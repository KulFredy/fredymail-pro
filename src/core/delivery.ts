/**
 * Teslim öncesi kontroller ve altyazı dosyaları (Faz 6).
 * Saf hesaplar: ürün adı yazımı, onaysız üretim, süre, kadraj/güvenli alan, altyazı, ses dengesi, yayın metni.
 * Ses yüksekliği ölçümü (LUFS) sunucuda render'dan sonra yapılır ve buraya verilir.
 */
import { CHANNELS, captionsFor, channelOf, normalizeTags, outputNameRatio } from './channels';
import type { Brand } from './brand';
import { FORMATS } from './formats';
import { fixPlacement, logoBox, safeAreaIssues, textBox } from './graphics';
import type { OpInput } from './ops';
import type { AssetRef, Output, Project } from './schema';
import { captionPages, outputFrames, timelineWords, type TimedWord } from './timeline';
import { FPS } from './schema';

export type CheckLevel = 'ok' | 'uyari' | 'hata';
export type CheckArea = 'urun' | 'sure' | 'kadraj' | 'altyazi' | 'ses' | 'metin' | 'kapak';
export type Check = { id: string; area: CheckArea; level: CheckLevel; text: string; fix?: { label: string; ops: OpInput[] } };

export const AREA_LABELS: Record<CheckArea, string> = {
  urun: 'Ürün doğruluğu',
  sure: 'Süre',
  kadraj: 'Kadraj',
  altyazi: 'Altyazı',
  ses: 'Ses dengesi',
  metin: 'Yayın metni',
  kapak: 'Kapak',
};

export type Loudness = { lufs: number; truePeak: number };

// ---------- Ürün adı yazımı ----------

const norm = (s: string) =>
  s
    .toLocaleLowerCase('tr-TR')
    .replace(/[’'`´].*$/u, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');

const lev = (a: string, b: string) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};

/**
 * Metinde ürün/marka adına çok benzeyen ama farklı yazılmış kelimeler (“Kahvemz” ↔ “Kahvemiz”).
 * Türkçe ekler sorun sayılmaz (“Kahvemizi”, “Kahvemiz'in”). Kısa adlarda (≤4 harf) bakılmaz.
 */
