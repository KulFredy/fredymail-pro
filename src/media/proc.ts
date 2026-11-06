import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

export type RunResult = { code: number; stdout: string; stderr: string };

/** Komutu argüman dizisiyle çalıştırır (kabuk yok; boşluklu/Türkçe yollar güvenli) */
export const run = (cmd: string, args: string[], opts: { onStderr?: (s: string) => void; env?: NodeJS.ProcessEnv } = {}) =>
  new Promise<RunResult>((resolve, reject) => {
    const p = spawn(cmd, args, { env: opts.env ?? process.env });
    let stdout = '';
    let stderr = '';
    p.stdout.on('data', (d) => (stdout += d));
    p.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (stderr.length > 200_000) stderr = stderr.slice(-100_000);
      opts.onStderr?.(s);
    });
    p.on('error', reject);
    p.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });

export const runOk = async (cmd: string, args: string[], opts?: Parameters<typeof run>[2]) => {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${path.basename(cmd)} başarısız (${r.code}): ${r.stderr.slice(-800)}`);
  return r;
};

export const which = async (name: string): Promise<string | null> => {
  if (name.includes('/')) {
    try {
      await access(name, constants.X_OK);
      return name;
    } catch {
      return null;
    }
  }
  const dirs = (process.env.PATH ?? '').split(path.delimiter).concat(['/opt/homebrew/bin', '/usr/local/bin']);
  for (const d of dirs) {
    const p = path.join(d, name);
    try {
      await access(p, constants.X_OK);
      return p;
    } catch {
      /* devam */
    }
  }
  return null;
};

export type Tools = {
  ffmpeg: string;
  ffprobe: string;
  h264Encoder: 'h264_videotoolbox' | 'libx264';
  zscale: boolean;
  sips: string | null;
  heifConvert: string | null;
};

let tools: Tools | null = null;

export const getTools = async (): Promise<Tools> => {
  if (tools) return tools;
  const ffmpeg = (await which(process.env.FABRIKA_FFMPEG ?? 'ffmpeg')) ?? 'ffmpeg';
  const ffprobe = (await which(process.env.FABRIKA_FFPROBE ?? 'ffprobe')) ?? 'ffprobe';
  const enc = await run(ffmpeg, ['-hide_banner', '-encoders']).catch(() => ({ stdout: '' }) as RunResult);
  const filt = await run(ffmpeg, ['-hide_banner', '-filters']).catch(() => ({ stdout: '' }) as RunResult);
  tools = {
    ffmpeg,
    ffprobe,
    h264Encoder: process.platform === 'darwin' && enc.stdout.includes('h264_videotoolbox') ? 'h264_videotoolbox' : 'libx264',
    zscale: /\bzscale\b/.test(filt.stdout),
    sips: process.platform === 'darwin' ? await which('sips') : null,
    heifConvert: await which('heif-convert'),
  };
  return tools;
};
