/**
 * Kanal profilleri (Faz 6): aynı projeden YouTube, Shorts, Reels, Story ve 4:5 reklam.
 * Süre ve metin sınırları platformların yayımladığı değerlerden alınmıştır, zamanla değişebilir;
 * güvenli alanlar yaklaşık ve resmi değildir.
 */
import { FORMATS } from './formats';
import type { CaptionStyle, FormatId, Output, Project } from './schema';

export const CHANNEL_IDS = ['yt-video', 'yt-shorts', 'ig-reels', 'ig-story', 'ig-post', 'ig-reklam-45'] as const;
export type ChannelId = (typeof CHANNEL_IDS)[number];

export type MetaField = 'title' | 'description' | 'tags' | 'headline' | 'primaryText';

export type ChannelInfo = {
  id: ChannelId;
  label: string;
  platform: 'YouTube' | 'Instagram' | 'Meta reklam';
  format: FormatId;
  kind: 'video' | 'image';
  /** En uzun süre (sn); null → sınır yok */
  maxSec: number | null;
  /** Önerilen en uzun süre (aşınca yalnız uyarı) */
  recSec?: number;
  /** Altyazı görüntüye yazılsın mı (YouTube'da ayrı .srt dosyası tercih edilir) */
  burnCaptions: boolean;
  /** Pakete .srt/.vtt eklensin mi */
  captionFile: boolean;
  /** Kapak/küçük resim ölçüsü (biçim + çözünürlük) */
  cover: { format: FormatId; resolution: '720' | '1080'; label: string } | null;
  /** Doldurulacak metin alanları ve sınırları (karakter; tags için adet veya toplam karakter) */
  fields: Partial<Record<MetaField, { label: string; max: number; required?: boolean; hint?: string }>>;
  /** Hedef ses yüksekliği (LUFS, ±2 LU tolerans) */
  loudness: number;
};

export const CHANNELS: Record<ChannelId, ChannelInfo> = {
  'yt-video': {
    id: 'yt-video',
    label: 'YouTube video',
    platform: 'YouTube',
    format: 'landscape',
    kind: 'video',
    maxSec: null,
    burnCaptions: false,
    captionFile: true,
    cover: { format: 'landscape', resolution: '720', label: 'Küçük resim 1280×720' },
    fields: {
      title: { label: 'Başlık', max: 100, required: true },
      description: { label: 'Açıklama', max: 5000 },
      tags: { label: 'Etiketler', max: 500, hint: 'toplam karakter' },
    },
    loudness: -14,
  },
  'yt-shorts': {
    id: 'yt-shorts',
    label: 'YouTube Shorts',
    platform: 'YouTube',
    format: 'reel',
    kind: 'video',
    maxSec: 180,
    burnCaptions: true,
    captionFile: true,
    cover: null,
    fields: { title: { label: 'Başlık', max: 100, required: true }, description: { label: 'Açıklama', max: 5000 } },
    loudness: -14,
  },
  'ig-reels': {
    id: 'ig-reels',
    label: 'Instagram Reels',
    platform: 'Instagram',
    format: 'reel',
    kind: 'video',
    maxSec: 180,
    burnCaptions: true,
    captionFile: false,
    cover: { format: 'reel', resolution: '1080', label: 'Kapak 1080×1920' },
    fields: { description: { label: 'Açıklama', max: 2200 }, tags: { label: 'Hashtag', max: 30, hint: 'adet' } },
    loudness: -14,
  },
  'ig-story': {
    id: 'ig-story',
    label: 'Instagram Story',
    platform: 'Instagram',
    format: 'story',
    kind: 'video',
    maxSec: 60,
    burnCaptions: true,
    captionFile: false,
    cover: null,
    fields: {},
    loudness: -14,
  },
  'ig-post': {
    id: 'ig-post',
    label: 'Instagram post',
    platform: 'Instagram',
    format: 'post',
    kind: 'image',
    maxSec: null,
    burnCaptions: false,
    captionFile: false,
    cover: null,
    fields: { description: { label: 'Açıklama', max: 2200 }, tags: { label: 'Hashtag', max: 30, hint: 'adet' } },
    loudness: -14,
  },
  'ig-reklam-45': {
    id: 'ig-reklam-45',
    label: '4:5 reklam',
    platform: 'Meta reklam',
    format: 'post',
    kind: 'video',
    maxSec: 240 * 60,
    recSec: 15,
    burnCaptions: true,
    captionFile: true,
    cover: null,
    fields: {
      headline: { label: 'Reklam başlığı', max: 40, hint: 'önerilen' },
      primaryText: { label: 'Reklam metni', max: 125, hint: 'önerilen; fazlası “devamı” arkasına kalır' },
      description: { label: 'Açıklama', max: 30, hint: 'önerilen' },
    },
    loudness: -14,
  },
};

export const isChannel = (id: string | null | undefined): id is ChannelId => !!id && (CHANNEL_IDS as readonly string[]).includes(id);
export const channelOf = (o: Pick<Output, 'channel'>): ChannelInfo | null => (isChannel(o.channel) ? CHANNELS[o.channel] : null);

/** Çıktının kısa adı: kanal varsa kanal, yoksa biçim (ör. “Instagram Reels”, “Story”) */
export const outputName = (o: Pick<Output, 'channel' | 'format'>) => channelOf(o)?.label ?? FORMATS[o.format].label;
/** Oranla birlikte (ör. “YouTube video 16:9”) */
export const outputNameRatio = (o: Pick<Output, 'channel' | 'format'>) => `${outputName(o)} ${FORMATS[o.format].ratio}`;
/** Sekme/başlık etiketi (ör. “Instagram Reels · 9:16 · MP4”) */
export const outputTitle = (o: Pick<Output, 'channel' | 'format' | 'kind'>) => `${outputName(o)} · ${FORMATS[o.format].ratio} · ${o.kind === 'video' ? 'MP4' : 'JPEG'}`;

/** Bu çıktıda geçerli altyazı ayarı: projenin ayarı + çıktıya özel fark */
export const captionsFor = (project: Pick<Project, 'captions'>, output: Pick<Output, 'captions'>): { enabled: boolean; style: CaptionStyle } => {
  const o = output.captions ?? {};
  return {
    enabled: o.enabled ?? project.captions.enabled,
    style: {
      ...project.captions.style,
      ...(o.position !== undefined ? { position: o.position } : {}),
      ...(o.offset !== undefined ? { offset: o.offset } : {}),
      ...(o.size !== undefined ? { size: o.size } : {}),
    },
  };
};

/** Etiket listesini platform biçimine çevirir: Instagram “#etiket”, YouTube düz */
export const normalizeTags = (tags: string[], channel: ChannelInfo | null) => {
  const clean = tags
    .flatMap((t) => t.split(/[,\n]/))
    .map((t) => t.trim().replace(/^#+/, '').replace(/\s+/g, channel?.platform === 'YouTube' ? ' ' : ''))
    .filter(Boolean);
  const uniq = clean.filter((t, i) => clean.findIndex((x) => x.toLocaleLowerCase('tr-TR') === t.toLocaleLowerCase('tr-TR')) === i);
  return channel?.platform === 'YouTube' ? uniq : uniq.map((t) => `#${t}`);
};
