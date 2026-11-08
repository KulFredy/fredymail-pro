import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { FORMATS, RESOLUTION_LABELS, renderSize, resolutionScale } from '../core/formats';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { parseCube } from '../core/lut';
import { buildMatchLut, colorStats, describeMatch, labToRgb, mergeStats, type ColorStats } from '../core/colormatch';
import { effectiveCamera } from '../core/looks';
import { sampleLut } from '../core/lut';
import { LutMetaSchema, classifyLut, lutFormat, parse3dl, toCube, unsupportedReason, type LutMeta } from '../core/lutlib';
import { getTools, runOk } from '../media/proc';
import { buildRefs, lutUrls, type LutInfo } from '../core/refs';
import { AssetSchema, type Asset, type CompProps, type Project } from '../core/schema';
import { layoutClips, outputFrames } from '../core/timeline';
import { suggestedMusicMode } from '../core/timeline';
import { archiveOriginal, hashFile, processMedia } from '../media/ingest';
import { probe } from '../media/probe';
import { detectCamera } from '../media/camera';
import { verifyOutput, type Verification } from '../media/verify';
import { findWhisper, transcribe, type WhisperConfig } from '../media/whisper';
import { detectBeats } from '../media/beats';
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
  /** Dış servis bağlantıları (index.ts kurar) */
  conns!: import('./connections').Connections;

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
      if (a.kind === 'audio' && a.status === 'ready' && !a.beats) this.ensureBeats(a.id);
    }
  }

  /** Müzik vuruşlarını sırayla (arka planda) hesapla */
  private beatQueue: Promise<void> = Promise.resolve();
  ensureBeats(id: string) {
    this.beatQueue = this.beatQueue.then(async () => {
      const a = this.store.library.get(id);
      if (!a || a.kind !== 'audio' || a.beats) return;
      try {
        const b = await detectBeats(this.store.abs(a.original));
        await this.store.patchAsset(id, { beats: b });
      } catch (e) {
        console.error(`[vuruş] ${a.name}: ${(e as Error).message}`);
      }
    });
    return this.beatQueue;
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
          alpha: !!r.alpha,
          width: r.width,
          height: r.height,
        });
        const cur = this.store.library.get(id)!;
        const wantsWords = ((cur.kind === 'video' && cur.hasAudio) || cur.role === 'voiceover') && cur.role !== 'reference';
        if (wantsWords && cur.transcript.status !== 'done') this.enqueueTranscribe(id);
        if (cur.kind === 'audio') void this.ensureBeats(id);
      } catch (e) {
        await this.store.patchAsset(id, { status: 'error', error: (e as Error).message });
        throw e;
      }
    });
  }

  enqueueTranscribe(id: string) {
    const a = this.store.library.get(id);
    if (!a || (a.kind !== 'video' && a.role !== 'voiceover')) return;
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

  /** Kurgu talimatı: sesi yazıya çevirir. Kayıt kütüphaneye girmez, dış sesten ayrıdır. */
  async speechToText(tmpFile: string): Promise<{ text: string; status: string; message: string }> {
    try {
      if (this.whisper.mode === 'fixture') {
        const dir = process.env.FABRIKA_FIXTURES ?? '';
        const text = process.env.FABRIKA_STT_FIXTURE ?? (await readFile(path.join(dir, 'komut.txt'), 'utf8').catch(() => ''));
        return { text: text.trim(), status: 'done', message: '' };
      }
      const r = await transcribe(tmpFile, 'komut', this.whisper);
      return { text: r.words.map((w) => w.text).join(' ').trim(), status: r.status, message: r.message };
    } finally {
      await rm(tmpFile, { force: true });
    }
  }

  /** Dış ses kaydı: kütüphaneye "voiceover" olarak girer, projede oynatma imlecine yerleşir */
  /** Referans ekle (yeni yüklenen dosya Medya listesinde görünmesin diye rolü 'reference' olur) */
  async addReference(projectId: string, asset: Asset, isNew: boolean) {
    if (isNew) await this.store.patchAsset(asset.id, { role: 'reference' });
    return this.store.applyOps(projectId, [{ type: 'reference.add', assetId: asset.id }], 'ui', 'Referans eklendi');
  }

  /** Bir kaynağın karesinin RGB pikselleri (gerekirse kamera dönüşümü uygulanmış) */
  private async framePixels(assetId: string, t: number, camera: string | null, region: { x: number; y: number; w: number; h: number } | null = null) {
    const sharp = (await import('sharp')).default;
    const file = await this.assetFrame(assetId, t, region ? 640 : 256);
    let img = sharp(file).removeAlpha();
    if (region) {
      const m = await sharp(file).metadata();
      const W = m.width ?? 1;
      const H = m.height ?? 1;
      const left = Math.max(0, Math.min(W - 2, Math.round(region.x * W)));
      const top = Math.max(0, Math.min(H - 2, Math.round(region.y * H)));
      img = img.extract({ left, top, width: Math.max(2, Math.min(W - left, Math.round(region.w * W))), height: Math.max(2, Math.min(H - top, Math.round(region.h * H))) });
    }
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    if (!camera) return { data, channels: info.channels };
    const lut = parseCube(await readFile(path.join(ROOT, 'assets', 'luts', 'kamera', `${camera}.cube`), 'utf8'));
    const out = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i += info.channels) {
      const [r, g, b] = sampleLut(lut, data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
      out[i] = Math.round(r * 255);
      out[i + 1] = Math.round(g * 255);
      out[i + 2] = Math.round(b * 255);
    }
    return { data: out, channels: info.channels };
  }

  /**
   * Referanstan renk eşleme: referans karesi ile hedef klip(ler)in karelerini karşılaştırır,
   * eşleme LUT'u üretip LUT'larım'a (#referans) kaydeder. Uygulamaz; arayüz önizletip onaylatır.
   */
  async colorMatch(projectId: string, referenceId: string, clipId: string | null) {
    const project = await this.store.getProject(projectId);
    const ref = project.references.find((r) => r.id === referenceId);
    if (!ref) throw new Error('Referans bulunamadı');
    const refAsset = this.store.library.get(ref.assetId);
    if (!refAsset || refAsset.status !== 'ready') throw new Error('Referans henüz hazır değil');
    const targets = (clipId ? project.clips.filter((c) => c.id === clipId) : project.clips).filter((c) => {
      const a = this.store.library.get(c.assetId);
      return a && a.kind !== 'audio' && a.status === 'ready';
    });
    if (!targets.length) throw new Error('Eşlenecek klip yok');
    const rp = await this.framePixels(refAsset.id, ref.at, null, ref.region);
    const refStats = colorStats(rp.data, rp.channels);
    const tStats: ColorStats[] = [];
    for (const c of targets.slice(0, 8)) {
      const a = this.store.library.get(c.assetId)!;
      const cam = effectiveCamera(c, a.camera.detected ?? null);
      const times = a.kind === 'video' ? [0.2, 0.5, 0.8].map((k) => c.in + (c.out - c.in) * k) : [0];
      for (const t of times) {
        const fp = await this.framePixels(a.id, t, cam);
        tStats.push(colorStats(fp.data, fp.channels));
      }
    }
    const target = mergeStats(tStats);
    const lut = buildMatchLut(target, refStats, 33);
    const refName = refAsset.name.replace(/\.[^.]+$/, '');
    const name = `Referans · ${refName}`;
    const [row] = await this.importLuts([{ name: `${name}.cube`, data: Buffer.from(toCube(lut, name)) }]);
    if (!row.id) throw new Error(row.reason ?? 'LUT kaydedilemedi');
    const meta = await this.updateLut(row.id, { tags: ['referans'] });
    const hex = (lab: [number, number, number]) => '#' + labToRgb(lab).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('');
    return {
      lutId: row.id,
      name: meta.name,
      summary: describeMatch(target, refStats),
      swatches: { reference: hex(refStats.mean), target: hex(target.mean) },
      clips: targets.length,
    };
  }

  async addVoiceover(projectId: string, asset: Asset, at: number) {
    await this.store.patchAsset(asset.id, { role: 'voiceover' });
    return this.store.applyOps(projectId, [{ type: 'voice.add', assetId: asset.id, at }], 'ui', 'Dış ses kaydı eklendi');
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

  // ---------- LUT Kütüphanem ----------
  private lutMeta: Record<string, LutMeta> | null = null;
  private lutMetaFile() {
    return this.store.p('kutuphane', 'luts.json');
  }
  private async loadLutMeta() {
    if (this.lutMeta) return this.lutMeta;
    const out: Record<string, LutMeta> = {};
    try {
      const raw = JSON.parse(await readFile(this.lutMetaFile(), 'utf8')) as Record<string, unknown>;
      for (const [id, v] of Object.entries(raw)) {
        const r = LutMetaSchema.safeParse(v);
        if (r.success) out[id] = r.data;
      }
    } catch {
      /* ilk kullanım */
    }
    this.lutMeta = out;
    return out;
  }
  private async saveLutMeta() {
    await writeFile(this.lutMetaFile(), JSON.stringify(this.lutMeta ?? {}, null, 2));
  }
  private static lutHash = (cube: string) => createHash('sha256').update(cube.replace(/\r\n/g, '\n').trim()).digest('hex').slice(0, 16);

  /** Projelerde hangi LUT kaç kez kullanılıyor (silmeden önce uyarı için) */
  private async lutUses(): Promise<Record<string, number>> {
    const uses: Record<string, number> = {};
    for (const s of await this.store.listProjects()) {
      try {
        const p = await this.store.getProject(s.id);
        const ids = new Set([p.look.lut, ...p.clips.map((c) => c.look?.lut ?? null)].filter(Boolean) as string[]);
        for (const id of ids) uses[id] = (uses[id] ?? 0) + 1;
      } catch {
        /* bozuk proje: say */
      }
    }
    return uses;
  }

  async listLuts(withUses = false): Promise<LutInfo[]> {
    const kamera = JSON.parse(await readFile(path.join(ROOT, 'assets', 'luts', 'kamera', 'index.json'), 'utf8')) as { id: string; title: string }[];
    const out: LutInfo[] = kamera.map((k) => ({ id: k.id, title: k.title, group: 'kamera', path: `/luts/kamera/${k.id}.cube` }));
    const userDir = this.store.p('kutuphane', 'luts');
    const meta = await this.loadLutMeta();
    let dirty = false;
    const uses = withUses ? await this.lutUses() : {};
    for (const f of (await readdir(userDir).catch(() => [])).filter((f) => f.toLowerCase().endsWith('.cube')).sort((a, b) => a.localeCompare(b, 'tr'))) {
      const id = `kullanici:${f}`;
      if (!meta[id]) {
        // Faz 4 öncesi eklenmiş LUT: bilgilerini bir kez çıkar
        try {
          const text = await readFile(path.join(userDir, f), 'utf8');
          const lut = parseCube(text);
          const name = f.replace(/\.cube$/i, '');
          meta[id] = LutMetaSchema.parse({ name, ...classifyLut(f, lut.title), size: lut.size, hash: Service.lutHash(text), source: f, addedAt: new Date().toISOString() });
          dirty = true;
        } catch {
          continue; // okunamayan dosya listelenmez
        }
      }
      out.push({ id, title: meta[id].name, group: 'kullanici', path: `/files/kutuphane/luts/${f}`, meta: meta[id], ...(withUses ? { uses: uses[id] ?? 0 } : {}) });
    }
    if (dirty) await this.saveLutMeta();
    return out;
  }

  /**
   * Toplu içe aktarma: .cube, .3dl (→ .cube'a çevrilir) ve bunları içeren .zip.
   * Aynı içerik ikinci kez eklenmez. Her dosya için sonuç döner.
   */
  async importLuts(files: { name: string; data: Buffer }[]) {
    type Row = { file: string; status: 'eklendi' | 'vardi' | 'hata'; id?: string; name?: string; reason?: string; kind?: string; input?: string | null };
    const report: Row[] = [];
    const meta = await this.loadLutMeta();
    await this.listLuts(); // eski dosyaların bilgisi hazır olsun
    const byHash = new Map(Object.entries(meta).map(([id, m]) => [m.hash, id]));
    const userDir = this.store.p('kutuphane', 'luts');
    await mkdir(userDir, { recursive: true });

    // Zip'leri aç
    const flat: { name: string; data: Buffer }[] = [];
    for (const f of files) {
      if (lutFormat(f.name) !== 'zip') {
        flat.push(f);
        continue;
      }
      const dir = path.join(os.tmpdir(), `fabrika-lut-${newId()}`);
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, 'paket.zip'), f.data);
        await runOk('unzip', ['-qq', '-o', '-j', path.join(dir, 'paket.zip'), '-d', path.join(dir, 'acik')]);
        const inner = (await readdir(path.join(dir, 'acik')).catch(() => [])).filter((n) => !n.startsWith('.') && !n.startsWith('__'));
        if (!inner.length) report.push({ file: f.name, status: 'hata', reason: 'Zip boş' });
        for (const n of inner) flat.push({ name: `${f.name} › ${n}`, data: await readFile(path.join(dir, 'acik', n)) });
      } catch {
        report.push({ file: f.name, status: 'hata', reason: 'Zip açılamadı' });
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }

    for (const f of flat) {
      const base = f.name.split(' › ').pop()!;
      const fmt = lutFormat(base);
      if (fmt !== 'cube' && fmt !== '3dl') {
        report.push({ file: f.name, status: 'hata', reason: unsupportedReason(base) });
        continue;
      }
      let cube: string;
      let lut;
      const name = base.replace(/\.(cube|3dl)$/i, '').replace(/_/g, ' ').trim() || 'LUT';
      try {
        const text = f.data.toString('utf8');
        if (fmt === 'cube') {
          if (/^\s*LUT_1D_SIZE/im.test(text) && /^\s*LUT_3D_SIZE/im.test(text)) throw new Error('1B + 3B (shaper) LUT desteklenmiyor');
          lut = parseCube(text);
          cube = text;
        } else {
          lut = parse3dl(text);
          cube = toCube(lut, name);
        }
      } catch (e) {
        report.push({ file: f.name, status: 'hata', reason: (e as Error).message });
        continue;
      }
      const hash = Service.lutHash(cube);
      const existing = byHash.get(hash);
      if (existing) {
        report.push({ file: f.name, status: 'vardi', id: existing, name: meta[existing]?.name });
        continue;
      }
      const stem = name.replace(/[/\\:*?"<>|]/g, '_').slice(0, 80);
      let fileName = `${stem}.cube`;
      for (let i = 2; await stat(path.join(userDir, fileName)).then(() => true, () => false); i++) fileName = `${stem} (${i}).cube`;
      await writeFile(path.join(userDir, fileName), cube);
      const id = `kullanici:${fileName}`;
      const c = classifyLut(base, lut.title);
      meta[id] = LutMetaSchema.parse({ name, ...c, size: lut.size, hash, source: base, addedAt: new Date().toISOString() });
      byHash.set(hash, id);
      report.push({ file: f.name, status: 'eklendi', id, name, kind: c.kind, input: c.input });
    }
    await this.saveLutMeta();
    return report;
  }

  /** Eski arayüz uyumu: tek .cube metni */
  async addLut(name: string, content: string) {
    const [r] = await this.importLuts([{ name: lutFormat(name) ? name : `${name}.cube`, data: Buffer.from(content) }]);
    if (r.status === 'hata') throw new Error(r.reason);
    return { id: r.id! };
  }

  async updateLut(id: string, patch: Partial<Pick<LutMeta, 'name' | 'kind' | 'input' | 'tags' | 'favorite'>>) {
    const meta = await this.loadLutMeta();
    if (!meta[id]) throw new Error('LUT bulunamadı');
    const next = { ...meta[id], ...patch };
    if (patch.kind === 'gorunum') next.input = null;
    if (patch.tags) next.tags = [...new Set(patch.tags.map((t) => t.toLocaleLowerCase('tr')))];
    meta[id] = LutMetaSchema.parse(next);
    await this.saveLutMeta();
    return meta[id];
  }

  async deleteLut(id: string) {
    const meta = await this.loadLutMeta();
    if (!id.startsWith('kullanici:')) throw new Error('Yalnız kendi eklediğiniz LUT silinebilir');
    await rm(this.store.p('kutuphane', 'luts', id.slice('kullanici:'.length)), { force: true });
    delete meta[id];
    await this.saveLutMeta();
  }

  /** Küçük önizleme karesi (LUT kütüphanesi için): videoda t. saniye, fotoğrafta kendisi; önbellekli JPEG */
  async assetFrame(id: string, t: number, width: number) {
    const a = this.store.library.get(id);
    if (!a || a.kind === 'audio') throw new Error('Kare alınamaz');
    const src = this.store.abs(a.preview ?? a.render ?? a.original);
    const w = Math.max(64, Math.min(960, Math.round(width / 16) * 16));
    const ts = a.kind === 'video' ? Math.max(0, Math.min(a.duration - 0.05, t)) : 0;
    const out = this.store.p('kutuphane', 'cache', id, `kare-${ts.toFixed(2)}-${w}.jpg`);
    if (!(await stat(out).then(() => true, () => false))) {
      await mkdir(path.dirname(out), { recursive: true });
      const { ffmpeg } = await getTools();
      await runOk(ffmpeg, ['-hide_banner', '-v', 'error', '-y', ...(a.kind === 'video' ? ['-ss', ts.toFixed(3)] : []), '-i', src, '-frames:v', '1', '-vf', `scale=${w}:-2`, '-q:v', '4', out]);
    }
    return out;
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
    return this.jobs.add('render', `Dışa aktarılıyor`, { projectId, outputId }, (update) => this.renderNow(projectId, outputId, variant, update));
  }

  /** Bir çıktıyı hemen render eder ve doğrular (iş kuyruğu dışında; paket işi de kullanır) */
  async renderNow(projectId: string, outputId: string, variant: 'full' | 'nomusic', update: (p: number, m?: string) => void, opts: { record?: boolean } = {}): Promise<ExportEntry> {
    {
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
      const res = output.resolution ?? '1080';
      const tag = `${fmt.id}_${RESOLUTION_LABELS[res].toLowerCase()}`;
      let name = `${tag}_${stamp}${variant === 'nomusic' ? '_muziksiz' : ''}.${ext}`;
      for (let i = 2; await stat(path.join(dir, name)).then(() => true, () => false); i++)
        name = `${tag}_${stamp}-${i}${variant === 'nomusic' ? '_muziksiz' : ''}.${ext}`;
      const outFile = path.join(dir, name);
      const props = await this.compProps(project, outputId, variant, 'render');
      const meta = await renderOutput({ props, outFile, kind: output.kind, onProgress: update, scale: resolutionScale(res) });
      update(0.99, 'Çıktı doğrulanıyor');
      const size = renderSize(output.format, res);
      const verification = await verifyOutput(outFile, {
        kind: output.kind,
        width: size.width,
        height: size.height,
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
      if (opts.record !== false) {
        await this.addExport(projectId, entry);
        this.store.emit('export', { projectId, entry });
      }
      return entry;
    }
  }

  /** Kapak/küçük resim: kurgunun bir anındaki kare (+ isteğe bağlı başlık) JPEG olarak */
  async renderCover(project: Project, outputId: string, at: number, title: CompProps['coverTitle'], outFile: string, resolution: '720' | '1080', format?: Project['outputs'][number]['format']) {
    const output = project.outputs.find((o) => o.id === outputId);
    if (!output) throw new Error('Çıktı bulunamadı');
    const layout = layoutClips(project);
    const item = layout.find((l) => at >= l.start && at < l.end) ?? layout[layout.length - 1];
    if (!item) throw new Error('Projede klip yok');
    const still = { clipId: item.clip.id, at: Math.max(0, Math.min(item.duration - 0.05, at - item.start)) };
    const coverOut = { ...output, id: `${output.id}_kapak`, format: format ?? output.format, kind: 'image' as const, still, captions: { enabled: false } };
    const framing = coverOut.format === output.format ? output.framing : {};
    const p2: Project = { ...structuredClone(project), outputs: [{ ...coverOut, framing }] };
    for (const el of [...p2.texts, ...p2.logos]) if (el.placements[output.id]) el.placements = { ...el.placements, [coverOut.id]: el.placements[output.id] };
    const props = { ...(await this.compProps(p2, coverOut.id, 'full', 'render')), coverTitle: title ?? null };
    await renderOutput({ props, outFile, kind: 'image', onProgress: () => undefined, scale: resolutionScale(resolution) });
    return outFile;
  }
}
