import { FORMATS } from './formats';
import { FPS, type AssetRef, type Clip, type Framing, type Output, type Project, type Word } from './schema';

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const toFrames = (sec: number) => Math.round(sec * FPS);

export type LayoutItem = { clip: Clip; start: number; end: number; duration: number };

/** Klipleri ana izde art arda dizer (zaman çizelgesi saniye cinsinden) */
export const layoutClips = (project: Project): LayoutItem[] => {
  let t = 0;
  return project.clips.map((clip) => {
    // Kare sınırına hizala: önizleme ve render aynı kareleri kullanır
    const duration = toFrames(Math.max(0, clip.out - clip.in)) / FPS;
    const item = { clip, start: t, end: t + duration, duration };
    t += duration;
    return item;
  });
};

export const totalDuration = (project: Project) => {
  const l = layoutClips(project);
  return l.length ? l[l.length - 1].end : 0;
};

export const outputSize = (output: Output) => {
  const f = FORMATS[output.format];
  return { width: f.width, height: f.height };
};

/** Çıktı süresi (kare). Görsel çıktı tek karedir. */
export const outputFrames = (project: Project, output: Output) =>
  output.kind === 'image' ? 1 : Math.max(1, toFrames(totalDuration(project)));

/** Varsayılan kadraj: ekranı doldur (kırp). Yatay klipte kullanıcı Sığdır'ı seçebilir. */
export const DEFAULT_FRAMING: Framing = { mode: 'fill', x: 0.5, y: 0.5, zoom: 1 };

export const framingFor = (output: Output, clip: Clip): Framing => output.framing[clip.id] ?? DEFAULT_FRAMING;

export type Box = { left: number; top: number; width: number; height: number; scale: number };

/**
 * Kaynağın çıktı karesindeki konumu ve ölçüsü.
 * Görüntü kareden büyükse x/y kaynakta odak noktasıdır (kaydırma);
 * kareden küçükse (ör. %50 küçültülmüş) x/y karedeki yerleşimdir (0 sol/üst · 0,5 orta · 1 sağ/alt).
 */
export const computeBox = (srcW: number, srcH: number, outW: number, outH: number, f: Framing): Box => {
  if (!srcW || !srcH) return { left: 0, top: 0, width: outW, height: outH, scale: 1 };
  const base = f.mode === 'fill' ? Math.max(outW / srcW, outH / srcH) : Math.min(outW / srcW, outH / srcH);
  const scale = base * f.zoom;
  const width = srcW * scale;
  const height = srcH * scale;
  const axis = (size: number, out: number, p: number) => (size >= out ? clamp(out / 2 - p * size, out - size, 0) : (out - size) * p);
  return { left: axis(width, outW, f.x), top: axis(height, outH, f.y), width, height, scale };
};

/** Önizlemede sürükleme: büyük görüntüde odak noktasını, küçük görüntüde yerini kaydırır */
export const moveFraming = (f: Framing, box: Box, outW: number, outH: number, dxOut: number, dyOut: number): Framing => {
  const ax = (p: number, size: number, out: number, d: number) => clamp01(size >= out ? p - d / size : p + d / Math.max(1, out - size));
  return { ...f, x: ax(f.x, box.width, outW, dxOut), y: ax(f.y, box.height, outH, dyOut) };
};

/**
 * Görüntüyü mevcut görünen boyutuna göre ölçekler (ör. 0,5 = yarıya küçült).
 * Doldur modunda kareden küçülürse arka planı boş kalmasın diye “Sığdır (bulanık)” moduna geçer.
 */
export const scaleFraming = (f: Framing, srcW: number, srcH: number, outW: number, outH: number, factor: number): Framing => {
  const cover = Math.max(outW / srcW, outH / srcH);
  const fit = Math.min(outW / srcW, outH / srcH);
  const current = (f.mode === 'fill' ? cover : fit) * f.zoom;
  const target = Math.max(fit * 0.1, Math.min(cover * 4, current * factor));
  if (f.mode === 'fill' && target < cover - 1e-6) return { ...f, mode: 'fit-blur', zoom: Math.max(0.1, target / fit) };
  return { ...f, zoom: Math.max(0.1, Math.min(4, target / (f.mode === 'fill' ? cover : fit))) };
};

