/**
 * Referanstan renk eşleme (Faz 4.2) — yaklaşık, yerel, internetsiz.
 * Referans ve hedef karelerin Lab renk uzayındaki ortalama/yayılımı karşılaştırılır (Reinhard aktarımı),
 * fark sınırlı tutularak bir 3B LUT'a dönüştürülür. Orijinal LUT birebir çıkarılmaz; amaç benzer ton.
 */
import type { Lut3D } from './lut';

export type Lab = [number, number, number];
export type ColorStats = { mean: Lab; std: Lab; chroma: number; n: number };

// ---------- sRGB ↔ Lab (D65) ----------
const toLin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
const XN = 0.95047;
const ZN = 1.08883;
const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
const fi = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));

export const rgbToLab = (r: number, g: number, b: number): Lab => {
  const R = toLin(r);
  const G = toLin(g);
  const B = toLin(b);
  const x = (0.4124564 * R + 0.3575761 * G + 0.1804375 * B) / XN;
  const y = 0.2126729 * R + 0.7151522 * G + 0.072175 * B;
  const z = (0.0193339 * R + 0.119192 * G + 0.9503041 * B) / ZN;
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
};

export const labToRgb = ([L, a, bb]: Lab): [number, number, number] => {
  const fy = (L + 16) / 116;
  const x = fi(fy + a / 500) * XN;
  const y = fi(fy);
  const z = fi(fy - bb / 200) * ZN;
  const R = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const G = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const B = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z;
  const c = (v: number) => Math.min(1, Math.max(0, toSrgb(Math.min(1, Math.max(0, v)))));
  return [c(R), c(G), c(B)];
};

/** RGB(A) piksel dizisinin Lab istatistikleri; çok karanlık/patlamış pikseller az ağırlık alır */
export const colorStats = (px: Uint8Array | Uint8ClampedArray, channels = 4, step = 1): ColorStats => {
  const sum: Lab = [0, 0, 0];
  const sq: Lab = [0, 0, 0];
  let chroma = 0;
  let w = 0;
  for (let i = 0; i < px.length; i += channels * step) {
    const lab = rgbToLab(px[i] / 255, px[i + 1] / 255, px[i + 2] / 255);
    const k = lab[0] < 3 || lab[0] > 98 ? 0.2 : 1;
    for (let c = 0; c < 3; c++) {
      sum[c] += lab[c] * k;
      sq[c] += lab[c] * lab[c] * k;
    }
    chroma += Math.hypot(lab[1], lab[2]) * k;
    w += k;
  }
  if (!w) return { mean: [50, 0, 0], std: [1, 1, 1], chroma: 0, n: 0 };
  const mean = sum.map((s) => s / w) as Lab;
  const std = sq.map((s, c) => Math.sqrt(Math.max(1e-6, s / w - mean[c] ** 2))) as Lab;
  return { mean, std, chroma: chroma / w, n: w };
};

