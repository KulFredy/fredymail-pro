import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { renderMedia, renderStill, selectComposition, type ChromiumOptions } from '@remotion/renderer';
import type { CompProps } from '../core/schema';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

let bundlePromise: Promise<string> | null = null;

/** Remotion kompozisyonunu bir kez paketler (ilk render ~20 sn) */
export const ensureBundle = (onProgress?: (p: number) => void) => {
  if (!bundlePromise) {
    bundlePromise = bundle({
      entryPoint: path.join(ROOT, 'src', 'remotion', 'index.ts'),
      onProgress: (p) => onProgress?.(p / 100),
      enableCaching: true,
    }).catch((e) => {
      bundlePromise = null;
      throw e;
    });
  }
  return bundlePromise;
};

const chromiumOptions = (): ChromiumOptions => ({
  gl: (process.env.FABRIKA_GL as ChromiumOptions['gl']) ?? (process.platform === 'darwin' ? 'angle' : 'swangle'),
});

const browserExecutable = () => process.env.FABRIKA_BROWSER ?? null;

export type RenderRequest = {
  props: CompProps;
  outFile: string;
  kind: 'video' | 'image';
  onProgress: (p: number, message: string) => void;
};

export const renderOutput = async ({ props, outFile, kind, onProgress }: RenderRequest) => {
  onProgress(0.01, 'Kompozisyon hazırlanıyor');
  const serveUrl = await ensureBundle((p) => onProgress(p * 0.1, 'Kompozisyon paketleniyor'));
  const inputProps = props as unknown as Record<string, unknown>;
  const composition = await selectComposition({
    serveUrl,
    id: 'Fabrika',
    inputProps,
    chromiumOptions: chromiumOptions(),
    browserExecutable: browserExecutable(),
    logLevel: 'error',
  });
  if (kind === 'image') {
    onProgress(0.4, 'Görsel oluşturuluyor');
    await renderStill({
      composition,
      serveUrl,
      output: outFile,
      inputProps,
      frame: 0,
      imageFormat: 'jpeg',
      jpegQuality: 93,
      chromiumOptions: chromiumOptions(),
      browserExecutable: browserExecutable(),
      timeoutInMilliseconds: 120_000,
      logLevel: 'error',
    });
    onProgress(1, 'Görsel hazır');
    return { durationInFrames: 1, fps: composition.fps, width: composition.width, height: composition.height };
  }
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    audioCodec: 'aac',
    audioBitrate: '192k',
    crf: 18,
    x264Preset: 'medium',
    pixelFormat: 'yuv420p',
    // BT.709 + TV aralığı: Instagram ve telefonlarda doğru renk
    colorSpace: 'bt709',
    enforceAudioTrack: true,
    imageFormat: 'jpeg',
    jpegQuality: 92,
    outputLocation: outFile,
    inputProps,
    chromiumOptions: chromiumOptions(),
    browserExecutable: browserExecutable(),
    concurrency: Math.max(1, Math.min(6, Math.floor(os.cpus().length / 2))),
    timeoutInMilliseconds: 120_000,
    logLevel: 'error',
    onProgress: ({ progress, stitchStage }) =>
      onProgress(0.1 + progress * 0.88, stitchStage === 'muxing' ? 'Ses ve görüntü birleştiriliyor' : 'Kareler işleniyor'),
  });
  onProgress(1, 'Video hazır');
  return { durationInFrames: composition.durationInFrames, fps: composition.fps, width: composition.width, height: composition.height };
};
