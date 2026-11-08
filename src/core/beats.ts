/**
 * Müzik vuruşu algılama (Faz 4.4) — yerel, saf TS.
 * 1) Kısa pencerelerde enerji → artış (onset) zarfı
 * 2) Zarfın otokorelasyonuyla tempo (70–180 BPM)
 * 3) En güçlü faz → düzenli vuruş ızgarası, her vuruş en yakın gerçek darbeye hizalanır
 */
import type { OpInput } from './ops';
import type { AssetRef, Project } from './schema';
import { FPS } from './schema';
import { layoutClips } from './timeline';

export type BeatInfo = { bpm: number; beats: number[]; confidence: number };

const HOP = 512;

/** Mono PCM (−1..1) → saniyede rate/HOP değerli onset zarfı */
export const onsetEnvelope = (pcm: Float32Array, rate: number) => {
  const n = Math.floor(pcm.length / HOP);
  const energy = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < HOP; j++) {
      const v = pcm[i * HOP + j];
      s += v * v;
    }
    energy[i] = Math.log1p(1000 * Math.sqrt(s / HOP));
  }
  const env = new Float32Array(n);
  for (let i = 1; i < n; i++) env[i] = Math.max(0, energy[i] - energy[i - 1]);
  // Ortalama çıkarılıp normalize edilir
  const mean = env.reduce((a, b) => a + b, 0) / Math.max(1, n);
  let max = 0;
  for (let i = 0; i < n; i++) {
    env[i] = Math.max(0, env[i] - mean * 0.5);
    max = Math.max(max, env[i]);
  }
  if (max > 0) for (let i = 0; i < n; i++) env[i] /= max;
  return { env, fps: rate / HOP };
};

export const analyzeBeats = (pcm: Float32Array, rate: number, minBpm = 70, maxBpm = 180): BeatInfo => {
  const { env, fps } = onsetEnvelope(pcm, rate);
  const n = env.length;
  if (n < fps * 3) return { bpm: 0, beats: [], confidence: 0 };
  // Tempo: otokorelasyon (yarım/iki katı tempoya hafif ceza yok; 70–180 aralığı)
  const minLag = Math.floor((60 / maxBpm) * fps);
  const maxLag = Math.ceil((60 / minBpm) * fps);
  let bestLag = minLag;
  let best = -Infinity;
  let total = 0;
  const scores: number[] = [];
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    // ±1 kare tolerans: tam sayıya denk gelmeyen periyotlar bulanıklaşmasın
    for (let i = lag + 1; i < n; i++) s += env[i] * Math.max(env[i - lag - 1], env[i - lag], env[i - lag + 1] ?? 0);
    s /= n - lag;
    // 120 BPM civarını hafifçe tercih et (insan algısı)
    const bpm = (60 * fps) / lag;
    const w = Math.exp(-0.5 * (Math.log2(bpm / 120) / 1.0) ** 2);
    const sc = s * (0.7 + 0.3 * w);
    scores.push(sc);
    total += sc;
    if (sc > best) {
      best = sc;
      bestLag = lag;
    }
  }
  // Oktav hatası: yarım periyot neredeyse aynı güçteyse (iki kat tempo) onu seç
  for (;;) {
    const half = Math.round(bestLag / 2);
    if (half < minLag) break;
    const sh = scores[half - minLag];
    if (sh !== undefined && sh >= best * 0.8) {
      bestLag = half;
      best = sh;
    } else break;
  }
  // Kesirli gecikme: komşularla parabolik tepe
  const i0 = bestLag - minLag;
  const a = scores[i0 - 1] ?? best;
  const c = scores[i0 + 1] ?? best;
  const denom = a - 2 * best + c;
  const frac = denom !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denom)) : 0;
  const period = bestLag + frac; // kare cinsinden
  // Faz: periyot içinde zarfın en güçlü olduğu kaydırma
  let bestPhase = 0;
  let bestSum = -Infinity;
  for (let ph = 0; ph < Math.ceil(period); ph++) {
    let s = 0;
    for (let t = ph; t < n; t += period) s += env[Math.round(t)] ?? 0;
    if (s > bestSum) {
      bestSum = s;
      bestPhase = ph;
    }
  }
  // Gerçek darbelere hizalayıp doğrusal uydurmayla tempo/fazı incelt (uzun parçalarda kayma birikmesin)
  const peakNear = (c: number, w: number) => {
    let bi = -1;
    for (let k = Math.max(1, Math.round(c - w)); k <= Math.min(n - 2, Math.round(c + w)); k++) if (bi < 0 || env[k] > env[bi]) bi = k;
    if (bi < 0 || env[bi] < 0.08) return null;
    // Parabolik alt-kare konum
    const y0 = env[bi - 1];
    const y1 = env[bi];
    const y2 = env[bi + 1];
    const d = y0 - 2 * y1 + y2;
    return bi + (d !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / d)) : 0);
  };
  // İzleme: güçlü bir darbeden başlayıp darbeden darbeye ilerle, tempoyu yavaşça güncelle
  let start = bestPhase;
  for (let k = 0; k < Math.min(n, Math.round(period * 4)); k++) if (env[k] > env[start]) start = k;
  const s0 = peakNear(start, 1) ?? start;
  const pts: [number, number][] = [[0, s0]];
  const track = (dir: 1 | -1) => {
    let per = period;
    let last = s0;
    let lastPeak = s0;
    let lastK = 0;
    for (let k = dir; ; k += dir) {
      const exp = last + dir * per;
      if (exp < 0 || exp >= n) break;
      const pk = peakNear(exp, per * 0.25);
      if (pk !== null) {
        const inst = (pk - lastPeak) / (k - lastK);
        if (inst > period * 0.7 && inst < period * 1.3) per = 0.85 * per + 0.15 * inst;
        pts.push([k, pk]);
        last = pk;
        lastPeak = pk;
        lastK = k;
      } else last = exp;
    }
  };
  track(1);
  track(-1);
  // Doğru numaralanmış darbelerle doğrusal uydurma → kesin tempo ve faz
  let ph = s0;
  let per = period;
  if (pts.length >= 4) {
    const m = pts.length;
    const sx = pts.reduce((q, p) => q + p[0], 0);
    const sy = pts.reduce((q, p) => q + p[1], 0);
    const sxx = pts.reduce((q, p) => q + p[0] * p[0], 0);
    const sxy = pts.reduce((q, p) => q + p[0] * p[1], 0);
    const slope = (m * sxy - sx * sy) / (m * sxx - sx * sx);
    if (slope > period * 0.7 && slope < period * 1.3) {
      per = slope;
      ph = (sy - slope * sx) / m;
    }
  }
  while (ph - per >= 0) ph -= per;
  const beats: number[] = [];
  for (let t = ph; t < n; t += per) {
    const pk = peakNear(t, per * 0.1);
    beats.push(+(((pk ?? t) * HOP) / rate).toFixed(3));
  }
  const bpmOut = (60 * fps) / per;
  const confidence = total > 0 ? Math.min(1, (best / (total / scores.length)) / 4) : 0;
  return { bpm: +bpmOut.toFixed(1), beats, confidence: +confidence.toFixed(2) };
};

