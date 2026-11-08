import { outputNameRatio } from './channels';
/**
 * Başlık/yazı ve logo yerleşimi (Faz 4.3).
 * Konum ya 9 noktalı ızgarayla (her çıktının Instagram güvenli alanı içinde) ya da serbest x/y ile verilir.
 * Önizleme, render ve güvenli alan uyarıları aynı hesapları kullanır.
 */
import { FORMATS } from './formats';
import type { Anchor, AssetRef, Logo, Output, Placement, Project, TextOverlay } from './schema';
import { totalDuration } from './timeline';

export const ANCHOR_LABELS: Record<Anchor, string> = {
  tl: 'sol üst', tc: 'üst orta', tr: 'sağ üst',
  ml: 'sol orta', mc: 'orta', mr: 'sağ orta',
  bl: 'sol alt', bc: 'alt orta', br: 'sağ alt',
};
/** Güvenli alan kenarından iç boşluk (px, 1080 tabanlı) */
export const SAFE_MARGIN = 24;
export const ANIM_SEC = 0.4;

export type Rect = { left: number; top: number; right: number; bottom: number };
export type Box = { cx: number; cy: number; w: number; h: number };

export const frameSize = (output: Output) => ({ W: FORMATS[output.format].width, H: FORMATS[output.format].height });

/** Çıktının güvenli dikdörtgeni (px) */
export const safeRect = (output: Output): Rect => {
  const f = FORMATS[output.format];
  return { left: f.safe.left, top: f.safe.top, right: f.width - f.safe.right, bottom: f.height - f.safe.bottom };
};

/** Yazının yaklaşık ölçüsü (px): satır kırılımı genişliği karenin %86'sı */
export const textSize = (t: Pick<TextOverlay, 'text' | 'size' | 'style'>, W: number, scale = 1) => {
  const size = t.size * scale;
  const maxW = W * 0.86;
  const lines = t.text.split('\n');
  let rows = 0;
  let widest = 0;
  for (const line of lines) {
    const w = Math.max(size * 0.5, line.length * size * 0.56);
    rows += Math.max(1, Math.ceil(w / maxW));
    widest = Math.max(widest, Math.min(maxW, w));
  }
  const pad = t.style === 'box' ? size * 0.6 : 0;
  return { w: widest + pad, h: rows * size * 1.1 + (t.style === 'box' ? size * 0.24 : 0) };
};

/** Logonun ölçüsü (px): genişlik kısa kenarın `size` oranı, yükseklik görselin oranından */
export const logoSize = (l: Pick<Logo, 'size'>, asset: Pick<AssetRef, 'width' | 'height'> | undefined, W: number, H: number, scale = 1) => {
  const w = l.size * Math.min(W, H) * scale;
  const ratio = asset && asset.width ? asset.height / asset.width : 1;
  return { w, h: w * ratio };
};

/** Izgara noktasının merkez konumu (px), güvenli alan içinde */
export const anchorCenter = (anchor: Anchor, r: Rect, w: number, h: number, m = SAFE_MARGIN) => {
  const col = anchor[1];
  const row = anchor[0];
  const cx = col === 'l' ? r.left + m + w / 2 : col === 'r' ? r.right - m - w / 2 : (r.left + r.right) / 2;
  const cy = row === 't' ? r.top + m + h / 2 : row === 'b' ? r.bottom - m - h / 2 : (r.top + r.bottom) / 2;
  return { cx, cy };
};

type Placeable = { anchor: Anchor | null; x: number; y: number; placements: Record<string, Placement> };

/** Bu çıktıda geçerli yerleşim (çıktıya özel ayar varsa o) */
export const placementFor = (el: Placeable, output: Output): Placement => el.placements[output.id] ?? { anchor: el.anchor, x: el.x, y: el.y, scale: 1 };

const boxFor = (pl: Placement, w: number, h: number, output: Output): Box => {
  const { W, H } = frameSize(output);
  const { cx, cy } = pl.anchor ? anchorCenter(pl.anchor, safeRect(output), w, h) : { cx: pl.x * W, cy: pl.y * H };
  return { cx, cy, w, h };
};

export const textBox = (t: TextOverlay, output: Output): Box => {
  const pl = placementFor(t, output);
  const { W } = frameSize(output);
  const { w, h } = textSize(t, W, pl.scale);
  return boxFor(pl, w, h, output);
};

