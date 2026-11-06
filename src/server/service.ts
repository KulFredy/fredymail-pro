import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { FORMATS } from '../core/formats';
import { parseCube } from '../core/lut';
import { buildRefs, lutUrls, type LutInfo } from '../core/refs';
import { AssetSchema, type Asset, type CompProps, type Project } from '../core/schema';
import { outputFrames } from '../core/timeline';
import { suggestedMusicMode } from '../core/timeline';
import { archiveOriginal, hashFile, processMedia } from '../media/ingest';
import { probe } from '../media/probe';
import { detectCamera } from '../media/camera';
import { verifyOutput, type Verification } from '../media/verify';
import { findWhisper, transcribe, type WhisperConfig } from '../media/whisper';
import { Jobs } from './jobs';
import { renderOutput } from './render';
import { Store, newId } from './store';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export type ExportEntry = {
  id: string;
  file: string;
  name: string;
  outputId: string;
  format: string;
  kind: 'video' | 'image';
  variant: 'full' | 'nomusic';
  createdAt: string;
  verification: Verification;
};

export class Service {
  store: Store;
  jobs = new Jobs();
  whisper: WhisperConfig = { bin: null, model: null, vadModel: null, mode: 'whisper' };
  port = 4747;

  constructor(home: string) {
    this.store = new Store(home);
  }

  async init() {
    await this.store.init();
    this.whisper = await findWhisper(this.store.home);
    // Yarım kalan işler: yeniden başlat
    for (const a of this.store.library.values()) {
      if (a.status === 'importing') this.enqueueProcess(a.id);
      else if (a.transcript.status === 'pending' || a.transcript.status === 'running') this.enqueueTranscribe(a.id);
      else if (a.transcript.status === 'unavailable' && this.whisper.model) this.enqueueTranscribe(a.id);
    }
  }

  baseUrl() {
    return `http://127.0.0.1:${this.port}`;
  }

  // ---------- İçe aktarma ----------

  /** Dosyayı arşive alır, hızlıca inceler, kütüphaneye ekler; ağır işlemler kuyrukta sürer */
  async importFile(tmpPath: string, name: string): Promise<Asset> {
    const sha = await hashFile(tmpPath);
    const existing = this.store.findBySha(sha);
    if (existing) {
      await rm(tmpPath, { force: true });
      if (existing.status === 'error') this.enqueueProcess(existing.id);
      return existing;
    }
    const ext = path.extname(name).toLowerCase() || '.bin';
    const id = sha.slice(0, 12);
    const origRel = `kutuphane/originals/${id}${ext}`;
    const origAbs = this.store.abs(origRel);
    await mkdir(path.dirname(origAbs), { recursive: true });
    await rename(tmpPath, origAbs).catch(async () => {
      await copyFile(tmpPath, origAbs);
      await rm(tmpPath, { force: true });
    });
    await archiveOriginal(origAbs, origAbs);
    const { size } = await stat(origAbs);
    const info = await probe(origAbs, ext);
    const camera = await detectCamera(origAbs, info);
    const asset = AssetSchema.parse({
      id,
      sha256: sha,
      kind: info.kind,
      name,
      ext,
      size,
      importedAt: new Date().toISOString(),
      status: 'importing',
      original: origRel,
      width: info.width,
      height: info.height,
      duration: info.kind === 'image' ? 0 : info.duration,
      fps: info.fps,
      hasAudio: info.hasAudio,
      hdr: info.hdr,
      bitDepth: info.bitDepth,
      codec: info.codec,
      rotation: info.rotation,
      camera,
      transcript: { status: info.kind === 'video' && info.hasAudio ? 'pending' : 'none' },
    });
    await this.store.upsertAsset(asset);
    this.enqueueProcess(id);
    return asset;
  }

