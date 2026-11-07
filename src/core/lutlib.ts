/**
 * LUT Kütüphanem (Faz 4): kullanıcının LUT'ları, türleri ve etiketleri.
 * Dosyalar `kutuphane/luts/*.cube` içinde, bilgiler `kutuphane/luts.json` içinde durur.
 * Üçüncü taraf LUT'lar yalnız kullanıcının kütüphanesinde tutulur; depoya veya sunucuya konmaz.
 */
import { z } from 'zod';
import type { Lut3D } from './lut';

/** gorunum: normal (Rec.709) görüntüye uygulanan yaratıcı LUT · teknik: belirli bir giriş (log, HDR…) bekleyen dönüşüm */
export const LUT_KINDS = ['gorunum', 'teknik'] as const;

export const LutMetaSchema = z.object({
  name: z.string(),
  kind: z.enum(LUT_KINDS).default('gorunum'),
  /** Teknik LUT'un beklediği giriş: kamera kimliği (assets/luts/kamera) veya 'log' | 'cineon' | 'hdr' | 'linear' | 'diger' */
  input: z.string().nullable().default(null),
  tags: z.array(z.string()).default([]),
  favorite: z.boolean().default(false),
  size: z.number().int().default(0),
  hash: z.string().default(''),
  /** İçe aktarılan asıl dosya adı */
  source: z.string().default(''),
  addedAt: z.string().default(''),
});
export type LutMeta = z.infer<typeof LutMetaSchema>;

export const LutPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    kind: z.enum(LUT_KINDS),
    input: z.string().nullable(),
    tags: z.array(z.string().trim().min(1).max(30)).max(12),
    favorite: z.boolean(),
  })
  .partial();

/** Giriş türlerinin Türkçe adları (kamera kimlikleri dahil) */
export const INPUT_LABELS: Record<string, string> = {
  'sony-slog3-sgamut3cine': 'Sony S-Log3',
  'sony-slog3-sgamut3': 'Sony S-Log3',
  'sony-slog2-sgamut': 'Sony S-Log2',
  'panasonic-vlog': 'Panasonic V-Log',
  'canon-clog3': 'Canon Log 3',
  'canon-clog2': 'Canon Log 2',
  'fujifilm-flog': 'Fujifilm F-Log',
  'fujifilm-flog2': 'Fujifilm F-Log2',
  'nikon-nlog': 'Nikon N-Log',
  'dji-dlog': 'DJI D-Log',
  'apple-log': 'Apple Log',
  'arri-logc3': 'ARRI LogC',
  log: 'log görüntü',
  cineon: 'Cineon log (film baskı)',
  hdr: 'HDR',
  linear: 'lineer (VFX)',
  diger: 'özel giriş',
};
export const inputLabel = (input: string | null) => (input ? (INPUT_LABELS[input] ?? input) : 'normal video (Rec.709)');

/** Aynı log eğrisini kullanan kamera kimlikleri (S-Log3 Cine ↔ S-Log3 gibi) aynı giriş sayılır */
const curveOf = (id: string | null) => (id ? id.replace(/-sgamut3?(cine)?$/, '').replace(/-sgamut$/, '') : null);
export const sameInput = (a: string | null, b: string | null) => curveOf(a) === curveOf(b);

const RULES: { re: RegExp; input: string }[] = [
  { re: /s-?log ?3|slog3/i, input: 'sony-slog3-sgamut3cine' },
  { re: /s-?log ?2|slog2/i, input: 'sony-slog2-sgamut' },
  { re: /v-?log/i, input: 'panasonic-vlog' },
  { re: /c-?log ?3|canon ?log ?3/i, input: 'canon-clog3' },
  { re: /c-?log ?2|canon ?log ?2/i, input: 'canon-clog2' },
  { re: /f-?log ?2/i, input: 'fujifilm-flog2' },
  { re: /f-?log/i, input: 'fujifilm-flog' },
  { re: /n-?log/i, input: 'nikon-nlog' },
  { re: /d-?log/i, input: 'dji-dlog' },
  { re: /apple ?log/i, input: 'apple-log' },
  { re: /log ?c\b|logc\d?|arri/i, input: 'arri-logc3' },
  { re: /hlg|st ?2084|\bpq\b|nits|rec ?2020|hdr/i, input: 'hdr' },
  { re: /cineon|^(rec ?709|dci-?p3) (kodak|fujifilm) \d{4}/i, input: 'cineon' },
  { re: /\blinear\b/i, input: 'linear' },
  { re: /om-?log|log3g10|bmd ?film|blackmagic .*film|universal log|acescc|aces|\blog\b|dci-?xyz/i, input: 'log' },
  { re: /\bgamma \d/i, input: 'diger' },
];

const TAG_RULES: { re: RegExp; tag: string }[] = [
  { re: /kodak|fuji|eterna|film|2383|2393|2395|3510|3513|cinematic|prolost/i, tag: 'film' },
  { re: /warm|suntan|candle|sunset|fall|sıcak|sicak|golden|amber/i, tag: 'sıcak' },
  { re: /blue|winter|moon|night|cold|cool|soğuk|soguk|teal/i, tag: 'soğuk' },
  { re: /\bb ?& ?w\b|\bbw\b|mono|black ?and ?white|siyah/i, tag: 'siyah-beyaz' },
  { re: /flat|neutral|soft|faded|matte/i, tag: 'yumuşak' },
  { re: /vibran|vivid|punch|contrast/i, tag: 'canlı' },
];

