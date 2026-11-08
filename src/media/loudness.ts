import { getTools, run } from './proc';

/**
 * Ses yüksekliği ölçümü (EBU R128 / ITU-R BS.1770): bütünleşik yükseklik (LUFS) ve gerçek tepe (dBTP).
 * Ses izi yoksa lufs = -Infinity.
 */
export const measureLoudness = async (file: string): Promise<{ lufs: number; truePeak: number }> => {
  const { ffmpeg } = await getTools();
  const r = await run(ffmpeg, ['-hide_banner', '-nostats', '-i', file, '-map', '0:a:0?', '-af', 'loudnorm=print_format=json', '-f', 'null', '-']);
  const m = r.stderr.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!m) return { lufs: -Infinity, truePeak: -Infinity };
  const j = JSON.parse(m[0]) as { input_i: string; input_tp: string };
  const num = (s: string) => (/inf/i.test(s) ? -Infinity : Number(s));
  return { lufs: num(j.input_i), truePeak: num(j.input_tp) };
};
