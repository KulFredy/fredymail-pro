/**
 * Kanal teslim paketi (Faz 6): seçilen kanallar için video/görsel, kapak, altyazı dosyası, yayın metinleri
 * ve kontrol raporu tek klasörde + zip. Onaylanan paket marka → ürün → kampanya klasörüne kopyalanır;
 * orijinaller (kütüphane), varyantlar (exports) ve onaylı sonuçlar (teslim/) ayrı kalır.
 */
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { slug, type Brand } from '../core/brand';
import { CHANNELS, channelOf, normalizeTags, outputName, type ChannelInfo } from '../core/channels';
import { AREA_LABELS, captionCues, deliveryChecks, summarize, toSrt, toVtt, type Check, type Loudness } from '../core/delivery';
import { buildRefs } from '../core/refs';
import type { Output, OutputMeta, Project, ProjectBrand } from '../core/schema';
import { timelineWords } from '../core/timeline';
import { measureLoudness } from '../media/loudness';
import { runOk } from '../media/proc';
import type { Brands } from './brands';
import type { Service } from './service';
import { newId } from './store';

export type PackageFile = { kind: 'video' | 'gorsel' | 'kapak' | 'srt' | 'vtt'; name: string };
export type PackageItem = { outputId: string; channel: string | null; label: string; files: PackageFile[]; checks: Check[]; loudness: Loudness | null; verified: boolean };
export type PackageEntry = {
  id: string;
  name: string;
  dir: string;
  zip: string;
  createdAt: string;
  brand: ProjectBrand | null;
  items: PackageItem[];
  errors: number;
  warnings: number;
  approved: boolean;
  approvedAt?: string;
  approvedDir?: string;
};

const pad = (n: number) => String(n).padStart(2, '0');
const stampNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
};
const exists = (f: string) => stat(f).then(
  () => true,
  () => false,
);
const ICON = { ok: '✓', uyari: '⚠', hata: '✗' } as const;

/** metinler.txt: kanal başına doldurulmuş alanlar (kopyala-yapıştır için) */
export const metaText = (project: Project, outputs: Output[]) => {
  const lines: string[] = [];
  const b = project.brand;
  lines.push(`${project.name}${b ? ` — ${[b.brandName, b.productName, b.campaign].filter(Boolean).join(' / ')}` : ''}`, '');
  for (const o of outputs) {
    const ch = channelOf(o);
    lines.push(`=== ${outputName(o)} ===`);
    const fields = ch?.fields ?? { description: { label: 'Açıklama', max: 2200 } };
    for (const [k, f] of Object.entries(fields)) {
      if (!f) continue;
      const v = k === 'tags' ? normalizeTags(o.meta.tags, ch).join(ch?.platform === 'YouTube' ? ', ' : ' ') : String(o.meta[k as keyof OutputMeta] ?? '');
      lines.push(`${f.label}:`, v || '(boş)', '');
    }
    if (!Object.keys(fields).length) lines.push('(Bu kanalda metin alanı yok)', '');
  }
  return lines.join('\n');
};

export const checkText = (items: PackageItem[]) =>
  items
    .map((it) => [`=== ${it.label} ===`, ...it.checks.map((c) => `${ICON[c.level]} ${AREA_LABELS[c.area]}: ${c.text}`), ''].join('\n'))
    .join('\n');

export class Delivery {
  constructor(
    private svc: Service,
    private brands: Brands,
  ) {}

  private file = (projectId: string) => path.join(this.svc.store.exportsDir(projectId), 'paketler.json');
  async list(projectId: string): Promise<PackageEntry[]> {
    try {
      return JSON.parse(await readFile(this.file(projectId), 'utf8')) as PackageEntry[];
    } catch {
      return [];
    }
  }
  private async save(projectId: string, list: PackageEntry[]) {
    await mkdir(this.svc.store.exportsDir(projectId), { recursive: true });
    await writeFile(this.file(projectId), JSON.stringify(list, null, 2));
  }

