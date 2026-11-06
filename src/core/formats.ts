import type { FormatId } from './schema';

export type SafeZone = { top: number; bottom: number; left: number; right: number };

export type FormatInfo = {
  id: FormatId;
  label: string;
  ratio: string;
  width: number;
  height: number;
  /** Instagram arayüz öğelerinin kapladığı yaklaşık alan (px). Resmi değildir. */
  safe: SafeZone;
  /** Profil ızgarasında görünen orta alan (post için 3:4) */
  gridGuide?: { width: number; height: number };
  defaultKind: 'video' | 'image';
};

export const FORMATS: Record<FormatId, FormatInfo> = {
  story: {
    id: 'story',
    label: 'Story',
    ratio: '9:16',
    width: 1080,
    height: 1920,
    safe: { top: 250, bottom: 340, left: 60, right: 60 },
    defaultKind: 'video',
  },
  reel: {
    id: 'reel',
    label: 'Reel',
    ratio: '9:16',
    width: 1080,
    height: 1920,
    safe: { top: 220, bottom: 420, left: 60, right: 160 },
    defaultKind: 'video',
  },
  post: {
    id: 'post',
    label: 'Akış postu',
    ratio: '4:5',
    width: 1080,
    height: 1350,
    safe: { top: 60, bottom: 90, left: 60, right: 60 },
    gridGuide: { width: 1012, height: 1350 },
    defaultKind: 'image',
  },
  landscape: {
    id: 'landscape',
    label: 'Yatay video',
    ratio: '16:9',
    width: 1920,
    height: 1080,
    safe: { top: 60, bottom: 90, left: 96, right: 96 },
    defaultKind: 'video',
  },
};

export const outputLabel = (format: FormatId, kind: 'video' | 'image') =>
  `${FORMATS[format].label} · ${FORMATS[format].ratio} · ${kind === 'video' ? 'MP4' : 'JPEG'}`;
