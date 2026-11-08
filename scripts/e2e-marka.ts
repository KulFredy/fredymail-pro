/**
 * Faz 6 kabul testi: marka → ürün → kampanya → kanal paketi → onay.
 *  - Marka profili kaydı (logo, renkler, yazı tipleri, ürün, kanallar); aynı ad reddedilir.
 *  - Markayı projeye uygulama planı (logo, altyazı, yazı, kanallar), ikinci kez uygulamak boş.
 *  - Teslim kontrolleri: ürün adı yanlış yazımı yakalanır, düzeltince geçer; boş başlık, kapak uyarısı.
 *  - Yerel metin önerisi; YouTube küçük resmi 1280×720 başlıklı; Shorts'ta altyazı görüntüde, YouTube'da .srt dosyasında.
 *  - Ses yüksekliği ölçülür; metinler.txt, kontrol.txt, zip; onaylanan paket teslim/marka/ürün/kampanya altında.
 * Çalıştırma: npm run e2e:marka
 */
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { runOk } from '../src/media/proc';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const ff = (args: string[]) => runOk('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);

const main = async () => {
  const t0 = Date.now();
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'marka') : path.join(os.tmpdir(), 'fabrika-marka');
  const home = path.join(work, 'ev');
  const media = path.join(work, 'medya');
  await rm(work, { recursive: true, force: true });
  await mkdir(media, { recursive: true });

  // 6 sn koyu gri video + ses; kelime zamanları test çözümleyicisinden (bilerek “Kahvemz” yanlış yazılmış)
  await ff([
    '-f', 'lavfi', '-i', 'color=c=0x303030:size=1920x1080:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6,volume=0.35',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', path.join(media, 'tanitim.mp4'),
  ]);
  const words = [
    { t0: 0.3, t1: 0.7, text: 'Yeni' },
    { t0: 0.7, t1: 1.3, text: 'Kahvemz' },
    { t0: 1.3, t1: 1.8, text: 'geldi.' },
    { t0: 2.4, t1: 2.8, text: 'Köşe' },
    { t0: 2.8, t1: 3.3, text: "Kahve'de" },
    { t0: 3.3, t1: 4.0, text: 'deneyin.' },
  ];
  await writeFile(path.join(media, 'tanitim.mp4.words.json'), JSON.stringify(words));
  const px = Buffer.alloc(300 * 150 * 4);
  for (let y = 0; y < 150; y++) for (let x = 0; x < 300; x++) if ((x - 150) ** 2 / 140 ** 2 + (y - 75) ** 2 / 70 ** 2 < 1) px.set([232, 192, 125, 255], (y * 300 + x) * 4);
  await sharp(px, { raw: { width: 300, height: 150, channels: 4 } }).png().toFile(path.join(media, 'kose-logo.png'));

  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4857';
  process.env.FABRIKA_TRANSCRIBER = 'fixture';
  process.env.FABRIKA_FIXTURES = media;
  const { createServer } = await import('../src/server/index');
  const { app } = await createServer(home);
  const port = Number(process.env.FABRIKA_PORT);
  await app.listen({ port, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${port}`;
  const call = async (method: string, url: string, body?: unknown) => {
    const r = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, j: (await r.json()) as any };
  };
  const api = async <T = any>(method: string, url: string, body?: unknown): Promise<T> => {
    const r = await call(method, url, body);
    if (r.status >= 400) throw new Error(`${method} ${url}: ${r.j.error ?? r.j.message}`);
    return r.j as T;
  };
  const waitFor = async (pred: () => Promise<boolean>, label: string, ms = 600_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await pred()) return;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`Zaman aşımı: ${label}`);
  };
  const ops = async (pid: string, list: unknown[]) => (await api('POST', `/api/projects/${pid}/ops`, { ops: list })).project;

  try {
    const st = await api('POST', '/api/projects', { name: 'Yaz tanıtımı', formats: [{ format: 'story' }] });
    const pid = st.project.id;
    const imp = await api('POST', '/api/import/paths', { projectId: pid, paths: [path.join(media, 'tanitim.mp4')] });
    const lg = await api('POST', '/api/import/paths', { paths: [path.join(media, 'kose-logo.png')] });
    await waitFor(async () => {
      const lib = await api<any[]>('GET', '/api/library');
      const v = lib.find((a) => a.id === imp.assets[0].id);
      return v?.status === 'ready' && v.transcript.status === 'done' && lib.find((a) => a.id === lg.assets[0].id)?.status === 'ready';
    }, 'içe aktarma');

    // 1) Marka profili
    const brandIn = {
      name: 'Köşe Kahve',
      logoAssetIds: [lg.assets[0].id],
      palette: ['#3B2A20', '#E8C07D', '#FFF8EE'],
      textColor: '#FFF8EE',
      accentColor: '#E8C07D',
      fonts: { heading: 'Playfair Display', body: 'Poppins' },
      tone: 'samimi, kısa cümleler',
      hashtags: ['köşekahve', 'kahve', 'yeni'],
      products: [{ name: 'Kahvemiz', notes: '250 g taze çekirdek' }],
      channels: ['yt-video', 'yt-shorts', 'ig-reels'],
    };
    const brand = await api('POST', '/api/markalar', brandIn);
    const dup = await call('POST', '/api/markalar', { ...brandIn, name: 'köşe kahve' });
    const saved = JSON.parse(await readFile(path.join(home, 'markalar.json'), 'utf8'));
    check('Marka kaydı: logo, renkler, yazı tipleri, ürün; aynı ad reddedildi', saved.length === 1 && brand.products[0].id && brand.fonts.heading === 'Playfair Display' && dup.status === 409, `${brand.name} · ürün ${brand.products[0].name} · tekrar → ${dup.status} ${dup.j.error ?? ''}`);
    const productId = brand.products[0].id;

    // 2) Projeye uygula
    const plan = await api('POST', `/api/projects/${pid}/marka-plan`, { brandId: brand.id, productId, campaign: 'Yaz 2026' });
    let p = await ops(pid, [...plan.ops, { type: 'text.add', text: { text: 'Yeni Kahvemiz', start: 0, end: 2.5, anchor: 'tc' } }]);
    p = await ops(pid, (await api('POST', `/api/projects/${pid}/marka-plan`, { brandId: brand.id, productId, campaign: 'Yaz 2026' })).ops);
    const again = await api('POST', `/api/projects/${pid}/marka-plan`, { brandId: brand.id, productId, campaign: 'Yaz 2026' });
    const chans = p.outputs.map((o: any) => o.channel ?? o.format);
    check(
      'Marka uygulandı: bağ, logo, altyazı rengi/yazı tipi, yazı, kanallar; tekrar uygulamak boş',
      p.brand?.productName === 'Kahvemiz' && p.logos.length === 1 && p.captions.style.font === 'Poppins' && p.captions.style.highlight === '#E8C07D' && p.texts[0].font === 'Playfair Display' && chans.join(',') === 'story,yt-video,yt-shorts,ig-reels' && again.ops.length === 0,
      `${plan.items.length} madde · kanallar ${chans.join(', ')}`,
    );
    const list = await api<any[]>('GET', '/api/projects');
    check('Proje listesinde marka/ürün/kampanya', list[0].brand?.campaign === 'Yaz 2026' && list[0].brand?.brandName === 'Köşe Kahve');
    const yt = p.outputs.find((o: any) => o.channel === 'yt-video');
    const sh = p.outputs.find((o: any) => o.channel === 'yt-shorts');
    const rl = p.outputs.find((o: any) => o.channel === 'ig-reels');

    // 3) Kontroller
    let ks = await api<any[]>('GET', `/api/projects/${pid}/kontrol`);
    const ytc = ks.find((k) => k.outputId === yt.id).checks;
    const adCheck = ytc.find((c: any) => c.id === 'urun-ad');
    check('Kontrol: “Kahvemz” yanlış yazımı, boş YouTube başlığı ve kapak uyarısı', /Kahvemz/.test(adCheck?.text) && ytc.some((c: any) => c.id === 'metin-title') && ytc.some((c: any) => c.id === 'kapak' && c.level === 'uyari'), adCheck?.text);
    const vid = imp.assets[0].id;
    await ops(pid, [{ type: 'captions.editWord', key: `${vid}:1`, text: 'Kahvemiz' }]);
    ks = await api<any[]>('GET', `/api/projects/${pid}/kontrol`);
    check('Altyazı düzeltilince ürün adı kontrolü geçer', ks.find((k) => k.outputId === yt.id).checks.find((c: any) => c.id === 'urun-ad')?.level === 'ok');

    // 4) Metinler (yerel) + kapak
    const mt = await api('POST', `/api/projects/${pid}/metin-yaz`, { outputIds: [yt.id, sh.id, rl.id], ai: false });
    const sYt = mt.suggestions.find((s: any) => s.outputId === yt.id).meta;
    const sRl = mt.suggestions.find((s: any) => s.outputId === rl.id).meta;
    check('Yerel metin önerisi: başlık, açıklama (konuşmadan), etiketler', mt.source === 'yerel' && /Kahvemiz \| Yaz 2026/.test(sYt.title) && /Yeni Kahvemiz geldi/.test(sYt.description) && sRl.tags.includes('köşekahve') && !('title' in sRl), `“${sYt.title}”`);
    p = await ops(pid, [
      ...mt.suggestions.map((s: any) => ({ type: 'output.update', outputId: s.outputId, patch: { meta: s.meta } })),
      { type: 'output.update', outputId: yt.id, patch: { cover: { at: 1.0, title: 'Yeni Kahvemiz' } } },
      { type: 'output.update', outputId: rl.id, patch: { cover: { at: 3.0 } } },
    ]);
    ks = await api<any[]>('GET', `/api/projects/${pid}/kontrol`);
    const errs = ks.flatMap((k) => k.checks.filter((c: any) => c.level === 'hata'));
    check('Metin ve kapak sonrası hata kalmadı', errs.length === 0, errs.map((c: any) => c.text).join(' | '));

    // 5) Paket
    const job = await api('POST', `/api/projects/${pid}/paket`, { outputIds: [yt.id, sh.id, rl.id] });
    let j: any;
    await waitFor(async () => {
      j = (await api<any[]>('GET', '/api/jobs')).find((x) => x.id === job.id);
      if (j.status === 'error') throw new Error(j.error);
      return j.status === 'done';
    }, 'paket');
    const pkg = j.result;
    const dir = path.join(home, pkg.dir);
    const files = (await readdir(dir)).sort();
    const pre = 'kose-kahve_kahvemiz_yaz-2026';
    const want = [`${pre}_yt-video.mp4`, `${pre}_yt-video_kapak.jpg`, `${pre}_yt-video.srt`, `${pre}_yt-video.vtt`, `${pre}_yt-shorts.mp4`, `${pre}_yt-shorts.srt`, `${pre}_yt-shorts.vtt`, `${pre}_ig-reels.mp4`, `${pre}_ig-reels_kapak.jpg`, 'metinler.txt', 'kontrol.txt', 'paket.json'];
    check('Paket klasörü: 3 video, 2 kapak, altyazı dosyaları, metinler, rapor', want.every((f) => files.includes(f)), files.join(', '));

    const cover = await sharp(path.join(dir, `${pre}_yt-video_kapak.jpg`)).metadata();
    const { data, info } = await sharp(path.join(dir, `${pre}_yt-video_kapak.jpg`)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    let light = 0;
    let accent = 0;
    for (let y = Math.floor(info.height * 0.55); y < info.height - 30; y++)
      for (let x = 60; x < info.width * 0.6; x++) {
        const i = (y * info.width + x) * 3;
        const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
        if (r > 225 && g > 220 && b > 200) light++;
        if (Math.abs(r - 232) < 30 && Math.abs(g - 192) < 30 && Math.abs(b - 125) < 35) accent++;
      }
    check('YouTube küçük resmi 1280×720, marka renginde başlık ve vurgu çizgisi', cover.width === 1280 && cover.height === 720 && light > 2000 && accent > 2000, `${cover.width}×${cover.height} · açık ${light} px · vurgu ${accent} px`);

    const srt = await readFile(path.join(dir, `${pre}_yt-video.srt`), 'utf8');
    check('YouTube .srt: düzeltilmiş kelime, SRT zaman biçimi', /^1\n00:00:00,300 --> 00:00:0\d,\d{3}\nYeni Kahvemiz geldi\.\n/.test(srt), JSON.stringify(srt.slice(0, 60)));

    // Altyazı: Shorts görüntüsünde var (1.0 sn), YouTube videosunda yok
    const brightIn = async (file: string, W: number, H: number, y0: number, y1: number) => {
      const png = path.join(work, `kare-${path.basename(file)}.png`);
      await ff(['-ss', '1.0', '-i', file, '-frames:v', '1', png]);
      const { data: d, info: inf } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const k = inf.width / W;
      let n = 0;
      for (let y = Math.floor(y0 * k); y < Math.floor(y1 * k); y++)
        for (let x = 0; x < inf.width; x++) {
          const i = (y * inf.width + x) * 3;
          if (d[i] > 225 && d[i + 1] > 215 && d[i + 2] > 195) n++;
        }
      void H;
      return n;
    };
    const shortsCap = await brightIn(path.join(dir, `${pre}_yt-shorts.mp4`), 1080, 1920, 1920 - 420 - 30 - 260, 1920 - 420 - 10);
    const ytCap = await brightIn(path.join(dir, `${pre}_yt-video.mp4`), 1920, 1080, 1080 - 90 - 30 - 200, 1080 - 60);
    check('Altyazı Shorts görüntüsünde var, YouTube videosunda yok (ayrı dosyada)', shortsCap > 1500 && ytCap < 200, `Shorts ${shortsCap} px · YouTube ${ytCap} px`);

    const items = pkg.items as any[];
    const louds = items.map((i) => i.loudness?.lufs);
    check('Ses yüksekliği her videoda ölçüldü ve kontrollerde', louds.every((l) => Number.isFinite(l)) && items.every((i) => i.checks.some((c: any) => c.id === 'ses-lufs' && /LUFS/.test(c.text))), louds.map((l) => l?.toFixed(1)).join(' / ') + ' LUFS');

    const metin = await readFile(path.join(dir, 'metinler.txt'), 'utf8');
    const rapor = await readFile(path.join(dir, 'kontrol.txt'), 'utf8');
    check('metinler.txt (Reels’te #etiket, YouTube’da başlık) ve kontrol.txt', /=== YouTube video ===\nBaşlık:\nKahvemiz \| Yaz 2026/.test(metin) && /#köşekahve #kahve/.test(metin) && /✓ Ürün doğruluğu/.test(rapor), metin.split('\n').slice(0, 4).join(' / '));

    const zl = (await runOk('unzip', ['-Z1', path.join(home, pkg.zip)])).stdout.trim().split('\n');
    check('Zip tüm dosyaları içeriyor', want.every((f) => zl.includes(f)) && zl.length === want.length, `${zl.length} dosya`);

    const exp = await api<any[]>('GET', `/api/projects/${pid}/exports`);
    check('Renderlar varyant olarak Çıktılar listesinde de duruyor', exp.length >= 3);

    // 6) Onay
    const ap = await api('POST', `/api/projects/${pid}/paketler/${pkg.id}/onayla`);
    const tdir = path.join(home, 'teslim', 'kose-kahve', 'kahvemiz', 'yaz-2026', pkg.name);
    const tfiles = await readdir(tdir);
    const orig = await stat(path.join(home, 'kutuphane', 'originals')).then(() => true);
    check('Onaylanan paket teslim/marka/ürün/kampanya altında; orijinaller ve varyantlar ayrı', ap.approved && ap.approvedDir.startsWith('teslim/kose-kahve/kahvemiz/yaz-2026/') && tfiles.length === want.length && orig, ap.approvedDir);

    // 6b) Arayüz (tarayıcıda)
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
        await page.goto(`${base}/#/`);
        await page.waitForSelector('[data-testid=project-filter]');
        await page.locator('[data-testid=project-filter] .chip', { hasText: 'Köşe Kahve' }).click();
        const shown = await page.locator('.project-card').count();
        const line = await page.locator('.brand-line').first().innerText();
        check('Ana ekran: markaya göre süzme, kartta marka · ürün · kampanya', shown === 1 && /Köşe Kahve · Kahvemiz · Yaz 2026/.test(line), `${shown} kart | ${line}`);
        // Markalar penceresinden yeni marka
        await page.getByRole('button', { name: 'Markalar' }).click();
        await page.getByRole('button', { name: /Yeni marka/ }).click();
        await page.getByLabel('Marka adı').fill('Ada Sabun');
        await page.getByRole('button', { name: /Ürün ekle/ }).click();
        await page.getByLabel('Ürün 1 adı').fill('Lavanta Sabunu');
        await page.getByLabel('Başlık yazı tipi').selectOption('Poppins');
        await page.getByRole('button', { name: 'Kaydet' }).click();
        await page.waitForSelector('.brand-item:has-text("Ada Sabun")');
        const all = await api<any[]>('GET', '/api/markalar');
        const ada = all.find((b) => b.name === 'Ada Sabun');
        check('Markalar penceresinden marka oluşturuldu (ürün, yazı tipi)', ada?.products[0]?.name === 'Lavanta Sabunu' && ada.fonts.heading === 'Poppins');
        await page.keyboard.press('Escape');
        // Stüdyo: marka etiketi ve kanal paketi
        await page.goto(`${base}/#/studyo/${pid}`);
        const chip = await page.getByTestId('brand-chip').innerText();
        await page.getByRole('button', { name: /Deliver/ }).click();
        await page.waitForSelector('[data-testid=checks] .check-row');
        await page.locator('.dl-ch', { hasText: 'YouTube video' }).locator('.dl-ch-name').click();
        const title = page.getByLabel('Başlık', { exact: true });
        await title.fill('Yeni Kahvemiz geldi!');
        await title.blur();
        await waitFor(async () => (await api('GET', `/api/projects/${pid}`)).project.outputs.find((o: any) => o.id === yt.id).meta.title === 'Yeni Kahvemiz geldi!', 'başlık kaydı', 15000);
        const rows = await page.locator('[data-testid=checks] .check-row').count();
        const pk = await page.locator('[data-testid=packages] .dl-pkg').first().innerText();
        check('Stüdyo: marka etiketi; Kanal paketinde başlık düzenlenip kaydedildi, kontroller ve onaylı paket görünüyor', /Köşe Kahve · Kahvemiz · Yaz 2026/.test(chip) && rows >= 5 && /Onaylandı/.test(pk), `${chip} · ${rows} kontrol`);
        // Bir kanalda altyazıyı kapat → kontrol uyarır, düzeltme düğmesi geri açar
        await page.locator('.dl-ch', { hasText: 'YouTube Shorts' }).locator('.dl-ch-name').click();
        await page.locator('[data-testid=channel-editor] .toggle', { hasText: 'Görüntüye yaz' }).click();
        await page.waitForSelector('[data-testid=checks] .check-row.uyari:has-text("altyazı kapalı")');
        await page.getByRole('button', { name: 'Bu çıktıda aç' }).click();
        await waitFor(async () => (await api('GET', `/api/projects/${pid}`)).project.outputs.find((o: any) => o.id === sh.id).captions?.enabled === true, 'altyazı düzeltme', 15000);
        check('Kontrol uyarısındaki düzeltme düğmesi çalışıyor (Shorts altyazısı)', true);
        // Instagram hashtag sayacı adet sayar (harf değil)
        await page.locator('.dl-ch', { hasText: 'Instagram Reels' }).locator('.dl-ch-name').click();
        const tagBox = page.getByLabel('Hashtag (virgülle)');
        await tagBox.fill('Zhiyun, Weebill5, gimbal, videoçekimi, içerikÜretimi');
        const counter = await page.locator('.meta-field', { has: tagBox }).locator('small').innerText();
        check('Hashtag sayacı etiket adedini gösteriyor', /^5\/30 adet/.test(counter.trim()), counter);
        // Videonun kendi altyazısı var → uygulama altyazısı kapanır, kontrol uyarmaz
        await page.getByTestId('caption-invideo').locator('.toggle').click();
        await page.waitForSelector('[data-testid=checks] .check-row:has-text("Videonun kendi altyazısı var")', { timeout: 15000 });
        const pv = (await api('GET', `/api/projects/${pid}`)).project;
        const rowsTxt = await page.locator('[data-testid=checks]').innerText();
        check('“Videoda altyazı zaten var”: uygulama altyazısı kapandı, altyazı uyarısı yok', pv.captions.inVideo === true && pv.captions.enabled === false && !/altyazı kapalı|emin olunamadı/.test(rowsTxt));
        check('Sayfada hata yok', !errors.length, errors.join(' | '));
      } catch (e) {
        await page.screenshot({ path: path.join(work, 'arayuz-hata.png') }).catch(() => undefined);
        check('Arayüz akışı tamamlandı', false, (e as Error).message.split('\n')[0]);
      } finally {
        await browser.close();
      }
    } else console.log('(Playwright yok: arayüz kontrolleri atlandı)');

    // 7) Marka silinse de proje açılır
    await api('DELETE', `/api/markalar/${brand.id}`);
    const after = await api('GET', `/api/projects/${pid}`);
    const ks2 = await api<any[]>('GET', `/api/projects/${pid}/kontrol`);
    check('Marka silinince proje açılıyor, adlar korunuyor', after.project.brand.brandName === 'Köşe Kahve' && ks2.length === 4);
    void stat;
  } catch (e) {
    check('Test akışı tamamlandı', false, (e as Error).message);
  } finally {
    await app.close();
  }
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} kontrol geçti · ${Math.round((Date.now() - t0) / 1000)} sn`);
  process.exit(ok === results.length ? 0 : 1);
};

void main();
