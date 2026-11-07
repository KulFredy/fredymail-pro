/**
 * Transkript ↔ kurgu eşlemesi (Faz 3).
 * Whisper kelimeleri KAYNAK dosyanın zamanındadır; zaman çizelgesi (kurgu) zamanı kesim ve bölmelerle değişir.
 * Bu modül ikisini tek yerde çevirir: transkript paneli, komut aralığı ve "cümleyi kes" aynı fonksiyonları kullanır.
 */
import type { OpInput } from './ops';
import type { AssetRef, Project, Word } from './schema';
import { layoutClips } from './timeline';

/** Kesimde cümlenin başına/sonuna bırakılan pay (Whisper zamanları ±100 ms sapabilir) */
export const CUT_PAD = 0.08;

export type Placement = { clipId: string; t0: number; t1: number };

export type TranscriptWord = {
  /** Altyazı düzeltme anahtarı: `${assetId}:${index}` */
  key: string;
  index: number;
  /** Görünen metin (düzeltme uygulanmış) */
  text: string;
  original: string;
  edited: boolean;
  /** Kaynak dosyadaki zaman (sn) */
  src0: number;
  src1: number;
  /** Kurgudaki yeri; kesilmişse null */
  at: Placement | null;
  p: number;
};

export type TranscriptSentence = {
  id: string;
  assetId: string;
  source: 'clip' | 'voice';
  words: TranscriptWord[];
  text: string;
  /** Kurgudaki ilk ve son görünen kelime (tamamen kesilmişse null) */
  start: number | null;
  end: number | null;
  /** none: tamamı kurguda · partial: bir kısmı kesik · all: tamamı kesik */
  cut: 'none' | 'partial' | 'all';
};

export type TranscriptSection = { assetId: string; name: string; source: 'clip' | 'voice'; sentences: TranscriptSentence[] };

const wordText = (project: Project, key: string, w: Word) => {
  const e = project.captions.edits[key];
  return { text: (e !== undefined ? e : w.text).trim(), edited: e !== undefined };
};

/** Kaynak zamanı → kurgu zamanı. Aynı kaynak birden çok klipte kullanılmışsa hepsi döner. */
export const sourceToTimeline = (project: Project, assetId: string, src: number): Placement[] => {
  const res: Placement[] = [];
  for (const item of layoutClips(project)) {
    const c = item.clip;
    if (c.assetId !== assetId || src < c.in - 1e-6 || src > c.out + 1e-6) continue;
    const t = Math.min(item.end, item.start + (src - c.in));
    res.push({ clipId: c.id, t0: t, t1: t });
  }
  return res;
};

/** Kurgu zamanı → kaynaktaki yer (ana iz) */
export const timelineToSource = (project: Project, t: number): { clipId: string; assetId: string; src: number } | null => {
  const items = layoutClips(project);
  const item = items.find((i) => t >= i.start - 1e-6 && t < i.end) ?? (items.length && Math.abs(t - items[items.length - 1].end) < 1e-6 ? items[items.length - 1] : undefined);
  if (!item) return null;
  return { clipId: item.clip.id, assetId: item.clip.assetId, src: item.clip.in + (t - item.start) };
};

/** Bir kelimenin kurgudaki yeri: orta noktası bir klibin içindeyse (altyazıyla aynı kural) */
const placeClipWord = (project: Project, assetId: string, w: Word): Placement | null => {
  const mid = (w.t0 + w.t1) / 2;
  for (const item of layoutClips(project)) {
    const c = item.clip;
    if (c.assetId !== assetId || mid < c.in || mid > c.out) continue;
    return {
      clipId: c.id,
      t0: Math.max(item.start, item.start + (w.t0 - c.in)),
      t1: Math.min(item.end, item.start + (w.t1 - c.in)),
    };
  }
  return null;
};

const placeVoiceWord = (project: Project, assetId: string, w: Word): Placement | null => {
  const mid = (w.t0 + w.t1) / 2;
  for (const v of project.voice) {
    if (v.assetId !== assetId || mid < v.in || mid > v.out) continue;
    return { clipId: v.id, t0: v.at + (w.t0 - v.in), t1: v.at + (w.t1 - v.in) };
  }
  return null;
};

/** Cümlelere böl: noktalama veya uzun duraksama (kaynak zamanında) */
const splitSentences = (words: TranscriptWord[], gap = 0.7): TranscriptWord[][] => {
  const res: TranscriptWord[][] = [];
  let cur: TranscriptWord[] = [];
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev && w.src0 - prev.src1 > gap) {
      res.push(cur);
      cur = [];
    }
    cur.push(w);
    if (/[.!?…]$/.test(w.original.trim())) {
      res.push(cur);
      cur = [];
    }
  }
  if (cur.length) res.push(cur);
  return res;
};

/**
 * Projenin transkripti: kurguda kullanılan her konuşmalı kaynak (ve dış ses) için bir bölüm.
 * Kesilen kelimeler de listede kalır (soluk gösterilir), böylece geri almak ve bağlamı görmek kolaydır.
 * Bölümler kurgudaki ilk görünme sırasına göre dizilir.
 */