/** Dosya adı ve başlıktan tür, giriş ve etiket tahmini (kullanıcı sonra düzeltebilir) */
export const classifyLut = (fileName: string, title = '') => {
  const text = `${fileName.replace(/\.(cube|3dl)$/i, '').replace(/[_]+/g, ' ')} ${title}`;
  const hit = RULES.find((r) => r.re.test(text));
  const tags = [...new Set(TAG_RULES.filter((r) => r.re.test(text)).map((r) => r.tag))];
  return { kind: hit ? ('teknik' as const) : ('gorunum' as const), input: hit?.input ?? null, tags };
};

export const lutFormat = (fileName: string): 'cube' | '3dl' | 'zip' | null => {
  const ext = fileName.toLowerCase().split('.').pop();
  return ext === 'cube' ? 'cube' : ext === '3dl' ? '3dl' : ext === 'zip' ? 'zip' : null;
};

/** Desteklenmeyen biçimler için anlaşılır neden */
export const unsupportedReason = (fileName: string) => {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  if (ext === 'look') return '.look (Adobe SpeedGrade) biçimi desteklenmiyor';
  if (ext === 'xmp') return 'Lightroom ön ayarı/profili (.xmp) LUT değildir';
  if (ext === 'lut' || ext === 'csp' || ext === 'mga' || ext === 'icc' || ext === 'icm') return `.${ext} biçimi desteklenmiyor; .cube veya .3dl gerekli`;
  return `.${ext || '?'} bir LUT dosyası değil`;
};

/**
 * .3dl (Autodesk/Lustre, Photoshop) 3B LUT'unu okur.
 * İlk sayısal satır giriş ızgarasıdır (N değer); sonra N³ satır tamsayı çıkış gelir.
 * Sıra: mavi en hızlı değişir (r → g → b); .cube'da kırmızı en hızlıdır, bu yüzden yeniden dizilir.
 */
export const parse3dl = (text: string): Lut3D => {
  const rows: number[][] = [];
  let mesh: number[] | null = null;
  let outBits: number | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^mesh\s+(\d+)\s+(\d+)/i.exec(line);
    if (m) {
      outBits = Number(m[2]);
      continue;
    }
    if (/^[a-z]/i.test(line)) continue; // 3DMESH, LUT8, gamma gibi anahtarlar
    const nums = line.split(/\s+/).map(Number);
    if (nums.some((n) => !Number.isFinite(n))) continue;
    if (!mesh && nums.length > 3) {
      mesh = nums;
      continue;
    }
    if (nums.length >= 3) rows.push(nums.slice(0, 3));
  }
  // 3 noktalı ızgarada başlık satırı veriyle aynı uzunluktadır: küp tutmuyorsa ve ilk satır 0'dan artan bir ızgaraysa başlıktır
  if (!mesh && rows.length > 1) {
    const k = Math.round(Math.cbrt(rows.length - 1));
    const [a, b, c] = rows[0];
    if (k ** 3 === rows.length - 1 && k === 3 && a === 0 && b > a && c > b) mesh = rows.shift()!;
  }
  const n = Math.round(Math.cbrt(rows.length));
  if (n < 2 || n * n * n !== rows.length) throw new Error(`Geçersiz .3dl: ${rows.length} satır bir küp oluşturmuyor`);
  if (mesh && mesh.length !== n) throw new Error(`Geçersiz .3dl: ızgara ${mesh.length}, veri ${n}³`);
  const maxVal = rows.reduce((m, r) => Math.max(m, r[0], r[1], r[2]), 0);
  const outMax = outBits ? 2 ** outBits - 1 : maxVal <= 1023 ? 1023 : maxVal <= 4095 ? 4095 : maxVal <= 65535 ? 65535 : maxVal;
  const data = new Float32Array(n * n * n * 4);
  for (let r = 0; r < n; r++)
    for (let g = 0; g < n; g++)
      for (let b = 0; b < n; b++) {
        const src = rows[(r * n + g) * n + b];
        const j = ((b * n + g) * n + r) * 4; // .cube sırası: r en hızlı
        data[j] = src[0] / outMax;
        data[j + 1] = src[1] / outMax;
        data[j + 2] = src[2] / outMax;
        data[j + 3] = 1;
      }
  return { size: n, data, title: '' };
};

/** Lut3D → .cube metni (dönüştürülen .3dl dosyaları böyle saklanır) */
export const toCube = (lut: Lut3D, title: string) => {
  const lines = [`TITLE "${title.replace(/"/g, "'")}"`, `LUT_3D_SIZE ${lut.size}`];
  for (let i = 0; i < lut.data.length; i += 4) lines.push(`${lut.data[i].toFixed(6)} ${lut.data[i + 1].toFixed(6)} ${lut.data[i + 2].toFixed(6)}`);
  return lines.join('\n') + '\n';
};

/** Görüntü verisine (RGBA, 0–255) LUT uygular — küçük önizlemeler için (tarayıcıda) */
export const applyLutToPixels = (px: Uint8ClampedArray, lut: Lut3D, amount = 1, sample: (l: Lut3D, r: number, g: number, b: number) => [number, number, number]) => {
  const out = new Uint8ClampedArray(px.length);
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    const [lr, lg, lb] = sample(lut, r, g, b);
    out[i] = (r + (lr - r) * amount) * 255;
    out[i + 1] = (g + (lg - g) * amount) * 255;
    out[i + 2] = (b + (lb - b) * amount) * 255;
    out[i + 3] = px[i + 3];
  }
  return out;
};
