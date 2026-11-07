import { existsSync, readdirSync } from 'node:fs';
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

type ChromeMode = 'headless-shell' | 'chrome-for-testing';
/** Kullanılan render tarayıcısı: Remotion'ın indirdiği ya da bilgisayardaki Google Chrome */
let browser: { executable: string | null; mode: ChromeMode } = {
  executable: process.env.FABRIKA_BROWSER ?? null,
  mode: (process.env.FABRIKA_CHROME_MODE as ChromeMode) ?? 'headless-shell',
};
const browserOpts = () => ({ browserExecutable: browser.executable, chromeMode: browser.mode });

const SYSTEM_CHROMES =
  process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        path.join(os.homedir(), 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
        '/Applications/Chromium.app/Contents/MacOS/Chromium',
      ]
    : process.platform === 'win32'
      ? ['C:/Program Files/Google/Chrome/Application/chrome.exe']
      : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'];

const findSystemChrome = () => SYSTEM_CHROMES.find((p) => existsSync(p)) ?? null;

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

const errText = (e: unknown) => {
  const err = e as Error & { code?: string; errors?: Error[] };
  return err?.message || err?.code || err?.errors?.map((x) => x.message).join(', ') || String(e) || 'bağlantı kurulamadı';
};

const downloadRemotionBrowser = () =>
  new Promise((resolve, reject) => {
    let lastPct = -1;
    browserReject = reject;
    ensureBrowser({
      browserExecutable: null,
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
  }).finally(() => {
    downloading = false;
    browserReject = null;
  });

/** Remotion'ın kendi tarayıcısı daha önce indirilmiş mi? (indirme denemesi yapmadan bakar) */
const remotionBrowserPresent = () => {
  const dir = path.join(ROOT, 'node_modules', '.remotion', 'chrome-headless-shell');
  try {
    return readdirSync(dir).some((f) => !f.startsWith('.') && !f.endsWith('.lock') && !f.endsWith('.zip') && f !== 'VERSION');
  } catch {
    return false;
  }
};

/** Remotion başarısız bir indirmeden sonra aynı süreçte yeniden denemiyor: bunu hatırla */
let downloadFailed: string | null = null;

const ensureBrowserOnce = () => {
  if (!browserPromise) {
    browserPromise = (async () => {
      if (browser.executable) {
        log(`Render tarayıcısı: ${browser.executable}`);
        return;
      }
      if (remotionBrowserPresent()) {
        await downloadRemotionBrowser(); // zaten var: indirme yapılmaz, yalnız doğrulanır
        log('Render tarayıcısı hazır');
        return;
      }
      // İndirme gerekmeden bilgisayardaki Google Chrome kullanılabiliyorsa onu tercih et
      const chrome = findSystemChrome();
      if (chrome) {
        browser = { executable: chrome, mode: 'chrome-for-testing' };
        log(`Render için bilgisayardaki Google Chrome kullanılıyor: ${chrome}`);
        return;
      }
      if (downloadFailed)
        throw new Error(
          `Render tarayıcısı indirilemedi (${downloadFailed}). Google Chrome'u kurun (google.com/chrome), ardından uygulamayı Terminal'de Ctrl+C ile kapatıp “npm run fabrika” ile yeniden açın.`,
        );
      try {
        await downloadRemotionBrowser();
        log('Render tarayıcısı hazır');
      } catch (e) {
        downloadFailed = errText(e);
        log(`Render tarayıcısı indirilemedi: ${downloadFailed}`);
        throw new Error(
          `Render tarayıcısı indirilemedi (${downloadFailed}). Google Chrome'u kurun (google.com/chrome), ardından uygulamayı Terminal'de Ctrl+C ile kapatıp “npm run fabrika” ile yeniden açın.`,
        );
      }
    })().catch((e) => {
      browserPromise = null;
      throw e;
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
  /** 1080 tabanına göre ölçek (720p 0,667 · 2K 1,333 · 4K 2) */
  scale?: number;
  onProgress: (p: number, message: string) => void;
};

export const renderOutput = async ({ props, outFile, kind, onProgress, scale = 1 }: RenderRequest) => {
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
    ...browserOpts(),
    logLevel: 'error',
  });
  log(`${path.basename(outFile)}: ${Math.round(composition.width * scale)}×${Math.round(composition.height * scale)}, ${composition.durationInFrames} kare`);
  if (kind === 'image') {
    onProgress(0.4, 'Görsel oluşturuluyor');
    await renderStill({
      composition,
      serveUrl,
      output: outFile,
      inputProps,
      frame: 0,
      scale,
      imageFormat: 'jpeg',
      jpegQuality: 93,
      chromiumOptions: chromiumOptions(),
      ...browserOpts(),
      timeoutInMilliseconds: 120_000,
      logLevel: 'error',
    });
    onProgress(1, 'Görsel hazır');
    log(`${path.basename(outFile)} hazır`);
    return { durationInFrames: 1, fps: composition.fps, width: Math.round(composition.width * scale), height: Math.round(composition.height * scale) };
  }
  let lastLogged = -1;
  await renderMedia({
    composition,
    serveUrl,
    codec: 'h264',
    audioCodec: 'aac',
    audioBitrate: '192k',
    crf: 18,
    scale,
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
    ...browserOpts(),
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
  return { durationInFrames: composition.durationInFrames, fps: composition.fps, width: Math.round(composition.width * scale), height: Math.round(composition.height * scale) };
};
