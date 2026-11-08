/**
 * Ana sayfa kabul testi (tarayıcıda, Playwright):
 *  - Eski (Faz 1–2) proje ana sayfadan açılır; son proje kartında gerçek ad, kapak, çıktı profilleri, son düzenleme.
 *  - Yeni proje → Hızlı Edit / Kurgu Stüdyosu doğru düzenleyiciyi açar; türleri kartlarda doğru.
 *  - Arama, “sonuç yok” durumu, Sabitlenenler (yeniden yüklemeden sonra korunur), kart menüsünden yeniden adlandır / sil (onaylı).
 *  - Telefondan ekle: hedef seçimi; iki ayrı proje için gerçek QR adresine telefon gibi yükleme → dosya doğru projeye gider;
 *    gelen dosya sayısı görünür; “Projeyi aç” doğru düzenleyiciye gider; bağlantı hatasında hedef korunarak yeniden deneme.
 *  - Kullanım kılavuzu ve Stüdyo kısayolları: klavyeyle açılır, Esc ile kapanır, odak açan düğmeye döner.
 *  - Marka kampanyası: “Marka oluştur” pencereyi kapatır, Markalar açılır; boş proje oluşmaz.
 *  - Dar ekran (390 px): kartlar alt alta, yatay kaydırma yok. Sayfada hata yok.
 * Gerçek Android telefonla yapılmaz (ayrı kullanıcı testi).
 * Çalıştırma: npm run e2e:anasayfa
 */
