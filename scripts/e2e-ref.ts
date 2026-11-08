/**
 * Faz 4.2 kabul testi: referanstan renk eşleme.
 *  - Soğuk tonlu bir video klibe, sıcak bir fotoğraf referansından renk eşlenir; render'da renk farkı ölçülür.
 *  - Video referansta seçilen kare sonucu belirler (turuncu kare → sıcak, camgöbeği kare → soğuk).
 *  - Referanslar kurguya girmez, Medya listesinde görünmez (rol), eşleme LUT'u #referans etiketiyle kaydedilir.
 * Çalıştırma: npm run e2e:ref
 */
import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { colorStats } from '../src/core/colormatch';
import { runOk } from '../src/media/proc';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const ff = (args: string[]) => runOk('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);
const labDist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const main = async () => {
  const t0 = Date.now();
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'referans') : path.join(os.tmpdir(), 'fabrika-referans');
  const home = path.join(work, 'ev');
  const media = path.join(work, 'medya');
  await rm(work, { recursive: true, force: true });
  await mkdir(media, { recursive: true });

  // Hedef: soğuk, soluk tonlu video (renk desenli) · Referans: sıcak fotoğraf · Referans video: 0–2 sn turuncu, 2–4 sn camgöbeği
  // Düz tonlu, hafif kumlu görüntüler: 4:5 kırpma ölçümü etkilemez
  await ff(['-f', 'lavfi', '-i', 'color=c=0x7088A0:size=1280x720:rate=30:duration=4', '-vf', 'noise=alls=30:allf=t', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', path.join(media, 'soguk.mp4')]);
  await ff(['-f', 'lavfi', '-i', 'color=c=0xC8A080:size=1200x800', '-vf', 'noise=alls=30', '-frames:v', '1', '-q:v', '3', path.join(media, 'sicak-ref.jpg')]);
  await ff([
    '-f', 'lavfi', '-i', 'color=c=0xE08030:size=640x360:rate=30:duration=2',
    '-f', 'lavfi', '-i', 'color=c=0x30B0C0:size=640x360:rate=30:duration=2',
    '-filter_complex', '[0:v][1:v]concat=n=2:v=1[v]', '-map', '[v]', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', path.join(media, 'ref-video.mp4'),
  ]);

  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4854';
  process.env.FABRIKA_TRANSCRIBER = 'fixture';
  process.env.FABRIKA_FIXTURES = media;
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
  const ready = (ids: string[]) =>
    waitFor(async () => {
      const lib = await api<any[]>('GET', '/api/library');
      return ids.every((id) => lib.find((a) => a.id === id)?.status === 'ready');
    }, 'içe aktarma');
  const uploadRef = async (pid: string, file: string) => {
    const fd = new FormData();
    fd.append('files', new Blob([new Uint8Array(await readFile(path.join(media, file)))]), file);
    const r = await fetch(`${base}/api/import?projectId=${pid}&role=reference`, { method: 'POST', body: fd });
    return r.json();
  };

  try {
    const st = await api('POST', '/api/projects', { name: 'Referans testi', formats: [{ format: 'landscape' }, { format: 'post', kind: 'image' }] });
    const pid = st.project.id;
    const imp = await api('POST', '/api/import/paths', { projectId: pid, paths: [path.join(media, 'soguk.mp4')] });
    const clip = imp.state.project.clips[0];
    const r1 = await uploadRef(pid, 'sicak-ref.jpg');
    const r2 = await uploadRef(pid, 'ref-video.mp4');
    await ready([clip.assetId, r1.assets[0].id, r2.assets[0].id]);
    let proj = (await api('GET', `/api/projects/${pid}`)).project;
    const lib = await api<any[]>('GET', '/api/library');
    check(
      'Referanslar eklendi; kurguya girmedi; rolleri “referans”',
      proj.references.length === 2 && proj.clips.length === 1 && [r1, r2].every((r) => lib.find((a) => a.id === r.assets[0].id)?.role === 'reference'),
      `${proj.references.length} referans, ${proj.clips.length} klip`,
    );
    const [refImg, refVid] = proj.references;

    // 1) Fotoğraf referansı → klibe
    const m1 = await api('POST', `/api/projects/${pid}/color-match`, { referenceId: refImg.id, clipId: clip.id });
    check('Eşleme özeti: referans daha sıcak', m1.summary.join(' ').includes('sıcak'), m1.summary.join(' · '));
    const luts: any[] = m1.luts;
    const ml = luts.find((l) => l.id === m1.lutId);
    check('Eşleme LUT\'u kaydedildi (#referans)', !!ml && ml.meta.tags.includes('referans') && ml.meta.kind === 'gorunum', ml?.title);

    // Render karşılaştırması (JPEG): eşlemesiz vs eşlemeli, referansa uzaklık
    const post = proj.outputs.find((o: any) => o.kind === 'image');
    await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'output.setStill', outputId: post.id, clipId: clip.id, at: 2 }] });
    const render = async () => {
      const job = await api('POST', `/api/projects/${pid}/render`, { outputId: post.id });
      let j: any;
      await waitFor(async () => {
        j = (await api<any[]>('GET', '/api/jobs')).find((x) => x.id === job.id);
        if (j.status === 'error') throw new Error(j.error);
        return j.status === 'done';
      }, 'render');
      const { data } = await sharp(path.join(home, j.result.file)).resize(160, 200).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      return colorStats(data, 3);
    };
    const refStats = colorStats((await sharp(path.join(media, 'sicak-ref.jpg')).resize(160, 100).removeAlpha().raw().toBuffer()), 3);
    const plain = await render();
    await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'clip.setLook', clipId: clip.id, look: { lut: m1.lutId, lutIntensity: 1 } }] });
    const matched = await render();
    const d0 = labDist(plain.mean, refStats.mean);
    const d1 = labDist(matched.mean, refStats.mean);
    check('Render\'da renk referansa yaklaştı', d1 < d0 * 0.6, `Lab uzaklığı ${d0.toFixed(1)} → ${d1.toFixed(1)}`);
    check('Render daha sıcak (b* arttı)', matched.mean[2] > plain.mean[2] + 8, `b* ${plain.mean[2].toFixed(1)} → ${matched.mean[2].toFixed(1)}`);

    // 2) Video referansta kare seçimi
    await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'reference.update', id: refVid.id, patch: { at: 1 } }] });
    const mA = await api('POST', `/api/projects/${pid}/color-match`, { referenceId: refVid.id, clipId: null });
    await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'reference.update', id: refVid.id, patch: { at: 3 } }] });
    const mB = await api('POST', `/api/projects/${pid}/color-match`, { referenceId: refVid.id, clipId: null });
    check('Video referansta seçilen kare sonucu belirliyor (turuncu kare → kırmızıya, camgöbeği → yeşile)', mA.summary.join(' ').includes('pembe/kırmızı') && mB.summary.join(' ').includes('yeşil') && mA.lutId !== mB.lutId, `1. sn: ${mA.summary.join(', ')} | 3. sn: ${mB.summary.join(', ')}`);
    check('Renk örnekleri (referans / klip)', /^#[0-9a-f]{6}$/.test(mA.swatches.reference) && /^#[0-9a-f]{6}$/.test(mA.swatches.target), `${mA.swatches.reference} / ${mA.swatches.target}`);

    // 3) Referans kaldırılınca kurgu etkilenmez
    proj = (await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'reference.remove', id: refImg.id }] })).project;
    check('Referans kaldırıldı, kurgu ve uygulanan renk yerinde', proj.references.length === 1 && proj.clips[0].look?.lut === m1.lutId);
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