/** t'ye en yakın vuruş (yoksa null) */
export const nearestBeat = (beats: number[], t: number) => {
  let best: number | null = null;
  for (const b of beats) if (best === null || Math.abs(b - t) < Math.abs(best - t)) best = b;
  return best;
};


/**
 * Kesim ritmi: klip geçişlerini müziğin en yakın vuruşuna kaydırır (en çok maxShift sn).
 * Kaydırma klibin sonunu uzatır/kısaltır; sonraki geçişler bu kaymayı hesaba katar.
 */
export const snapCutsToBeats = (project: Project, assets: Record<string, AssetRef>, maxShift = 0.3) => {
  const music = project.music;
  const ma = music ? assets[music.assetId] : undefined;
  if (!music || !ma?.beats?.length) return null;
  const beats = ma.beats.map((b) => b - music.start).filter((b) => b > 0.05);
  const layout = layoutClips(project);
  const ops: OpInput[] = [];
  const moved: { at: number; to: number }[] = [];
  let acc = 0;
  for (let i = 0; i < layout.length - 1; i++) {
    const { clip, end } = layout[i];
    const cur = end + acc;
    const b = nearestBeat(beats, cur);
    if (b === null) continue;
    const d = b - cur;
    if (Math.abs(d) < 1 / FPS || Math.abs(d) > maxShift) continue;
    const a = assets[clip.assetId];
    const out = clip.out + d;
    if (!a || (a.kind === 'video' && (out > a.duration + 1e-6 || out - clip.in < 0.3)) || (a.kind === 'image' && out < 0.3)) continue;
    ops.push({ type: 'clip.trim', clipId: clip.id, in: clip.in, out: +out.toFixed(4) });
    moved.push({ at: cur, to: b });
    acc += d;
  }
  return { ops, moved, cuts: Math.max(0, layout.length - 1), bpm: ma.bpm ?? 0 };
};
