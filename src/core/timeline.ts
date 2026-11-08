import { FORMATS } from './formats';
import { FPS, type AssetRef, type Clip, type Framing, type Motion, type Output, type Project, type Word } from './schema';

export const dbToGain = (db: number) => Math.pow(10, db / 20);
export const toFrames = (sec: number) => Math.round(sec * FPS);

/** Tık önleyici en kısa ses geçişi (kare) */
export const MIN_AUDIO_EDGE = 3;

/**
 * Bir ses parçasının f. karedeki kazanç çarpanı (0–1): yumuşak giriş/çıkış.
 * Geçiş süresi en az MIN_AUDIO_EDGE karedir; giriş ve çıkış parçanın yarısını geçemez.
 */
export const edgeGain = (f: number, lenF: number, fadeInSec = 0, fadeOutSec = 0) => {
  const half = Math.max(1, lenF / 2);
  const inF = Math.min(half, Math.max(MIN_AUDIO_EDGE, toFrames(fadeInSec)));
  const outF = Math.min(half, Math.max(MIN_AUDIO_EDGE, toFrames(fadeOutSec)));
  return Math.max(0, Math.min(1, f / inF, (lenF - f) / outF));
};

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

/**
 * Ken Burns: t (klip içi sn) anındaki kadraj. Yumuşak (ease-in-out) ilerler.
 * Kaydırmada görüntü biraz büyütülür ki kenar boşluğu kalmasın.
 */
