import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { detectCamera, type CameraInfo } from './camera';
import { getTools, runOk } from './proc';
import { probe, type ProbeInfo } from './probe';

export const hashFile = (file: string) =>
  new Promise<string>((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });

export type IngestResult = {
  probe: ProbeInfo;
  camera: CameraInfo;
  preview: string | null;
  render: string | null;
  poster: string | null;
  waveform: string | null;
  width: number;
  height: number;
  /** Saydam görsel (PNG/SVG): kopyalar PNG tutulur */
  alpha?: boolean;
};

type Progress = (fraction: number, message: string) => void;

const BROWSER_AUDIO = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac', '.webm']);

/** Orijinali salt-okunur arşive kopyalar */
export const archiveOriginal = async (src: string, dest: string) => {
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    await stat(dest);
    return; // aynı içerik zaten arşivde
  } catch {
    /* yok */
  }
  await copyFile(src, dest);
  await chmod(dest, 0o444);
};

const timeRe = /time=(\d+):(\d+):(\d+\.\d+)/;

const ffmpegWithProgress = async (args: string[], duration: number, onProgress?: (f: number) => void) => {
  const { ffmpeg } = await getTools();
  await runOk(ffmpeg, ['-hide_banner', '-y', ...args], {
    onStderr: (s) => {
      const m = timeRe.exec(s);
      if (m && duration > 0 && onProgress) onProgress(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / duration));
    },
  });
};

/** Video önizleme kopyası: yön düzeltilmiş, HDR → SDR, kısa kenar en çok 1080, sık anahtar kare */
export const makeVideoProxy = async (orig: string, out: string, info: ProbeInfo, onProgress?: (f: number) => void) => {
  const t = await getTools();
  const filters: string[] = [];
  if (info.hdr && t.zscale) {
    filters.push('zscale=t=linear:npl=203', 'format=gbrpf32le', 'zscale=p=bt709', 'tonemap=tonemap=hable:desat=0', 'zscale=t=bt709:m=bt709:r=tv');
  }
  filters.push("scale=w='if(gte(iw,ih),-2,min(1080,iw))':h='if(gte(iw,ih),min(1080,ih),-2)'", 'format=yuv420p');
  const venc =
    t.h264Encoder === 'h264_videotoolbox'
      ? ['-c:v', 'h264_videotoolbox', '-b:v', '8M', '-allow_sw', '1']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23'];
  const args = [
    '-i', orig,
    '-map', '0:v:0', '-map', '0:a:0?',
    '-vf', filters.join(','),
    ...(info.fps > 31 ? ['-r', '30'] : []),
    ...venc,
    '-g', '15', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
    '-movflags', '+faststart',
    out,
  ];
  await ffmpegWithProgress(args, info.duration, onProgress);
};

export const makePoster = async (video: string, out: string, at: number) => {
  const { ffmpeg } = await getTools();
  await runOk(ffmpeg, ['-hide_banner', '-y', '-ss', String(at), '-i', video, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '4', out]);
};

/** Ses dalga formu: saniyede 40 tepe değeri (0..1) */
export const makeWaveform = async (file: string, out: string) => {
  const { ffmpeg } = await getTools();
  const rate = 4000;
  const perPeak = rate / 40;
  const pcm = await new Promise<Buffer>((resolve, reject) => {
    const p = spawn(ffmpeg, ['-hide_banner', '-v', 'error', '-i', file, '-vn', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-']);
    const chunks: Buffer[] = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error('Dalga formu çıkarılamadı'))));
  });
  const samples = Math.floor(pcm.length / 2);
  const peaks: number[] = [];
  for (let i = 0; i < samples; i += perPeak) {
    let m = 0;
    for (let j = i; j < Math.min(samples, i + perPeak); j++) m = Math.max(m, Math.abs(pcm.readInt16LE(j * 2)));
    peaks.push(Math.round((m / 32768) * 1000) / 1000);
  }
  await writeFile(out, JSON.stringify({ rate: 40, peaks }));
};