  private unapproved() {
    return new Set([...this.svc.store.library.values()].filter((a) => a.role === 'uretim').map((a) => a.id));
  }
  private async brandOf(project: Project): Promise<Brand | null> {
    return project.brand ? await this.brands.get(project.brand.brandId) : null;
  }

  /** Paket öncesi kontroller (ses yüksekliği son paketten alınır, yoksa çıktıdan sonra ölçülür) */
  async checks(projectId: string) {
    const project = await this.svc.store.getProject(projectId);
    const assets = buildRefs(this.svc.store.library.values(), '', 'render');
    const brand = await this.brandOf(project);
    const last = (await this.list(projectId))[0];
    const unapproved = this.unapproved();
    return project.outputs.map((o) => {
      const loud = last?.items.find((i) => i.outputId === o.id)?.loudness ?? null;
      const checks = deliveryChecks({ project, assets, output: o, brand, unapprovedAssetIds: unapproved, loudness: loud });
      return { outputId: o.id, label: outputName(o), checks, ...summarize(checks) };
    });
  }

  enqueue(projectId: string, outputIds: string[]) {
    return this.svc.jobs.add('paket', 'Kanal paketi hazırlanıyor', { projectId }, (update) => this.build(projectId, outputIds, update));
  }

  private async build(projectId: string, outputIds: string[], update: (p: number, m?: string) => void): Promise<PackageEntry> {
    const project = await this.svc.store.getProject(projectId);
    const outputs = outputIds.map((id) => project.outputs.find((o) => o.id === id)).filter((o): o is Output => !!o);
    if (!outputs.length) throw new Error('Pakete girecek kanal seçin');
    const brand = await this.brandOf(project);
    const b = project.brand;
    const baseName = [b?.brandName, b?.productName, b?.campaign].filter(Boolean).map((x) => slug(x!)).join('_') || slug(project.name);
    const exportsDir = this.svc.store.exportsDir(projectId);
    let name = `paket_${baseName}_${stampNow()}`;
    for (let i = 2; await exists(path.join(exportsDir, name)); i++) name = `paket_${baseName}_${stampNow()}-${i}`;
    const dir = path.join(exportsDir, name);
    await mkdir(dir, { recursive: true });
    const assets = buildRefs(this.svc.store.library.values(), '', 'render');
    const hasWords = timelineWords(project, assets).length > 0;
    const items: PackageItem[] = [];
    const steps = outputs.length;
    for (const [i, o] of outputs.entries()) {
      const ch: ChannelInfo | null = channelOf(o);
      const label = outputName(o);
      const chSlug = ch ? ch.id : `${o.format}-${o.kind}`;
      const prefix = `${baseName}_${chSlug}`;
      const sub = (k: number, msg: string) => update((i + k) / steps, `${label}: ${msg}`);
      sub(0, 'render');
      const entry = await this.svc.renderNow(projectId, o.id, 'full', (p, m) => sub(p * 0.8, m ?? 'render'));
      const files: PackageFile[] = [];
      const ext = o.kind === 'video' ? 'mp4' : 'jpg';
      await copyFile(this.svc.store.abs(entry.file), path.join(dir, `${prefix}.${ext}`));
      files.push({ kind: o.kind === 'video' ? 'video' : 'gorsel', name: `${prefix}.${ext}` });
      let loudness: Loudness | null = null;
      if (o.kind === 'video') {
        sub(0.82, 'ses yüksekliği ölçülüyor');
        loudness = await measureLoudness(this.svc.store.abs(entry.file)).catch(() => null);
      }
      if (ch?.cover && o.kind === 'video') {
        sub(0.88, 'kapak');
        const title = o.cover?.title ? { text: o.cover.title, font: brand?.fonts.heading ?? 'Montserrat', color: brand?.textColor ?? '#FFFFFF', accent: brand?.accentColor ?? '#FFD60A' } : null;
        const coverName = `${prefix}_kapak.jpg`;
        await this.svc.renderCover(project, o.id, o.cover?.at ?? 0, title, path.join(dir, coverName), ch.cover.resolution, ch.cover.format);
        files.push({ kind: 'kapak', name: coverName });
      }
      if (ch?.captionFile && hasWords && o.kind === 'video') {
        const cues = captionCues(project, assets);
        await writeFile(path.join(dir, `${prefix}.srt`), toSrt(cues));
        await writeFile(path.join(dir, `${prefix}.vtt`), toVtt(cues));
        files.push({ kind: 'srt', name: `${prefix}.srt` }, { kind: 'vtt', name: `${prefix}.vtt` });
      }
      const checks = deliveryChecks({ project, assets, output: o, brand, unapprovedAssetIds: this.unapproved(), loudness });
      if (!entry.verification.ok) checks.unshift({ id: 'dogrulama', area: 'kadraj', level: 'hata', text: `Dosya doğrulaması: ${entry.verification.checks.filter((c) => !c.ok).map((c) => c.label).join(', ')}` });
      items.push({ outputId: o.id, channel: o.channel, label, files, checks, loudness, verified: entry.verification.ok });
    }
    update(0.97, 'Metinler ve rapor yazılıyor');
    await writeFile(path.join(dir, 'metinler.txt'), metaText(project, outputs));
    await writeFile(path.join(dir, 'kontrol.txt'), checkText(items));
    const all = items.flatMap((i) => i.checks);
    const pkg: PackageEntry = {
      id: `k_${newId()}`,
      name,
      dir: this.svc.store.rel(dir),
      zip: this.svc.store.rel(`${dir}.zip`),
      createdAt: new Date().toISOString(),
      brand: project.brand,
      items,
      ...summarize(all),
      approved: false,
    };
    await writeFile(path.join(dir, 'paket.json'), JSON.stringify({ ...pkg, kanallar: items.map((i) => ({ kanal: i.label, dosyalar: i.files.map((f) => f.name) })) }, null, 2));
    const names = ['metinler.txt', 'kontrol.txt', 'paket.json', ...items.flatMap((i) => i.files.map((f) => f.name))];
    await runOk('zip', ['-q', '-j', `${dir}.zip`, ...names.map((n) => path.join(dir, n))]);
    await this.save(projectId, [pkg, ...(await this.list(projectId))]);
    this.svc.store.emit('paket', { projectId, pkg });
    return pkg;
  }