/** Birden çok karenin istatistiklerini birleştirir (ağırlıklı) */
export const mergeStats = (list: ColorStats[]): ColorStats => {
  const n = list.reduce((s, x) => s + x.n, 0) || 1;
  const mean = [0, 1, 2].map((c) => list.reduce((s, x) => s + x.mean[c] * x.n, 0) / n) as Lab;
  const std = [0, 1, 2].map((c) => Math.sqrt(list.reduce((s, x) => s + (x.std[c] ** 2 + (x.mean[c] - mean[c]) ** 2) * x.n, 0) / n)) as Lab;
  return { mean, std, chroma: list.reduce((s, x) => s + x.chroma * x.n, 0) / n, n };
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Sınırlar: aşırı uçları önler (gece fotoğrafı referansı gündüz videosunu karartıp mahvetmesin) */
export const MATCH_LIMITS = { meanL: 18, meanAB: 14, ratioL: [0.7, 1.45] as const, ratioAB: [0.6, 1.8] as const };

export type MatchParams = { shift: Lab; scale: Lab; from: Lab; to: Lab };
export const matchParams = (target: ColorStats, ref: ColorStats): MatchParams => {
  const lim = MATCH_LIMITS;
  const shift: Lab = [
    clamp(ref.mean[0] - target.mean[0], -lim.meanL, lim.meanL),
    clamp(ref.mean[1] - target.mean[1], -lim.meanAB, lim.meanAB),
    clamp(ref.mean[2] - target.mean[2], -lim.meanAB, lim.meanAB),
  ];
  const scale: Lab = [
    clamp(ref.std[0] / target.std[0], lim.ratioL[0], lim.ratioL[1]),
    clamp(ref.std[1] / target.std[1], lim.ratioAB[0], lim.ratioAB[1]),
    clamp(ref.std[2] / target.std[2], lim.ratioAB[0], lim.ratioAB[1]),
  ];
  return { shift, scale, from: target.mean, to: [0, 1, 2].map((c) => target.mean[c] + shift[c]) as Lab };
};

/** Eşleme LUT'u: hedefin Lab dağılımını referansınkine yaklaştırır */
export const buildMatchLut = (target: ColorStats, ref: ColorStats, size = 33): Lut3D => {
  const p = matchParams(target, ref);
  const data = new Float32Array(size ** 3 * 4);
  let j = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const lab = rgbToLab(r / (size - 1), g / (size - 1), b / (size - 1));
        const out: Lab = [0, 1, 2].map((c) => (lab[c] - p.from[c]) * p.scale[c] + p.to[c]) as Lab;
        out[0] = clamp(out[0], 0, 100);
        // Siyah ve beyaz uçları korunsun (kayma yalnız orta tonlarda tam güçte)
        const keep = Math.min(1, Math.min(lab[0], 100 - lab[0]) / 15);
        for (let c = 0; c < 3; c++) out[c] = lab[c] + (out[c] - lab[c]) * keep;
        const rgb = labToRgb(out);
        data[j++] = rgb[0];
        data[j++] = rgb[1];
        data[j++] = rgb[2];
        data[j++] = 1;
      }
  return { size, data, title: 'Referans eşleme' };
};

/** Farkın sade Türkçe özeti (ne değişecek) */
export const describeMatch = (target: ColorStats, ref: ColorStats): string[] => {
  const p = matchParams(target, ref);
  const out: string[] = [];
  const dL = p.shift[0];
  if (dL > 3) out.push(`daha aydınlık (+${dL.toFixed(0)})`);
  if (dL < -3) out.push(`daha karanlık (${dL.toFixed(0)})`);
  if (p.scale[0] > 1.1) out.push(`daha kontrastlı (×${p.scale[0].toFixed(2)})`);
  if (p.scale[0] < 0.9) out.push(`daha yumuşak kontrast (×${p.scale[0].toFixed(2)})`);
  if (p.shift[2] > 3) out.push('daha sıcak (sarı/turuncu)');
  if (p.shift[2] < -3) out.push('daha soğuk (mavi)');
  if (p.shift[1] > 3) out.push('daha pembe/kırmızı');
  if (p.shift[1] < -3) out.push('daha yeşil');
  const cr = ref.chroma / Math.max(1, target.chroma);
  if (cr > 1.15) out.push('daha doygun renkler');
  if (cr < 0.85) out.push('daha soluk renkler');
  const limited = Math.abs(ref.mean[0] - target.mean[0]) > MATCH_LIMITS.meanL || Math.abs(ref.mean[2] - target.mean[2]) > MATCH_LIMITS.meanAB || Math.abs(ref.mean[1] - target.mean[1]) > MATCH_LIMITS.meanAB;
  if (!out.length) out.push('renkler zaten çok yakın; değişiklik küçük olacak');
  if (limited) out.push('fark çok büyük olduğu için eşleme sınırlandı (görüntü bozulmasın diye)');
  return out;
};