export const logoBox = (l: Logo, asset: Pick<AssetRef, 'width' | 'height'> | undefined, output: Output): Box => {
  const pl = placementFor(l, output);
  const { W, H } = frameSize(output);
  const { w, h } = logoSize(l, asset, W, H, pl.scale);
  return boxFor(pl, w, h, output);
};

/** Logonun görünür olduğu aralık (sn) */
export const logoSpan = (l: Logo, project: Project) => (l.full ? { start: 0, end: Math.max(0.1, totalDuration(project)) } : { start: l.start, end: l.end });

/** Animasyon: 0 → 1 giriş, 1 → 0 çıkış (kare bazında); opaklık, kayma ve ölçek */
export const animAt = (anim: Logo['anim'], frame: number, len: number, fps: number) => {
  if (anim === 'yok') return { opacity: 1, dy: 0, scale: 1 };
  const n = Math.max(1, Math.min(Math.round(ANIM_SEC * fps), Math.floor(len / 2)));
  const k = Math.max(0, Math.min(1, frame / n, (len - frame) / n));
  const e = 1 - (1 - k) ** 2; // yumuşak çıkış
  return { opacity: e, dy: anim === 'yukari' ? (1 - e) * 20 : 0, scale: anim === 'buyume' ? 0.85 + 0.15 * e : 1 };
};

export type SafeIssue = { outputId: string; outputLabel: string; kind: 'text' | 'logo'; id: string; name: string; text: string };

const overflow = (b: Box, r: Rect) => {
  const sides: string[] = [];
  if (b.cy - b.h / 2 < r.top - 1) sides.push('üst');
  if (b.cy + b.h / 2 > r.bottom + 1) sides.push('alt');
  if (b.cx - b.w / 2 < r.left - 1) sides.push('sol');
  if (b.cx + b.w / 2 > r.right + 1) sides.push('sağ');
  return sides;
};
/** Dikey (Story/Reel) oranlarda üstte/altta Instagram arayüzü var; diğerlerinde yalnız kenar payı */
const zoneText = (side: string, vertical: boolean) =>
  vertical && side === 'üst' ? 'Instagram üst bilgisinin altında kalıyor' : vertical && side === 'alt' ? 'yanıt alanının altında kalıyor' : `${side} kenara çok yakın`;

/** Hangi yazı/logo hangi çıktıda güvenli alanın dışına taşıyor? */
export const safeAreaIssues = (project: Project, assets: Record<string, AssetRef>, onlyOutputId?: string): SafeIssue[] => {
  const out: SafeIssue[] = [];
  for (const o of project.outputs) {
    if (onlyOutputId && o.id !== onlyOutputId) continue;
    const r = safeRect(o);
    const label = outputNameRatio(o);
    const push = (kind: 'text' | 'logo', id: string, name: string, b: Box) => {
      const s = overflow(b, r);
      const vertical = o.format === 'story' || o.format === 'reel';
      if (s.length) out.push({ outputId: o.id, outputLabel: label, kind, id, name, text: `${label}: “${name}” ${s.map((x) => zoneText(x, vertical)).join(', ')}` });
    };
    for (const t of project.texts) push('text', t.id, t.text.slice(0, 24) || 'yazı', textBox(t, o));
    if (o.kind === 'video' || o.kind === 'image')
      for (const l of project.logos) push('logo', l.id, assets[l.assetId]?.name ?? 'logo', logoBox(l, assets[l.assetId], o));
  }
  return out;
};

/** Taşan öğe için o çıktıda en yakın ızgara noktası (güvenli alan içinde) */
export const nearestAnchor = (b: Box, output: Output): Anchor => {
  const { W, H } = frameSize(output);
  const col = b.cx < W / 3 ? 'l' : b.cx > (2 * W) / 3 ? 'r' : 'c';
  const row = b.cy < H / 3 ? 't' : b.cy > (2 * H) / 3 ? 'b' : 'm';
  return `${row}${col}` as Anchor;
};

/** Güvenli alana al: bu çıktıya özel yerleşim (gerekirse küçültülerek) */
export const fixPlacement = (el: Placeable, b: Box, output: Output): Placement => {
  const r = safeRect(output);
  const fitScale = Math.min(1, (r.right - r.left - 2 * SAFE_MARGIN) / b.w, (r.bottom - r.top - 2 * SAFE_MARGIN) / b.h);
  const cur = placementFor(el, output);
  return { anchor: nearestAnchor(b, output), x: cur.x, y: cur.y, scale: Math.max(0.2, cur.scale * fitScale) };
};
