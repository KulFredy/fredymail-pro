/**
 * Faz 7 kabul testi: onaylı paketten YouTube'a doğrudan yayın (sahte Google sunucusuyla).
 *  - OAuth: masaüstü istemcisi, geri dönüş bu Mac, PKCE (S256) doğrulanır; yenileme belirteci kasada.
 *  - Önizleme engelleri: onaysız paket, bağlı olmayan hesap; açık onay olmadan yükleme yok.
 *  - Yükleme: resumable (üst veri + dosya baytları), küçük resim, SRT altyazı, durum (işleniyor → hazır).
 *  - Aynı paket öğesi ikinci kez yüklenmez; kota hatası Türkçe; belirteçler sayfaya/dosyalara sızmaz.
 * Gerçek YouTube hesabıyla doğrulanmadı (kullanıcının Google Cloud istemcisi gerekir).
 * Çalıştırma: npm run e2e:yayin
 */
import { createHash } from 'node:crypto';
import { createServer as httpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createRequire } from 'node:module';
import { mkdir, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runOk } from '../src/media/proc';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const ff = (args: string[]) => runOk('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);

const SECRET = { client: '1234-abc.apps.googleusercontent.com', secret: 'GOCSPX-GIZLI-istemci', refresh: '1//GIZLI-yenileme-belirteci', access: 'ya29.GIZLI-erisim' };

const main = async () => {
  const t0 = Date.now();
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'yayin') : path.join(os.tmpdir(), 'fabrika-yayin');
  const home = path.join(work, 'ev');
  const media = path.join(work, 'medya');
  await rm(work, { recursive: true, force: true });
  await mkdir(media, { recursive: true });
  await ff([
    '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=30:duration=3',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(media, 'klip.mp4'),
  ]);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(media, 'klip.mp4.words.json'), JSON.stringify([{ t0: 0.2, t1: 0.8, text: 'Merhaba' }, { t0: 0.8, t1: 1.6, text: 'YouTube.' }]));

  // ---- Sahte Google ----
  const seen = { challenge: '', verifierOk: false, tokenCalls: 0, uploads: [] as any[], bytes: 0, thumbs: 0, captions: '' as string, statusCalls: 0, quota: false, authHeaders: new Set<string>() };
  const body = (req: IncomingMessage) => new Promise<Buffer>((r) => { const c: Buffer[] = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });
  const json = (res: ServerResponse, code: number, o: unknown, h: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...h }); res.end(JSON.stringify(o)); };
  const authOk = (req: IncomingMessage) => { seen.authHeaders.add(String(req.headers.authorization)); return req.headers.authorization === `Bearer ${SECRET.access}`; };
  const mock = httpServer(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/token') {
      seen.tokenCalls++;
      const f = new URLSearchParams((await body(req)).toString());
      if (f.get('client_id') !== SECRET.client || f.get('client_secret') !== SECRET.secret) return json(res, 401, { error: 'invalid_client' });
      if (f.get('grant_type') === 'authorization_code') {
        seen.verifierOk = createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url') === seen.challenge && f.get('code') === 'KOD-1';
        if (!seen.verifierOk) return json(res, 400, { error: 'invalid_grant' });
        return json(res, 200, { access_token: SECRET.access, refresh_token: SECRET.refresh, expires_in: 3599, token_type: 'Bearer' });
      }
      if (f.get('grant_type') === 'refresh_token' && f.get('refresh_token') === SECRET.refresh) return json(res, 200, { access_token: SECRET.access, expires_in: 3599 });
      return json(res, 400, { error: 'invalid_grant' });
    }
    if (!authOk(req)) return json(res, 401, { error: { code: 401, message: 'Invalid Credentials', errors: [{ reason: 'authError' }] } });
    if (u.pathname === '/youtube/v3/channels') return json(res, 200, { items: [{ id: 'UC123', snippet: { title: 'Köşe Kahve TV' } }] });
    if (u.pathname === '/upload/youtube/v3/videos' && req.method === 'POST') {
      if (seen.quota) return json(res, 403, { error: { code: 403, message: 'The request cannot be completed because you have exceeded your quota.', errors: [{ reason: 'quotaExceeded' }] } });
      const meta = JSON.parse((await body(req)).toString('utf8'));
      seen.uploads.push({ q: Object.fromEntries(u.searchParams), meta, len: req.headers['x-upload-content-length'], type: req.headers['x-upload-content-type'] });
      return json(res, 200, {}, { location: `http://127.0.0.1:4898/oturum/${seen.uploads.length}` });
    }
    if (u.pathname.startsWith('/oturum/') && req.method === 'PUT') {
      const b = await body(req);
      seen.bytes += b.length;
      return json(res, 200, { id: 'VID123', kind: 'youtube#video' });
    }
    if (u.pathname === '/upload/youtube/v3/thumbnails/set') {
      const b = await body(req);
      if (u.searchParams.get('videoId') === 'VID123' && req.headers['content-type'] === 'image/jpeg' && b[0] === 0xff && b[1] === 0xd8) seen.thumbs++;
      return json(res, 200, { items: [] });
    }
    if (u.pathname === '/upload/youtube/v3/captions') {
      seen.captions = (await body(req)).toString('utf8');
      return json(res, 200, { id: 'CAP1' });
    }
    if (u.pathname === '/youtube/v3/videos') {
      seen.statusCalls++;
      const done = seen.statusCalls > 1;
      return json(res, 200, { items: [{ id: 'VID123', status: { uploadStatus: done ? 'processed' : 'uploaded', privacyStatus: 'private' }, processingDetails: { processingStatus: done ? 'succeeded' : 'processing' } }] });
    }
    json(res, 404, { error: 'yok' });
  });
  await new Promise<void>((r) => mock.listen(4898, '127.0.0.1', r));
  process.env.FABRIKA_GOOGLE_AUTH_URL = 'http://127.0.0.1:4898/auth';
  process.env.FABRIKA_GOOGLE_TOKEN_URL = 'http://127.0.0.1:4898/token';
  process.env.FABRIKA_YOUTUBE_URL = 'http://127.0.0.1:4898';
  process.env.FABRIKA_SECRETS_FILE = path.join(home, 'gizli.json');
  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4858';
  process.env.FABRIKA_TRANSCRIBER = 'fixture';
  process.env.FABRIKA_FIXTURES = media;
  const logs: string[] = [];
  const origErr = console.error;
  const origLog = console.log;
  console.error = (...a: unknown[]) => (logs.push(a.map(String).join(' ')), origErr(...a));
  const { createServer } = await import('../src/server/index');
  const { app } = await createServer(home);
  const port = Number(process.env.FABRIKA_PORT);
  await app.listen({ port, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${port}`;
  const responses: string[] = [];
  const call = async (method: string, url: string, b?: unknown) => {
    const r = await fetch(base + url, { method, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined, redirect: 'manual' });
    const t = await r.text();
    responses.push(t, r.headers.get('location') ?? '');
    let j: any = null;
    try {
      j = t ? JSON.parse(t) : null;
    } catch {
      j = t;
    }
    return { status: r.status, j, location: r.headers.get('location') };
  };
  const api = async (method: string, url: string, b?: unknown) => {
    const r = await call(method, url, b);
    if (r.status >= 400) throw new Error(`${method} ${url}: ${r.j?.error ?? r.status}`);
    return r.j;
  };
  const waitJob = async (id: string, ms = 300_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const j = (await api('GET', '/api/jobs')).find((x: any) => x.id === id);
      if (j?.status === 'done') return j;
      if (j?.status === 'error') return j;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error('iş zaman aşımı');
  };

  try {
    const st = await api('POST', '/api/projects', { name: 'Yayın testi', formats: [{ format: 'landscape' }] });
    const pid = st.project.id;
    const imp = await api('POST', '/api/import/paths', { projectId: pid, paths: [path.join(media, 'klip.mp4')] });
    const end = Date.now() + 120_000;
    while (Date.now() < end) {
      const a = (await api('GET', '/api/library')).find((x: any) => x.id === imp.assets[0].id);
      if (a?.status === 'ready' && a.transcript.status === 'done') break;
      await new Promise((r) => setTimeout(r, 400));
    }
    let p = (await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'output.addChannel', channel: 'yt-video' }] })).project;
    const yt = p.outputs[0];
    p = (await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'output.update', outputId: yt.id, patch: { meta: { title: 'Yayın testi videosu', description: 'Açıklama', tags: ['kahve', 'test'] }, cover: { at: 1 } } }] })).project;
    const job = await api('POST', `/api/projects/${pid}/paket`, { outputIds: [yt.id] });
    const pkg = (await waitJob(job.id)).result;

    // 1) Önizleme engelleri
    let pv = await api('GET', `/api/projects/${pid}/yayin/onizleme?pkgId=${pkg.id}&outputId=${yt.id}`);
    check('Önizleme: onaysız paket ve bağlı olmayan hesap engel', pv.blockers.some((b: string) => /onaylanmadı/.test(b)) && pv.blockers.some((b: string) => /bağlı değil/.test(b)), pv.blockers.join(' | '));

    // 2) Bağlantı: istemci + OAuth (PKCE)
    const setc = await api('PUT', '/api/connections/youtube', { key: `${SECRET.client}:${SECRET.secret}` });
    const redirect = await call('GET', '/api/youtube/baglan');
    const loc = new URL(redirect.location ?? 'http://x/');
    seen.challenge = loc.searchParams.get('code_challenge') ?? '';
    check(
      'OAuth adresi: masaüstü istemcisi, bu Mac’e dönüş, PKCE S256, çevrimdışı erişim, yükleme + altyazı izni',
      redirect.status === 302 && loc.searchParams.get('client_id') === SECRET.client && loc.searchParams.get('redirect_uri') === `${base}/api/youtube/callback` && loc.searchParams.get('code_challenge_method') === 'S256' && loc.searchParams.get('access_type') === 'offline' && /youtube\.upload/.test(loc.searchParams.get('scope') ?? '') && /force-ssl/.test(loc.searchParams.get('scope') ?? '') && !setc.status.ok,
      `${setc.status.detail}`,
    );
    const bad = await call('GET', `/api/youtube/callback?code=KOD-1&state=yanlis`);
    const cb = await call('GET', `/api/youtube/callback?code=KOD-1&state=${loc.searchParams.get('state')}`);
    const conns = await api('GET', '/api/connections?test=1');
    const yc = conns.find((c: any) => c.id === 'youtube');
    check('Geri dönüş: belirteç alındı (PKCE doğrulandı), yanlış state reddedildi, kanal adı görünüyor', seen.verifierOk && bad.status >= 400 && cb.status === 200 && /Köşe Kahve TV/.test(String(cb.j)) && /Köşe Kahve TV/.test(yc.status.detail), yc.status.detail);
    const gizli = JSON.parse(await readFile(path.join(home, 'gizli.json'), 'utf8'));
    check('Yenileme belirteci ve istemci kasada (gizli dosya 600)', gizli['youtube-token'] === SECRET.refresh && gizli.youtube.endsWith(SECRET.secret) && ((await stat(path.join(home, 'gizli.json'))).mode & 0o777) === 0o600);

    // 3) Onaysız / onaysız yayın isteği
    const noConfirm = await call('POST', `/api/projects/${pid}/yayin`, { pkgId: pkg.id, outputId: yt.id, privacy: 'private', confirm: false });
    const unapproved = await call('POST', `/api/projects/${pid}/yayin`, { pkgId: pkg.id, outputId: yt.id, privacy: 'private', confirm: true });
    check('Açık onay olmadan ve onaysız pakette yükleme yapılmaz', noConfirm.status === 400 && unapproved.status === 409 && seen.uploads.length === 0, `${noConfirm.status} / ${unapproved.status}`);
    await api('POST', `/api/projects/${pid}/paketler/${pkg.id}/onayla`);
    pv = await api('GET', `/api/projects/${pid}/yayin/onizleme?pkgId=${pkg.id}&outputId=${yt.id}`);
    check('Önizleme: kanal, dosya, başlık, etiket, kapak, altyazı; engel yok', !pv.blockers.length && pv.channel?.title === 'Köşe Kahve TV' && pv.title === 'Yayın testi videosu' && pv.tags.join(',') === 'kahve,test' && pv.cover && pv.captions && pv.file.size > 0, `${pv.file?.name} ${pv.file?.size} bayt`);

    // 4) Yayın
    const pubRes = await api('POST', `/api/projects/${pid}/yayin`, { pkgId: pkg.id, outputId: yt.id, privacy: 'unlisted', madeForKids: false, containsSyntheticMedia: true, confirm: true });
    const pj = await waitJob(pubRes.job.id);
    const up = seen.uploads[0];
    check(
      'Yükleme: resumable üst veri (başlık, etiket, Türkçe, liste dışı, çocuklara yönelik değil, sentetik içerik beyanı)',
      pj.status === 'done' && up?.q.uploadType === 'resumable' && up.q.part === 'snippet,status' && up.meta.snippet.title === 'Yayın testi videosu' && up.meta.snippet.tags.join(',') === 'kahve,test' && up.meta.snippet.defaultLanguage === 'tr' && up.meta.status.privacyStatus === 'unlisted' && up.meta.status.selfDeclaredMadeForKids === false && up.meta.status.containsSyntheticMedia === true,
      `${pj.status} ${pj.error ?? ''}`,
    );
    check('Dosyanın tüm baytları, küçük resim (JPEG) ve SRT altyazı gönderildi', seen.bytes === pv.file.size && Number(up.len) === pv.file.size && seen.thumbs === 1 && /"videoId":"VID123"/.test(seen.captions) && /00:00:00,200 --> /.test(seen.captions) && /Merhaba YouTube\./.test(seen.captions), `${seen.bytes} bayt`);
    let pubs = await api('GET', `/api/projects/${pid}/yayinlar`);
    let pub = pubs[0];
    pub = await api('POST', `/api/projects/${pid}/yayinlar/${pub.id}/durum`);
    check('Durum: işleniyor → hazır; bağlantı adresi', pub.status === 'hazir' && pub.url === 'https://youtu.be/VID123' && pub.steps.video && pub.steps.thumbnail && pub.steps.captions, `${pub.status} ${pub.url}`);

    // 5) İkinci kez gönderme yinelenmez
    const again = await api('POST', `/api/projects/${pid}/yayin`, { pkgId: pkg.id, outputId: yt.id, privacy: 'public', madeForKids: false, containsSyntheticMedia: false, confirm: true });
    check('Aynı paket öğesi ikinci kez yüklenmez', again.job === null && again.pub.id === pub.id && seen.uploads.length === 1);

    // 6) Kota hatası
    seen.quota = true;
    const pkg2 = (await waitJob((await api('POST', `/api/projects/${pid}/paket`, { outputIds: [yt.id] })).id)).result;
    await api('POST', `/api/projects/${pid}/paketler/${pkg2.id}/onayla`);
    const q = await api('POST', `/api/projects/${pid}/yayin`, { pkgId: pkg2.id, outputId: yt.id, privacy: 'private', madeForKids: false, containsSyntheticMedia: false, confirm: true });
    const qj = await waitJob(q.job.id);
    pubs = await api('GET', `/api/projects/${pid}/yayinlar`);
    check('Kota hatası Türkçe ve kayıtta', qj.status === 'error' && /kota/.test(qj.error) && pubs[0].status === 'hata', qj.error);

    // 7) Arayüz
    const pw = (() => {
      try {
        return createRequire(import.meta.url)('playwright');
      } catch {
        return null;
      }
    })();
    if (pw) {
      await runOk('npx', ['vite', 'build', '--config', 'web/vite.config.ts', '--logLevel', 'error']);
      const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
      const page = await browser.newPage({ viewport: { width: 1512, height: 950 } });
      const errors: string[] = [];
      page.on('pageerror', (e: Error) => errors.push(e.message));
      try {
        await page.goto(`${base}/#/studyo/${pid}`);
        await page.getByRole('button', { name: /Deliver/ }).click();
        await page.waitForSelector('[data-testid=packages] .dl-pkg');
        const linkTxt = await page.locator('[data-testid=yt-pub]').filter({ hasText: 'youtu.be' }).first().innerText();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: 'Bağlantılar' }).first().click();
        await page.waitForSelector('[data-conn=youtube] .conn-state');
        await page.waitForFunction(() => !document.querySelector('.conn-list .spin'));
        const ytTxt = await page.locator('[data-conn=youtube]').innerText();
        const html = await page.content();
        check('Arayüz: pakette YouTube bağlantısı, Bağlantılar’da kanal; belirteç sayfada yok', /youtu\.be\/VID123|YouTube’da/.test(linkTxt) && /Köşe Kahve TV/.test(ytTxt) && !html.includes(SECRET.refresh) && !html.includes(SECRET.secret) && !errors.length, `${linkTxt.replace(/\n/g, ' ')} | ${errors.join(' ')}`);
      } catch (e) {
        await page.screenshot({ path: path.join(work, 'arayuz-hata.png') }).catch(() => undefined);
        check('Arayüz akışı tamamlandı', false, (e as Error).message.split('\n')[0]);
      } finally {
        await browser.close();
      }
    }

    // 8) Sızıntı taraması
    const files: string[] = [];
    const walk = async (d: string) => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) await walk(f);
        else if (/\.(json|jsonl|txt|srt|vtt)$/.test(e.name) && e.name !== 'gizli.json') files.push(f);
      }
    };
    await walk(home);
    const leaks: string[] = [];
    for (const f of files) {
      const t = await readFile(f, 'utf8');
      if ([SECRET.refresh, SECRET.secret, SECRET.access].some((s) => t.includes(s))) leaks.push(path.relative(home, f));
    }
    const respLeak = responses.some((t) => [SECRET.refresh, SECRET.secret, SECRET.access].some((s) => t.includes(s)));
    const logLeak = logs.some((t) => [SECRET.refresh, SECRET.secret, SECRET.access].some((s) => t.includes(s)));
    check('Belirteç ve gizli anahtar dosyalarda, yanıtlarda ve loglarda yok', !leaks.length && !respLeak && !logLeak, `${files.length} dosya tarandı ${leaks.join(',')}`);

    // 9) Bağlantıyı kes
    await api('DELETE', '/api/youtube/baglanti');
    pv = await api('GET', `/api/projects/${pid}/yayin/onizleme?pkgId=${pkg2.id}&outputId=${yt.id}`);
    check('Hesap bağlantısı kesilince yayın engelleniyor', pv.blockers.some((b: string) => /bağlı değil/.test(b)));
  } catch (e) {
    check('Test akışı tamamlandı', false, (e as Error).message);
  } finally {
    console.error = origErr;
    console.log = origLog;
    await app.close();
    mock.close();
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} kontrol geçti · ${Math.round((Date.now() - t0) / 1000)} sn`);
  process.exit(ok === results.length ? 0 : 1);
};

void main();
