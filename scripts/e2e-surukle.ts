/**
 * Sürükle-bırak ve zaman çizelgesi kabul testi (Hızlı Edit + Stüdyo, Playwright):
 *  - Kütüphane kartı yukarıdaki bırakma alanına sürüklenince klip eklenir (yeniden yükleme yok).
 *  - Kart zaman çizelgesinin başına bırakılınca ilk sıraya girer; müzik dosyası müzik olur.
 *  - Zaman çizelgesi üst kenardaki tutamakla yukarı sürüklenip büyür; yenilemeden sonra korunur; çift tık varsayılana döner.
 *  - Klip seçilince “N. klip seçili · Klibi sil” görünür; düğme ve ⌫ klibi çıkarır, ⌘Z geri getirir.
 *  - Stüdyo'da Media Pool kartı zaman çizelgesine sürüklenir; tutamak çalışır.
 * Çalıştırma: npm run e2e:surukle
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
const PHOTO = '0a43577b2918';
const AUDIO = 'b39f0b7e703b';

const main = async () => {
  const t0 = Date.now();
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'surukle') : path.join(os.tmpdir(), 'fabrika-surukle');
  const home = path.join(work, 'ev');
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await cp(path.join(ROOT, 'tests', 'fixtures', 'eski-ev'), home, { recursive: true });
  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4863';
  const { createServer } = await import('../src/server/index');
  const { app } = await createServer(home);
  const port = Number(process.env.FABRIKA_PORT);
  await app.listen({ port, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${port}`;
  const api = async (method: string, url: string, b?: unknown) => {
    const r = await fetch(base + url, { method, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return r.json() as Promise<any>;
  };
  const projectOf = async (id: string) => (await api('GET', `/api/projects/${id}`)).project;
  const waitFor = async (fn: () => Promise<boolean>, ms = 8000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  };

  await runOk('npx', ['vite', 'build', '--config', 'web/vite.config.ts', '--logLevel', 'error']);
  const pw = createRequire(import.meta.url)('playwright');
  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  try {
    // ---------- Hızlı Edit ----------
    const q = (await api('POST', '/api/projects', { name: 'Sürükle testi', formats: [{ format: 'reel' }], mode: 'quick' })).project.id as string;
    await page.goto(`${base}/#/proje/${q}`);
    await page.waitForSelector('[data-testid=add-dropzone]');
    await page.locator(`.lib-item[data-asset="${VIDEO}"]`).dragTo(page.getByTestId('add-dropzone'));
    const ok1 = await waitFor(async () => (await projectOf(q)).clips.length === 1);
    check('Kütüphane kartı bırakma alanına sürüklendi → klip eklendi', ok1 && (await projectOf(q)).clips[0].assetId === VIDEO);

    await page.waitForSelector('.tl-content');
    const content = page.locator('.tl-content');
    const box = (await content.boundingBox())!;
    await page.locator(`.lib-item[data-asset="${PHOTO}"]`).dragTo(content, { targetPosition: { x: 4, y: Math.min(40, box.height - 4) } });
    const ok2 = await waitFor(async () => (await projectOf(q)).clips.length === 2);
    const clips = (await projectOf(q)).clips;
    check('Kart zaman çizelgesinin başına bırakıldı → ilk sıraya girdi', ok2 && clips[0].assetId === PHOTO && clips[1].assetId === VIDEO, clips.map((c: any) => c.assetId).join(','));

    await page.locator(`.lib-item[data-asset="${AUDIO}"]`).dragTo(content, { targetPosition: { x: box.width / 2, y: 10 } });
    const ok3 = await waitFor(async () => (await projectOf(q)).music?.assetId === AUDIO);
    check('Ses dosyası zaman çizelgesine bırakıldı → müzik oldu', ok3);

    // Tutamak: yukarı sürükle
    const footer = page.locator('.strip-row');
    const h0 = (await footer.boundingBox())!.height;
    const sp = (await page.getByTestId('tl-splitter').boundingBox())!;
    await page.mouse.move(sp.x + sp.width / 2, sp.y + sp.height / 2);
    await page.mouse.down();
    await page.mouse.move(sp.x + sp.width / 2, sp.y - 150, { steps: 8 });
    await page.mouse.up();
    const h1 = (await footer.boundingBox())!.height;
    await page.reload();
    await page.waitForSelector('.strip-row .tl-content');
    const h2 = (await page.locator('.strip-row').boundingBox())!.height;
    check('Zaman çizelgesi yukarı sürüklenip büyüdü, yenilemeden sonra korundu', h1 > h0 + 120 && Math.abs(h2 - h1) < 3, `${Math.round(h0)} → ${Math.round(h1)} → ${Math.round(h2)}`);
    await page.getByTestId('tl-splitter').dblclick();
    const h3 = (await page.locator('.strip-row').boundingBox())!.height;
    check('Çift tık varsayılan yüksekliğe döndürdü', Math.abs(h3 - h0) < 3, `${Math.round(h3)}`);

    // Klip seç → sil düğmesi, ⌫, ⌘Z
    const second = (await projectOf(q)).clips[1].id as string;
    await page.locator(`.tl-item.clip[data-clip-id="${second}"]`).click();
    await page.waitForSelector(`.tl-item.clip[data-clip-id="${second}"].sel`);
    const border = await page.locator(`.tl-item.clip[data-clip-id="${second}"]`).evaluate((el: HTMLElement) => getComputedStyle(el).borderTopColor);
    const info = await page.getByTestId('tl-sel-clip').innerText();
    check('Seçili klip turuncu çerçeveli; “2. klip seçili · Klibi sil” görünüyor', /255, 122, 61|rgb\(255/.test(border) && /2\. klip seçili/.test(info) && /Klibi sil/.test(info), `${border} · ${info.replace(/\n/g, ' ')}`);
    await page.getByTestId('tl-sel-clip').getByRole('button', { name: /Klibi sil/ }).click();
    const ok4 = await waitFor(async () => (await projectOf(q)).clips.length === 1);
    check('“Klibi sil” klibi kurgudan çıkardı', ok4);
    await page.keyboard.press('Control+z');
    const ok5 = await waitFor(async () => (await projectOf(q)).clips.length === 2);
    const first = (await projectOf(q)).clips[0].id as string;
    await page.locator(`.tl-item.clip[data-clip-id="${first}"]`).click();
    await page.waitForSelector(`.tl-item.clip[data-clip-id="${first}"].sel`);
    await page.keyboard.press('Backspace');
    const ok6 = await waitFor(async () => {
      const p = await projectOf(q);
      return p.clips.length === 1 && p.clips[0].assetId === VIDEO;
    });
    check('⌘Z geri getirdi; ⌫ seçili klibi çıkardı', ok5 && ok6);

    // Fotoğraf çıktısı seçiliyken oynatma: video çıktısına geçip oynar
    await api('POST', `/api/projects/${q}/ops`, { ops: [{ type: 'output.add', format: 'post', kind: 'image' }] });
    const outs = (await projectOf(q)).outputs as { id: string; kind: string }[];
    const img = outs.find((o) => o.kind === 'image')!;
    await page.reload();
    await page.waitForSelector('.preview-tabs');
    await page.locator('.preview-tabs button', { hasText: 'JPEG' }).click();
    await page.waitForSelector('[data-testid=transport-still]');
    const stillTxt = await page.getByTestId('transport-still').innerText();
    await page.getByTestId('transport-still').getByRole('button', { name: /Videoyu oynat/ }).click();
    await page.waitForSelector('.transport .play-btn[title^="Durdur"]', { timeout: 15000 });
    const active1 = await page.locator('.preview-tabs button.on').innerText();
    check('Fotoğraf çıktısında “Videoyu oynat” → video önizlemesine geçip oynuyor', /Videoyu oynat/.test(stillTxt) && !/JPEG/.test(active1), active1);
    await page.locator('.transport .play-btn').click();
    await page.locator('.preview-tabs button', { hasText: 'JPEG' }).click();
    await page.waitForSelector('[data-testid=transport-still]');
    await page.locator('.steps .step', { hasText: 'Sırala' }).click();
    await page.getByRole('button', { name: 'Oynat', exact: false }).first().click();
    await page.waitForSelector('.transport .play-btn[title^="Durdur"]', { timeout: 15000 });
    check('Sırala adımında “Oynat” fotoğraf çıktısındayken de çalışıyor', !(await page.locator('.preview-tabs button.on').innerText()).includes('JPEG'));
    await page.locator('.transport .play-btn').click();
    void img;

    // ---------- Stüdyo ----------
    const s = (await api('POST', '/api/projects', { name: 'Stüdyo sürükle', formats: [{ format: 'reel' }], mode: 'studio' })).project.id as string;
    await api('POST', `/api/projects/${s}/ops`, { ops: [{ type: 'clips.add', assetIds: [VIDEO] }] });
    await page.goto(`${base}/#/studyo/${s}`);
    await page.waitForSelector('.studio-timeline .tl-content');
    await page.getByRole('tab', { name: 'Media' }).click();
    await page.waitForSelector(`.bin-item[data-asset="${PHOTO}"]`);
    const sc = page.locator('.studio-timeline .tl-content');
    const sb = (await sc.boundingBox())!;
    await page.locator(`.bin-item[data-asset="${PHOTO}"]`).dragTo(sc, { targetPosition: { x: sb.width - 10, y: 40 } });
    const ok7 = await waitFor(async () => {
      const p = await projectOf(s);
      return p.clips.length === 2 && p.clips[1].assetId === PHOTO;
    });
    check('Stüdyo: Media Pool kartı zaman çizelgesinin sonuna sürüklendi', ok7);
    const sf = page.locator('.studio-timeline');
    const s0 = (await sf.boundingBox())!.height;
    const ss = (await page.getByTestId('tl-splitter').boundingBox())!;
    await page.mouse.move(ss.x + ss.width / 2, ss.y + ss.height / 2);
    await page.mouse.down();
    await page.mouse.move(ss.x + ss.width / 2, ss.y - 100, { steps: 6 });
    await page.mouse.up();
    const s1 = (await sf.boundingBox())!.height;
    check('Stüdyo: zaman çizelgesi tutamakla büyüdü', s1 > s0 + 80, `${Math.round(s0)} → ${Math.round(s1)}`);
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
