import { stat } from 'node:fs/promises';
import { getTools, runOk } from './proc';

export type Check = { label: string; ok: boolean; detail: string };
export type Verification = {
  width: number;
  height: number;
  duration: number;
  vcodec: string;
  acodec: string;
  pixFmt: string;
  size: number;
  checks: Check[];
  ok: boolean;
};

/** Çıktıyı ffprobe ile doğrular: çözünürlük, codec, süre */
export const verifyOutput = async (
  file: string,
  expect: { kind: 'video' | 'image'; width: number; height: number; duration?: number; audio?: boolean },
): Promise<Verification> => {
  const { ffprobe } = await getTools();
  const r = await runOk(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  const j = JSON.parse(r.stdout) as { streams: Record<string, any>[]; format: Record<string, any> };
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const { size } = await stat(file);
  const width = Number(v?.width ?? 0);
  const height = Number(v?.height ?? 0);
  const duration = Number(j.format.duration ?? v?.duration ?? 0);
  const checks: Check[] = [
    { label: 'Çözünürlük', ok: width === expect.width && height === expect.height, detail: `${width}×${height} (beklenen ${expect.width}×${expect.height})` },
  ];
  if (expect.kind === 'video') {
    checks.push({ label: 'Video codec', ok: v?.codec_name === 'h264', detail: `${v?.codec_name ?? '-'} · ${v?.profile ?? ''}` });
    checks.push({ label: 'Renk', ok: v?.pix_fmt === 'yuv420p', detail: `${v?.pix_fmt ?? '-'} · ${v?.color_space ?? 'renk alanı yok'}` });
    if (expect.audio !== false) checks.push({ label: 'Ses codec', ok: a?.codec_name === 'aac', detail: a?.codec_name ?? 'ses yok' });
    if (expect.duration !== undefined)
      checks.push({
        label: 'Süre',
        ok: Math.abs(duration - expect.duration) <= 0.1,
        detail: `${duration.toFixed(2)} sn (beklenen ${expect.duration.toFixed(2)} sn)`,
      });
  } else {
    checks.push({ label: 'Biçim', ok: v?.codec_name === 'mjpeg', detail: v?.codec_name === 'mjpeg' ? 'JPEG' : String(v?.codec_name) });
  }
  return {
    width,
    height,
    duration,
    vcodec: String(v?.codec_name ?? ''),
    acodec: String(a?.codec_name ?? ''),
    pixFmt: String(v?.pix_fmt ?? ''),
    size,
    checks,
    ok: checks.every((c) => c.ok),
  };
};
