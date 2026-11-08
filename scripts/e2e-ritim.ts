/**
 * Faz 4.4 kabul testi: ritim ve hareket.
 *  - Müzik (WAV, 128 BPM metronom) içe aktarılınca tempo ve vuruşlar yerelde bulunur.
 *  - “Kesimleri müziğe oturt” komutu → render'daki gerçek kesimler (sahne değişimi) vuruşlara denk gelir.
 *  - Ken Burns “yavaşça yakınlaş”: render'da ortadaki nesne sonda büyümüş olur.
 *  - Referansta bölge seçimi: yazı bandı dışarıda kalınca eşleme sonucu değişir.
 * Çalıştırma: npm run e2e:ritim
 */
import { mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { run, runOk } from '../src/media/proc';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const ff = (args: string[]) => runOk('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);

/** 16 bit mono WAV: her vuruşta tık + alttan sürekli bas */
const metronomeWav = (bpm: number, seconds: number, offset: number) => {
  const rate = 22050;
  const n = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  const period = 60 / bpm;
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    let v = 0.08 * Math.sin(2 * Math.PI * 55 * t);
    const k = Math.floor((t - offset) / period);
    const dt = t - offset - k * period;
    if (t >= offset && dt < 0.06) v += 0.7 * Math.sin(2 * Math.PI * 1000 * dt) * Math.exp(-dt / 0.012);
    buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(v * 32767))), 44 + i * 2);
  }
  return buf;
};

