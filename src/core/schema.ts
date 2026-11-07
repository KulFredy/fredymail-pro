import { z } from 'zod';

/** Proje dosyasının şema sürümü. Değişirse migrate() güncellenir. */
export const SCHEMA_VERSION = 1;
export const FPS = 30;

const unit = (def = 0) => z.number().min(-1).max(1).default(def);
const pos = (def = 0) => z.number().min(0).max(1).default(def);

export const AdjustSchema = z.object({
  exposure: z.number().min(-3).max(3).default(0),
  contrast: unit(),
  highlights: unit(),
  shadows: unit(),
  temp: unit(),
  tint: unit(),
  vibrance: unit(),
  saturation: unit(),
  sharpen: pos(),
  vignette: pos(),
  fade: pos(),
});
export type Adjust = z.infer<typeof AdjustSchema>;
export const DEFAULT_ADJUST: Adjust = AdjustSchema.parse({});

export const LookSchema = z.object({
  preset: z.string().default('dogal'),
  intensity: pos(1),
  adjust: AdjustSchema.default(DEFAULT_ADJUST),
  /** Yaratıcı LUT kimliği (kullanıcının yüklediği .cube) */
  lut: z.string().nullable().default(null),
  lutIntensity: pos(1),
});
export type Look = z.infer<typeof LookSchema>;
export const DEFAULT_LOOK: Look = LookSchema.parse({});

export const FramingSchema = z.object({
  mode: z.enum(['fill', 'fit-blur', 'fit']).default('fill'),
  /** Kaynak görüntüde odak noktası (0..1) */
  x: pos(0.5),
  y: pos(0.5),
  zoom: z.number().min(1).max(4).default(1),
});
export type Framing = z.infer<typeof FramingSchema>;

export const ClipSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  /** Kaynak zamanı (sn). Fotoğrafta in=0, out=süre. */
  in: z.number().min(0),
  out: z.number().positive(),
  /** Kamera dönüşümü: 'auto' (algılanan), 'none' veya kamera LUT kimliği */
  camera: z.string().default('auto'),
  /** null → projenin renk ayarını kullanır */
  look: LookSchema.nullable().default(null),
  gainDb: z.number().min(-60).max(12).default(0),
  muted: z.boolean().default(false),
  musicMuted: z.boolean().default(false),
});
export type Clip = z.infer<typeof ClipSchema>;

export const FORMAT_IDS = ['story', 'reel', 'post', 'square', 'landscape'] as const;
/** Çıktı çözünürlüğü: kısa kenar (px). Kompozisyon 1080 tabanında tasarlanır, render ölçeklenir. */
export const RESOLUTIONS = ['720', '1080', '1440', '2160'] as const;
export type Resolution = (typeof RESOLUTIONS)[number];
export type FormatId = (typeof FORMAT_IDS)[number];

export const OutputSchema = z.object({
  id: z.string(),
  format: z.enum(FORMAT_IDS),
  kind: z.enum(['video', 'image']),
  /** Kadraj çıktı başına saklanır: post kadrajı Story'yi etkilemez */
  framing: z.record(z.string(), FramingSchema).default({}),
  /** Görsel çıktı için kaynak kare */
  still: z.object({ clipId: z.string(), at: z.number().min(0).default(0) }).nullable().default(null),
  resolution: z.enum(RESOLUTIONS).default('1080'),
});
export type Output = z.infer<typeof OutputSchema>;

export const MUSIC_MODES = ['bed', 'duck', 'fixed'] as const;
export type MusicMode = (typeof MUSIC_MODES)[number];

export const MusicSchema = z.object({
  assetId: z.string(),
  gainDb: z.number().min(-40).max(6).default(-6),
  /** Müzik dosyasında başlangıç noktası (sn) */
  start: z.number().min(0).default(0),
  /** bed: arka planda sabit kısık · duck: konuşmada kıs · fixed: sabit seviye */
  mode: z.enum(MUSIC_MODES).default('fixed'),
  bedDb: z.number().min(-40).max(0).default(-18),
  duckDb: z.number().min(-40).max(0).default(-14),
  attack: z.number().min(0.05).max(2).default(0.3),
  release: z.number().min(0.05).max(3).default(0.6),
  fadeIn: z.number().min(0).max(5).default(0.5),
  fadeOut: z.number().min(0).max(5).default(1.5),
  /** Kullanıcı modu elle seçtiyse otomatik öneri değiştirmez */
  modeLocked: z.boolean().default(false),
});
export type Music = z.infer<typeof MusicSchema>;

export const CaptionStyleSchema = z.object({
  font: z.enum(['Inter', 'Montserrat']).default('Inter'),
  size: z.number().min(24).max(140).default(64),
  color: z.string().default('#FFFFFF'),
  highlight: z.string().default('#FFD60A'),
  outline: z.boolean().default(true),
  box: z.boolean().default(false),
  uppercase: z.boolean().default(false),
  maxLines: z.number().int().min(1).max(3).default(2),
  position: z.enum(['bottom', 'middle', 'top']).default('bottom'),
  /** İnce konum ayarı (px, + yukarı) */
  offset: z.number().min(-600).max(600).default(0),
});
export type CaptionStyle = z.infer<typeof CaptionStyleSchema>;

export const CaptionsSchema = z.object({
  enabled: z.boolean().default(true),
  style: CaptionStyleSchema.default(CaptionStyleSchema.parse({})),
  /** Kelime düzeltmeleri: anahtar `${assetId}:${kelimeSırası}`. Boş metin kelimeyi gizler. */
  edits: z.record(z.string(), z.string()).default({}),
});
export type Captions = z.infer<typeof CaptionsSchema>;

