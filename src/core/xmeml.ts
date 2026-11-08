/**
 * Premiere Pro / DaVinci Resolve'a aktarma: Final Cut Pro 7 XML (xmeml v4).
 * Kurgu iskeleti taşınır: V1 klipler (giriş/çıkış), V2 üst iz, klip sesleri, dış ses, müzik.
 * Renk/LUT, yazı, altyazı ve logo taşınmaz (altyazı ayrı .srt olarak verilir).
 * Dosyalar orijinal yollarından bağlanır; HEIC gibi okunamayan görsellerde dönüştürülmüş kopya kullanılır.
 */
import { FPS, type Project } from './schema';
import { layoutClips, toFrames, totalDuration } from './timeline';
import { FORMATS } from './formats';

export type XmlAsset = {
  id: string;
  name: string;
  /** Mutlak dosya yolu (bu Mac'te) */
  path: string;
  kind: 'video' | 'image' | 'audio';
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!);
/** file://localhost/… (boşluk ve Türkçe karakterler yüzde kodlu) */
export const pathUrl = (p: string) => `file://localhost${p.split('/').map(encodeURIComponent).join('/')}`;
const rate = `<rate><timebase>${FPS}</timebase><ntsc>FALSE</ntsc></rate>`;
/** Görsel klipler kaynakta “uzun” kabul edilir (fotoğraf) */
const STILL_FRAMES = FPS * 60 * 60;

export const buildXmeml = (project: Project, assets: Record<string, XmlAsset>, outputId?: string): string => {
  const output = project.outputs.find((o) => o.id === outputId) ?? project.outputs[0];
  const fmt = FORMATS[output?.format ?? 'landscape'];
  const seqFrames = Math.max(1, toFrames(totalDuration(project)));
  const files = new Map<string, number>();
  let clipSeq = 0;
  const fileRef = (a: XmlAsset) => {
    const known = files.get(a.id);
    if (known) return `<file id="file-${known}"/>`;
    const n = files.size + 1;
    files.set(a.id, n);
    const dur = a.kind === 'image' ? STILL_FRAMES : Math.max(1, toFrames(a.duration));
    const video = a.kind !== 'audio' ? `<video><samplecharacteristics>${rate}<width>${a.width || fmt.width}</width><height>${a.height || fmt.height}</height></samplecharacteristics></video>` : '';
    const audio = a.kind === 'audio' || a.hasAudio ? `<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>` : '';
    return `<file id="file-${n}"><name>${esc(a.name)}</name><pathurl>${esc(pathUrl(a.path))}</pathurl>${rate}<duration>${dur}</duration><media>${video}${audio}</media></file>`;
  };
  const clipItem = (a: XmlAsset, start: number, end: number, srcIn: number, label: string, extra = '') => {
    const id = ++clipSeq;
    const dur = a.kind === 'image' ? STILL_FRAMES : Math.max(1, toFrames(a.duration));
    return `<clipitem id="clipitem-${id}"><name>${esc(label)}</name><enabled>TRUE</enabled><duration>${dur}</duration>${rate}<start>${start}</start><end>${end}</end><in>${srcIn}</in><out>${srcIn + (end - start)}</out>${fileRef(a)}${extra}</clipitem>`;
  };

  const layout = layoutClips(project);
  const v1: string[] = [];
  const a1: string[] = [];
  for (const it of layout) {
    const a = assets[it.clip.assetId];
    if (!a) continue;
    const start = toFrames(it.start);
    const end = Math.max(start + 1, toFrames(it.end));
    const srcIn = a.kind === 'image' ? 0 : toFrames(it.clip.in);
    v1.push(clipItem(a, start, end, srcIn, a.name));
    if (a.kind === 'video' && a.hasAudio && !it.clip.muted) a1.push(clipItem(a, start, end, srcIn, a.name, '<sourcetrack><mediatype>audio</mediatype><trackindex>1</trackindex></sourcetrack>'));
  }
  const v2 = project.overlays.flatMap((o) => {
    const a = assets[o.assetId];
    if (!a) return [];
    const start = toFrames(o.at);
    return [clipItem(a, start, Math.max(start + 1, start + toFrames(o.out - o.in)), a.kind === 'image' ? 0 : toFrames(o.in), a.name)];
  });
  const vo = project.voice.flatMap((v) => {
    const a = assets[v.assetId];
    if (!a) return [];
    const start = toFrames(v.at);
    return [clipItem(a, start, Math.max(start + 1, start + toFrames(v.out - v.in)), toFrames(v.in), a.name)];
  });
  const music = (() => {
    const m = project.music;
    const a = m ? assets[m.assetId] : undefined;
    if (!m || !a) return [];
    const len = Math.min(seqFrames, Math.max(1, toFrames(a.duration - m.start)));
    return [clipItem(a, 0, len, toFrames(m.start), a.name)];
  })();

  const track = (items: string[]) => `<track>${items.join('')}</track>`;
  const videoTracks = [track(v1), ...(v2.length ? [track(v2)] : [])].join('');
  const audioTracks = [a1, vo, music].filter((t) => t.length).map(track).join('');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE xmeml>',
    '<xmeml version="4">',
    `<sequence id="sequence-1"><name>${esc(project.name)}</name><duration>${seqFrames}</duration>${rate}`,
    `<timecode>${rate}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>`,
    `<media><video><format><samplecharacteristics>${rate}<width>${fmt.width}</width><height>${fmt.height}</height><pixelaspectratio>square</pixelaspectratio></samplecharacteristics></format>${videoTracks}</video>`,
    `<audio>${audioTracks}</audio></media></sequence></xmeml>`,
  ].join('\n');
};
