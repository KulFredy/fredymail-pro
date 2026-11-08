/**
 * Faz 5 kabul testi: bağlantılar ve ücretli üretim — gerçek servislerin yerine SAHTE sunucuyla.
 * Sahte sunucu resmi API biçimlerini denetler (başlık adları, yol, gövde alanları) ve çağrıları sayar.
 *  - Anahtarlar kasada; API cevaplarında, proje/ayar dosyalarında ve logda görünmez; gizli dosya 600.
 *  - Eski sürümün ayarlar.json'daki Claude anahtarı kasaya taşınır.
 *  - ElevenLabs: tahmin (karakter/kredi/kalan), örnek, üretim → dış ses izi; aynı istek tekrar ücretlenmez;
 *    eşzamanlı çift istek tek çağrı; metin değişince aynı öğe yeniden üretilir; kredi yoksa anlaşılır hata.
 *  - Gemini: ürün fotoğrafından 2 arka plan; ürünü koruma talimatı gönderilir; onaylanana kadar Medya'da görünmez.
 * Gerçek servislerle doğrulama: kullanıcının anahtarlarıyla Mac'te (docs/DEVAM.md).
 * Çalıştırma: npm run e2e:baglanti
 */
import { createServer as httpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { runOk } from '../src/media/proc';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const KEYS = { elevenlabs: 'el-GIZLI-anahtar-1234', gemini: 'gm-GIZLI-anahtar-5678', anthropic: 'sk-ant-GIZLI-eski-9999' };

const main = async () => {
  const t0 = Date.now();
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'baglanti') : path.join(os.tmpdir(), 'fabrika-baglanti');
  const home = path.join(work, 'ev');
  const media = path.join(work, 'medya');
  await rm(work, { recursive: true, force: true });
  await mkdir(media, { recursive: true });
  await mkdir(home, { recursive: true });

  // Sahte servis çıktıları
  // Her çağrıda farklı ses (gerçek serviste olduğu gibi)
  const ttsMp3s: Buffer[] = [];
  for (const f of [330, 440, 550]) {
    await runOk('ffmpeg', ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${f}:duration=2`, '-c:a', 'libmp3lame', '-b:a', '64k', path.join(media, `tts${f}.mp3`)]);
    ttsMp3s.push(await readFile(path.join(media, `tts${f}.mp3`)));
  }
  await sharp({ create: { width: 900, height: 1100, channels: 3, background: { r: 240, g: 240, b: 240 } } })
    .composite([{ input: await sharp({ create: { width: 300, height: 500, channels: 3, background: { r: 160, g: 30, b: 30 } } }).png().toBuffer(), left: 300, top: 300 }])
    .jpeg()
    .toFile(path.join(media, 'urun.jpg'));

  // ---- Sahte sunucu ----
  const calls = { tts: 0, gen: 0, voices: 0 };
  const seen: { genBodies: any[]; ttsBodies: any[]; headers: string[] } = { genBodies: [], ttsBodies: [], headers: [] };
  const body = (req: IncomingMessage) => new Promise<string>((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
  const json = (res: ServerResponse, code: number, o: unknown) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };
  const mock = httpServer(async (req, res) => {
    const u = new URL(req.url!, 'http://x');
    seen.headers.push(Object.keys(req.headers).join(','));
    // ElevenLabs
    if (u.pathname.startsWith('/v1/') && !u.pathname.startsWith('/v1/models?') && req.headers['xi-api-key'] !== undefined) {
      if (req.headers['xi-api-key'] !== KEYS.elevenlabs) return json(res, 401, { detail: { status: 'invalid_api_key', message: 'Invalid API key' } });
      if (u.pathname === '/v1/user/subscription') return json(res, 200, { tier: 'creator', character_count: 1000, character_limit: 100000, next_character_count_reset_unix: 1790000000 });
      if (u.pathname === '/v1/voices') return calls.voices++, json(res, 200, { voices: [{ voice_id: 'v-ayse', name: 'Ayşe', category: 'premade', labels: { accent: 'turkish' }, preview_url: null }, { voice_id: 'v-mert', name: 'Mert', category: 'cloned', labels: {}, preview_url: null }] });
      if (u.pathname === '/v1/models')
        return json(res, 200, [
          { model_id: 'eleven_multilingual_v2', name: 'Eleven Multilingual v2', can_do_text_to_speech: true, languages: [{ language_id: 'en', name: 'English' }, { language_id: 'tr', name: 'Turkish' }], model_rates: { character_cost_multiplier: 1 }, max_characters_request_subscribed_user: 10000 },
          { model_id: 'eleven_flash_v2_5', name: 'Eleven Flash v2.5', can_do_text_to_speech: true, languages: [{ language_id: 'tr', name: 'Turkish' }], model_rates: { character_cost_multiplier: 0.5 } },
          { model_id: 'eleven_english_sts_v2', name: 'STS', can_do_text_to_speech: false, languages: [{ language_id: 'en', name: 'English' }], model_rates: { character_cost_multiplier: 1 } },
        ]);
      const m = /^\/v1\/text-to-speech\/([^/]+)$/.exec(u.pathname);
      if (m && req.method === 'POST') {
        const b = JSON.parse(await body(req));
        seen.ttsBodies.push({ voice: m[1], output_format: u.searchParams.get('output_format'), accept: req.headers.accept, ...b });
        if (String(b.text).includes('KREDİYOK')) return json(res, 402, { detail: { status: 'quota_exceeded', message: 'This request exceeds your quota' } });
        calls.tts++;
        await new Promise((r) => setTimeout(r, 600));
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'request-id': `req-${calls.tts}` });
        return res.end(ttsMp3s[calls.tts % ttsMp3s.length]);
      }
    }
    // Gemini
    if (u.pathname.startsWith('/v1beta/models/')) {
      if (req.headers['x-goog-api-key'] !== KEYS.gemini) return json(res, 403, { error: { code: 403, message: 'API key not valid. Please pass a valid API key.', status: 'PERMISSION_DENIED' } });
      if (req.method === 'GET') return json(res, 200, { name: 'models/gemini-3.1-flash-image' });
      if (u.pathname.endsWith(':generateContent')) {
        const b = JSON.parse(await body(req));
        seen.genBodies.push({ path: u.pathname, ...b });
        calls.gen++;
        const shade = 60 + calls.gen * 40;
        const png = await sharp({ create: { width: 800, height: 1000, channels: 3, background: { r: shade, g: 120, b: 200 } } }).png().toBuffer();
        return json(res, 200, { candidates: [{ content: { role: 'model', parts: [{ text: 'İşte görsel.' }, { inlineData: { mimeType: 'image/png', data: png.toString('base64') } }] }, finishReason: 'STOP' }] });
      }
    }
    // Anthropic (SDK, ANTHROPIC_BASE_URL)
    if (u.pathname === '/v1/models') {
      if (req.headers['x-api-key'] !== KEYS.anthropic && req.headers.authorization !== `Bearer ${KEYS.anthropic}`) return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } });
      return json(res, 200, { data: [{ id: 'claude-opus-5-5', type: 'model', display_name: 'Claude Opus 5.5', created_at: '2026-01-01T00:00:00Z' }], has_more: false, first_id: 'claude-opus-5-5', last_id: 'claude-opus-5-5' });
    }
    json(res, 404, { error: 'yok' });
  });
  await new Promise<void>((r) => mock.listen(4899, '127.0.0.1', r));
  process.env.FABRIKA_ELEVENLABS_URL = 'http://127.0.0.1:4899';
  process.env.FABRIKA_GEMINI_URL = 'http://127.0.0.1:4899';
  process.env.ANTHROPIC_BASE_URL = 'http://127.0.0.1:4899';
  delete process.env.ANTHROPIC_API_KEY;

  // Eski sürüm: Claude anahtarı ayarlar.json'da
  await writeFile(path.join(home, 'ayarlar.json'), JSON.stringify({ anthropicApiKey: KEYS.anthropic, aiModel: 'claude-opus-5-5' }));

  // Logları yakala (anahtar sızıntısı kontrolü)
  const logs: string[] = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...a: unknown[]) => (logs.push(a.map(String).join(' ')), origLog(...a));
  console.error = (...a: unknown[]) => (logs.push(a.map(String).join(' ')), origErr(...a));

  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4857';
  process.env.FABRIKA_SECRETS_FILE = path.join(home, 'gizli.json');
  const { createServer } = await import('../src/server/index');
  const { app } = await createServer(home);
  const port = Number(process.env.FABRIKA_PORT);
  await app.listen({ port, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${port}`;
  const responses: string[] = [];
  const api = async <T = any>(method: string, url: string, b?: unknown): Promise<{ status: number; j: T }> => {
    const r = await fetch(base + url, { method, headers: b ? { 'content-type': 'application/json' } : {}, body: b ? JSON.stringify(b) : undefined });
    const t = await r.text();
    responses.push(t);
    return { status: r.status, j: (t ? JSON.parse(t) : null) as T };
  };
  const waitFor = async (pred: () => Promise<boolean>, label: string, ms = 120_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await pred()) return;
      await new Promise((r) => setTimeout(r, 300));
    }
    throw new Error(`Zaman aşımı: ${label}`);
  };

  try {
    // 1) Eski Claude anahtarı kasaya taşındı
    const ayar = JSON.parse(await readFile(path.join(home, 'ayarlar.json'), 'utf8'));
    const gizli = JSON.parse(await readFile(path.join(home, 'gizli.json'), 'utf8'));
    const mode = (await stat(path.join(home, 'gizli.json'))).mode & 0o777;
    check('Eski Claude anahtarı kasaya taşındı (ayarlar.json\'dan silindi, gizli dosya 600)', !ayar.anthropicApiKey && ayar.aiModel === 'claude-opus-5-5' && gizli.anthropic === KEYS.anthropic && mode === 0o600, `izin ${mode.toString(8)}`);

    // 2) Anahtar ekle + test
    const bad = await api('PUT', '/api/connections/elevenlabs', { key: 'el-yanlis-anahtar' });
    check('Yanlış ElevenLabs anahtarı: anlaşılır hata', bad.j.status.ok === false && /anahtar geçersiz/.test(bad.j.status.detail), bad.j.status.detail);
    const el = await api('PUT', '/api/connections/elevenlabs', { key: KEYS.elevenlabs });
    const gm = await api('PUT', '/api/connections/gemini', { key: KEYS.gemini });
    check('ElevenLabs bağlandı (kalan karakter)', el.j.status.ok && /99\.000/.test(el.j.status.detail), el.j.status.detail);
    check('Gemini bağlandı', gm.j.status.ok, gm.j.status.detail);
    const list = await api<any[]>('GET', '/api/connections?test=1');
    const an = list.j.find((c) => c.id === 'anthropic');
    check('Bağlantı listesi: durum, kaynak, son 4 hane (anahtar yok)', an.configured && an.status.ok && an.hint === '…9999' && list.j.find((c) => c.id === 'higgsfield').verified === false, `${list.j.map((c) => `${c.id}:${c.configured ? c.hint : '—'}`).join(' ')} · Claude: ${an.status?.detail}`);

    // 3) Dış ses
    const st = await api('POST', '/api/projects', { name: 'Bağlantı testi', formats: [{ format: 'landscape' }] });
    const pid = st.j.project.id;
    const text = 'Bu hafta sonu kafemizde yeni kahvemizi tadın. Sizi bekliyoruz.';
    const cat = await api('GET', '/api/uret/dis-ses/katalog');
    check('Ses kataloğu: Türkçe destekleyen model varsayılan', cat.j.defaultModelId === 'eleven_multilingual_v2' && cat.j.voices.length === 2 && !cat.j.models.some((m: any) => m.id === 'eleven_english_sts_v2'), `${cat.j.defaultModelId}, ${cat.j.voices.map((v: any) => v.name).join('/')}`);
    const est = await api('POST', '/api/uret/dis-ses/tahmin', { text, voiceId: 'v-ayse', modelId: 'eleven_flash_v2_5' });
    check('Maliyet tahmini (karakter × model çarpanı, kalan kredi)', est.j.chars === [...text].length && est.j.credits === Math.ceil([...text].length * 0.5) && est.j.remaining === 99000, `${est.j.chars} karakter · ${est.j.credits} kredi · kalan ${est.j.remaining}`);
    const ornek = await api('POST', '/api/uret/dis-ses/ornek', { text, voiceId: 'v-ayse', modelId: 'eleven_multilingual_v2' });
    check('Kısa örnek (ilk cümle) projeye eklenmeden üretildi', ornek.j.text === 'Bu hafta sonu kafemizde yeni kahvemizi tadın.' && !!(await stat(path.join(home, ornek.j.file)).catch(() => null)));
    const before = calls.tts;
    const [g1, g2] = await Promise.all([
      api('POST', `/api/projects/${pid}/uret/dis-ses`, { text, voiceId: 'v-ayse', modelId: 'eleven_multilingual_v2', at: 1 }),
      new Promise((r) => setTimeout(r, 150)).then(() => api('POST', `/api/projects/${pid}/uret/dis-ses`, { text, voiceId: 'v-ayse', modelId: 'eleven_multilingual_v2', at: 1 })),
    ]);
    check('Eşzamanlı çift istek: servise tek çağrı', calls.tts - before === 1 && (g1.j.running || g2.j.running), `çağrı ${calls.tts - before}`);
    const done = g1.j.state ? g1.j : g2.j;
    const v = done.state.project.voice[0];
    const tb = seen.ttsBodies.find((b) => b.text === text);
    check('Dış ses ize eklendi; resmi biçim (yol, output_format, model_id, Accept)', done.state.project.voice.length === 1 && v.at === 1 && v.tts.voiceName === 'Ayşe' && tb.voice === 'v-ayse' && tb.output_format === 'mp3_44100_128' && tb.model_id === 'eleven_multilingual_v2' && tb.accept === 'audio/mpeg');
    const lib = await api<any[]>('GET', '/api/library');
    check('Üretilen ses yerel kütüphanede, rolü dış ses', lib.j.find((a) => a.id === v.assetId)?.role === 'voiceover' && lib.j.find((a) => a.id === v.assetId)?.generated?.provider === 'elevenlabs');
    const again = await api('POST', `/api/projects/${pid}/uret/dis-ses`, { text, voiceId: 'v-ayse', modelId: 'eleven_multilingual_v2', at: 5 });
    check('Aynı metin/ses/model tekrar ücretlenmedi (kayıt kullanıldı)', again.j.reused === true && calls.tts - before === 1);
    const pr = (await api('GET', `/api/projects/${pid}`)).j.project;
    const regen = await api('POST', `/api/projects/${pid}/uret/dis-ses`, { text: text + ' Afiyet olsun.', voiceId: 'v-ayse', modelId: 'eleven_multilingual_v2', at: 1, voiceItemId: pr.voice[0].id });
    const v2 = regen.j.state.project.voice.find((x: any) => x.id === pr.voice[0].id);
    check('Metin değişince aynı öğe yeniden üretildi (yer korundu)', calls.tts - before === 2 && v2.at === 1 && /Afiyet/.test(v2.tts.text) && v2.assetId !== v.assetId);
    const nocredit = await api('POST', `/api/projects/${pid}/uret/dis-ses`, { text: 'KREDİYOK deneme', voiceId: 'v-ayse', modelId: 'eleven_multilingual_v2', at: 0 });
    const gens = (await api<any[]>('GET', `/api/projects/${pid}/uretimler`)).j;
    check('Kredi yetmeyince 402 ve anlaşılır ileti; kayıt “hata”', nocredit.status === 402 && /kredi yetersiz/.test(nocredit.j.error) && gens.some((g) => g.status === 'hata'), nocredit.j.error);

    // 4) Gemini arka plan
    const imp = await api('POST', '/api/import/paths', { paths: [path.join(media, 'urun.jpg')] });
    const urun = imp.j.assets[0];
    await waitFor(async () => (await api<any[]>('GET', '/api/library')).j.find((a) => a.id === urun.id)?.status === 'ready', 'ürün fotoğrafı');
    const bg = await api('POST', `/api/projects/${pid}/uret/arka-plan`, { assetId: urun.id, prompt: 'güneşli bir kafe masası, sabah ışığı', aspectRatio: '4:5', count: 2 });
    const gb = seen.genBodies;
    check('Gemini: 2 seçenek; resmi biçim (inlineData, IMAGE, imageConfig.aspectRatio) ve ürünü koruma talimatı', bg.j.generation.status === 'onay-bekliyor' && bg.j.generation.resultAssetIds.length === 2 && gb.length === 2 && gb[0].path.endsWith('/gemini-3.1-flash-image:generateContent') && gb[0].contents[0].parts[1].inlineData.mimeType === 'image/jpeg' && gb[0].generationConfig.responseModalities.includes('IMAGE') && gb[0].generationConfig.imageConfig.aspectRatio === '4:5' && /Keep the product itself exactly unchanged/.test(gb[0].contents[0].parts[0].text) && /kafe masası/.test(gb[0].contents[0].parts[0].text));
    const lib2 = (await api<any[]>('GET', '/api/library')).j;
    check('Onaylanana kadar Medya\'da görünmez (rol “üretim”)', bg.j.generation.resultAssetIds.every((id: string) => lib2.find((a) => a.id === id)?.role === 'uretim'));
    const ap = await api('POST', `/api/uretimler/${bg.j.generation.id}/onayla`, { assetIds: [bg.j.generation.resultAssetIds[1]] });
    const lib3 = (await api<any[]>('GET', '/api/library')).j;
    check('Onaylanan seçenek Medya\'ya geçti, diğeri gizli kaldı', ap.j.status === 'onaylandi' && lib3.find((a) => a.id === bg.j.generation.resultAssetIds[1])?.role === 'media' && lib3.find((a) => a.id === bg.j.generation.resultAssetIds[0])?.role === 'uretim');
    const badGm = await api('PUT', '/api/connections/gemini', { key: 'gm-yanlis' });
    const failBg = await api('POST', `/api/projects/${pid}/uret/arka-plan`, { assetId: urun.id, prompt: 'deniz kenarı', count: 1 });
    check('Gemini yanlış anahtar: anlaşılır hata', badGm.j.status.ok === false && failBg.status === 400 && /anahtar geçersiz/.test(failBg.j.error), failBg.j.error);
    await api('PUT', '/api/connections/gemini', { key: KEYS.gemini });

    // 5) Anahtar sızıntısı: API cevapları, ev klasöründeki dosyalar (gizli.json hariç), loglar
    const files: string[] = [];
    const walk = async (d: string): Promise<void> => {
      for (const e of await readdir(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (/\.(json|jsonl|txt|log)$/.test(e.name) && e.name !== 'gizli.json') files.push(p);
      }
    };
    await walk(home);
    const leaks: string[] = [];
    for (const f of files) {
      const t = await readFile(f, 'utf8');
      for (const k of Object.values(KEYS)) if (t.includes(k)) leaks.push(path.relative(home, f));
    }
    for (const r of responses) for (const k of Object.values(KEYS)) if (r.includes(k)) leaks.push('API cevabı');
    for (const l of logs) for (const k of Object.values(KEYS)) if (l.includes(k)) leaks.push('log');
    check('Anahtarlar hiçbir API cevabında, dosyada (gizli.json hariç) veya logda yok', leaks.length === 0, leaks.length ? [...new Set(leaks)].join(', ') : `${files.length} dosya, ${responses.length} cevap, ${logs.length} log satırı tarandı`);

    // 6) Kaldırma
    await api('DELETE', '/api/connections/elevenlabs');
    const after = (await api<any[]>('GET', '/api/connections')).j.find((c) => c.id === 'elevenlabs');
    const cat2 = await api('GET', '/api/uret/dis-ses/katalog?yenile=1');
    check('Bağlantı kaldırıldı; üretim anlaşılır biçimde durur', !after.configured && cat2.status === 400 && /bağlı değil/.test(cat2.j.error), cat2.j.error);
  } catch (e) {
    check('Test akışı tamamlandı', false, (e as Error).message);
  } finally {
    await app.close();
    mock.close();
    console.log = origLog;
    console.error = origErr;
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} kontrol geçti · ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => {
  console.error('\n✗ Test durdu:', e.message);
  process.exit(1);
});