export const TextOverlaySchema = z.object({
  id: z.string(),
  text: z.string(),
  start: z.number().min(0),
  end: z.number().positive(),
  x: pos(0.5),
  y: pos(0.25),
  size: z.number().min(20).max(220).default(84),
  color: z.string().default('#FFFFFF'),
  font: z.enum(['Inter', 'Montserrat']).default('Montserrat'),
  style: z.enum(['shadow', 'box', 'outline']).default('shadow'),
});
export type TextOverlay = z.infer<typeof TextOverlaySchema>;

/** Üst iz (B-roll): ana görüntünün üstünde gösterilir, ana ses devam eder */
export const OverlaySchema = z.object({
  id: z.string(),
  assetId: z.string(),
  /** Zaman çizelgesinde başlangıç (sn) */
  at: z.number().min(0),
  /** Kaynakta giriş/çıkış (sn); fotoğrafta in=0, out=süre */
  in: z.number().min(0).default(0),
  out: z.number().positive(),
  camera: z.string().default('auto'),
});
export type Overlay = z.infer<typeof OverlaySchema>;

/** Dış ses izi: videoda kullanılacak ses kaydı (kurgu talimatından ayrı) */
export const VoiceSchema = z.object({
  id: z.string(),
  assetId: z.string(),
  at: z.number().min(0),
  in: z.number().min(0).default(0),
  out: z.number().positive(),
  gainDb: z.number().min(-40).max(12).default(0),
});
export type Voice = z.infer<typeof VoiceSchema>;

export const UiStateSchema = z.object({
  step: z.string().default('ekle'),
  selectedClipId: z.string().nullable().default(null),
  activeOutputId: z.string().nullable().default(null),
  frame: z.number().int().min(0).default(0),
  safeZones: z.boolean().default(true),
});
export type UiState = z.infer<typeof UiStateSchema>;

export const ProjectSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION).default(SCHEMA_VERSION),
  id: z.string(),
  name: z.string(),
  mode: z.enum(['quick', 'studio']).default('quick'),
  createdAt: z.string(),
  updatedAt: z.string(),
  clips: z.array(ClipSchema).default([]),
  outputs: z.array(OutputSchema).default([]),
  music: MusicSchema.nullable().default(null),
  captions: CaptionsSchema.default(CaptionsSchema.parse({})),
  texts: z.array(TextOverlaySchema).default([]),
  overlays: z.array(OverlaySchema).default([]),
  voice: z.array(VoiceSchema).default([]),
  look: LookSchema.default(DEFAULT_LOOK),
  /** Instagram açıklama metni */
  description: z.string().default(''),
  /** Bu projeye özel talimatlar (ör. "bu sefer siyah beyaz") — Faz 2'de dolacak */
  notes: z.array(z.string()).default([]),
  ui: UiStateSchema.default(UiStateSchema.parse({})),
});
export type Project = z.infer<typeof ProjectSchema>;

// ---------- Kütüphane (kaynak dosyalar) ----------

export const WordSchema = z.object({
  t0: z.number(),
  t1: z.number(),
  text: z.string(),
  p: z.number().default(1),
});
export type Word = z.infer<typeof WordSchema>;

export const TranscriptSchema = z.object({
  status: z.enum(['none', 'pending', 'running', 'done', 'silent', 'unavailable', 'error']).default('none'),
  words: z.array(WordSchema).default([]),
  language: z.string().default('tr'),
  engine: z.string().default(''),
  message: z.string().default(''),
});
export type Transcript = z.infer<typeof TranscriptSchema>;

export const AssetSchema = z.object({
  id: z.string(),
  sha256: z.string(),
  kind: z.enum(['video', 'image', 'audio']),
  /** media: normal kaynak · voiceover: uygulamada kaydedilen dış ses */
  role: z.enum(['media', 'voiceover']).default('media'),
  name: z.string(),
  ext: z.string(),
  size: z.number(),
  importedAt: z.string(),
  status: z.enum(['importing', 'ready', 'error']),
  error: z.string().default(''),
  /** Ev klasörüne göre göreli yollar */
  original: z.string(),
  preview: z.string().nullable().default(null),
  render: z.string().nullable().default(null),
  poster: z.string().nullable().default(null),
  waveform: z.string().nullable().default(null),
  /** Yönü düzeltilmiş görüntü ölçüsü */
  width: z.number().default(0),
  height: z.number().default(0),
  duration: z.number().default(0),
  fps: z.number().default(0),
  hasAudio: z.boolean().default(false),
  hdr: z.boolean().default(false),
  bitDepth: z.number().default(8),
  codec: z.string().default(''),
  rotation: z.number().default(0),
  camera: z
    .object({
      detected: z.string().nullable().default(null),
      make: z.string().default(''),
      model: z.string().default(''),
      reason: z.string().default(''),
    })
    .default({ detected: null, make: '', model: '', reason: '' }),
  transcript: TranscriptSchema.default(TranscriptSchema.parse({})),
});
export type Asset = z.infer<typeof AssetSchema>;

/** Kompozisyona giden, URL'leri çözülmüş kaynak bilgisi */
export type AssetRef = {
  id: string;
  kind: Asset['kind'];
  importedAt?: string;
  name: string;
  url: string;
  width: number;
  height: number;
  duration: number;
  hasAudio: boolean;
  words: Word[];
  transcriptStatus: Transcript['status'];
  cameraDetected: string | null;
};

export type CompProps = {
  project: Project;
  assets: Record<string, AssetRef>;
  outputId: string;
  variant: 'full' | 'nomusic';
  target: 'preview' | 'render';
  /** LUT kimliği → .cube URL */
  luts: Record<string, string>;
  /** Arayüzde önizleme için zorla kadraj (Sığdır/Doldur karşılaştırması) */
  framingOverride?: Record<string, Framing>;
};