  /** Yerel dosya yolundan içe aktarma (MCP ve testler için). Orijinal yerinde kalır. */
  async importPath(file: string): Promise<Asset> {
    const tmp = this.store.p('tmp', `${newId()}${path.extname(file)}`);
    await copyFile(file, tmp);
    return this.importFile(tmp, path.basename(file));
  }

  async importStream(stream: Readable, name: string): Promise<Asset> {
    const tmp = this.store.p('tmp', `${newId()}${path.extname(name)}`);
    await pipeline(stream, createWriteStream(tmp));
    return this.importFile(tmp, name);
  }

  enqueueProcess(id: string) {
    const a = this.store.library.get(id);
    if (!a) return;
    this.jobs.add('ingest', `Hazırlanıyor: ${a.name}`, { assetId: id }, async (update) => {
      try {
        const cacheDir = this.store.p('kutuphane', 'cache', id);
        const r = await processMedia(this.store.abs(a.original), a.ext, cacheDir, (f, m) => update(f, m));
        const rel = (p: string | null) => (p ? this.store.rel(p) : null);
        await this.store.patchAsset(id, {
          status: 'ready',
          error: '',
          preview: rel(r.preview),
          render: rel(r.render),
          poster: rel(r.poster),
          waveform: rel(r.waveform),
          width: r.width,
          height: r.height,
        });
        const cur = this.store.library.get(id)!;
        if (cur.kind === 'video' && cur.hasAudio && cur.transcript.status !== 'done') this.enqueueTranscribe(id);
      } catch (e) {
        await this.store.patchAsset(id, { status: 'error', error: (e as Error).message });
        throw e;
      }
    });
  }

  enqueueTranscribe(id: string) {
    const a = this.store.library.get(id);
    if (!a || a.kind !== 'video') return;
    void this.store.patchAsset(id, { transcript: { ...a.transcript, status: 'pending', message: 'Sırada' } });
    this.jobs.add('transcribe', `Türkçe konuşma çözülüyor: ${a.name}`, { assetId: id }, async (update) => {
      const cur = this.store.library.get(id)!;
      await this.store.patchAsset(id, { transcript: { ...cur.transcript, status: 'running', message: 'Çözülüyor' } });
      try {
        const res = await transcribe(this.store.abs(cur.original), cur.name, this.whisper, (f) => update(f, 'Konuşma çözülüyor'));
        await this.store.patchAsset(id, { transcript: { ...res, language: 'tr' } });
        this.store.emit('transcript', { assetId: id, words: res.words.length });
        return { words: res.words.length, status: res.status };
      } catch (e) {
        await this.store.patchAsset(id, { transcript: { status: 'error', words: [], language: 'tr', engine: '', message: (e as Error).message } });
        throw e;
      }
    });
  }

  /** Telefondan/sürükle-bırakla gelen dosyaları projeye ekler (seçim sırasıyla) */
  async addAssetsToProject(projectId: string, assets: Asset[], source = 'ui') {
    const clipIds = assets.filter((a) => a.kind !== 'audio').map((a) => a.id);
    const ops: any[] = [];
    if (clipIds.length) ops.push({ type: 'clips.add', assetIds: clipIds });
    const project = await this.store.getProject(projectId);
    const music = assets.find((a) => a.kind === 'audio');
    if (music && !project.music) {
      const speech = project.clips.some((c) => (this.store.library.get(c.assetId)?.transcript.words.length ?? 0) > 0);
      ops.push({ type: 'music.set', music: { assetId: music.id, mode: suggestedMusicMode(speech) } });
    }
    if (ops.length) return this.store.applyOps(projectId, ops, source);
    return this.store.getProjectState(projectId);
  }