  /** Onay: paket marka → ürün → kampanya klasörüne kopyalanır (teslim/) */
  async approve(projectId: string, pkgId: string) {
    const list = await this.list(projectId);
    const pkg = list.find((p) => p.id === pkgId);
    if (!pkg) throw new Error('Paket bulunamadı');
    if (pkg.approved && pkg.approvedDir) return pkg;
    const project = await this.svc.store.getProject(projectId);
    const b = pkg.brand ?? project.brand;
    const parts = ['teslim', slug(b?.brandName || 'markasiz'), slug(b?.productName || 'genel'), slug(b?.campaign || project.name)];
    const target = this.svc.store.p(...parts, pkg.name);
    await rm(target, { recursive: true, force: true });
    await mkdir(target, { recursive: true });
    const src = this.svc.store.abs(pkg.dir);
    const names = ['metinler.txt', 'kontrol.txt', 'paket.json', ...pkg.items.flatMap((i) => i.files.map((f) => f.name))];
    for (const n of names) await copyFile(path.join(src, n), path.join(target, n));
    pkg.approved = true;
    pkg.approvedAt = new Date().toISOString();
    pkg.approvedDir = this.svc.store.rel(target);
    await this.save(projectId, list);
    this.svc.store.emit('paket', { projectId, pkg });
    return pkg;
  }
}

export { CHANNELS };