import { cp, mkdir, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { runOk } from '../src/media/proc';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const main = async () => {
  const t0 = Date.now();
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'anasayfa') : path.join(os.tmpdir(), 'fabrika-anasayfa');
  const home = path.join(work, 'ev');
  await rm(work, { recursive: true, force: true });
  await mkdir(work, { recursive: true });
  await cp(path.join(ROOT, 'tests', 'fixtures', 'eski-ev'), home, { recursive: true });
  // Her “telefon” dosyası farklı içerik (kütüphane aynı içeriği tekilleştirir)
  let shade = 40;
  const makePng = () => sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 200, g: 60, b: (shade += 40) } } }).png().toBuffer();

  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4859';
  const { createServer } = await import('../src/server/index');
  const { app } = await createServer(home);
  const port = Number(process.env.FABRIKA_PORT);
  await app.listen({ port, host: '0.0.0.0' });
  const base = `http://127.0.0.1:${port}`;
  const api = async (method: string, url: string, b?: unknown) => {
    const r = await fetch(base + url, { method, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    return r.json() as Promise<any>;
  };
  const projectOf = async (id: string) => (await api('GET', `/api/projects/${id}`)).project;
  /** Telefonun yaptığı gibi: QR adresindeki sayfayı aç, aynı yoldan dosya gönder */
  const phoneUpload = async (qrUrl: string, name: string) => {
    const u = new URL(qrUrl);
    const local = `${base}${u.pathname}${u.search}`;
    const page = await (await fetch(local)).text();
    const fd = new FormData();
    fd.append('files', new Blob([new Uint8Array(await makePng())], { type: 'image/png' }), name);
    const up = await fetch(`${base}${u.pathname.replace('/m/', '/api/m/')}/upload${u.search}`, { method: 'POST', body: fd });
    return { page, status: up.status, body: (await up.json()) as { count: number } };
  };

  await runOk('npx', ['vite', 'build', '--config', 'web/vite.config.ts', '--logLevel', 'error']);
  const pw = createRequire(import.meta.url)('playwright');
  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  page.on('dialog', (d: any) => void d.accept());
  // Hata ayıklama: başarısız olursa son istekler yazdırılır
  const reqLog: string[] = [];
  page.on('requestfinished', async (r: any) => { if (r.url().includes('/api/projects/')) reqLog.push(`${(await r.response())?.status()} ${r.method()} ${r.url().replace(base, '')}`); });
  page.on('requestfailed', (r: any) => reqLog.push(`FAIL ${r.url().replace(base, '')} ${r.failure()?.errorText}`));
  page.on('console', (m: any) => m.type() === 'error' && reqLog.push(`console: ${m.text().slice(0, 160)}`));
  const focusedText = () => page.evaluate(() => (document.activeElement as HTMLElement | null)?.innerText?.trim() ?? '');
  const goHome = async () => {
    await page.goto(`${base}/#/`);
    await page.waitForSelector('[data-testid=last-project]');
  };

  try {
    // 1) Eski proje: son proje kartı ve açılış
    const old = (await api('GET', '/api/projects'))[0];
    await goHome();
    const card = await page.getByTestId('last-project').innerText();
    const cover = await page.locator('.last-cover').evaluate((el: HTMLElement) => getComputedStyle(el).backgroundImage);
    check('Son proje kartı: gerçek ad, tür, çıktı profilleri, son düzenleme, kapak', card.includes(old.name) && /Hızlı Edit|Stüdyo/.test(card) && /Story|Post|Reel|Yatay/.test(card) && /son düzenleme/.test(card) && /url\(/.test(cover), card.replace(/\n+/g, ' | ').slice(0, 140));
    await page.getByTestId('last-project').getByRole('link', { name: /Devam et/ }).click();
    await page.waitForFunction(() => /#\/(proje|studyo)\//.test(location.hash));
    await page.waitForSelector('.topbar, .qe-top, header', { timeout: 30000 });
    const hash1 = await page.evaluate(() => location.hash);
    await page.waitForTimeout(800);
    check('Eski proje ana sayfadan açıldı', hash1.includes(old.id) && !errors.length, hash1);

    // 2) Yeni proje → Hızlı Edit ve Kurgu Stüdyosu
    await goHome();
    await page.getByTestId('new-actions').getByRole('button', { name: /Instagram Hızlı Edit/ }).click();
    await page.getByTestId('new-quick').getByRole('textbox').fill('E2E Hızlı');
    await page.getByTestId('new-quick').getByRole('button', { name: 'Oluştur' }).click();
    await page.waitForFunction(() => location.hash.startsWith('#/proje/'));
    const quickId = (await page.evaluate(() => location.hash)).split('/')[2];
    await goHome();
    await page.getByTestId('new-actions').getByRole('button', { name: /Kurgu Stüdyosu/ }).click();
    await page.waitForFunction(() => location.hash.startsWith('#/studyo/'));
    const studioId = (await page.evaluate(() => location.hash)).split('/')[2];
    await page.waitForSelector('.topbar');
    const qp = await projectOf(quickId);
    const sp = await projectOf(studioId);
    await goHome();
    const quickCard = await page.locator(`[data-project="${quickId}"]`).innerText();
    const studioCard = await page.locator(`[data-project="${studioId}"]`).innerText();
    const quickHref = await page.locator(`[data-project="${quickId}"] a.card-link`).getAttribute('href');
    const studioHref = await page.locator(`[data-project="${studioId}"] a.card-link`).getAttribute('href');
    check(
      'Ana sayfadan tek tıkla: Instagram Hızlı Edit → #/proje (Story + post), Kurgu Stüdyosu → #/studyo; kartlarda tür doğru',
      qp.mode === 'quick' && sp.mode === 'studio' && /Instagram/.test(quickCard) && /Stüdyo/.test(studioCard) && quickHref === `#/proje/${quickId}` && studioHref === `#/studyo/${studioId}`,
      `${quickCard.split('\n')[0]} / ${studioCard.split('\n')[0]}`,
    );

    // 3) Arama ve sonuç yok
    const total = (await api('GET', '/api/projects')).length;
    await page.getByLabel('Projelerde ara').fill('e2e hız');
    const found = await page.locator('.project-card').count();
    await page.getByLabel('Projelerde ara').fill('zzzz-yok');
    const none = await page.getByTestId('no-results').innerText();
    await page.getByRole('button', { name: 'Aramayı temizle' }).last().click();
    const all = await page.locator('.project-card').count();
    check('Arama: adla süzme, “bulunamadı” durumu, temizleme', found === 1 && /“zzzz-yok” adında proje bulunamadı/.test(none) && all === total, `${found} / ${all} / ${total}`);

    // 4) Sabitle → yeniden yüklemeden sonra korunur; Sabitlenenler süzgeci
    await page.locator(`[data-project="${studioId}"]`).getByRole('button', { name: /Proje menüsü/ }).click();
    await page.getByRole('menuitem', { name: 'Sabitle' }).click();
    await page.waitForSelector(`[data-project="${studioId}"].pinned`);
    await page.reload();
    await page.waitForSelector('[data-testid=project-grid]');
    const firstAfter = await page.locator('.project-card').first().getAttribute('data-project');
    await page.getByRole('button', { name: /Sabitlenenler/ }).click();
    const pinnedIds = await page.locator('.project-card').evaluateAll((els: Element[]) => els.map((e) => e.getAttribute('data-project')));
    check('Sabitleme yeniden yüklemeden sonra korunuyor, en üstte; Sabitlenenler süzgeci', firstAfter === studioId && pinnedIds.length === 1 && pinnedIds[0] === studioId, `${pinnedIds.join(',')}`);
    await page.getByRole('button', { name: /Tümü/ }).click();

    // 5) Menüden yeniden adlandır ve sil (onaylı)
    await page.locator(`[data-project="${quickId}"]`).getByRole('button', { name: /Proje menüsü/ }).click();
    await page.getByRole('menuitem', { name: 'Yeniden adlandır' }).click();
    await page.getByLabel('Yeni proje adı').fill('E2E Hızlı (yeni ad)');
    await page.getByTestId('rename').getByRole('button', { name: 'Kaydet' }).click();
    await page.waitForSelector(`[data-project="${quickId}"]:has-text("E2E Hızlı (yeni ad)")`);
    const renamed = (await projectOf(quickId)).name;
    const tmp = (await api('POST', '/api/projects', { name: 'Silinecek', formats: [{ format: 'story' }] })).project.id;
    await page.reload();
    await page.waitForSelector(`[data-project="${tmp}"]`);
    await page.locator(`[data-project="${tmp}"]`).getByRole('button', { name: /Proje menüsü/ }).click();
    await page.getByRole('menuitem', { name: 'Sil' }).click();
    await page.waitForFunction((id: string) => !document.querySelector(`[data-project="${id}"]`), tmp);
    const left = (await api('GET', '/api/projects')).map((p: any) => p.id);
    check('Kart menüsü: yeniden adlandır ve sil (onay sorusuyla)', renamed === 'E2E Hızlı (yeni ad)' && !left.includes(tmp), renamed);

    // 6) Telefondan ekle: iki farklı proje
    await goHome();
    // a) “Başka bir mevcut proje” → eski proje
    await page.getByRole('button', { name: /^Telefondan ekle/ }).first().click();
    await page.getByTestId('phone-target').getByText('Başka bir mevcut proje').click();
    await page.screenshot({ path: path.join(work, 'telefon-hedef.png') });
    await page.getByLabel('Proje seç').selectOption(old.id);
    await page.getByRole('button', { name: /QR kodu göster/ }).click();
    await page.waitForSelector('[data-testid=phone-qr] .qr svg');
    const qrA = await page.locator('.qr-url').innerText();
    await page.screenshot({ path: path.join(work, 'telefon-qr.png') });
    const targetA = await page.getByTestId('phone-target-name').innerText();
    const panelA = await page.getByTestId('phone-qr').innerText();
    const beforeA = (await projectOf(old.id)).clips.length;
    const upA = await phoneUpload(qrA, 'telefon-a.png');
    await page.waitForSelector('[data-testid=phone-status]:has-text("1 dosya geldi")', { timeout: 30000 });
    const afterA = await projectOf(old.id);
    check(
      'QR hedef proje için: ad, aynı Wi-Fi uyarısı, sonraki adım; telefon sayfası projeyi adıyla gösteriyor',
      targetA === old.name && qrA.includes(`?p=${old.id}`) && /aynı Wi-Fi ağına/.test(panelA) && /Galeriden seç/.test(panelA) && upA.page.includes(old.name) && upA.status === 200,
      qrA,
    );
    // b) Son proje kartından → önceden seçili son proje (Stüdyo) — modal kapanınca son proje değişmedi mi?
    await page.getByRole('button', { name: 'Projeyi aç' }).click();
    await page.waitForFunction((id: string) => location.hash.includes(id), old.id);
    const openHash = await page.evaluate(() => location.hash);
    await goHome();
    // Son projeyi Stüdyo projesi yap
    await page.goto(`${base}/#/studyo/${studioId}`);
    await page.waitForSelector('.topbar');
    await goHome();
    await page.getByTestId('last-project').getByRole('button', { name: /telefondan ekle/i }).click();
    const preChecked = await page.getByTestId('phone-target').locator('input[type=radio]').first().isChecked();
    const preName = await page.getByTestId('phone-target').locator('.ptarget').first().innerText();
    await page.getByRole('button', { name: /QR kodu göster/ }).click();
    await page.waitForSelector('[data-testid=phone-qr] .qr svg');
    const qrB = await page.locator('.qr-url').innerText();
    await phoneUpload(qrB, 'telefon-b.png');
    await page.waitForSelector('[data-testid=phone-status]:has-text("1 dosya geldi")', { timeout: 30000 });
    const pB = await projectOf(studioId);
    const pA = await projectOf(old.id);
    const lib = await api('GET', '/api/library');
    const nameOf = (id: string) => lib.find((a: any) => a.id === id)?.name;
    check(
      'İki proje: A’ya giden dosya A’da, B’ye giden B’de; karışma yok',
      afterA.clips.length === beforeA + 1 && pA.clips.some((c: any) => nameOf(c.assetId) === 'telefon-a.png') && !pA.clips.some((c: any) => nameOf(c.assetId) === 'telefon-b.png') && pB.clips.some((c: any) => nameOf(c.assetId) === 'telefon-b.png') && !pB.clips.some((c: any) => nameOf(c.assetId) === 'telefon-a.png'),
      `A ${beforeA}→${pA.clips.length} · B ${pB.clips.length}`,
    );
    check('Son proje kartından açılınca son proje önceden seçili; “Projeyi aç” doğru düzenleyici', preChecked && preName.includes((await projectOf(studioId)).name) && openHash === `${old.editor === 'studio' ? '#/studyo/' : '#/proje/'}${old.id}`, `${openHash} · ${preName.replace(/\n/g, ' ')}`);
    await page.getByRole('button', { name: 'Projeyi aç' }).click();
    await page.waitForFunction((id: string) => location.hash === `#/studyo/${id}`, studioId);
    check('Stüdyo projesinde “Projeyi aç” Stüdyo’ya gidiyor', true);

    // c) Bağlantı hatası → hedef korunur, yeniden dene
    await goHome();
    let fail = true;
    await page.route('**/api/mobile?*', (route: any) => (fail ? route.abort() : route.continue()));
    await page.getByRole('button', { name: /^Telefondan ekle/ }).first().click();
    await page.getByRole('button', { name: /QR kodu göster/ }).click();
    await page.waitForSelector('[data-testid=phone-qr] .phone-err');
    const errName = await page.getByTestId('phone-target-name').innerText();
    fail = false;
    await page.getByRole('button', { name: 'Yeniden dene' }).click();
    await page.waitForSelector('[data-testid=phone-qr] .qr svg');
    const retryName = await page.getByTestId('phone-target-name').innerText();
    await page.unroute('**/api/mobile?*');
    check('Bağlantı hatasında hedef korunarak yeniden deneme', errName === retryName && retryName.length > 0, retryName);
    await page.keyboard.press('Escape');

    // d) Yeni proje hedefi; dosya gelmeden kapatılırsa boş proje kalmaz
    const n0 = (await api('GET', '/api/projects')).length;
    await page.getByRole('button', { name: /^Telefondan ekle/ }).first().click();
    await page.getByTestId('phone-target').getByText('Yeni proje', { exact: true }).click();
    await page.getByLabel('Yeni proje adı').fill('Telefondan yeni');
    await page.getByRole('button', { name: /QR kodu göster/ }).click();
    await page.waitForSelector('[data-testid=phone-qr] .qr svg');
    const n1 = (await api('GET', '/api/projects')).length;
    await page.getByTestId('phone-qr').getByRole('button', { name: 'Kapat' }).click();
    await page.waitForTimeout(500);
    const n2 = (await api('GET', '/api/projects')).length;
    check('Yeni proje hedefi oluşturulur; dosya gelmeden kapatılırsa silinir', n1 === n0 + 1 && n2 === n0, `${n0} → ${n1} → ${n2}`);

    // 7) Yardım: klavyeyle aç/kapa, odak geri döner
    await goHome();
    const guideBtn = page.getByRole('button', { name: 'Kullanım kılavuzu' });
    await guideBtn.focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid=guide]');
    const guideTxt = await page.getByTestId('guide').innerText();
    await page.getByRole('button', { name: /Cümleyi kes ile Altyazıyı düzelt farkı/ }).click();
    await page.screenshot({ path: path.join(work, 'kilavuz.png') });
    const diffTxt = await page.getByTestId('guide').innerText();
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=guide]', { state: 'detached' });
    const backToGuide = await focusedText();
    const scBtn = page.getByRole('button', { name: 'Stüdyo kısayolları' });
    await scBtn.focus();
    await page.keyboard.press('Space');
    await page.waitForSelector('[data-testid=shortcuts]');
    const scTxt = await page.getByTestId('shortcuts').innerText();
    await page.screenshot({ path: path.join(work, 'kisayollar.png') });
    await page.keyboard.press('Escape');
    await page.waitForSelector('[data-testid=shortcuts]', { state: 'detached' });
    const backToSc = await focusedText();
    await page.locator('body').click({ position: { x: 5, y: 5 } });
    await page.keyboard.press('?');
    const qOpen = await page.getByTestId('shortcuts').isVisible();
    await page.keyboard.press('Escape');
    check(
      'Kılavuz ve kısayollar: klavyeyle açılır, Esc ile kapanır, odak açan düğmeye döner; “?” kısayolu',
      /Telefondan medya ekleme/.test(guideTxt) && /Instagram Hızlı Edit ile çıktı alma/.test(guideTxt) && /Galeriden seç/.test(guideTxt) && /Video süresi değişmez/.test(diffTxt) && backToGuide === 'Kullanım kılavuzu' && backToSc === 'Stüdyo kısayolları' && qOpen && /Giriş işareti/.test(scTxt) && /İmleçte böl/.test(scTxt) && /Bir kare geri/.test(scTxt) && /Geri al/.test(scTxt),
      `${backToGuide} / ${backToSc}`,
    );

    // 8) Kısayollar Stüdyo'da gerçekten çalışıyor: I, →, O, S, ⌘Z
    await page.goto(`${base}/#/studyo/${old.id}`);
    await page.waitForSelector('.tl-item.clip');
    await page.locator('body').click({ position: { x: 700, y: 40 } }).catch(() => undefined);
    const frameNow = () => page.evaluate(() => (document.querySelector('.transport') as HTMLElement)?.innerText ?? '');
    const t0f = await frameNow();
    for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
    const t1f = await frameNow();
    const clips0 = (await projectOf(old.id)).clips.length;
    await page.keyboard.press('s');
    await page.waitForFunction(async () => true);
    await page.waitForTimeout(800);
    const clips1 = (await projectOf(old.id)).clips.length;
    await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
    await page.waitForTimeout(800);
    const clips2 = (await projectOf(old.id)).clips.length;
    await page.keyboard.press('i');
    await page.keyboard.press('Shift+ArrowRight');
    await page.keyboard.press('o');
    const marks = (await page.locator('.tl-marks-info').innerText().catch(() => '')).includes('sil') ? 1 : 0;
    check('Stüdyo’da kısayollar: → kare ilerler, S böler, ⌘Z geri alır, I/O işaretler', t0f !== t1f && clips1 === clips0 + 1 && clips2 === clips0 && marks > 0, `${t0f.split('\n').pop()} → ${t1f.split('\n').pop()} · klip ${clips0}→${clips1}→${clips2} · işaret ${marks}`);

    // 9) Marka kampanyası: “Marka oluştur” pencereyi kapatır; boş proje oluşmaz
    await goHome();
    const c0 = (await api('GET', '/api/projects')).length;
    await page.getByTestId('new-actions').getByRole('button', { name: /Marka kampanyası/ }).click();
    await page.waitForSelector('[data-testid=campaign]');
    await page.getByRole('button', { name: /Marka oluştur/ }).click();
    const campaignGone = (await page.locator('[data-testid=campaign]').count()) === 0;
    const brandsOpen = await page.getByRole('dialog', { name: 'Markalar' }).isVisible();
    await page.getByRole('dialog', { name: 'Markalar' }).getByRole('button', { name: 'Kapat' }).click();
    await page.waitForTimeout(300);
    const dialogs = await page.getByRole('dialog').count();
    const c1 = (await api('GET', '/api/projects')).length;
    check('Marka kampanyası: “Marka oluştur” pencereyi kapatıp Markalar’ı açar; X ile çıkınca pencere geri açılmaz; boş proje yok', campaignGone && brandsOpen && dialogs === 0 && c1 === c0, `${c0} → ${c1}`);

    // 10) Dar ekran
    await page.setViewportSize({ width: 390, height: 844 });
    await goHome();
    const layout = await page.evaluate(() => {
      const cards = [...document.querySelectorAll('.project-card')].map((c) => c.getBoundingClientRect());
      const acts = [...document.querySelectorAll('.home-action')].map((c) => c.getBoundingClientRect());
      return { overflow: document.documentElement.scrollWidth - window.innerWidth, oneCol: cards.every((r, i) => i === 0 || r.top > cards[i - 1].top), actionsStack: acts.every((r, i) => i === 0 || r.top > acts[i - 1].top), widths: cards.map((r) => Math.round(r.width)) };
    });
    await page.screenshot({ path: path.join(work, 'dar-ekran.png'), fullPage: true });
    check('Dar ekran (390 px): eylemler ve kartlar alt alta, yatay kaydırma yok', layout.overflow <= 0 && layout.oneCol && layout.actionsStack, JSON.stringify(layout));
    await page.setViewportSize({ width: 1440, height: 940 });
    await goHome();
    await page.screenshot({ path: path.join(work, 'ana-sayfa.png') });
    const heights = await page.locator('.project-card').evaluateAll((els: Element[]) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    check('Geniş ekranda kartlar derli toplu (yükseklik < 320 px)', heights.every((h: number) => h < 320), heights.join(','));
    check('Sayfada hata yok', !errors.length, errors.join(' | '));
  } catch (e) {
    await page.screenshot({ path: path.join(work, 'hata.png') }).catch(() => undefined);
    console.log(reqLog.slice(-25).join('\n'));
    console.log('hash', await page.evaluate(() => location.hash).catch(() => ''));
    check('Test akışı tamamlandı', false, (e as Error).message.split('\n')[0]);
  } finally {
    await browser.close();
    await app.close();
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} kontrol geçti · ${Math.round((Date.now() - t0) / 1000)} sn`);
  process.exit(ok === results.length ? 0 : 1);
};

void main();
