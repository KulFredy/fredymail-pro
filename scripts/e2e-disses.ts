/**
 * Dış ses (A1) kabul testi (tarayıcıda, Playwright):
 *  - Aynı noktaya eklenen iki dış ses zaman çizelgesinde alt alta görünür; ikisi de tıklanıp seçilebilir.
 *  - Inspector çakışmayı söyler, “…’a taşı” sesi boş yere taşır.
 *  - Seçili dış ses ⌫ ile silinir, ⌘Z geri getirir; diğer ses yerinde kalır.
 * Çalıştırma: npm run e2e:disses
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOk } from '../src/media/proc';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const VIDEO = 'df59f0c9b847';
const VOICE = 'b39f0b7e703b';

const main = async () => {
  const t0 = Date.now();
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'disses') : path.join(os.tmpdir(), 'fabrika-disses');
  const home = path.join(work, 'ev');
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await cp(path.join(ROOT, 'tests', 'fixtures', 'eski-ev'), home, { recursive: true });
  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4861';
  const { createServer } = await import('../src/server/index');
  const { app } = await createServer(home);
  const port = Number(process.env.FABRIKA_PORT);
  await app.listen({ port, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${port}`;
  const api = async (method: string, url: string, b?: unknown) => {
    const r = await fetch(base + url, { method, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return r.json() as Promise<any>;
  };

  const created = await api('POST', '/api/projects', { name: 'Dış ses testi', formats: [{ format: 'reel' }], mode: 'studio' });
  const id = created.project.id as string;
  await api('POST', `/api/projects/${id}/ops`, {
    ops: [
      { type: 'clips.add', assetIds: [VIDEO] },
      { type: 'voice.add', assetId: VOICE, at: 1 },
      { type: 'voice.add', assetId: VOICE, at: 1 },
    ],
  });
  const voices = async () => (await api('GET', `/api/projects/${id}`)).project.voice as { id: string; at: number }[];
  const [v1, v2] = await voices();

  await runOk('npx', ['vite', 'build', '--config', 'web/vite.config.ts', '--logLevel', 'error']);
  const pw = createRequire(import.meta.url)('playwright');
  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  try {
    await page.goto(`${base}/#/studyo/${id}`);
    await page.waitForSelector(`[data-voice="${v2.id}"]`, { timeout: 30000 });
    const b1 = await page.locator(`[data-voice="${v1.id}"]`).boundingBox();
    const b2 = await page.locator(`[data-voice="${v2.id}"]`).boundingBox();
    check('Aynı noktadaki iki dış ses alt alta (üst üste binmiyor)', !!b1 && !!b2 && Math.abs(b1.x - b2.x) < 1 && b2.y >= b1.y + b1.height - 1, `${b1?.y}/${b1?.height} → ${b2?.y}`);

    await page.locator(`[data-voice="${v2.id}"]`).click();
    await page.waitForSelector(`[data-voice="${v2.id}"].sel`);
    const warn = await page.getByTestId('voice-overlap').innerText();
    check('Alttaki ses tıklanıp seçiliyor; Inspector çakışmayı söylüyor', /üst üste çalıyor/.test(warn), warn.replace(/\n+/g, ' | '));

    await page.getByTestId('voice-overlap').getByRole('button', { name: /taşı/ }).click();
    await page.waitForFunction(async ({ id, vid }: { id: string; vid: string }) => {
      const r = await fetch(`/api/projects/${id}`).then((x) => x.json());
      return r.project.voice.find((v: { id: string; at: number }) => v.id === vid)?.at > 1.5;
    }, { id, vid: v2.id });
    const moved = (await voices()).find((v) => v.id === v2.id)!;
    await page.waitForSelector('[data-testid=voice-overlap]', { state: 'detached' });
    const after = await page.locator('.tl-item.voice.stacked').count();
    check('“…’a taşı” sesi öncekinin bitişine taşıdı; artık tek satır', Math.abs(moved.at - (1 + 3.249)) < 0.05 && after === 0, `at=${moved.at.toFixed(2)}`);

    await page.locator(`[data-voice="${v1.id}"]`).click();
    await page.waitForSelector(`[data-voice="${v1.id}"].sel`);
    await page.keyboard.press('Backspace');
    await page.waitForSelector(`[data-voice="${v1.id}"]`, { state: 'detached' });
    const left = await voices();
    check('Seçili dış ses ⌫ ile silindi, diğeri kaldı', left.length === 1 && left[0].id === v2.id);

    await page.keyboard.press('Control+z');
    await page.waitForSelector(`[data-voice="${v1.id}"]`, { timeout: 10000 });
    check('⌘Z silinen sesi geri getirdi', (await voices()).length === 2);
    check('Sayfada hata yok', !errors.length, errors.join(' | '));
  } catch (e) {
    check('Test akışı tamamlandı', false, (e as Error).message.split('\n')[0]);
  } finally {
    await browser.close();
    await app.close();
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(`${ok}/${results.length} kontrol geçti · ${Math.round((Date.now() - t0) / 1000)} sn`);
  process.exit(ok === results.length ? 0 : 1);
};
void main();
