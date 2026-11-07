import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, renderStill, selectComposition, type ChromiumOptions } from '@remotion/renderer';
import type { CompProps } from '../core/schema';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

type Listener = (p: number, message: string) => void;

const log = (msg: string) => console.log(`[render] ${msg}`);

/** Hazırlık adımları (paketleme, tarayıcı) birden çok iş tarafından beklenebilir: ilerleme hepsine yayınlanır */
const prep = {
  listeners: new Set<Listener>(),
  last: { p: 0, message: 'Hazırlanıyor' },
  emit(p: number, message: string) {
    this.last = { p, message };
    this.listeners.forEach((l) => l(p, message));
  },
};

let bundlePromise: Promise<string> | null = null;
let browserPromise: Promise<unknown> | null = null;
let browserReject: ((e: Error) => void) | null = null;
let downloading = false;

const browserExecutable = () => process.env.FABRIKA_BROWSER ?? null;

/**
 * Remotion'ın tarayıcı indirmesi ağ hatasında yakalanamayan bir hata fırlatabiliyor.
 * Sunucunun genel hata yakalayıcısı bunu buraya iletir: indirme başarısız sayılır, sunucu açık kalır.
 */
export const handleStrayError = (e: Error) => {
  if (downloading && browserReject) {
    browserReject(e);
    return true;
  }
  return false;
};

const ensureBrowserOnce = () => {
  if (!browserPromise) {
    let lastPct = -1;
    browserPromise = new Promise((resolve, reject) => {
      browserReject = reject;
      ensureBrowser({
        browserExecutable: browserExecutable(),
        onBrowserDownload: () => {
          downloading = true;
          log('Render tarayıcısı indiriliyor (yalnız ilk sefer, ~100 MB)…');
          return {
            version: null,
            onProgress: ({ percent }) => {
              const pct = Math.round(percent * 100);
              if (pct !== lastPct) {
                lastPct = pct;
                prep.emit(0.02 + percent * 0.06, `Render tarayıcısı indiriliyor (ilk sefer) %${pct}`);
                if (pct % 10 === 0) log(`Tarayıcı indirme %${pct}`);
              }
            },
          };
        },
      }).then(resolve, reject);
    })
      .then((s) => {
        log('Render tarayıcısı hazır');
        return s;
      })
      .catch((e: Error) => {
        browserPromise = null;
        log(`Render tarayıcısı indirilemedi: ${e.message}`);
        throw new Error(
          `Render tarayıcısı indirilemedi (${e.message}). İnternet bağlantınızı kontrol edip “Dışa aktar”a yeniden basın; indirme kaldığı yerden tekrar denenir.`,
        );
      })
      .finally(() => {
        downloading = false;
        browserReject = null;
      });
  }
  return browserPromise;
};

/** Remotion kompozisyonunu bir kez paketler (ilk sefer ~20–60 sn) */
export const ensureBundle = () => {
  if (!bundlePromise) {
    log('Kompozisyon paketleniyor…');
    let lastPct = -1;
    bundlePromise = bundle({
      entryPoint: path.join(ROOT, 'src', 'remotion', 'index.ts'),
      onProgress: (pct) => {
        if (pct !== lastPct) {
          lastPct = pct;
          prep.emit(0.08 + (pct / 100) * 0.04, `Kompozisyon paketleniyor %${pct}`);
        }
      },
      enableCaching: true,
    })
      .then((url) => {
        log('Kompozisyon hazır');
        return url;
      })
      .catch((e) => {
        bundlePromise = null;
        log(`Paketleme hatası: ${e.message}`);
        throw e;
      });
  }
  return bundlePromise;
};

/** Sunucu açılırken çağrılır: ilk dışa aktarma beklemesin */
export const warmUp = async () => {
  await ensureBrowserOnce();
  await ensureBundle();
};

const chromiumOptions = (): ChromiumOptions => ({
  gl: (process.env.FABRIKA_GL as ChromiumOptions['gl']) ?? (process.platform === 'darwin' ? 'angle' : 'swangle'),
});

export type RenderRequest = {
  props: CompProps;
  outFile: string;
  kind: 'video' | 'image';
  onProgress: (p: number, message: string) => void;
};

export const renderOutput = async ({ props, outFile, kind, onProgress }: RenderRequest) => {
  const listener: Listener = (p, m) => onProgress(p, m);
  prep.listeners.add(listener);
  onProgress(Math.max(0.01, prep.last.p), prep.last.message);
  let serveUrl: string;
  try {
    await ensureBrowserOnce();
    serveUrl = await ensureBundle();
  } finally {
    prep.listeners.delete(listener);
  }
  onProgress(0.13, 'Kompozisyon açılıyor');
  const inputProps = props as unknown as Record<string, unknown>;
  const composition = await selectComposition({
    serveUrl,
    id: 'Fabrika',
    inputProps,
    chromiumOptions: chromiumOptions(),
    browserExecutable: browserExecutable(),
    logLevel: 'error',
  });
  log(`${path.basename(outFile)}: ${composition.width}×${composition.height}, ${composition.durationInFrames} kare`);
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
    log(`${path.basename(outFile)} hazır`);
    return { durationInFrames: 1, fps: composition.fps, width: composition.width, height: composition.height };
  }
  let lastLogged = -1;
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
    onProgress: ({ progress, renderedFrames, stitchStage }) => {
      const pct = Math.round(progress * 100);
      if (pct % 10 === 0 && pct !== lastLogged) {
        lastLogged = pct;
        log(`${path.basename(outFile)} %${pct}`);
      }
      onProgress(
        0.14 + progress * 0.84,
        stitchStage === 'muxing' ? 'Ses ve görüntü birleştiriliyor' : `Kareler işleniyor (${renderedFrames}/${composition.durationInFrames})`,
      );
    },
  });
  onProgress(1, 'Video hazır');
  log(`${path.basename(outFile)} hazır`);
  return { durationInFrames: composition.durationInFrames, fps: composition.fps, width: composition.width, height: composition.height };
};
