/**
 * Faz 4.3 kabul testi: logo ve başlık yerleşimi (render'da piksel ölçümüyle).
 *  - Saydam PNG logo: saydam kısım gerçekten saydam (siyah/beyaz kutu yok), varsayılan sağ üst.
 *  - Story'de logo Instagram üst bilgisinin altında, yatayda köşede (aynı ayar, iki oran).
 *  - Yalnız Story'ye özel yerleşim yatayı değiştirmez.
 *  - Giriş animasyonu: ilk karede görünmez, sonra görünür. Post (JPEG) çıktısında logo var.
 *  - Başlık “alt orta”da yanıt alanının üstünde. SVG logo içe aktarılır (saydam).
 * Çalıştırma: npm run e2e:grafik
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { logoBox, safeRect, textBox } from '../src/core/graphics';
import { runOk } from '../src/media/proc';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const ff = (args: string[]) => runOk('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);

const main = async () => {
  const t0 = Date.now();
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'grafik') : path.join(os.tmpdir(), 'fabrika-grafik');
  const home = path.join(work, 'ev');
  const media = path.join(work, 'medya');
  await rm(work, { recursive: true, force: true });
  await mkdir(media, { recursive: true });

  // Gri arka plan videosu; logo: sol yarı kırmızı, sağ yarı tamamen saydam (400×200)
  await ff(['-f', 'lavfi', '-i', 'color=c=0x808080:size=1920x1080:rate=30:duration=3', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', path.join(media, 'gri.mp4')]);
  const px = Buffer.alloc(400 * 200 * 4);
  for (let y = 0; y < 200; y++) for (let x = 0; x < 400; x++) if (x < 200) px.set([230, 20, 20, 255], (y * 400 + x) * 4);
  await sharp(px, { raw: { width: 400, height: 200, channels: 4 } }).png().toFile(path.join(media, 'logo.png'));
  await writeFile(path.join(media, 'yildiz.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="#1060e0"/></svg>');

  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4855';
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
  /** Render → istenen anın karesi (RGB, çıktı ölçüsünde) */
  const frameOf = async (pid: string, outputId: string, at: number) => {
    const job = await api('POST', `/api/projects/${pid}/render`, { outputId });
    let j: any;
    await waitFor(async () => {
      j = (await api<any[]>('GET', '/api/jobs')).find((x) => x.id === job.id);
      if (j.status === 'error') throw new Error(j.error);
      return j.status === 'done';
    }, 'render');
    let file = path.join(home, j.result.file);
    if (file.endsWith('.mp4')) {
      const png = path.join(work, `kare-${outputId}-${at}.png`);
      await ff(['-ss', String(at), '-i', file, '-frames:v', '1', png]);
      file = png;
    }
    const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    // Kompozisyon 1080 tabanlı; çıktı ölçüsü farklıysa oranla örnekle
    return { at: (x: number, y: number, W: number) => {
      const k = info.width / W;
      const i = (Math.round(y * k) * info.width + Math.round(x * k)) * 3;
      return [data[i], data[i + 1], data[i + 2]];
    } };
  };
  const isRed = ([r, g, b]: number[]) => r > 180 && g < 70 && b < 70;
  const isGray = ([r, g, b]: number[]) => Math.abs(r - 128) < 25 && Math.abs(g - 128) < 25 && Math.abs(b - 128) < 25;

  try {
    const st = await api('POST', '/api/projects', { name: 'Logo testi', formats: [{ format: 'landscape' }, { format: 'story' }, { format: 'post', kind: 'image' }] });
    const pid = st.project.id;
    const imp = await api('POST', '/api/import/paths', { projectId: pid, paths: [path.join(media, 'gri.mp4')] });
    const lg = await api('POST', '/api/import/paths', { paths: [path.join(media, 'logo.png'), path.join(media, 'yildiz.svg')] });
    const [logoA, svgA] = lg.assets;
    await waitFor(async () => {
      const lib = await api<any[]>('GET', '/api/library');
      return [imp.assets[0].id, logoA.id, svgA.id].every((id) => lib.find((a) => a.id === id)?.status === 'ready');
    }, 'içe aktarma');
    const lib = await api<any[]>('GET', '/api/library');
    const L = lib.find((a) => a.id === logoA.id);
    const S = lib.find((a) => a.id === svgA.id);
    check('Saydam PNG ve SVG saydamlığı korunarak içe aktarıldı', L.alpha && L.render.endsWith('.png') && S.alpha && S.kind === 'image' && S.width > 0, `PNG ${L.width}×${L.height}, SVG ${S.width}×${S.height}`);

    let p = (await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'logo.add', assetId: logoA.id }, { type: 'text.add', text: { text: 'BAŞLIK', start: 0, end: 3, anchor: 'bc', size: 90, anim: 'yok' } }] })).project;
    const [land, story, post] = p.outputs;
    const logo = p.logos[0];
    const refL = { width: L.width, height: L.height };

    // Yatay: logo sağ üstte; saydam yarısı gri kalıyor
    const fL = await frameOf(pid, land.id, 1.5);
    const bL = logoBox(logo, refL, land);
    const redL = fL.at(bL.cx - bL.w / 4, bL.cy, 1920);
    const clearL = fL.at(bL.cx + bL.w / 4, bL.cy, 1920);
    check('Yatay: logo sağ üst köşede, saydam kısım saydam', isRed(redL) && isGray(clearL) && bL.cx > 1500 && bL.cy < 250, `kırmızı rgb(${redL}) · saydam rgb(${clearL}) · merkez ${Math.round(bL.cx)},${Math.round(bL.cy)}`);

    // Story: aynı ayar, Instagram üst bilgisinin altında
    const fS = await frameOf(pid, story.id, 1.5);
    const bS = logoBox(logo, refL, story);
    const rS = safeRect(story);
    const redS = fS.at(bS.cx - bS.w / 4, bS.cy, 1080);
    const aboveS = fS.at(bS.cx - bS.w / 4, rS.top - 40, 1080);
    check('Story: logo üst bilgi alanının altında, sağda', isRed(redS) && isGray(aboveS) && bS.cy - bS.h / 2 >= rS.top, `logo üstü ${Math.round(bS.cy - bS.h / 2)} px ≥ güvenli ${rS.top} px`);

    // Başlık: alt orta, yanıt alanının üstünde
    const tb = textBox(p.texts[0], story);
    check('Başlık “alt orta”: yanıt alanının üstünde', tb.cy + tb.h / 2 <= rS.bottom && Math.abs(tb.cx - 540) < 2, `başlık altı ${Math.round(tb.cy + tb.h / 2)} ≤ ${rS.bottom}`);
    const capPix = [0, 1, 2, 3, 4].map((k) => fS.at(tb.cx - tb.w / 3 + (k * tb.w) / 7, tb.cy, 1080));
    check('Başlık render\'da o konumda', capPix.some(([r, g, b]) => r > 220 && g > 220 && b > 220), capPix.map((c) => `rgb(${c})`).join(' '));

    // Animasyon: ilk karede görünmez
    const f0 = await frameOf(pid, land.id, 0);
    check('Giriş animasyonu: ilk karede logo görünmüyor', isGray(f0.at(bL.cx - bL.w / 4, bL.cy, 1920)), `rgb(${f0.at(bL.cx - bL.w / 4, bL.cy, 1920)})`);

    // Post (JPEG): logo var
    const fP = await frameOf(pid, post.id, 0);
    const bP = logoBox(logo, refL, post);
    check('Post (JPEG) çıktısında logo görünüyor', isRed(fP.at(bP.cx - bP.w / 4, bP.cy, 1080)), `rgb(${fP.at(bP.cx - bP.w / 4, bP.cy, 1080)})`);

    // Yalnız Story'de sol alt
    p = (await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'element.place', kind: 'logo', id: logo.id, outputId: story.id, place: { anchor: 'bl', x: 0.5, y: 0.5, scale: 1 } }] })).project;
    const fS2 = await frameOf(pid, story.id, 1.5);
    const bS2 = logoBox(p.logos[0], refL, story);
    const fL2 = await frameOf(pid, land.id, 1.5);
    check('Yalnız Story\'de sol alta taşındı; yatay aynı kaldı', isRed(fS2.at(bS2.cx - bS2.w / 4, bS2.cy, 1080)) && bS2.cx < 400 && bS2.cy > 1300 && isRed(fL2.at(bL.cx - bL.w / 4, bL.cy, 1920)), `Story merkez ${Math.round(bS2.cx)},${Math.round(bS2.cy)}`);

    // Saydamlık %50
    await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'logo.update', id: logo.id, patch: { opacity: 0.5 } }] });
    const fH = await frameOf(pid, land.id, 1.5);
    const half = fH.at(bL.cx - bL.w / 4, bL.cy, 1920);
    check('Saydamlık %50: renk arada', half[0] > 150 && half[0] < 210 && half[1] > 50 && half[1] < 110, `rgb(${half})`);
  } catch (e) {
    check('Test akışı tamamlandı', false, (e as Error).message);
  } finally {
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
