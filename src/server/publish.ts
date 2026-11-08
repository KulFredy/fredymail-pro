/**
 * Doğrudan yayın (Faz 7): onaylı kanal paketinden YouTube'a yükleme.
 * Akış: önizleme (ne, nereye, hangi görünürlükle gidecek) → açık onay → yükleme işi → durum.
 * Aynı paket öğesi ikinci kez yüklenmez (yinelenen video olmaz); reklam ve bütçe kapsam dışı.
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { channelOf, normalizeTags } from '../core/channels';
import type { Project } from '../core/schema';
import type { Delivery, PackageEntry, PackageItem } from './delivery';
import type { Service } from './service';
import { newId } from './store';
import { YouTubeError, type YouTube } from './youtube';

export type Privacy = 'private' | 'unlisted' | 'public';
export type Publication = {
  id: string;
  platform: 'youtube';
  pkgId: string;
  outputId: string;
  channel: string | null;
  title: string;
  privacy: Privacy;
  publishAt: string | null;
  status: 'yukleniyor' | 'isleniyor' | 'hazir' | 'hata';
  steps: { video: boolean; thumbnail: boolean | null; captions: boolean | null };
  videoId: string | null;
  url: string | null;
  youtubeStatus?: { uploadStatus: string; privacyStatus: string; processing: string; problem: string; publishAt: string | null };
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

const YT_CHANNELS = new Set(['yt-video', 'yt-shorts']);

export class Publisher {
  constructor(
    private svc: Service,
    private delivery: Delivery,
    private yt: YouTube,
  ) {}

  private file = (projectId: string) => path.join(this.svc.store.exportsDir(projectId), 'yayinlar.json');
  async list(projectId: string): Promise<Publication[]> {
    try {
      return JSON.parse(await readFile(this.file(projectId), 'utf8')) as Publication[];
    } catch {
      return [];
    }
  }
  private async save(projectId: string, list: Publication[]) {
    await writeFile(this.file(projectId), JSON.stringify(list, null, 2));
  }
  private async upsert(projectId: string, pub: Publication) {
    const list = await this.list(projectId);
    const i = list.findIndex((p) => p.id === pub.id);
    pub.updatedAt = new Date().toISOString();
    if (i >= 0) list[i] = pub;
    else list.unshift(pub);
    await this.save(projectId, list);
    this.svc.store.emit('yayin', { projectId, pub });
  }

  private async find(projectId: string, pkgId: string, outputId: string) {
    const pkg = (await this.delivery.list(projectId)).find((p) => p.id === pkgId);
    if (!pkg) throw new YouTubeError('Paket bulunamadı', 'istek', 404);
    const item = pkg.items.find((i) => i.outputId === outputId);
    if (!item) throw new YouTubeError('Bu kanal pakette yok', 'istek', 404);
    return { pkg, item };
  }

  /** Projede yapay zekâyla üretilmiş görsel veya ses var mı? (YouTube “değiştirilmiş/sentetik içerik” beyanı) */
  private synthetic(project: Project) {
    const lib = this.svc.store.library;
    const gen = [...project.clips, ...project.overlays].some((c) => !!lib.get(c.assetId)?.generated);
    return gen || project.voice.some((v) => !!v.tts);
  }

  /** Yüklemeden önce gösterilecek her şey; engel varsa nedenleri */
  async preview(projectId: string, pkgId: string, outputId: string) {
    const { pkg, item } = await this.find(projectId, pkgId, outputId);
    const project = await this.svc.store.getProject(projectId);
    const output = project.outputs.find((o) => o.id === outputId);
    const dir = this.svc.store.abs(pkg.dir);
    const video = item.files.find((f) => f.kind === 'video');
    const cover = item.files.find((f) => f.kind === 'kapak');
    const srt = item.files.find((f) => f.kind === 'srt');
    const blockers: string[] = [];
    if (!YT_CHANNELS.has(item.channel ?? '')) blockers.push('Şimdilik yalnız YouTube video ve Shorts kanalları doğrudan yayınlanabilir.');
    if (!pkg.approved) blockers.push('Paket henüz onaylanmadı (Kanal paketi → Onayla).');
    const errs = item.checks.filter((c) => c.level === 'hata');
    if (errs.length) blockers.push(`Teslim kontrolünde ${errs.length} hata var: ${errs.map((c) => c.text).join('; ')}`.slice(0, 300));
    if (!video) blockers.push('Pakette video dosyası yok.');
    const meta = output?.meta;
    if (!meta?.title.trim()) blockers.push('Başlık boş.');
    const client = await this.yt.client();
    const connected = !!client && (await this.yt.connected());
    if (!connected) blockers.push('YouTube hesabı bağlı değil (Ayarlar → Bağlantılar → YouTube).');
    let channel: { id: string; title: string } | null = null;
    if (connected) channel = await this.yt.channel().catch(() => null);
    const prev = (await this.list(projectId)).find((p) => p.pkgId === pkgId && p.outputId === outputId && p.status !== 'hata');
    const size = video ? (await stat(path.join(dir, video.name))).size : 0;
    return {
      platform: 'YouTube',
      channel,
      kind: item.channel === 'yt-shorts' ? 'Shorts' : 'Video',
      file: video ? { name: video.name, size } : null,
      cover: cover ? `${pkg.dir}/${cover.name}` : null,
      captions: !!srt,
      title: meta?.title ?? '',
      description: meta?.description ?? '',
      tags: normalizeTags(meta?.tags ?? [], channelOf({ channel: item.channel })),
      containsSyntheticMedia: this.synthetic(project),
      already: prev ?? null,
      blockers,
    };
  }

  /** Açık onayla yükleme işini başlatır (aynı öğe zaten yüklendiyse o kaydı döner) */
  async publish(projectId: string, b: { pkgId: string; outputId: string; privacy: Privacy; publishAt?: string | null; madeForKids: boolean; containsSyntheticMedia: boolean; confirm: boolean }) {
    if (!b.confirm) throw new YouTubeError('Yayın için açık onay gerekli.', 'istek', 400);
    const pv = await this.preview(projectId, b.pkgId, b.outputId);
    if (pv.already) return { pub: pv.already, job: null };
    if (pv.blockers.length) throw new YouTubeError(pv.blockers.join(' '), 'istek', 409);
    if (b.publishAt && !(new Date(b.publishAt).getTime() > Date.now() + 15 * 60_000)) throw new YouTubeError('Zamanlanmış yayın en az 15 dakika sonrası olmalı.', 'istek', 400);
    const { pkg, item } = await this.find(projectId, b.pkgId, b.outputId);
    const now = new Date().toISOString();
    const pub: Publication = {
      id: `y_${newId()}`,
      platform: 'youtube',
      pkgId: b.pkgId,
      outputId: b.outputId,
      channel: item.channel,
      title: pv.title,
      privacy: b.privacy,
      publishAt: b.publishAt ?? null,
      status: 'yukleniyor',
      steps: { video: false, thumbnail: pv.cover ? false : null, captions: pv.captions ? false : null },
      videoId: null,
      url: null,
      error: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.upsert(projectId, pub);
    const job = this.svc.jobs.add('yayin', `YouTube'a yükleniyor: ${pv.title}`, { projectId }, (update) => this.run(projectId, pub, pkg, item, pv, b, update));
    return { pub, job };
  }

  private async run(
    projectId: string,
    pub: Publication,
    pkg: PackageEntry,
    item: PackageItem,
    pv: Awaited<ReturnType<Publisher['preview']>>,
    b: { privacy: Privacy; publishAt?: string | null; madeForKids: boolean; containsSyntheticMedia: boolean },
    update: (p: number, m?: string) => void,
  ) {
    const dir = this.svc.store.abs(pkg.dir);
    try {
      const video = item.files.find((f) => f.kind === 'video')!;
      const { videoId } = await this.yt.upload(
        path.join(dir, video.name),
        { title: pv.title, description: pv.description, tags: pv.tags, privacyStatus: b.privacy, publishAt: b.publishAt ?? null, madeForKids: b.madeForKids, containsSyntheticMedia: b.containsSyntheticMedia },
        (f) => update(f * 0.85, `Video yükleniyor %${Math.round(f * 100)}`),
      );
      pub.videoId = videoId;
      pub.url = item.channel === 'yt-shorts' ? `https://youtube.com/shorts/${videoId}` : `https://youtu.be/${videoId}`;
      pub.steps.video = true;
      pub.status = 'isleniyor';
      await this.upsert(projectId, pub);
      const problems: string[] = [];
      const cover = item.files.find((f) => f.kind === 'kapak');
      if (cover) {
        update(0.9, 'Küçük resim');
        // Küçük resim yüklemek YouTube'da doğrulanmış hesap ister; olmazsa video yine yayındadır
        try {
          await this.yt.setThumbnail(videoId, await readFile(path.join(dir, cover.name)));
          pub.steps.thumbnail = true;
        } catch (e) {
          problems.push(`Küçük resim yüklenemedi: ${(e as Error).message}`);
        }
      }
      const srt = item.files.find((f) => f.kind === 'srt');
      if (srt) {
        update(0.95, 'Altyazı');
        try {
          await this.yt.addCaptions(videoId, await readFile(path.join(dir, srt.name), 'utf8'));
          pub.steps.captions = true;
        } catch (e) {
          problems.push(`Altyazı yüklenemedi: ${(e as Error).message}`);
        }
      }
      pub.error = problems.length ? problems.join(' · ') : null;
      await this.upsert(projectId, pub);
      await this.refresh(projectId, pub.id).catch(() => undefined);
      return (await this.list(projectId)).find((p) => p.id === pub.id);
    } catch (e) {
      pub.status = pub.videoId ? 'isleniyor' : 'hata';
      pub.error = (e as Error).message;
      await this.upsert(projectId, pub);
      throw e;
    }
  }

  /** YouTube'daki durumu yeniler (işleniyor → hazır) */
  async refresh(projectId: string, pubId: string) {
    const pub = (await this.list(projectId)).find((p) => p.id === pubId);
    if (!pub) throw new YouTubeError('Yayın kaydı bulunamadı', 'istek', 404);
    if (!pub.videoId) return pub;
    const st = await this.yt.status(pub.videoId);
    if (!st.found) {
      pub.status = 'hata';
      pub.error = 'Video YouTube\'da bulunamadı (silinmiş olabilir).';
    } else {
      pub.youtubeStatus = { uploadStatus: st.uploadStatus, privacyStatus: st.privacyStatus, processing: st.processing, problem: st.problem, publishAt: st.publishAt };
      if (st.uploadStatus === 'failed' || st.uploadStatus === 'rejected' || st.processing === 'failed') {
        pub.status = 'hata';
        pub.error = `YouTube işleyemedi: ${st.problem || st.uploadStatus}`;
      } else pub.status = st.processing === 'succeeded' || st.uploadStatus === 'processed' ? 'hazir' : 'isleniyor';
    }
    await this.upsert(projectId, pub);
    return pub;
  }
}