/** Doldur modunda kadrajı kaydırmak için: piksel kaymasını odak noktası değişimine çevirir */
export const panFraming = (f: Framing, box: Box, dxOut: number, dyOut: number): Framing => ({
  ...f,
  x: clamp01(f.x - dxOut / box.width),
  y: clamp01(f.y - dyOut / box.height),
});

const clamp = (v: number, min: number, max: number) => (min > max ? (min + max) / 2 : Math.min(max, Math.max(min, v)));
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

// ---------- Konuşma, altyazı ----------

export type TimedWord = { key: string; text: string; t0: number; t1: number; clipId: string; p: number };

/** Bir klipte görünen kelimeleri zaman çizelgesi zamanına taşır (düzeltmeler uygulanmış) */
export const timelineWords = (project: Project, assets: Record<string, AssetRef>): TimedWord[] => {
  const out: TimedWord[] = [];
  for (const item of layoutClips(project)) {
    const asset = assets[item.clip.assetId];
    if (!asset || asset.kind !== 'video' || item.clip.muted) continue;
    asset.words.forEach((w: Word, i: number) => {
      const mid = (w.t0 + w.t1) / 2;
      if (mid < item.clip.in || mid > item.clip.out) return;
      const key = `${asset.id}:${i}`;
      const edited = project.captions.edits[key];
      const text = edited !== undefined ? edited : w.text;
      if (!text.trim()) return;
      out.push({
        key,
        text: text.trim(),
        t0: Math.max(item.start, item.start + (w.t0 - item.clip.in)),
        t1: Math.min(item.end, item.start + (w.t1 - item.clip.in)),
        clipId: item.clip.id,
        p: w.p,
      });
    });
  }
  // Dış ses izi: kayıttaki konuşma da altyazı ve müzik kısmada sayılır
  for (const v of project.voice ?? []) {
    const asset = assets[v.assetId];
    if (!asset) continue;
    asset.words.forEach((w: Word, i: number) => {
      const mid = (w.t0 + w.t1) / 2;
      if (mid < v.in || mid > v.out) return;
      const key = `${asset.id}:${i}`;
      const edited = project.captions.edits[key];
      const text = edited !== undefined ? edited : w.text;
      if (!text.trim()) return;
      out.push({ key, text: text.trim(), t0: v.at + (w.t0 - v.in), t1: v.at + (w.t1 - v.in), clipId: v.id, p: w.p });
    });
  }
  return out.sort((a, b) => a.t0 - b.t0);
};

/** Cümleler: noktalama veya uzun duraksamayla ayrılan kelime grupları (komutlar ve altyazı için) */
export type Sentence = { words: TimedWord[]; start: number; end: number; text: string };
export const sentences = (words: TimedWord[], gap = 0.7): Sentence[] => {
  const res: Sentence[] = [];
  let cur: TimedWord[] = [];
  const flush = () => {
    if (cur.length) res.push({ words: cur, start: cur[0].t0, end: cur[cur.length - 1].t1, text: cur.map((w) => w.text).join(' ') });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && (w.t0 - prev.t1 > gap || prev.clipId !== w.clipId)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.text)) flush();
  }
  flush();
  return res;
};

/** Konuşma aralıkları (birbirine yakın kelimeler birleşir) */
export const speechIntervals = (words: { t0: number; t1: number }[], gap = 0.6): [number, number][] => {
  const res: [number, number][] = [];
  for (const w of [...words].sort((a, b) => a.t0 - b.t0)) {
    const last = res[res.length - 1];
    if (last && w.t0 - last[1] <= gap) last[1] = Math.max(last[1], w.t1);
    else res.push([w.t0, w.t1]);
  }
  return res;
};

export const hasSpeech = (project: Project, assets: Record<string, AssetRef>) => timelineWords(project, assets).length > 0;

