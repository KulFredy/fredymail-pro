import { getTools, runOk } from './proc';

export type ProbeInfo = {
  kind: 'video' | 'image' | 'audio';
  width: number;
  height: number;
  duration: number;
  fps: number;
  hasAudio: boolean;
  hdr: boolean;
  bitDepth: number;
  codec: string;
  rotation: number;
  colorTransfer: string;
  tags: Record<string, string>;
  pixFmt: string;
  audioCodec: string;
  formatName: string;
};

const IMAGE_EXT = new Set(['.svg', '.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.avif', '.tif', '.tiff', '.bmp', '.gif']);
const IMAGE_CODECS = new Set(['mjpeg', 'png', 'webp', 'hevc_image', 'bmp', 'tiff', 'gif', 'av1_image']);

const parseRate = (r?: string) => {
  if (!r) return 0;
  const [a, b] = r.split('/').map(Number);
  return b ? a / b : a || 0;
};

export const probe = async (file: string, ext: string): Promise<ProbeInfo> => {
  if (ext === '.svg') {
    // ffprobe SVG okuyamayabilir: ölçüyü sharp'tan al (vektör, 300 dpi'de)
    const sharp = (await import('sharp')).default;
    const m = await sharp(file, { density: 300 }).metadata();
    return {
      kind: 'image', width: m.width ?? 0, height: m.height ?? 0, duration: 0, fps: 0, hasAudio: false, hdr: false, bitDepth: 8,
      codec: 'svg', rotation: 0, colorTransfer: '', tags: {}, pixFmt: 'rgba', audioCodec: '', formatName: 'svg',
    } as ProbeInfo;
  }
  const { ffprobe } = await getTools();
  const r = await runOk(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(r.stdout) as {
    streams?: Record<string, any>[];
    format?: Record<string, any>;
  };
  const streams = j.streams ?? [];
  const v = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  const a = streams.find((s) => s.codec_type === 'audio');
  const fmt = j.format ?? {};
  const isImage = IMAGE_EXT.has(ext) || (v && IMAGE_CODECS.has(v.codec_name) && !(Number(fmt.duration) > 0.5));
  let rotation = 0;
  if (v) {
    const dm = (v.side_data_list ?? []).find((s: any) => s.rotation !== undefined);
    if (dm) rotation = Number(dm.rotation) || 0;
    else if (v.tags?.rotate) rotation = -Number(v.tags.rotate) || 0;
  }
  const quarter = Math.abs(Math.round(rotation / 90)) % 2 === 1;
  const w = Number(v?.width ?? 0);
  const h = Number(v?.height ?? 0);
  const transfer = String(v?.color_transfer ?? '');
  const pixFmt = String(v?.pix_fmt ?? '');
  const bits = Number(v?.bits_per_raw_sample) || (/(p10|p12|10le|12le)/.test(pixFmt) ? 10 : 8);
  const tags: Record<string, string> = { ...(fmt.tags ?? {}), ...(v?.tags ?? {}) };
  return {
    kind: isImage ? 'image' : v ? 'video' : 'audio',
    width: quarter ? h : w,
    height: quarter ? w : h,
    duration: Number(fmt.duration ?? v?.duration ?? a?.duration ?? 0) || 0,
    fps: parseRate(v?.avg_frame_rate) || parseRate(v?.r_frame_rate),
    hasAudio: !!a,
    hdr: transfer === 'smpte2084' || transfer === 'arib-std-b67',
    bitDepth: bits,
    codec: String(v?.codec_name ?? a?.codec_name ?? ''),
    rotation,
    colorTransfer: transfer,
    tags,
    pixFmt,
    audioCodec: String(a?.codec_name ?? ''),
    formatName: String(fmt.format_name ?? ''),
  };
};
