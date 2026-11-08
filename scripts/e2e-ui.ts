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

    // 6) Komut: hedef klip + aralık görünür; Önizle → Vazgeç → Uygula → Geri al (yerel anlayıcı, Claude kapalı)
    const total0 = (await state()).total;
    await page.locator('[data-sid] .tr-time').first().click(); // imleç ilk cümlede
    const ph = (await state()).playhead;
    const box = page.getByPlaceholder(/Yazın veya mikrofona söyleyin/);
    await box.fill('Buradan sonraki iki saniyeyi kes');
    await box.press('Enter');
    await page.waitForSelector('.impact li');
    const impact = await page.locator('.impact li').first().innerText();
    const expRange = `${fmt(ph)}–${fmt(ph + 2)}`;
    check('Komut önerisi hedef klibi, aralığı ve kapsamı gösteriyor', impact.includes('Klip 1 · konusma.mp4') && impact.includes(expRange) && impact.includes('Tüm proje') && impact.includes('“Hafta sonu” yazısı da silinir'), impact.replace(/\n+/g, ' · '));
    const hl = await page.locator('.tl-highlight.delete').count();
    check('Etkilenen aralık zaman çizelgesinde işaretli', hl === 1);
    await page.getByRole('button', { name: /Önizle/ }).click();
    await page.waitForTimeout(600);
    const tPrev = (await state()).total;
    const apiPrev = (await api('GET', `/api/projects/${pid}`)).project;
    check('Önizleme kurguyu kısaltıyor ama kaydetmiyor', tPrev !== total0 && JSON.stringify(apiPrev.clips) === JSON.stringify(before.clips), `${total0} → ${tPrev}`);
    await page.getByRole('button', { name: 'Vazgeç' }).click();
    await page.waitForTimeout(600);
    check('Vazgeç: önizleme geri döndü', (await state()).total === total0);
    await box.fill('Buradan sonraki iki saniyeyi kes');
    await box.press('Enter');
    await page.waitForSelector('.impact li');
    await page.getByRole('button', { name: 'Uygula' }).click();
    await page.waitForTimeout(800);
    const applied = (await api('GET', `/api/projects/${pid}`)).project;
    const lenApplied = applied.clips.reduce((x: number, c: any) => x + c.out - c.in, 0);
    check('Uygula: kaydedildi (2 sn kısaldı)', Math.abs(lenBefore - lenApplied - 2) < 0.05, `${lenBefore.toFixed(2)} → ${lenApplied.toFixed(2)} sn`);
    await page.locator('.plan.applied').getByRole('button', { name: 'Geri al' }).click();
    await page.waitForTimeout(800);
    const back = (await api('GET', `/api/projects/${pid}`)).project;
    check('Komut panelinden Geri al: kurgu eski haline döndü', JSON.stringify(back.clips) === JSON.stringify(before.clips));

    // 7) Kare hassasiyetinde aralık: I → 15 kare ileri → O → ⌫ ; S ile imleçte böl
    await page.locator('[data-sid] .tr-time').first().click();
    await page.locator('.studio-center').click({ position: { x: 5, y: 5 } });
    const tIn = (await state()).playhead;
    await page.keyboard.press('i');
    for (let k = 0; k < 15; k++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press('o');
    await page.waitForTimeout(200);
    const marksText = await page.locator('.tl-marks-info').innerText();
    check('I/O ile 15 karelik (0,50 sn) aralık işaretlendi', marksText.includes('0.50 sn sil'), marksText.replace(/\n+/g, ' · '));
    await page.keyboard.press('Backspace');
    await page.waitForTimeout(800);
    const cutIO = (await api('GET', `/api/projects/${pid}`)).project;
    const lenIO = cutIO.clips.reduce((x: number, c: any) => x + c.out - c.in, 0);
    check('⌫ ile işaretli aralık silindi (tam 15 kare)', Math.abs(lenBefore - lenIO - 0.5) < 1e-3 && Math.abs(cutIO.clips[0].out - tIn) < 0.02, `${lenBefore.toFixed(3)} → ${lenIO.toFixed(3)} sn`);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    await page.locator('[data-sid] .tr-time').first().click();
    await page.locator('.studio-center').click({ position: { x: 5, y: 5 } });
    const tSplit = (await state()).playhead;
    await page.keyboard.press('s');
    await page.waitForTimeout(800);
    const split = (await api('GET', `/api/projects/${pid}`)).project;
    check('S ile imleçte bölündü (2 parça, aynı süre)', split.clips.length === before.clips.length + 1 && Math.abs(split.clips[0].out - tSplit) < 0.02, `${split.clips.length} parça, bölme ${tSplit.toFixed(2)} sn`);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    const waves = await page.locator('.tl-wave').count();
    check('Ses dalgası çiziliyor (klip ve dış ses)', waves >= 2, `${waves} dalga`);

    // 8) Boş Stüdyo projesine sonradan klip eklenince zaman çizelgesi tüm genişliği kullanır
    const empty = await (await fetch(`${base}/api/projects`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Boş', formats: [{ format: 'landscape' }] }) })).json();
    await page.goto(`${base}/#/studyo/${empty.project.id}`);
    await page.waitForSelector('.strip-empty');
    await page.getByRole('tab', { name: 'Medya' }).click();
    await page.getByRole('button', { name: 'Ana ize' }).first().click();
    await page.waitForSelector('.tl-item.clip');
    await page.waitForTimeout(400);
    const fill = await page.evaluate(() => {
      const clip = document.querySelector('.tl-item.clip')!.getBoundingClientRect().width;
      const area = document.querySelector('.tl-scroll')!.getBoundingClientRect().width;
      return clip / area;
    });
    check('Boş projeye klip eklenince zaman çizelgesi tüm genişliği kullanıyor', fill > 0.9, `klip / alan = %${(fill * 100).toFixed(0)}`);

    // 9) Altyazı izindeki “+” altyazıyı kapatır; iz görünür kalır ve tekrar “+” ile açılır
    const capLabel = page.locator('.tl-label.lane-c');
    await capLabel.click();
    await page.waitForTimeout(500);
    const off = (await api('GET', `/api/projects/${empty.project.id}`)).project.captions.enabled;
    const offVisible = await page.getByText('Altyazı kapalı').isVisible();
    await capLabel.click();
    await page.waitForTimeout(500);
    const on = (await api('GET', `/api/projects/${empty.project.id}`)).project.captions.enabled;
    check('Altyazı “+” ile kapanıp aynı yerden tekrar açılabiliyor', off === false && offVisible && on === true);

    // 10) LUT'larım: dosyadan içe aktar (bir bozuk), küçük önizlemeler, ana önizlemede dene, uyarı, uygula, geri al, karşılaştır
    await page.goto(`${base}/#/studyo/${pid}`);
    await page.getByRole('tab', { name: "LUT'larım" }).click();
    const cubeTxt = (f: (r: number, g: number, b: number) => number[]) => {
      const l = ['LUT_3D_SIZE 2'];
      for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) l.push(f(r, g, b).join(' '));
      return Buffer.from(l.join('\n'));
    };
    await page.locator('input[type=file][accept*=".cube"]').first().setInputFiles([
      { name: 'Ters.cube', mimeType: 'text/plain', buffer: cubeTxt((r, g, b) => [1 - r, 1 - g, 1 - b]) },
      { name: 'Sony SLog 3.cube', mimeType: 'text/plain', buffer: cubeTxt((r, g, b) => [r, g * 0.9, b]) },
      { name: 'Crisp_Warm.look', mimeType: 'text/plain', buffer: Buffer.from('<look/>') },
    ]);
    await page.waitForSelector('.lut-card');
    const repText = await page.locator('.lut-report summary').innerText();
    check('LUT içe aktarma raporu (2 eklendi, 1 okunamadı)', /2 eklendi/.test(repText) && /1 okunamadı/.test(repText), repText);
    await page.waitForTimeout(1500);
    const thumbOk = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('[data-lut="Ters"] canvas');
      if (!c || !c.width) return false;
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      return s > 0;
    });
    check('LUT küçük önizlemesi çizildi', thumbOk);
    await page.locator('[data-lut="Sony SLog 3"]').click();
    await page.waitForTimeout(400);
    const warn = await page.locator('.lut-active .impact-warn').first().innerText().catch(() => '');
    check('Log LUT\'u normal videoda uyarı veriyor', /normal video/.test(warn), warn);
    await page.locator('[data-lut="Ters"]').click();
    await page.waitForTimeout(500);
    const pv = (await api('GET', `/api/projects/${pid}`)).project;
    check('LUT denemesi (önizleme) kaydetmiyor', JSON.stringify(pv.clips) === JSON.stringify(before.clips) && pv.look.lut === before.look.lut);
    await page.locator('.lut-active').getByRole('button', { name: 'Uygula' }).click();
    await page.waitForTimeout(800);
    const ap = (await api('GET', `/api/projects/${pid}`)).project;
    check('Uygula: seçili klibe LUT kaydedildi', ap.clips.some((c: any) => c.look?.lut === 'kullanici:Ters.cube' && c.look?.lutIntensity === 1), ap.clips.map((c: any) => c.look?.lut ?? '—').join(', '));
    const inUse = await page.locator('[data-lut="Ters"].inuse').count();
    check('“kullanımda” işareti', inUse === 1);
    await page.locator('.lut-active').getByRole('button', { name: 'Karşılaştır' }).click();
    await page.waitForSelector('.cmp-split canvas');
    await page.waitForTimeout(1200);
    const cmp = await page.evaluate(() => document.querySelectorAll('.cmp-split canvas').length + document.querySelectorAll('.cmp-cell').length);
    check('Karşılaştırma penceresi (önce/sonra + hücre)', cmp >= 3, `${cmp} tuval`);
    await page.locator('.modal-actions').getByRole('button', { name: 'Kapat' }).click();
    await page.waitForTimeout(300);
    await page.locator('.studio-center').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    const un = (await api('GET', `/api/projects/${pid}`)).project;
    check('⌘Z: LUT geri alındı', JSON.stringify(un.clips) === JSON.stringify(before.clips));

    // 11) Referans: sıcak bir fotoğraf ekle → rengi eşle → önizleme kaydetmez → uygula → geri al
    const sharpMod = (await import('sharp')).default;
    const warm = await sharpMod({ create: { width: 600, height: 400, channels: 3, background: { r: 215, g: 150, b: 90 } } }).jpeg().toBuffer();
    await page.getByRole('tab', { name: 'Referans' }).click();
    await page.locator('.refp input[type=file]').setInputFiles([{ name: 'sicak.jpg', mimeType: 'image/jpeg', buffer: warm }]);
    await page.waitForSelector('.ref-card img', { timeout: 60000 });
    const refs = (await api('GET', `/api/projects/${pid}`)).project.references;
    check('Referans eklendi (kurguya girmedi)', refs.length === 1 && (await api('GET', `/api/projects/${pid}`)).project.clips.length === before.clips.length);
    await page.getByRole('button', { name: 'Rengi eşle' }).click();
    await page.waitForSelector('.ref-summary li', { timeout: 60000 });
    const summ = await page.locator('.ref-summary').innerText();
    check('Renk eşleme özeti gösterildi', /sıcak|aydınlık|doygun|kırmızı/.test(summ), summ.replace(/\n+/g, ' · '));
    const pv2 = (await api('GET', `/api/projects/${pid}`)).project;
    check('Eşleme önizlemesi kaydetmiyor', JSON.stringify(pv2.clips) === JSON.stringify(before.clips));
    await page.locator('.ref-match').getByRole('button', { name: 'Uygula' }).click();
    await page.waitForTimeout(800);
    const ap2 = (await api('GET', `/api/projects/${pid}`)).project;
    check('Uygula: eşleme LUT\'u klibe kaydedildi', ap2.clips.some((c: any) => /Referans/.test(c.look?.lut ?? '') && Math.abs(c.look.lutIntensity - 0.8) < 1e-6), ap2.clips.map((c: any) => c.look?.lut ?? '—').join(', '));
    await page.locator('.studio-center').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(800);
    check('⌘Z: renk eşleme geri alındı', JSON.stringify((await api('GET', `/api/projects/${pid}`)).project.clips) === JSON.stringify(before.clips));

    // 12) Logo: LOGO izinden saydam PNG yükle → sağ üst; sol alta al; yalnız Story'de farklı; güvenli alana al
    await fetch(`${base}/api/projects/${pid}/ops`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: [{ type: 'output.add', format: 'story' }] }) });
    await page.reload();
    await page.waitForSelector('.tl-item.clip');
    const lpx = Buffer.alloc(200 * 100 * 4);
    for (let i = 0; i < 200 * 100; i++) if (i % 200 < 100) lpx.set([230, 20, 20, 255], i * 4);
    const logoPng = await sharpMod(lpx, { raw: { width: 200, height: 100, channels: 4 } }).png().toBuffer();
    await page.locator('[data-testid=logo-input]').setInputFiles([{ name: 'marka.png', mimeType: 'image/png', buffer: logoPng }]);
    await page.waitForSelector('.tl-item.logo', { timeout: 60000 });
    let pl = (await api('GET', `/api/projects/${pid}`)).project;
    check('Logo eklendi: sağ üst, videonun tamamı', pl.logos.length === 1 && pl.logos[0].anchor === 'tr' && pl.logos[0].full === true);
    await page.locator('.tl-item.logo').click();
    await page.getByRole('tab', { name: 'Seçili öğe' }).click().catch(() => undefined);
    await page.waitForSelector('.anchor-grid');
    await page.getByRole('button', { name: 'sol alt', exact: true }).click();
    await page.waitForTimeout(500);
    pl = (await api('GET', `/api/projects/${pid}`)).project;
    check('Izgaradan “sol alt” seçildi (bütün oranlar)', pl.logos[0].anchor === 'bl' && Object.keys(pl.logos[0].placements).length === 0);
    const storyId = pl.outputs.find((o: any) => o.format === 'story').id;
    await page.getByRole('button', { name: /Story · 9:16/ }).first().click(); // önizlemede Story'ye geç
    await page.waitForTimeout(300);
    await page.locator('.placement').getByRole('button', { name: /Yalnız Story/ }).click();
    await page.getByRole('button', { name: 'sağ üst', exact: true }).click();
    await page.waitForTimeout(500);
    pl = (await api('GET', `/api/projects/${pid}`)).project;
    check('Yalnız Story için “sağ üst”; genel ayar sol altta kaldı', pl.logos[0].anchor === 'bl' && pl.logos[0].placements[storyId]?.anchor === 'tr');
    // Güvenli alan: serbest konumlu yazı Story'de üstte → uyarı ve düzeltme
    await fetch(`${base}/api/projects/${pid}/ops`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ops: [{ type: 'text.add', text: { text: 'Kampanya', start: 0, end: 3, y: 0.04 } }] }) });
    await page.reload();
    await page.waitForSelector('.tl-item.text');
    await page.locator('.tl-item.text', { hasText: 'Kampanya' }).click({ force: true });
    await page.getByRole('tab', { name: 'Seçili öğe' }).click().catch(() => undefined);
    const warnTxt = await page.locator('.impact-warn').first().innerText({ timeout: 10000 });
    check('Güvenli alan uyarısı gösterildi', /Instagram üst bilgisinin|kenara çok yakın/.test(warnTxt), warnTxt.split('\n')[0]);
    const nWarn = await page.locator('.impact-warn').count();
    await page.locator('.impact-warn').getByRole('button', { name: 'Güvenli alana al' }).first().click();
    await page.waitForTimeout(600);
    const nWarn2 = await page.locator('.impact-warn').count();
    pl = (await api('GET', `/api/projects/${pid}`)).project;
    const tx = pl.texts.find((t: any) => t.text === 'Kampanya');
    check('“Güvenli alana al” o oran için düzeltti', nWarn2 === nWarn - 1 && Object.keys(tx.placements).length === 1, `${nWarn} → ${nWarn2} uyarı`);

    if (process.env.FABRIKA_UI_SHOT) await page.screenshot({ path: process.env.FABRIKA_UI_SHOT });
    check('Sayfada hata yok', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) {
    if (process.env.FABRIKA_UI_SHOT) await page.screenshot({ path: process.env.FABRIKA_UI_SHOT.replace(/\.png$/, '-hata.png') }).catch(() => undefined);
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