export const buildTranscript = (project: Project, assets: Record<string, AssetRef>): TranscriptSection[] => {
  const sections: TranscriptSection[] = [];
  const seen = new Set<string>();
  const add = (assetId: string, source: 'clip' | 'voice') => {
    const key = `${source}:${assetId}`;
    if (seen.has(key)) return;
    seen.add(key);
    const a = assets[assetId];
    if (!a || !a.words?.length) return;
    const words: TranscriptWord[] = a.words.map((w, index) => {
      const k = `${assetId}:${index}`;
      const { text, edited } = wordText(project, k, w);
      return {
        key: k,
        index,
        text,
        original: w.text,
        edited,
        src0: w.t0,
        src1: w.t1,
        at: source === 'clip' ? placeClipWord(project, assetId, w) : placeVoiceWord(project, assetId, w),
        p: w.p,
      };
    });
    const sentences = splitSentences(words).map((ws, i): TranscriptSentence => {
      const vis = ws.filter((w) => w.at);
      return {
        id: `${source}:${assetId}:${i}`,
        assetId,
        source,
        words: ws,
        text: ws.map((w) => w.text).filter(Boolean).join(' '),
        start: vis.length ? Math.min(...vis.map((w) => w.at!.t0)) : null,
        end: vis.length ? Math.max(...vis.map((w) => w.at!.t1)) : null,
        cut: vis.length === ws.length ? 'none' : vis.length ? 'partial' : 'all',
      };
    });
    sections.push({ assetId, name: a.name, source, sentences });
  };
  for (const item of layoutClips(project)) if (assets[item.clip.assetId]?.kind === 'video') add(item.clip.assetId, 'clip');
  for (const v of [...project.voice].sort((x, y) => x.at - y.at)) add(v.assetId, 'voice');
  return sections;
};

/** Kurgudaki bir an hangi cümleye denk geliyor? (oynatma sırasında vurgulamak için) */
export const sentenceAt = (sections: TranscriptSection[], t: number): TranscriptSentence | null => {
  for (const s of sections)
    for (const sen of s.sentences) if (sen.start !== null && sen.end !== null && t >= sen.start - 0.05 && t <= sen.end + 0.05) return sen;
  return null;
};

/**
 * "Cümleyi kes": cümlenin kurgudaki görünen kelimelerini çıkaran işlemler.
 * Komşu kelimelere taşmadan küçük bir pay bırakır; birden çok klibe yayılırsa her parça ayrı silinir
 * (sondan başa doğru, böylece öndeki aralıklar kaymaz). Dış ses cümlesi kesilemez (null).
 */
export const cutSentenceOps = (project: Project, section: TranscriptSection, sentence: TranscriptSentence, pad = CUT_PAD): OpInput[] | null => {
  if (sentence.source !== 'clip') return null;
  const items = layoutClips(project);
  const all = section.sentences.flatMap((s) => s.words);
  const ranges: { start: number; end: number }[] = [];
  // Aynı klipteki ardışık görünen kelimeleri grupla
  const vis = sentence.words.filter((w) => w.at);
  const groups: TranscriptWord[][] = [];
  for (const w of vis) {
    const g = groups[groups.length - 1];
    if (g && g[g.length - 1].at!.clipId === w.at!.clipId && w.index === g[g.length - 1].index + 1) g.push(w);
    else groups.push([w]);
  }
  for (const g of groups) {
    const first = g[0];
    const last = g[g.length - 1];
    const item = items.find((i) => i.clip.id === first.at!.clipId)!;
    const prev = all[first.index - 1];
    const next = all[last.index + 1];
    const lo = Math.max(item.start, prev?.at?.clipId === item.clip.id ? prev.at.t1 : -Infinity);
    const hi = Math.min(item.end, next?.at?.clipId === item.clip.id ? next.at.t0 : Infinity);
    let start = Math.max(lo, first.at!.t0 - pad);
    let end = Math.min(hi, last.at!.t1 + pad);
    // Klibin başına/sonuna 0,15 sn'den az kalıyorsa oraya kadar kes (kırıntı bırakma)
    if (start - item.start < 0.15 && !(prev?.at?.clipId === item.clip.id)) start = item.start;
    if (item.end - end < 0.15 && !(next?.at?.clipId === item.clip.id)) end = item.end;
    if (end - start >= 0.05) ranges.push({ start, end });
  }
  if (!ranges.length) return null;
  return ranges.sort((a, b) => b.start - a.start).map((r) => ({ type: 'timeline.deleteRange', start: +r.start.toFixed(4), end: +r.end.toFixed(4) }));
};

/**
 * "Altyazıyı düzelt": cümlenin yeni metnini kelime yuvalarına dağıtır.
 * Kesimlere ve zamanlara dokunmaz; yalnız captions.editWord üretir. Kelime sayısı farklıysa
 * fazlası son yuvaya eklenir, eksik yuvalar boşaltılır (altyazıda görünmez).
 */
export const editSentenceOps = (sentence: TranscriptSentence, newText: string): OpInput[] => {
  const slots = sentence.words;
  const parts = newText.trim().split(/\s+/).filter(Boolean);
  const ops: OpInput[] = [];
  slots.forEach((w, i) => {
    let text: string;
    if (i < slots.length - 1) text = parts[i] ?? '';
    else text = parts.slice(i).join(' ');
    const target = text === w.original ? null : text; // aslına dönüyorsa düzeltmeyi kaldır
    const current = w.edited ? w.text : null;
    if ((target ?? null) !== current) ops.push({ type: 'captions.editWord', key: w.key, text: target });
  });
  return ops;
};
