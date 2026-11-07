/**
 * Faz 4 · LUT Kütüphanem kabul testi (sunucu + render):
 *  - 24 dosyalık karışık paket (zip içinde 3 dosya daha): .cube (17/33), .3dl, aynı içerikli kopyalar, zip, bozuk ve desteklenmeyen dosyalar.
 *  - Rapor: eklendi / zaten vardı / okunamadı (neden) doğru mu?
 *  - Tür tahmini (görünüm / teknik + giriş), etiket/favori düzenleme, kullanım sayısı, silme.
 *  - Render'da gerçekten uygulanıyor mu: .cube (ters çevirme) ve .3dl'den dönüşen (kırmızı↔mavi) LUT, piksel ölçümüyle.
 * Çalıştırma: npm run e2e:lut
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { runOk } from '../src/media/proc';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

type F = (r: number, g: number, b: number) => [number, number, number];
const cube = (n: number, f: F, title = '') => {
  const lines = [title ? `TITLE "${title}"` : '# test', `LUT_3D_SIZE ${n}`];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) lines.push(f(r / (n - 1), g / (n - 1), b / (n - 1)).map((v) => v.toFixed(6)).join(' '));
  return lines.join('\n') + '\n';
};
const dl3 = (n: number, f: F) => {
  const rows = [Array.from({ length: n }, (_, i) => Math.round((i * 1023) / (n - 1))).join(' ')];
  for (let r = 0; r < n; r++) for (let g = 0; g < n; g++) for (let b = 0; b < n; b++) rows.push(f(r / (n - 1), g / (n - 1), b / (n - 1)).map((v) => Math.round(v * 4095)).join(' '));
  return '3DMESH\nMesh 4 12\n' + rows.join('\n') + '\n';
};
const tint = (k: number): F => (r, g, b) => [Math.min(1, r * (1 + k)), g, Math.max(0, b * (1 - k))];

const main = async () => {
  const t0 = Date.now();
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'lut') : path.join(os.tmpdir(), 'fabrika-lut');
  const home = path.join(work, 'ev');
  const media = path.join(work, 'medya');
  await rm(work, { recursive: true, force: true });
  await mkdir(media, { recursive: true });

  // ---- 25 dosyalık paket ----
  const files: { name: string; data: string | Buffer }[] = [];
  const looks = ['Los Feliz', 'Bloodbag', 'Blue Unity', 'Dade', 'Suntan', 'Tranquility', 'Maxine', 'Polaris', 'Fall is Here', 'Candlelight', 'Fuji ETERNA 250D Kodak 2395 (by Adobe)', 'Prolost Flat Cinematic'];
  looks.forEach((n, i) => files.push({ name: `${n}.cube`, data: cube(i % 2 ? 17 : 33, tint(0.02 * (i + 1)), n) }));
  files.push({ name: 'Ters.cube', data: cube(2, (r, g, b) => [1 - r, 1 - g, 1 - b]) });
  files.push({ name: 'Blue_Unity.cube', data: files[2].data }); // Magic Bullet Runtimes kopyası: aynı içerik
  files.push({ name: 'Moonlight.3DL', data: dl3(17, (r, g, b) => [r * 0.8, g * 0.9, Math.min(1, b * 1.2)]) });
  files.push({ name: 'KirmiziMavi.3dl', data: dl3(5, (r, g, b) => [b, g, r]) });
  files.push({ name: 'Sony SLog 3.cube', data: cube(17, tint(0.3)) });
  files.push({ name: 'Rec709 Kodak 2383 D65.cube', data: cube(17, tint(0.31)) });
  files.push({ name: 'Gamma 2.4 to HDR 1000 nits.cube', data: cube(17, tint(0.32)) });
  files.push({ name: 'Crisp_Warm.look', data: '<look/>' });
  files.push({ name: 'Bozuk.cube', data: 'LUT_3D_SIZE 17\n0 0 0\n1 1 1\n' });
  files.push({ name: 'Shaper.cube', data: 'LUT_1D_SIZE 2\n0 0 0\n1 1 1\nLUT_3D_SIZE 2\n' + cube(2, (r, g, b) => [r, g, b]).split('\n').slice(2).join('\n') });
  files.push({ name: 'Profil.xmp', data: '<x:xmpmeta/>' });
  // Zip: iki yeni + bir kopya
  const zdir = path.join(work, 'zip');
  await mkdir(zdir, { recursive: true });
  await writeFile(path.join(zdir, 'Offspring.cube'), cube(17, tint(0.4)));
  await writeFile(path.join(zdir, 'Subtitle.cube'), cube(17, tint(0.41)));
  await writeFile(path.join(zdir, 'Los Feliz kopya.cube'), files[0].data);
  await runOk('zip', ['-qj', path.join(work, 'paket.zip'), ...['Offspring.cube', 'Subtitle.cube', 'Los Feliz kopya.cube'].map((f) => path.join(zdir, f))]);
  const { readFile } = await import('node:fs/promises');
  files.push({ name: 'paket.zip', data: await readFile(path.join(work, 'paket.zip')) });
  console.log(`Paket: ${files.length} dosya`);

  // Test görüntüsü: düz kırmızı fotoğraf
  await sharp({ create: { width: 1200, height: 1500, channels: 3, background: { r: 220, g: 30, b: 30 } } }).jpeg({ quality: 95 }).toFile(path.join(media, 'kirmizi.jpg'));

  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4853';
  const { createServer } = await import('../src/server/index');
  const { app } = await createServer(home);
  const port = Number(process.env.FABRIKA_PORT);
  await app.listen({ port, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${port}`;
  const api = async <T = any>(method: string, url: string, body?: unknown): Promise<T> => {
    const r = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json();
    if (!r.ok) throw new Error(`${method} ${url}: ${j.error ?? j.message}`);
    return j as T;
  };
  const waitFor = async (pred: () => Promise<boolean>, label: string, ms = 600_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await pred()) return;
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`Zaman aşımı: ${label}`);
  };
  const enc = encodeURIComponent;

  try {
    // 1) Toplu içe aktarma
    const fd = new FormData();
    for (const f of files) fd.append('files', new Blob([typeof f.data === 'string' ? f.data : new Uint8Array(f.data)]), f.name);
    const imp = await (await fetch(`${base}/api/luts`, { method: 'POST', body: fd })).json();
    const rep: any[] = imp.report;
    const by = (s: string) => rep.filter((r) => r.status === s);
    check('Rapor: 20 eklendi, 2 zaten vardı, 4 okunamadı', by('eklendi').length === 20 && by('vardi').length === 2 && by('hata').length === 4, `${by('eklendi').length} / ${by('vardi').length} / ${by('hata').length}`);
    const reason = (f: string) => rep.find((r) => r.file.endsWith(f))?.reason ?? '';
    check(
      'Okunamayanların nedeni anlaşılır',
      /look/.test(reason('Crisp_Warm.look')) && /bulundu|bekleniyordu/.test(reason('Bozuk.cube')) && /shaper/.test(reason('Shaper.cube')) && /Lightroom/.test(reason('Profil.xmp')),
      by('hata').map((r) => `${r.file}: ${r.reason}`).join(' · '),
    );
    check('Aynı içerik ikinci kez eklenmedi (Runtimes kopyası, zip içindeki kopya)', rep.find((r) => r.file === 'Blue_Unity.cube')?.status === 'vardi' && rep.find((r) => r.file.endsWith('Los Feliz kopya.cube'))?.status === 'vardi');
    check('Zip içindekiler eklendi', rep.some((r) => r.file === 'paket.zip › Offspring.cube' && r.status === 'eklendi'));

    // 2) Tür tahmini
    const luts: any[] = await api('GET', '/api/luts?kullanim=1');
    const L = (name: string) => luts.find((l) => l.group === 'kullanici' && l.title === name);
    check('Kütüphanede 20 kullanıcı LUT\'u', luts.filter((l) => l.group === 'kullanici').length === 20);
    check(
      'Tür tahmini: görünüm / teknik ve beklenen giriş',
      L('Los Feliz').meta.kind === 'gorunum' && L('Sony SLog 3').meta.input === 'sony-slog3-sgamut3cine' && L('Rec709 Kodak 2383 D65').meta.input === 'cineon' && L('Gamma 2.4 to HDR 1000 nits').meta.input === 'hdr' && L('Moonlight').meta.kind === 'gorunum',
      ['Los Feliz', 'Sony SLog 3', 'Rec709 Kodak 2383 D65', 'Moonlight'].map((n) => `${n}: ${L(n).meta.kind}${L(n).meta.input ? ' · ' + L(n).meta.input : ''}`).join(' · '),
    );
    check('Boyutlar ve etiketler', L('Los Feliz').meta.size === 33 && L('Bloodbag').meta.size === 17 && L('Fuji ETERNA 250D Kodak 2395 (by Adobe)').meta.tags.includes('film') && L('Candlelight').meta.tags.includes('sıcak'));

    // 3) Düzenleme
    const losId = L('Los Feliz').id;
    const pat = await api('PATCH', `/api/luts/${enc(losId)}`, { favorite: true, tags: ['Yaz', 'kafe'], name: 'Los Feliz (yaz)' });
    check('Ad, favori ve etiket düzenlendi', pat.meta.favorite && pat.meta.tags.join(',') === 'yaz,kafe' && pat.meta.name === 'Los Feliz (yaz)');
    const tk = await api('PATCH', `/api/luts/${enc(L('Sony SLog 3').id)}`, { kind: 'gorunum' });
    check('Teknik → görünüm yapılınca giriş temizlenir', tk.meta.kind === 'gorunum' && tk.meta.input === null);

    // 4) Render'da uygulanıyor mu?
    const st = await api('POST', '/api/projects', { name: 'LUT testi', formats: [{ format: 'post', kind: 'image' }] });
    const pid = st.project.id;
    const imp2 = await api('POST', '/api/import/paths', { projectId: pid, paths: [path.join(media, 'kirmizi.jpg')] });
    const aid = imp2.assets[0].id;
    await waitFor(async () => (await api<any[]>('GET', '/api/library')).find((a) => a.id === aid).status === 'ready', 'içe aktarma');
    const clip = imp2.state.project.clips[0].id;
    const out = imp2.state.project.outputs[0].id;
    const render = async () => {
      const job = await api('POST', `/api/projects/${pid}/render`, { outputId: out });
      let j: any;
      await waitFor(async () => {
        j = (await api<any[]>('GET', '/api/jobs')).find((x) => x.id === job.id);
        if (j.status === 'error') throw new Error(j.error);
        return j.status === 'done';
      }, 'render');
      const { data } = await sharp(path.join(home, j.result.file)).resize(40, 50).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < data.length; i += 3) (r += data[i]), (g += data[i + 1]), (b += data[i + 2]);
      const n = data.length / 3;
      return [r / n, g / n, b / n].map(Math.round);
    };
    const plain = await render();
    await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'clip.setLook', clipId: clip, look: { lut: L('Ters').id, lutIntensity: 1 } }] });
    const inv = await render();
    check('.cube LUT render\'da uygulandı (ters çevirme)', Math.abs(inv[0] - (255 - plain[0])) < 25 && Math.abs(inv[2] - (255 - plain[2])) < 25, `rgb(${plain}) → rgb(${inv})`);
    await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'clip.setLook', clipId: clip, look: { lut: L('KirmiziMavi').id, lutIntensity: 1 } }] });
    const sw = await render();
    check('.3dl\'den dönüşen LUT render\'da doğru (kırmızı ↔ mavi)', Math.abs(sw[2] - plain[0]) < 25 && Math.abs(sw[0] - plain[2]) < 25, `rgb(${plain}) → rgb(${sw})`);
    await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'clip.setLook', clipId: clip, look: { lut: L('KirmiziMavi').id, lutIntensity: 0.5 } }] });
    const half = await render();
    check('Yoğunluk %50 arada bir sonuç verir', half[0] < plain[0] - 40 && half[0] > sw[0] + 40, `rgb(${half})`);

    // 5) Kullanım sayısı ve silme
    const withUses: any[] = await api('GET', '/api/luts?kullanim=1');
    check('Kullanım sayısı (silmeden önce uyarı için)', withUses.find((l) => l.title === 'KirmiziMavi').uses === 1 && withUses.find((l) => l.title === 'Bloodbag').uses === 0);
    const del = await api('DELETE', `/api/luts/${enc(L('Bloodbag').id)}`);
    check('Silindi', !del.luts.some((l: any) => l.title === 'Bloodbag') && del.luts.filter((l: any) => l.group === 'kullanici').length === 19);

    // 6) Önizleme karesi
    const fr = await fetch(`${base}/api/assets/${aid}/frame?t=0&w=160`);
    const meta = await sharp(Buffer.from(await fr.arrayBuffer())).metadata();
    check('Küçük önizleme karesi', fr.ok && meta.format === 'jpeg' && meta.width === 160, `${meta.width}×${meta.height}`);

    // 7) Yeniden açınca bilgiler yerinde
    await app.close();
    const again = await createServer(home);
    await again.app.listen({ port, host: '127.0.0.1' });
    const l2: any[] = await api('GET', '/api/luts');
    check('Yeniden açınca favori/etiket yerinde', l2.find((l) => l.title === 'Los Feliz (yaz)')?.meta.favorite === true);
    await again.app.close();
  } catch (e) {
    check('Test akışı tamamlandı', false, (e as Error).message);
    await app.close().catch(() => undefined);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} kontrol geçti · ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => {
  console.error('\n✗ Test durdu:', e.message);
  process.exit(1);
});