export const motionFraming = (f: Framing, motion: Motion | null | undefined, t: number, clipDur: number): Framing => {
  if (!motion) return f;
  const D = Math.max(0.1, Math.min(clipDur, motion.duration ?? clipDur));
  const k = Math.min(1, Math.max(0, t / D));
  const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  const a = motion.amount;
  switch (motion.kind) {
    case 'yakinlas':
      return { ...f, zoom: f.zoom * (1 + a * e) };
    case 'uzaklas':
      return { ...f, zoom: f.zoom * (1 + a * (1 - e)) };
    case 'sola':
    case 'saga':
    case 'yukari':
    case 'asagi': {
      const d = (e - 0.5) * a * 2; // −a..+a
      const zoom = f.zoom * (1 + a);
      if (motion.kind === 'sola') return { ...f, zoom, x: clamp01(f.x + d) };
      if (motion.kind === 'saga') return { ...f, zoom, x: clamp01(f.x - d) };
      if (motion.kind === 'yukari') return { ...f, zoom, y: clamp01(f.y + d) };
      return { ...f, zoom, y: clamp01(f.y - d) };
    }
  }
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

/** Dış ses öğesinin zaman çizelgesindeki aralığı */
export const voiceSpan = (v: { at: number; in: number; out: number }) => ({ start: v.at, end: v.at + Math.max(0, v.out - v.in) });

/**
 * Çakışan öğeleri alt satırlara dağıtır (zaman çizelgesinde üst üste binip tıklanamaz olmasınlar).
 * Her öğe, kendisiyle çakışmayan en üst satıra yerleşir; sıra girdi sırasıyla aynıdır.
 */
export const stackRows = (spans: { start: number; end: number }[], eps = 1e-3): { rows: number[]; count: number } => {
  const order = spans.map((s, i) => i).sort((a, b) => spans[a].start - spans[b].start || a - b);
  const rowEnd: number[] = [];
  const rows = new Array<number>(spans.length).fill(0);
  for (const i of order) {
    let r = rowEnd.findIndex((end) => end <= spans[i].start + eps);
    if (r < 0) r = rowEnd.length;
    rowEnd[r] = spans[i].end;
    rows[i] = r;
  }
  return { rows, count: Math.max(1, rowEnd.length) };
};

/** t anında çalan dış sesler bitince gelen ilk boş an (yeni dış ses öncekilerin üstüne binmesin). */
export const voiceFreeAt = (voice: { at: number; in: number; out: number }[], t: number, eps = 1e-3): number => {
  let at = t;
  for (let guard = 0; guard <= voice.length; guard++) {
    const hit = voice.map(voiceSpan).find((s) => s.start <= at + eps && s.end > at + eps);
    if (!hit) return at;
    at = hit.end;
  }
  return at;
};

/** Verilen dış sesle zaman olarak çakışan diğer dış sesler */
export const voiceOverlaps = <T extends { id: string; at: number; in: number; out: number }>(voice: T[], id: string, eps = 1e-3): T[] => {
  const me = voice.find((v) => v.id === id);
  if (!me) return [];
  const a = voiceSpan(me);
  return voice.filter((v) => v.id !== id && voiceSpan(v).start < a.end - eps && voiceSpan(v).end > a.start + eps);
};

/** Zaman çizelgesinde t anına klip eklenecekse sırası: ortası t'den önce kalan klipler önde kalır */
export const clipIndexAt = (project: Project, t: number) => layoutClips(project).filter((l) => (l.start + l.end) / 2 < t).length;

/** Fotoğraf (tek kare) çıktısının karesi zaman çizelgesinde nerede (sn) */
export const stillTime = (project: Project, output: Output): number => {
  const layout = layoutClips(project);
  const item = layout.find((l) => l.clip.id === output.still?.clipId) ?? layout[0];
  if (!item) return 0;
  const at = output.still?.clipId === item.clip.id ? output.still.at : 0;
  return item.start + Math.min(at, Math.max(0, item.duration - 1 / FPS));
};

/** Zaman çizelgesindeki t anı fotoğraf karesi olarak: hangi klip, klibin kaçıncı saniyesi */
export const stillAtTime = (project: Project, t: number): { clipId: string; at: number } | null => {
  const layout = layoutClips(project);
  if (!layout.length) return null;
  const item = layout.find((l) => t >= l.start && t < l.end) ?? layout[layout.length - 1];
  return { clipId: item.clip.id, at: Math.max(0, Math.min(item.duration - 1 / FPS, t - item.start)) };
};

/**
 * Altyazıda görünen kelimeler: çeviri varsa çevrilmiş satırlar (satır süresine harf oranında dağıtılır),
 * yoksa konuşmanın kendisi. Transkript, kesimler ve müzik kısma her zaman orijinal konuşmayı kullanır.
 */
export const captionWords = (project: Project, assets: Record<string, AssetRef>): TimedWord[] => {
  const tr = project.captions.translation;
  if (!tr) return timelineWords(project, assets);
  const out: TimedWord[] = [];
  const place = (assetId: string, ownerId: string, srcIn: number, srcOut: number, toTimeline: (src: number) => number, clampLo: number, clampHi: number) => {
    const segs = tr.byAsset[assetId];
    if (!segs) {
      // Bu dosya çevrilmemiş (ör. sonradan eklendi): orijinal konuşması kalır
      for (const w of timelineWords(project, assets)) if (w.clipId === ownerId) out.push(w);
      return;
    }
    segs.forEach((s, i) => {
      const mid = (s.t0 + s.t1) / 2;
      if (mid < srcIn || mid > srcOut) return;
      const tokens = s.text.split(/\s+/).filter(Boolean);
      if (!tokens.length) return;
      const total = tokens.reduce((n, t) => n + t.length + 1, 0);
      let acc = 0;
      tokens.forEach((tok, j) => {
        const a = s.t0 + ((s.t1 - s.t0) * acc) / total;
        acc += tok.length + 1;
        const b = s.t0 + ((s.t1 - s.t0) * acc) / total;
        out.push({ key: `${assetId}:c${i}:${j}`, text: tok, t0: Math.max(clampLo, toTimeline(a)), t1: Math.min(clampHi, toTimeline(b)), clipId: ownerId, p: 1 });
      });
    });
  };
  for (const item of layoutClips(project)) {
    const asset = assets[item.clip.assetId];
    if (!asset || asset.kind !== 'video' || item.clip.muted) continue;
    place(asset.id, item.clip.id, item.clip.in, item.clip.out, (src) => item.start + (src - item.clip.in), item.start, item.end);
  }
  for (const v of project.voice ?? []) {
    if (!assets[v.assetId]) continue;
    place(v.assetId, v.id, v.in, v.out, (src) => v.at + (src - v.in), v.at, v.at + (v.out - v.in));
  }
  return out.filter((w) => w.t1 > w.t0).sort((a, b) => a.t0 - b.t0);
};

/** Çeviri için kaynak satırlar: kurguda kullanılan her konuşmalı dosyanın cümleleri (kaynak zamanında, düzeltmeler uygulanmış) */
export const transcriptSegments = (project: Project, assets: Record<string, AssetRef>): { assetId: string; segs: { t0: number; t1: number; text: string }[] }[] => {
  const ids = [...new Set([...project.clips.map((c) => c.assetId), ...(project.voice ?? []).map((v) => v.assetId)])];
  const res: { assetId: string; segs: { t0: number; t1: number; text: string }[] }[] = [];
  for (const id of ids) {
    const a = assets[id];
    if (!a?.words.length) continue;
    const tw: TimedWord[] = a.words
      .map((w, i) => {
        const e = project.captions.edits[`${id}:${i}`];
        return { key: `${id}:${i}`, text: (e !== undefined ? e : w.text).trim(), t0: w.t0, t1: w.t1, clipId: id, p: w.p };
      })
      .filter((w) => w.text);
    // Çok uzun cümleler altyazıda okunmaz: ~14 kelimede böl
    const segs: { t0: number; t1: number; text: string }[] = [];
    for (const s of sentences(tw)) {
      for (let k = 0; k < s.words.length; k += 14) {
        const part = s.words.slice(k, k + 14);
        segs.push({ t0: part[0].t0, t1: part[part.length - 1].t1, text: part.map((w) => w.text).join(' ') });
      }
    }
    if (segs.length) res.push({ assetId: id, segs });
  }
  return res;
};
