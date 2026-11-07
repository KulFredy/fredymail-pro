import { DEFAULT_ADJUST, type Adjust, type Clip, type Look, type Project } from './schema';

export type Preset = {
  id: string;
  label: string;
  adjust: Partial<Adjust>;
  /** Gölge ve parlak alan renk kayması (ton bölme), -1..1 RGB */
  shadowTint?: [number, number, number];
  highlightTint?: [number, number, number];
  swatch: string;
};

export const PRESETS: Preset[] = [
  { id: 'dogal', label: 'Doğal', adjust: {}, swatch: 'linear-gradient(135deg,#9aa5b1,#e6e1d6)' },
  {
    id: 'sicak',
    label: 'Sıcak',
    adjust: { temp: 0.45, tint: 0.06, saturation: 0.06, contrast: 0.06, shadows: 0.05 },
    highlightTint: [0.35, 0.18, 0],
    swatch: 'linear-gradient(135deg,#c9733c,#f6d29a)',
  },
  {
    id: 'soguk',
    label: 'Soğuk',
    adjust: { temp: -0.45, tint: -0.04, contrast: 0.06 },
    shadowTint: [0, 0.1, 0.3],
    swatch: 'linear-gradient(135deg,#2f5f8a,#bfe0f2)',
  },
  {
    id: 'canli',
    label: 'Canlı',
    adjust: { vibrance: 0.5, saturation: 0.12, contrast: 0.14, shadows: 0.08 },
    swatch: 'linear-gradient(135deg,#e63946,#2a9d8f)',
  },
  {
    id: 'film',
    label: 'Film',
    adjust: { contrast: -0.06, saturation: -0.18, temp: 0.12, fade: 0.55, highlights: -0.15 },
    shadowTint: [0, 0.22, 0.25],
    highlightTint: [0.3, 0.15, 0],
    swatch: 'linear-gradient(135deg,#3d5a5b,#d9b48f)',
  },
  {
    id: 'sb',
    label: 'Siyah beyaz',
    adjust: { saturation: -1, contrast: 0.22 },
    swatch: 'linear-gradient(135deg,#111,#eee)',
  },
];

export const presetById = (id: string): Preset => PRESETS.find((p) => p.id === id) ?? PRESETS[0];

export const presetAdjust = (id: string): Adjust => ({ ...DEFAULT_ADJUST, ...presetById(id).adjust });

/** Klibin geçerli renk ayarı: klibe özel ayar yoksa projeninki */
export const effectiveLook = (project: Project, clip: Clip): Look => clip.look ?? project.look;

/** Klibin kamera dönüşümü (LUT kimliği veya null) */
export const effectiveCamera = (clip: Clip, detected: string | null): string | null => {
  if (clip.camera === 'none') return null;
  if (clip.camera === 'auto') return detected;
  return clip.camera;
};

export const ADJUST_FIELDS: { key: keyof Adjust; label: string; min: number; max: number; step: number }[] = [
  { key: 'exposure', label: 'Pozlama', min: -2, max: 2, step: 0.05 },
  { key: 'contrast', label: 'Kontrast', min: -1, max: 1, step: 0.02 },
  { key: 'highlights', label: 'Parlak alanlar', min: -1, max: 1, step: 0.02 },
  { key: 'shadows', label: 'Gölgeler', min: -1, max: 1, step: 0.02 },
  { key: 'temp', label: 'Sıcaklık', min: -1, max: 1, step: 0.02 },
  { key: 'tint', label: 'Ton (yeşil ↔ mor)', min: -1, max: 1, step: 0.02 },
  { key: 'vibrance', label: 'Canlılık', min: -1, max: 1, step: 0.02 },
  { key: 'saturation', label: 'Doygunluk', min: -1, max: 1, step: 0.02 },
  { key: 'sharpen', label: 'Keskinlik', min: 0, max: 1, step: 0.02 },
  { key: 'fade', label: 'Soluk film', min: 0, max: 1, step: 0.02 },
  { key: 'vignette', label: 'Vinyet', min: 0, max: 1, step: 0.02 },
];
