import { spawn } from 'node:child_process';
import { analyzeBeats, type BeatInfo } from '../core/beats';
import { getTools } from './proc';

/** Ses dosyasından vuruşlar (en çok ilk 6 dakika; mono 22,05 kHz) */
export const detectBeats = async (file: string): Promise<BeatInfo> => {
  const { ffmpeg } = await getTools();
  const rate = 22050;
  const pcm = await new Promise<Buffer>((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-v', 'error', '-i', file, '-t', '360', '-vn', '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-']);
    const chunks: Buffer[] = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('Ses çözülemedi'))));
  });
  const f32 = new Float32Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.length / 4));
  return analyzeBeats(f32, rate);
};