  // ---------- LUT ----------
  async listLuts(): Promise<LutInfo[]> {
    const kamera = JSON.parse(await readFile(path.join(ROOT, 'assets', 'luts', 'kamera', 'index.json'), 'utf8')) as { id: string; title: string }[];
    const out: LutInfo[] = kamera.map((k) => ({ id: k.id, title: k.title, group: 'kamera', path: `/luts/kamera/${k.id}.cube` }));
    const userDir = this.store.p('kutuphane', 'luts');
    for (const f of (await readdir(userDir).catch(() => [])).filter((f) => f.toLowerCase().endsWith('.cube')).sort()) {
      out.push({ id: `kullanici:${f}`, title: f.replace(/\.cube$/i, ''), group: 'kullanici', path: `/files/kutuphane/luts/${f}` });
    }
    return out;
  }

  async addLut(name: string, content: string) {
    parseCube(content); // geçerli mi?
    const safe = name.replace(/[/\\]/g, '_').replace(/\.cube$/i, '') + '.cube';
    await writeFile(this.store.p('kutuphane', 'luts', safe), content);
    return { id: `kullanici:${safe}` };
  }

  // ---------- Render ----------
  async compProps(project: Project, outputId: string, variant: 'full' | 'nomusic', target: 'preview' | 'render'): Promise<CompProps> {
    const base = this.baseUrl();
    return {
      project,
      assets: buildRefs(this.store.library.values(), base, target),
      outputId,
      variant,
      target,
      luts: lutUrls(await this.listLuts(), base),
    };
  }

  async listExports(projectId: string): Promise<ExportEntry[]> {
    const file = path.join(this.store.exportsDir(projectId), 'manifest.json');
    try {
      return JSON.parse(await readFile(file, 'utf8')) as ExportEntry[];
    } catch {
      return [];
    }
  }

  private async addExport(projectId: string, e: ExportEntry) {
    const list = [e, ...(await this.listExports(projectId))];
    await writeFile(path.join(this.store.exportsDir(projectId), 'manifest.json'), JSON.stringify(list, null, 2));
  }

  enqueueRender(projectId: string, outputId: string, variant: 'full' | 'nomusic' = 'full') {
    return this.jobs.add('render', `Dışa aktarılıyor`, { projectId, outputId }, async (update) => {
      const project = await this.store.getProject(projectId);
      const output = project.outputs.find((o) => o.id === outputId);
      if (!output) throw new Error('Çıktı bulunamadı');
      if (!project.clips.length) throw new Error('Projede klip yok');
      const notReady = project.clips.map((c) => this.store.library.get(c.assetId)).filter((a) => !a || a.status !== 'ready');
      if (notReady.length) throw new Error('Bazı klipler hâlâ hazırlanıyor; biraz sonra tekrar deneyin');
      const fmt = FORMATS[output.format];
      const d = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
      const ext = output.kind === 'video' ? 'mp4' : 'jpg';
      const dir = this.store.exportsDir(projectId);
      await mkdir(dir, { recursive: true });
      // Önceki çıktıların üzerine asla yazma
      let name = `${fmt.id}_${stamp}${variant === 'nomusic' ? '_muziksiz' : ''}.${ext}`;
      for (let i = 2; await stat(path.join(dir, name)).then(() => true, () => false); i++)
        name = `${fmt.id}_${stamp}-${i}${variant === 'nomusic' ? '_muziksiz' : ''}.${ext}`;
      const outFile = path.join(dir, name);
      const props = await this.compProps(project, outputId, variant, 'render');
      const meta = await renderOutput({ props, outFile, kind: output.kind, onProgress: update });
      update(0.99, 'Çıktı doğrulanıyor');
      const verification = await verifyOutput(outFile, {
        kind: output.kind,
        width: fmt.width,
        height: fmt.height,
        duration: output.kind === 'video' ? outputFrames(project, output) / meta.fps : undefined,
      });
      const entry: ExportEntry = {
        id: `e_${newId()}`,
        file: this.store.rel(outFile),
        name,
        outputId,
        format: output.format,
        kind: output.kind,
        variant,
        createdAt: new Date().toISOString(),
        verification,
      };
      await this.addExport(projectId, entry);
      this.store.emit('export', { projectId, entry });
      return entry;
    });
  }
}
