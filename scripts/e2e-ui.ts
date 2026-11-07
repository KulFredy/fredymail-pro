/**
 * Faz 3 arayüz kabul testi (gerçek tarayıcıda tıklayarak):
 *  - Transkriptte cümle seçilince önizleme zamanı, zaman çizelgesi imleci ve seçili klip aynı anı gösterir.
 *  - "Cümleyi kes" sonrası sonraki cümlenin zamanı kesim kadar kayar ve eşleşme korunur.
 *  - "Altyazıyı düzelt" kurguyu (klipler, süre) değiştirmez.
 *  - Geri al (⌘Z / Ctrl+Z) kurguyu eski haline getirir; sağ panel kapanınca önizleme genişler.
 * Eski (Faz 2 sürümüyle kaydedilmiş) proje kullanılır: tests/fixtures/eski-ev
 * Gerekenler: Playwright + Chromium (bulut ortamında hazır). Mac'te gerekmez; bu kontroller orada elle yapılır.
 * Çalıştırma: npm run e2e:ui
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { runOk } from '../src/media/proc';

const ROOT = path.resolve(import.meta.dirname, '..');
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const loadPlaywright = () => {
  try {
    return createRequire(import.meta.url)('playwright');
  } catch {
    try {
      return createRequire(path.join(process.env.NODE_PATH ?? '/usr/lib/node_modules', 'x.js'))('playwright');
    } catch {
      return null;
    }
  }
};

const main = async () => {
  const t0 = Date.now();
  const pw = loadPlaywright();
  if (!pw) {
    console.log('Playwright yok: arayüz testi atlandı (Mac\'te bu kontroller elle yapılır, bkz. docs/DEVAM.md).');
    process.exit(0);
  }
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'arayuz') : path.join(os.tmpdir(), 'fabrika-arayuz');
  const home = path.join(work, 'ev');
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await cp(path.join(ROOT, 'tests', 'fixtures', 'eski-ev'), home, { recursive: true });
  await runOk('npx', ['vite', 'build', '--config', 'web/vite.config.ts', '--logLevel', 'error']);

  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4852';
  const { createServer } = await import('../src/server/index');
  const { app } = await createServer(home);
  const port = Number(process.env.FABRIKA_PORT);
  await app.listen({ port, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${port}`;
  const api = async (method: string, url: string): Promise<any> => (await fetch(base + url, { method })).json();

  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1512, height: 900 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  try {
    const pid = (await api('GET', '/api/projects')).find((p: any) => p.name === 'Eski Faz 2 projesi').id;
    const before = (await api('GET', `/api/projects/${pid}`)).project;
    await page.goto(`${base}/#/studyo/${pid}`);
    await page.getByRole('tab', { name: 'Transkript' }).click();
    await page.waitForSelector('.tr-sen');

    /** Ekrandaki durum: imleç zamanı, önizleme saati, seçili klip */
    type Sen = { id: string; start: number | null; text: string };
    type UiState = { playhead: number; clipId: string | null; clipStart: number; clipWidth: number; time: string; total: string; sentences: Sen[]; previewW: number };
    const state = (): Promise<UiState> =>
      page.evaluate(() => {
        const ph = document.querySelector<HTMLElement>('.tl-playhead');
        const sel = document.querySelector<HTMLElement>('.tl-item.clip.sel');
        const time = document.querySelector('.transport .time')?.textContent ?? '';
        return {
          playhead: Number(ph?.dataset.t ?? NaN),
          clipId: sel?.dataset.clipId ?? null,
          clipStart: Number(sel?.dataset.start ?? NaN),
          clipWidth: sel?.getBoundingClientRect().width ?? 0,
          time: time.split('/')[0].trim(),
          total: time.split('/')[1]?.trim() ?? '',
          sentences: [...document.querySelectorAll<HTMLElement>('.tr-sen')].map((e) => ({ id: e.dataset.sid!, start: e.dataset.start === '' ? null : Number(e.dataset.start), text: e.querySelector('.tr-text')?.textContent?.trim() ?? '' })),
          previewW: document.querySelector('.studio-center')?.getBoundingClientRect().width ?? 0,
        };
      });
    const fmt = (sec: number) => {
      const m = Math.floor(sec / 60);
      return `${m}:${(sec - m * 60).toFixed(1).padStart(4, '0')}`;
    };

    // 1) Cümle seç → aynı an
    const s0 = await state();
    const second = s0.sentences.find((s) => s.text.startsWith('Yeni kahvemiz'))!;
    await page.locator(`[data-sid="${second.id}"] .tr-time`).click(); // zaman etiketi: cümle başı
    await page.waitForTimeout(400);
    const s1 = await state();
    check(
      'Cümle seçilince imleç, önizleme saati ve seçili klip aynı anı gösteriyor',
      Math.abs(s1.playhead - second.start!) < 1 / 30 + 1e-3 && s1.time === fmt(second.start!) && s1.clipId === before.clips[0].id,
      `cümle ${second.start!.toFixed(2)} sn · imleç ${s1.playhead.toFixed(2)} · önizleme ${s1.time} · klip ${s1.clipId}`,
    );

    // Kelimeye tıkla → tam o kelime
    const word = page.locator(`[data-sid="${second.id}"] .tr-w`).nth(2);
    await word.click();
    await page.waitForTimeout(300);
    const s1b = await state();
    check('Kelimeye tıklayınca imleç o kelimeye gidiyor', s1b.playhead > second.start! + 0.3 && (await word.getAttribute('class'))!.includes('now'), `imleç ${s1b.playhead.toFixed(2)} sn`);

    // 2) İlk cümleyi kes → ikinci cümle kesim kadar kayar
    const first = s0.sentences.find((s) => s.text.startsWith('Merhaba'))!;
    await page.locator(`[data-sid="${first.id}"] .tr-time`).click();
    await page.getByRole('button', { name: 'Cümleyi kes' }).click();
    await page.waitForTimeout(800);
    const after = (await api('GET', `/api/projects/${pid}`)).project;
    const lenBefore = before.clips.reduce((s: number, c: any) => s + c.out - c.in, 0);
    const lenAfter = after.clips.reduce((s: number, c: any) => s + c.out - c.in, 0);
    const cutLen = lenBefore - lenAfter;
    const s2 = await state();
    const firstAfter = s2.sentences.find((s) => s.id === first.id)!;
    const secondAfter = s2.sentences.find((s) => s.id === second.id)!;
    check('Cümle kesildi (soluk/“kesildi”), süre kısaldı', firstAfter.start === null && cutLen > 1, `${cutLen.toFixed(2)} sn kesildi`);
    check('Kesimden sonra sonraki cümle tam kesim kadar kaydı', Math.abs(secondAfter.start! - (second.start! - cutLen)) < 0.02, `${second.start!.toFixed(2)} → ${secondAfter.start!.toFixed(2)} sn`);
    await page.locator(`[data-sid="${second.id}"] .tr-time`).click();
    await page.waitForTimeout(300);
    const s3 = await state();
    check('Kesimden sonra da cümle seçimi imleç ve klip ile eşleşiyor', Math.abs(s3.playhead - secondAfter.start!) < 1 / 30 + 1e-3 && s3.clipStart <= s3.playhead + 1e-3, `imleç ${s3.playhead.toFixed(2)} · klip başı ${s3.clipStart.toFixed(2)}`);

    // 3) Altyazıyı düzelt → kurgu aynı
    await page.getByRole('button', { name: 'Altyazıyı düzelt' }).click();
    await page.getByLabel('Altyazı metni').fill('Yeni kahvemiz harika oldu.');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(800);
    const edited = (await api('GET', `/api/projects/${pid}`)).project;
    const s4 = await state();
    check(
      'Altyazı düzeltildi; klipler ve süre değişmedi',
      JSON.stringify(edited.clips) === JSON.stringify(after.clips) && s4.total === s2.total && s4.sentences.find((s) => s.id === second.id)!.text.includes('harika'),
      s4.sentences.find((s) => s.id === second.id)!.text,
    );

    // 4) Geri al: önce düzeltme, sonra kesim
    await page.locator('.studio-center').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    const undone = (await api('GET', `/api/projects/${pid}`)).project;
    check('İki kez geri al: kurgu ve altyazı eski haline döndü', JSON.stringify(undone.clips) === JSON.stringify(before.clips) && JSON.stringify(undone.captions.edits) === JSON.stringify(before.captions.edits));

    // 5) Sağ panel kapanınca önizleme genişler
    const w0 = (await state()).previewW;
    await page.getByRole('button', { name: 'Sağ paneli kapat' }).click();
    await page.waitForTimeout(300);
    const w1 = (await state()).previewW;
    await page.getByRole('button', { name: 'Sağ paneli aç' }).click();
    check('Sağ panel kapanınca önizleme genişliyor', w1 > w0 + 200, `${w0.toFixed(0)} → ${w1.toFixed(0)} px`);

    if (process.env.FABRIKA_UI_SHOT) await page.screenshot({ path: process.env.FABRIKA_UI_SHOT });
    check('Sayfada hata yok', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    check('Test akışı tamamlandı', false, (e as Error).message.split('\n')[0]);
  } finally {
    await browser.close();
    await app.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} kontrol geçti · ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => {
  console.error('\n✗ Test durdu:', e.message);
  process.exit(1);
});