export const misspellings = (text: string, name: string): string[] => {
  const target = norm(name.replace(/\s+/g, ''));
  if (target.length <= 4) return [];
  const thr = target.length <= 8 ? 1 : 2;
  const n = name.trim().split(/\s+/).length;
  const tokens = text.split(/\s+/).filter(Boolean);
  const found: string[] = [];
  for (let i = 0; i + n <= tokens.length; i++) {
    const raw = tokens.slice(i, i + n).join(' ');
    const w = norm(tokens.slice(i, i + n).join(''));
    if (!w || w.startsWith(target)) continue;
    // Ekli hâlleri de dene: kelimenin hedef uzunluğundaki başı (±1)
    const cands = [w, w.slice(0, target.length), w.slice(0, target.length + 1), w.slice(0, target.length - 1)];
    const best = Math.min(...cands.filter((c) => c.length >= target.length - 1).map((c) => lev(c, target)));
    if (best > 0 && best <= thr) found.push(raw.replace(/[.,!?;:…"“”]+$/u, ''));
  }
  return [...new Set(found)];
};

// ---------- Altyazı dosyası ----------

export type Cue = { start: number; end: number; text: string };

/** Altyazı satırları (dosya için): ekrandakiyle aynı düzeltmeler, satır başına ≤42 karakter */
export const captionCues = (project: Project, assets: Record<string, AssetRef>, opts: { maxChars?: number; maxLines?: number } = {}): Cue[] => {
  const words = timelineWords(project, assets);
  return captionPages(words, { maxChars: opts.maxChars ?? 42, maxLines: opts.maxLines ?? 2 }).map((p) => ({
    start: p.start,
    end: Math.max(p.end, p.start + 0.3),
    text: p.lines.map((l: TimedWord[]) => l.map((w) => w.text).join(' ')).join('\n'),
  }));
};

const stamp = (sec: number, sep: ',' | '.') => {
  const ms = Math.max(0, Math.round(sec * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const r = ms % 1000;
  const p = (x: number, k = 2) => String(x).padStart(k, '0');
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(r, 3)}`;
};
export const toSrt = (cues: Cue[]) => cues.map((c, i) => `${i + 1}\n${stamp(c.start, ',')} --> ${stamp(c.end, ',')}\n${c.text}\n`).join('\n');
export const toVtt = (cues: Cue[]) => `WEBVTT\n\n${cues.map((c) => `${stamp(c.start, '.')} --> ${stamp(c.end, '.')}\n${c.text}\n`).join('\n')}`;

// ---------- Kontroller ----------

export type CheckInput = {
  project: Project;
  assets: Record<string, AssetRef>;
  output: Output;
  brand?: Brand | null;
  /** Onay bekleyen üretilmiş görseller (kurguda kullanılmamalı) */
  unapprovedAssetIds?: Set<string>;
  /** Render'dan sonra ölçülen ses yüksekliği */
  loudness?: Loudness | null;
};

export const deliveryChecks = ({ project, assets, output, brand, unapprovedAssetIds, loudness }: CheckInput): Check[] => {
  const ch = channelOf(output);
  const label = outputNameRatio(output);
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const dur = outputFrames(project, output) / FPS;
  const isVideo = output.kind === 'video';

  // Ürün doğruluğu: onaysız üretim, logo, ad yazımı
  const used = [...project.clips.map((c) => c.assetId), ...project.overlays.map((o) => o.assetId)];
  const pending = used.filter((id) => unapprovedAssetIds?.has(id));
  if (pending.length) add({ id: 'urun-onay', area: 'urun', level: 'hata', text: `${pending.length} üretilmiş görsel onaylanmadan kurguda` });
  if (brand?.logoAssetIds.length && !project.logos.some((l) => brand.logoAssetIds.includes(l.assetId)))
    add({ id: 'urun-logo', area: 'urun', level: 'uyari', text: 'Marka logosu yok', fix: { label: 'Logoyu ekle', ops: [{ type: 'logo.add', assetId: brand.logoAssetIds[0] }] } });
  const names = [project.brand?.productName, project.brand?.brandName].filter((x): x is string => !!x);
  if (names.length) {
    const sources: { where: string; text: string }[] = [
      ...project.texts.map((t) => ({ where: 'yazı', text: t.text })),
      { where: 'altyazı', text: timelineWords(project, assets).map((w) => w.text).join(' ') },
      { where: 'başlık', text: output.meta.title },
      { where: 'açıklama', text: output.meta.description },
      { where: 'reklam metni', text: `${output.meta.headline} ${output.meta.primaryText}` },
    ];
    const bad: string[] = [];
    for (const n of names) for (const s of sources) for (const w of misspellings(s.text, n)) bad.push(`${s.where}: “${w}” → “${n}”?`);
    if (bad.length) add({ id: 'urun-ad', area: 'urun', level: 'uyari', text: `Ad yazımı: ${[...new Set(bad)].slice(0, 4).join(' · ')}` });
    else add({ id: 'urun-ad', area: 'urun', level: 'ok', text: `“${names.join('”, “')}” yazımı tutarlı` });
  }

  // Süre
  if (isVideo && ch?.maxSec && dur > ch.maxSec + 0.05) add({ id: 'sure', area: 'sure', level: 'hata', text: `${dur.toFixed(1)} sn; ${ch.label} en çok ${ch.maxSec} sn` });
  else if (isVideo && ch?.recSec && dur > ch.recSec + 0.05) add({ id: 'sure', area: 'sure', level: 'uyari', text: `${dur.toFixed(1)} sn; ${ch.label} için önerilen ≤ ${ch.recSec} sn` });
  else if (isVideo) add({ id: 'sure', area: 'sure', level: 'ok', text: `${dur.toFixed(1)} sn` });

  // Kadraj: güvenli alan ve siyah bant
  const issues = safeAreaIssues(project, assets, output.id);
  for (const i of issues) {
    const el = i.kind === 'text' ? project.texts.find((t) => t.id === i.id) : project.logos.find((l) => l.id === i.id);
    const box = el ? (i.kind === 'text' ? textBox(el as Project['texts'][number], output) : logoBox(el as Project['logos'][number], assets[(el as Project['logos'][number]).assetId], output)) : null;
    add({
      id: `kadraj-${i.id}`,
      area: 'kadraj',
      level: 'uyari',
      text: i.text.replace(`${label}: `, ''),
      fix: el && box ? { label: 'Güvenli alana al', ops: [{ type: 'element.place', kind: i.kind, id: i.id, outputId: output.id, place: fixPlacement(el, box, output) }] } : undefined,
    });
  }
  const bars = project.clips.filter((c) => (output.framing[c.id]?.mode ?? 'fill') === 'fit');
  if (bars.length) add({ id: 'kadraj-bant', area: 'kadraj', level: 'uyari', text: `${bars.length} klipte siyah bant var (Sığdır); bulanık dolgu veya Doldur daha iyi olabilir` });
  if (!issues.length && !bars.length) add({ id: 'kadraj', area: 'kadraj', level: 'ok', text: 'Yazı ve logolar güvenli alanda' });

  // Altyazı
  const words = timelineWords(project, assets);
  const cap = captionsFor(project, output);
  if (isVideo && words.length) {
    if (ch?.burnCaptions && !cap.enabled)
      add({ id: 'altyazi-kapali', area: 'altyazi', level: 'uyari', text: 'Konuşma var ama altyazı kapalı (çoğu kişi sessiz izler)', fix: { label: 'Bu çıktıda aç', ops: [{ type: 'output.update', outputId: output.id, patch: { captions: { enabled: true } } }] } });
    else if (cap.enabled) {
      const unsure = words.filter((w) => w.p < 0.5 && project.captions.edits[w.key] === undefined).length;
      if (unsure) add({ id: 'altyazi-emin', area: 'altyazi', level: 'uyari', text: `${unsure} kelimeden emin olunamadı; Transkript'te kontrol edin` });
      const safe = FORMATS[output.format].safe;
      if (cap.style.position === 'bottom' && cap.style.offset < -20)
        add({ id: 'altyazi-alan', area: 'altyazi', level: 'uyari', text: `Altyazı alttaki arayüz alanına (${safe.bottom} px) giriyor`, fix: { label: 'Yukarı al', ops: [{ type: 'output.update', outputId: output.id, patch: { captions: { offset: 0 } } }] } });
      if (!unsure) add({ id: 'altyazi', area: 'altyazi', level: 'ok', text: `${words.length} kelime, görüntüye yazılı` });
    }
    if (ch?.captionFile) add({ id: 'altyazi-dosya', area: 'altyazi', level: 'ok', text: 'Altyazı dosyası (.srt, .vtt) pakete eklenir' });
  } else if (isVideo && !words.length && project.clips.some((c) => assets[c.assetId]?.kind === 'video' && assets[c.assetId]?.transcriptStatus === 'pending')) {
    add({ id: 'altyazi-bekliyor', area: 'altyazi', level: 'uyari', text: 'Konuşma çözümü henüz bitmedi' });
  }

  // Ses dengesi
  if (isVideo) {
    const m = project.music;
    if (m && words.length && m.mode === 'fixed' && m.gainDb > -12)
      add({ id: 'ses-muzik', area: 'ses', level: 'uyari', text: `Müzik konuşma sırasında da ${m.gainDb} dB; ses bastırılabilir`, fix: { label: 'Konuşmada kıs', ops: [{ type: 'music.set', music: { mode: 'duck' } }] } });
    if (loudness) {
      const target = ch?.loudness ?? -14;
      if (!Number.isFinite(loudness.lufs)) add({ id: 'ses-lufs', area: 'ses', level: 'uyari', text: 'Videoda ses yok' });
      else if (Math.abs(loudness.lufs - target) > 2)
        add({ id: 'ses-lufs', area: 'ses', level: 'uyari', text: `Ses yüksekliği ${loudness.lufs.toFixed(1)} LUFS; hedef ${target} (±2). ${loudness.lufs < target ? 'Platform sesi açar, sessiz kalabilir' : 'Platform kısar'}` });
      else add({ id: 'ses-lufs', area: 'ses', level: 'ok', text: `Ses yüksekliği ${loudness.lufs.toFixed(1)} LUFS (hedef ${target})` });
      if (Number.isFinite(loudness.truePeak) && loudness.truePeak > -1) add({ id: 'ses-tepe', area: 'ses', level: 'uyari', text: `Tepe seviye ${loudness.truePeak.toFixed(1)} dBTP; bozulma olabilir (≤ −1 önerilir)` });
    } else add({ id: 'ses-lufs', area: 'ses', level: 'ok', text: 'Ses yüksekliği çıktıdan sonra ölçülür' });
  }

  // Yayın metni
  if (ch) {
    const meta = output.meta;
    for (const [k, f] of Object.entries(ch.fields)) {
      if (!f) continue;
      const key = k as keyof typeof meta;
      if (key === 'tags') {
        const tags = normalizeTags(meta.tags, ch);
        const size = f.hint === 'adet' ? tags.length : tags.join(',').length;
        if (size > f.max) add({ id: `metin-${k}`, area: 'metin', level: 'hata', text: `${f.label}: ${size} ${f.hint === 'adet' ? 'adet' : 'karakter'}; en çok ${f.max}` });
        continue;
      }
      const v = String(meta[key] ?? '').trim();
      if (!v && f.required) add({ id: `metin-${k}`, area: 'metin', level: 'uyari', text: `${f.label} boş` });
      else if (v.length > f.max) add({ id: `metin-${k}`, area: 'metin', level: f.hint?.startsWith('önerilen') ? 'uyari' : 'hata', text: `${f.label}: ${v.length} karakter; ${f.hint?.startsWith('önerilen') ? 'önerilen' : 'en çok'} ${f.max}` });
    }
    if (!checks.some((c) => c.area === 'metin') && Object.keys(ch.fields).length) add({ id: 'metin', area: 'metin', level: 'ok', text: 'Sınırlar içinde' });
    if (ch.cover && !output.cover) add({ id: 'kapak', area: 'kapak', level: 'uyari', text: `${ch.cover.label} seçilmedi; ilk kare kullanılır` });
    else if (ch.cover && output.cover) add({ id: 'kapak', area: 'kapak', level: 'ok', text: `${ch.cover.label}: ${output.cover.at.toFixed(1)}. sn${output.cover.title ? ` · “${output.cover.title}”` : ''}` });
  }
  return checks;
};

/** Paket için tüm çıktıların kontrol özeti (hata var mı?) */
export const summarize = (checks: Check[]) => ({
  errors: checks.filter((c) => c.level === 'hata').length,
  warnings: checks.filter((c) => c.level === 'uyari').length,
});

export { CHANNELS };