const convertHeic = async (src: string, out: string) => {
  const t = await getTools();
  if (t.sips) return void (await runOk(t.sips, ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', src, '--out', out]));
  if (t.heifConvert) return void (await runOk(t.heifConvert, ['-q', '95', src, out]));
  await runOk(t.ffmpeg, ['-hide_banner', '-y', '-i', src, '-frames:v', '1', '-q:v', '2', out]);
};

/**
 * Bir kaynağı işler: önizleme, render kopyası, kapak, dalga formu.
 * Yollar mutlak verilir; dönen yollar da mutlaktır (çağıran göreli yapar).
 */
export const processMedia = async (orig: string, ext: string, cacheDir: string, onProgress: Progress = () => {}): Promise<IngestResult> => {
  await mkdir(cacheDir, { recursive: true });
  onProgress(0.02, 'Dosya inceleniyor');
  const info = await probe(orig, ext);
  const camera = await detectCamera(orig, info);
  const res: IngestResult = { probe: info, camera, preview: null, render: null, poster: null, waveform: null, width: info.width, height: info.height };

  if (info.kind === 'image') {
    let src = orig;
    if (ext === '.heic' || ext === '.heif') {
      onProgress(0.1, 'HEIC dönüştürülüyor');
      src = path.join(os.tmpdir(), `fabrika-${path.basename(cacheDir)}.jpg`);
      await convertHeic(orig, src);
    }
    onProgress(0.3, 'Fotoğraf hazırlanıyor');
    // Saydam görsel (logo): saydamlık korunur, kopyalar PNG
    const isSvg = ext === '.svg';
    const open = () => sharp(src, isSvg ? { density: 300 } : {});
    const m0 = await open().metadata();
    const alpha = isSvg || (!!m0.hasAlpha && !(await open().stats()).isOpaque);
    if (alpha) {
      const render = path.join(cacheDir, 'render.png');
      await open().rotate().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: !isSvg }).png().toFile(render);
      const meta = await sharp(render).metadata();
      const preview = path.join(cacheDir, 'preview.png');
      await sharp(render).resize({ width: 1200, height: 1200, fit: 'inside', withoutEnlargement: true }).png().toFile(preview);
      const poster = path.join(cacheDir, 'poster.jpg');
      await sharp(render).resize({ width: 480, height: 480, fit: 'inside' }).flatten({ background: '#3a3f4b' }).jpeg({ quality: 80 }).toFile(poster);
      Object.assign(res, { render, preview, poster, alpha: true, width: meta.width ?? info.width, height: meta.height ?? info.height });
      onProgress(1, 'Hazır');
      return res;
    }
    const render = path.join(cacheDir, 'render.jpg');
    // EXIF yönü uygulanır (telefon fotoğrafı doğru görünür), en çok 4096 px
    await sharp(src).rotate().flatten({ background: '#000' }).resize({ width: 4096, height: 4096, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 93 }).toFile(render);
    const meta = await sharp(render).metadata();
    const preview = path.join(cacheDir, 'preview.jpg');
    await sharp(render).resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(preview);
    const poster = path.join(cacheDir, 'poster.jpg');
    await sharp(render).resize({ width: 480, height: 480, fit: 'inside' }).jpeg({ quality: 80 }).toFile(poster);
    if (src !== orig) await rm(src, { force: true });
    Object.assign(res, { render, preview, poster, width: meta.width ?? info.width, height: meta.height ?? info.height });
    onProgress(1, 'Hazır');
    return res;
  }

  if (info.kind === 'audio') {
    let preview = orig;
    if (!BROWSER_AUDIO.has(ext)) {
      onProgress(0.2, 'Ses dönüştürülüyor');
      preview = path.join(cacheDir, 'preview.m4a');
      await ffmpegWithProgress(['-i', orig, '-vn', '-c:a', 'aac', '-b:a', '256k', preview], info.duration);
    }
    onProgress(0.7, 'Dalga formu');
    const waveform = path.join(cacheDir, 'waveform.json');
    await makeWaveform(orig, waveform);
    Object.assign(res, { preview, render: preview, waveform });
    onProgress(1, 'Hazır');
    return res;
  }

  // Video
  const preview = path.join(cacheDir, 'preview.mp4');
  onProgress(0.05, info.hdr ? 'HDR → SDR önizleme kopyası' : 'Önizleme kopyası');
  await makeVideoProxy(orig, preview, info, (f) => onProgress(0.05 + f * 0.8, 'Önizleme kopyası'));
  const poster = path.join(cacheDir, 'poster.jpg');
  await makePoster(preview, poster, Math.min(1, info.duration / 3));
  let waveform: string | null = null;
  if (info.hasAudio) {
    onProgress(0.9, 'Dalga formu');
    waveform = path.join(cacheDir, 'waveform.json');
    await makeWaveform(preview, waveform);
  }
  // Son render orijinalden yapılır (4K kalite korunur); Remotion yön ve HDR ton eşlemesini uygular
  Object.assign(res, { preview, render: orig, poster, waveform });
  onProgress(1, 'Hazır');
  return res;
};
