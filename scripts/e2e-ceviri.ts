/**
 * Konuşma dili + altyazı çevirisi kabul testi (sahte Claude, sahte konuşma çözücü):
 *  - Konuşma dili seçilip yeniden çözülür (İngilizce); transkript ve dil etiketi güncellenir.
 *  - Çeviri: önce satır sayısı ve tahmini maliyet, onayla çevir → altyazı izi ve kanal kontrolleri çeviriyi kullanır,
 *    transkript orijinal kalır; satır düzeltme; orijinale dön; ⌘Z.
 *  - Komut paneline “altyazıyı Türkçeye çevir” yazınca Claude komutu yerine çeviri paneli açılır.
 *  - Claude'a giden istekte video/ses yok, marka adları korunması istenir; anahtar sayfada görünmez.
 * Çalıştırma: npm run e2e:ceviri
 */
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';
import http from 'node:http';
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
const KEY = 'sk-ant-test-ceviri-0123456789';

const main = async () => {
  const t0 = Date.now();
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'ceviri') : path.join(os.tmpdir(), 'fabrika-ceviri');
  const home = path.join(work, 'ev');
  const fixtures = path.join(work, 'konusma');
  await rm(work, { recursive: true, force: true });
  await mkdir(fixtures, { recursive: true });
  await cp(path.join(ROOT, 'tests', 'fixtures', 'eski-ev'), home, { recursive: true });
  // Yeniden çözümde “İngilizce” konuşma (sahte çözücü dosyası)
  const en = ['No', 'need', 'to', 'rebalance.', 'Just', 'shoot', 'with', 'Weebill', '5.'];
  await writeFile(path.join(fixtures, 'konusma.mp4.words.json'), JSON.stringify(en.map((text, i) => ({ text, t0: 0.5 + i * 0.6, t1: 0.5 + i * 0.6 + 0.45, p: 0.95 }))));

  // Sahte Claude
  const calls: any[] = [];
  const mock = http.createServer(async (req, res) => {
    let raw = '';
    for await (const c of req) raw += c;
    if (req.url?.startsWith('/v1/messages') && req.method === 'POST') {
      if (req.headers['x-api-key'] !== KEY && req.headers.authorization !== `Bearer ${KEY}`) return res.writeHead(401).end('{"type":"error","error":{"type":"authentication_error","message":"bad"}}');
      const b = JSON.parse(raw);
      calls.push(b);
      const lines = JSON.parse(String(b.messages[0].content).split('\n').slice(2).join('\n')) as { i: number; metin: string }[];
      const satirlar = lines.map((l) => ({ i: l.i, metin: l.metin.replace('No need to rebalance.', 'Yeniden dengelemeye gerek yok.').replace('Just shoot with Weebill 5.', 'Weebill 5 ile hemen çek.') }));
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(
        JSON.stringify({
          id: 'msg_1', type: 'message', role: 'assistant', model: b.model, stop_reason: 'tool_use', stop_sequence: null,
          content: [{ type: 'tool_use', id: 'tu_1', name: 'altyazi_cevirisi', input: { kaynakDil: 'en', satirlar, not: '' } }],
          usage: { input_tokens: 700, output_tokens: 90, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }),
      );
    }
    res.writeHead(404).end('{}');
  });
  await new Promise<void>((r) => mock.listen(4901, '127.0.0.1', r));
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:4901';
  delete process.env.ANTHROPIC_API_KEY;
  await writeFile(path.join(home, 'ayarlar.json'), JSON.stringify({ anthropicApiKey: KEY, aiModel: 'claude-opus-5-5' }));
  process.env.FABRIKA_SECRETS_FILE = path.join(home, 'gizli.json');
  process.env.FABRIKA_TRANSCRIBER = 'fixture';
  process.env.FABRIKA_FIXTURES = fixtures;
  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4865';

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
  const waitFor = async (fn: () => Promise<boolean>, ms = 15000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn()) return true;
      await new Promise((r) => setTimeout(r, 200));
    }
    return false;
  };

  const pid = (await api('POST', '/api/projects', { name: 'Çeviri testi', formats: [{ format: 'reel' }], mode: 'studio' })).project.id as string;
  await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'clips.add', assetIds: [VIDEO] }, { type: 'output.addChannel', channel: 'ig-reels' }] });

  await runOk('npx', ['vite', 'build', '--config', 'web/vite.config.ts', '--logLevel', 'error']);
  const pw = createRequire(import.meta.url)('playwright');
  const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 940 } });
  const errors: string[] = [];
  page.on('pageerror', (e: Error) => errors.push(e.message));
  try {
    await page.goto(`${base}/#/studyo/${pid}`);
    await page.getByRole('tab', { name: 'Transcript' }).click();
    await page.waitForSelector('[data-testid=speech-lang]');

    // 1) Konuşma dili: İngilizce seçip yeniden çöz
    const before = await page.getByTestId('speech-lang').first().innerText();
    await page.getByTestId('speech-lang').first().getByLabel('Konuşma dili').selectOption('en');
    await page.getByTestId('speech-lang').first().getByRole('button', { name: 'Yeniden çöz' }).click();
    const okLang = await waitFor(async () => {
      const a = (await api('GET', `/api/assets/${VIDEO}`)) as any;
      return a.transcript.status === 'done' && a.transcript.language === 'en' && a.transcript.words[0]?.text === 'No';
    });
    await page.waitForSelector('[data-testid=speech-lang]:has-text("İngilizce")', { timeout: 15000 });
    await page.waitForSelector('.tr-sen:has-text("No need to rebalance.")', { timeout: 15000 });
    check('Konuşma dili seçilip yeniden çözüldü: İngilizce transkript ve etiket', okLang && /Türkçe/.test(before), before.replace(/\n/g, ' '));

    // 2) Çeviri: tahmin → onay → altyazı Türkçe, transkript İngilizce
    await page.getByTestId('caption-translate').getByRole('button', { name: /Türkçe altyazı yap/ }).click();
    await page.waitForSelector('[data-testid=translate-estimate]');
    const est = await page.getByTestId('translate-estimate').innerText();
    check('Önce satır sayısı, tahmini maliyet ve gönderilen veri gösteriliyor', /2 altyazı satırı/.test(est) && /\$0\.\d{3}/.test(est) && /video veya ses gönderilmez/.test(est) && calls.length === 0, est.replace(/\n+/g, ' | '));
    await page.getByRole('button', { name: 'Onayla ve çevir' }).click();
    const okTr = await waitFor(async () => !!(await projectOf(pid)).captions.translation);
    const p1 = await projectOf(pid);
    await page.waitForSelector('.tl-item.caption:has-text("Yeniden dengelemeye")', { timeout: 15000 });
    const trText = await page.locator('.tr-list').innerText();
    check(
      'Onaylayınca çeviri uygulandı: altyazı izi Türkçe, transkript İngilizce kaldı',
      okTr && p1.captions.translation.lang === 'tr' && p1.captions.translation.from === 'en' && /No need to rebalance/.test(trText),
      JSON.stringify(p1.captions.translation.byAsset[VIDEO].map((s: any) => s.text)),
    );
    const sys = String(calls[0]?.system ?? '');
    const msg = JSON.stringify(calls[0]?.messages ?? '');
    check('Claude isteği: yalnız metin, satır numaralı; video/ses yok', calls.length === 1 && /Türkçe/.test(sys) && !/base64|\.mp4|image|audio/.test(msg) && /No need to rebalance/.test(msg));

    // 3) Kanal kontrolü ve paket altyazısı çeviriyi kullanır
    const reels = p1.outputs.find((o: any) => o.channel === 'ig-reels');
    const ck = await api('GET', `/api/projects/${pid}/kontrol`);
    const rows = JSON.stringify(ck);
    check('Teslim kontrolü çeviriyi görüyor (emin olunamayan kelime uyarısı yok)', !/emin olunamadı/.test(rows) && !!reels, rows.slice(0, 160));

    // 4) Satır düzelt → editTranslation; orijinale dön; ⌘Z
    const line2 = page.getByLabel('Çeviri satırı 2');
    if (!(await line2.isVisible())) await page.locator('.ctr-lines summary').click();
    await line2.fill('Weebill 5 ile anında çek.');
    await line2.press('Enter');
    const okEdit = await waitFor(async () => (await projectOf(pid)).captions.translation.byAsset[VIDEO][1].text === 'Weebill 5 ile anında çek.');
    await page.getByRole('button', { name: /Orijinale dön/ }).click();
    const okBack = await waitFor(async () => (await projectOf(pid)).captions.translation === null);
    await page.keyboard.press('Control+z');
    const okUndo = await waitFor(async () => !!(await projectOf(pid)).captions.translation);
    check('Satır düzeltme, “Orijinale dön” ve ⌘Z çalışıyor', okEdit && okBack && okUndo);

    // 5) Komut paneli: çeviri isteği Claude komutuna değil çeviri paneline gider
    const nCalls = calls.length;
    await page.getByRole('tab', { name: 'Command' }).click().catch(() => undefined);
    const box = page.locator('textarea').first();
    await box.fill('videonun dili ingilizce, altyazıyı türkçeye çevir');
    await box.press('Enter');
    await page.waitForSelector('[data-testid=translate-estimate]', { timeout: 15000 });
    check('Komut “altyazıyı türkçeye çevir” → çeviri paneli maliyetle açıldı, Claude komutu çağrılmadı', calls.length === nCalls);

    const html = await page.content();
    check('Anahtar sayfada yok', !html.includes(KEY));
    check('Sayfada hata yok', !errors.length, errors.join(' | '));
  } catch (e) {
    check('Test akışı tamamlandı', false, (e as Error).message.split('\n')[0]);
    console.log('toast:', await page.locator('.toast').allInnerTexts().catch(() => []), 'claude çağrısı:', calls.length);
    await page.screenshot({ path: path.join(work, 'hata.png') }).catch(() => undefined);
  } finally {
    await browser.close();
    await app.close();
    mock.close();
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(`${ok}/${results.length} kontrol geçti · ${Math.round((Date.now() - t0) / 1000)} sn`);
  process.exit(ok === results.length ? 0 : 1);
};
void main();