const main = async () => {
  const t0 = Date.now();
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'ritim') : path.join(os.tmpdir(), 'fabrika-ritim');
  const home = path.join(work, 'ev');
  const media = path.join(work, 'medya');
  await rm(work, { recursive: true, force: true });
  await mkdir(media, { recursive: true });

  const BPM = 128;
  const OFFSET = 0.25;
  await writeFile(path.join(media, 'muzik.wav'), metronomeWav(BPM, 30, OFFSET));
  // Üç düz renkli fotoğraf (kesimler sahne değişimiyle bulunur) + ortasında kırmızı kare olan fotoğraf (Ken Burns)
  const colors = [
    [40, 90, 200],
    [220, 200, 40],
    [40, 170, 80],
  ];
  for (let i = 0; i < 3; i++) await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: colors[i][0], g: colors[i][1], b: colors[i][2] } } }).jpeg().toFile(path.join(media, `renk${i}.jpg`));
  const sq = await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 230, g: 20, b: 20 } } }).png().toBuffer();
  await sharp({ create: { width: 1920, height: 1080, channels: 3, background: { r: 128, g: 128, b: 128 } } }).composite([{ input: sq, left: 760, top: 340 }]).jpeg().toFile(path.join(media, 'kare.jpg'));
  // Referans: üst %70 mavi yazı bandı, alt %30 sıcak turuncu
  const band = await sharp({ create: { width: 1200, height: 560, channels: 3, background: { r: 30, g: 60, b: 200 } } }).png().toBuffer();
  await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 225, g: 140, b: 60 } } }).composite([{ input: band, left: 0, top: 0 }]).jpeg().toFile(path.join(media, 'ref.jpg'));

  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4856';
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
  const render = async (pid: string, outputId: string) => {
    const job = await api('POST', `/api/projects/${pid}/render`, { outputId });
    let j: any;
    await waitFor(async () => {
      j = (await api<any[]>('GET', '/api/jobs')).find((x) => x.id === job.id);
      if (j.status === 'error') throw new Error(j.error);
      return j.status === 'done';
    }, 'render');
    return path.join(home, j.result.file);
  };

  try {
    // 1) Müzik → vuruşlar
    const st = await api('POST', '/api/projects', { name: 'Ritim testi', formats: [{ format: 'landscape' }] });
    const pid = st.project.id;
    const imp = await api('POST', '/api/import/paths', { projectId: pid, paths: ['renk0.jpg', 'renk1.jpg', 'renk2.jpg', 'muzik.wav'].map((f) => path.join(media, f)) });
    const musicId = imp.assets[3].id;
    await waitFor(async () => {
      const lib = await api<any[]>('GET', '/api/library');
      return imp.assets.every((a: any) => lib.find((x) => x.id === a.id)?.status === 'ready') && !!lib.find((x) => x.id === musicId)?.beats;
    }, 'vuruşlar');
    const ma = (await api<any[]>('GET', '/api/library')).find((x) => x.id === musicId);
    const period = 60 / BPM;
    const errs = ma.beats.beats.slice(1, -1).map((b: number) => Math.abs(b - (OFFSET + Math.round((b - OFFSET) / period) * period)));
    check('Müzik vuruşları bulundu (128 BPM)', Math.abs(ma.beats.bpm - BPM) < 2 && Math.max(...errs) < 0.04, `${ma.beats.bpm} BPM, ${ma.beats.beats.length} vuruş, en büyük sapma ${(Math.max(...errs) * 1000).toFixed(0)} ms`);

    // 2) Kesimleri müziğe oturt → render'daki kesimler vuruşta
    let p = (await api('GET', `/api/projects/${pid}`)).project;
    check('Müzik projeye eklendi', p.music?.assetId === musicId && p.clips.length === 3);
    const plan = await api('POST', `/api/projects/${pid}/command`, { text: 'Kesimleri müziğe oturt', playhead: 0 });
    check('Komut anlaşıldı', plan.understood && plan.ops.length >= 1, plan.summary);
    p = (await api('POST', `/api/projects/${pid}/ops`, { ops: plan.ops })).project;
    const file = await render(pid, p.outputs[0].id);
    const sc = await run('ffmpeg', ['-hide_banner', '-i', file, '-vf', "select='gt(scene,0.3)',showinfo", '-f', 'null', '-']);
    const cuts = [...sc.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
    const beatsTl = ma.beats.beats.map((b: number) => b - (p.music.start ?? 0));
    const off = cuts.map((c) => Math.min(...beatsTl.map((b: number) => Math.abs(b - c))));
    check('Render\'daki kesimler vuruşlara denk geliyor (≤ 1 kare + 20 ms)', cuts.length === 2 && Math.max(...off) <= 1 / 30 + 0.02, `kesimler ${cuts.map((c) => c.toFixed(3)).join(', ')} sn · vuruşa uzaklık ${off.map((o) => (o * 1000).toFixed(0)).join(', ')} ms`);

    // 3) Ken Burns: yavaşça yakınlaş
    const st2 = await api('POST', '/api/projects', { name: 'Hareket testi', formats: [{ format: 'landscape' }] });
    const p2 = st2.project.id;
    const imp2 = await api('POST', '/api/import/paths', { projectId: p2, paths: [path.join(media, 'kare.jpg')] });
    await waitFor(async () => (await api<any[]>('GET', '/api/library')).find((x) => x.id === imp2.assets[0].id)?.status === 'ready', 'fotoğraf');
    const c2 = imp2.state.project.clips[0];
    const mplan = await api('POST', `/api/projects/${p2}/command`, { text: 'Bu klipte çok yavaşça yakınlaş', playhead: 0 });
    await api('POST', `/api/projects/${p2}/ops`, { ops: mplan.ops });
    const f2 = await render(p2, imp2.state.project.outputs[0].id);
    const redShare = async (at: number) => {
      const png = path.join(work, `kb-${at}.png`);
      await ff(['-ss', String(at), '-i', f2, '-frames:v', '1', png]);
      const { data } = await sharp(png).resize(192, 108).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      let red = 0;
      for (let i = 0; i < data.length; i += 3) if (data[i] > 180 && data[i + 1] < 80) red++;
      return red / (data.length / 3);
    };
    const r0 = await redShare(0.05);
    const r1 = await redShare(2.9);
    check('Ken Burns: ortadaki kare sonda büyümüş (%30 yakınlaşma → alan ≈ ×1,69)', r1 / r0 > 1.45 && r1 / r0 < 1.95, `kırmızı alan %${(r0 * 100).toFixed(1)} → %${(r1 * 100).toFixed(1)} (×${(r1 / r0).toFixed(2)})`);

    // 4) Referansta bölge
    const ref = await (async () => {
      const fd = new FormData();
      const { readFile } = await import('node:fs/promises');
      fd.append('files', new Blob([new Uint8Array(await readFile(path.join(media, 'ref.jpg')))]), 'ref.jpg');
      return (await fetch(`${base}/api/import?projectId=${p2}&role=reference`, { method: 'POST', body: fd })).json();
    })();
    await waitFor(async () => (await api<any[]>('GET', '/api/library')).find((x) => x.id === ref.assets[0].id)?.status === 'ready', 'referans');
    const refId = ref.state.project.references[0].id;
    const whole = await api('POST', `/api/projects/${p2}/color-match`, { referenceId: refId, clipId: c2.id });
    await api('POST', `/api/projects/${p2}/ops`, { ops: [{ type: 'reference.update', id: refId, patch: { region: { x: 0, y: 0.75, w: 1, h: 0.25 } } }] });
    const part = await api('POST', `/api/projects/${p2}/color-match`, { referenceId: refId, clipId: c2.id });
    check('Bölge seçimi: yazı bandı dışarıda kalınca sonuç sıcak', !whole.summary.join(' ').includes('sıcak') && part.summary.join(' ').includes('sıcak'), `tüm kare: ${whole.summary.join(', ')} | bölge: ${part.summary.join(', ')}`);
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