export type CaptionPage = { start: number; end: number; lines: TimedWord[][] };

/** Kelimeleri ekranda birlikte görünecek sayfalara böler */
export const captionPages = (
  words: TimedWord[],
  opts: { maxChars: number; maxLines: number; maxGap?: number },
): CaptionPage[] => {
  const pages: CaptionPage[] = [];
  let lines: TimedWord[][] = [[]];
  const flush = () => {
    const ws = lines.flat();
    if (ws.length) pages.push({ start: ws[0].t0, end: ws[ws.length - 1].t1, lines: lines.filter((l) => l.length) });
    lines = [[]];
  };
  const lineLen = (l: TimedWord[]) => l.reduce((n, w) => n + w.text.length + 1, -1);
  let prev: TimedWord | null = null;
  for (const w of words) {
    const gapBreak = prev && (w.t0 - prev.t1 > (opts.maxGap ?? 0.7) || prev.clipId !== w.clipId);
    const sentenceBreak = prev && /[.!?…]$/.test(prev.text);
    if (gapBreak || sentenceBreak) flush();
    let cur = lines[lines.length - 1];
    if (cur.length && lineLen(cur) + 1 + w.text.length > opts.maxChars) {
      if (lines.length >= opts.maxLines) flush();
      else lines.push([]);
      cur = lines[lines.length - 1];
    }
    cur.push(w);
    prev = w;
  }
  flush();
  // Sayfa bir sonrakine kadar ekranda kalsın (en çok 0.5 sn fazladan)
  for (let i = 0; i < pages.length; i++) {
    const next = pages[i + 1];
    pages[i].end = Math.min(next ? next.start : Infinity, pages[i].end + 0.5);
  }
  return pages;
};

// ---------- Müzik seviyesi ----------

const smooth = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/**
 * Müziğin t anındaki doğrusal kazancı.
 * - bed: baştan sona bedDb (kısık arka plan)
 * - duck: gainDb, konuşmada duckDb kadar iner (attack/release ile)
 * - fixed: gainDb
 * Ayrıca klip bazında "müziği sustur" ve giriş/çıkış yumuşatması uygulanır.
 */
export const musicGainAt = (
  t: number,
  project: Project,
  speech: [number, number][],
  total: number,
  layout: LayoutItem[] = layoutClips(project),
): number => {
  const m = project.music;
  if (!m) return 0;
  let db = m.mode === 'bed' ? m.bedDb : m.gainDb;
  let gain = dbToGain(db);
  if (m.mode === 'duck' && speech.length) {
    let duck = 0; // 0..1 kısma miktarı
    for (const [s, e] of speech) {
      if (t >= s - m.attack && t <= e + m.release) {
        const d = t < s ? smooth((t - (s - m.attack)) / m.attack) : t <= e ? 1 : 1 - smooth((t - e) / m.release);
        duck = Math.max(duck, d);
      }
    }
    db = m.gainDb + m.duckDb * duck;
    gain = dbToGain(db);
  }
  // Klip bazında müzik susturma (0.25 sn yumuşak geçiş)
  for (const item of layout) {
    if (!item.clip.musicMuted) continue;
    const r = 0.25;
    if (t >= item.start - r && t <= item.end + r) {
      const k = t < item.start ? smooth((item.start - t) / r) : t > item.end ? smooth((t - item.end) / r) : 0;
      gain *= k;
    }
  }
  if (m.fadeIn > 0 && t < m.fadeIn) gain *= smooth(t / m.fadeIn);
  if (m.fadeOut > 0 && t > total - m.fadeOut) gain *= smooth((total - t) / m.fadeOut);
  return Math.max(0, gain);
};

/** Konuşma varsa "Konuşmada kıs", yoksa "Sabit" önerilir */
export const suggestedMusicMode = (speechPresent: boolean) => (speechPresent ? 'duck' : 'fixed');

export const formatTime = (sec: number) => {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r.toFixed(1).padStart(4, '0')}`;
};
