import type { Asset, AssetRef } from './schema';

export type LutInfo = { id: string; title: string; group: 'kamera' | 'kullanici'; path: string };

/** Göreli dosya yolunu URL'ye çevirir (Türkçe/boşluklu adlar güvenli) */
export const fileUrl = (base: string, rel: string | null) =>
  rel ? `${base}/files/${rel.split('/').map(encodeURIComponent).join('/')}` : '';

export const assetRef = (a: Asset, base: string, target: 'preview' | 'render'): AssetRef => ({
  id: a.id,
  kind: a.kind,
  name: a.name,
  url: a.status === 'ready' ? fileUrl(base, target === 'render' ? a.render : a.preview) : '',
  width: a.width,
  height: a.height,
  duration: a.duration,
  hasAudio: a.hasAudio,
  words: a.transcript.status === 'done' ? a.transcript.words : [],
  transcriptStatus: a.transcript.status,
  cameraDetected: a.camera.detected,
});

export const buildRefs = (assets: Iterable<Asset>, base: string, target: 'preview' | 'render') => {
  const out: Record<string, AssetRef> = {};
  for (const a of assets) out[a.id] = assetRef(a, base, target);
  return out;
};

export const lutUrls = (luts: LutInfo[], base: string) => {
  const out: Record<string, string> = {};
  for (const l of luts) out[l.id] = `${base}${l.path.split('/').map((s, i) => (i === 0 ? s : encodeURIComponent(s))).join('/')}`;
  return out;
};
