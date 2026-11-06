/**
 * Faz 1 kabul testinin otomatik sürümü (sunucu API'si üzerinden, arayüzün yaptığı işlemlerle).
 *   npm run e2e              → test medyası üretir, senaryoyu çalıştırır, çıktıları doğrular
 * Ortam: FABRIKA_TRANSCRIBER=fixture ile kesin kelime zamanlı test çözümleyicisi kullanılır.
 * Gerçek Whisper ile denemek için: FABRIKA_E2E_REAL_WHISPER=1 npm run e2e
 */
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { runOk, run } from '../src/media/proc';

const t0 = Date.now();
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};

const main = async () => {
  const work = process.env.FABRIKA_E2E_DIR ?? (await mkdtemp(path.join(os.tmpdir(), 'fabrika-e2e-')));
  const media = path.join(work, 'medya');
  const home = path.join(work, 'ev');
  await rm(home, { recursive: true, force: true });
  console.log(`Çalışma klasörü: ${work}`);
  await runOk('npx', ['tsx', path.join('scripts', 'make-test-media.ts'), media]);

  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4848';
  if (!process.env.FABRIKA_E2E_REAL_WHISPER) {
    process.env.FABRIKA_TRANSCRIBER = 'fixture';
    process.env.FABRIKA_FIXTURES = media;
  }
  const { createServer } = await import('../src/server/index');
  const { app, svc } = await createServer(home);
  const port = Number(process.env.FABRIKA_PORT);
  await app.listen({ port, host: '127.0.0.1' });
  const base = `http://127.0.0.1:${port}`;
  const api = async <T = any>(method: string, url: string, body?: unknown): Promise<T> => {
    const r = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json();
    if (!r.ok) throw new Error(`${method} ${url}: ${j.error}`);
    return j as T;
  };
  const waitFor = async (pred: () => Promise<boolean>, label: string, ms = 600_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await pred()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Zaman aşımı: ${label}`);
  };

  try {
    // 1) Proje: Story + 4:5 post (fotoğraf)
    let st = await api('POST', '/api/projects', { name: 'Kafe Story', formats: [{ format: 'story' }, { format: 'post', kind: 'image' }] });
    const pid = st.project.id;
    const story = st.project.outputs.find((o: any) => o.format === 'story');
    const post = st.project.outputs.find((o: any) => o.format === 'post');

    // 2) Üç dosya tek seferde (seçim sırası korunur)
    const imp = await api('POST', '/api/import/paths', {
      projectId: pid,
      paths: ['foto.jpg', 'ortam.mp4', 'konusma.mp4'].map((f) => path.join(media, f)),
    });
    st = imp.state;
    check('Üç dosya tek seferde içe aktarıldı', st.project.clips.length === 3, `${st.project.clips.length} klip`);
    const [cFoto, cOrtam, cKonusma] = st.project.clips;
    const ids = imp.assets.map((a: any) => a.id);
    await waitFor(async () => {
      const lib = await api<any[]>('GET', '/api/library');
      return ids.every((id: string) => {
        const a = lib.find((x) => x.id === id);
        return a.status === 'ready' && !['pending', 'running'].includes(a.transcript.status);
      });
    }, 'içe aktarma ve çözümleme');
    const lib = await api<any[]>('GET', '/api/library');
    const A = (id: string) => lib.find((x) => x.id === id);
    const foto = A(cFoto.assetId);
    const ortam = A(cOrtam.assetId);
    const kon = A(cKonusma.assetId);
    check('Fotoğraf yönü düzeltildi (EXIF)', foto.height > foto.width, `${foto.width}×${foto.height}`);
    check('Dikey telefon klibi doğru yönde', kon.height > kon.width, `${kon.width}×${kon.height} (dönüş ${kon.rotation}°)`);
    check('4K ortam videosu algılandı', ortam.width === 3840, `${ortam.width}×${ortam.height}, önizleme kopyası hazır`);
    check('Türkçe konuşma çözüldü', kon.transcript.status === 'done' && kon.transcript.words.length >= 5, `${kon.transcript.words.length} kelime · ${kon.transcript.engine}`);
    check('Ortam videosunda uydurma altyazı yok', ortam.transcript.words.length === 0, ortam.transcript.status);

    // 3) Kurgu: fotoğraf 3 sn, ortamdan 3 sn, konuşma cümlesi
    const lastWord = kon.transcript.words.at(-1).t1;
    const firstWord = kon.transcript.words[0].t0;
    st = await api('POST', `/api/projects/${pid}/ops`, {
      ops: [
        { type: 'clip.trim', clipId: cFoto.id, in: 0, out: 3 },
        { type: 'clip.trim', clipId: cOrtam.id, in: 1.5, out: 4.5 },
        { type: 'clip.trim', clipId: cKonusma.id, in: Math.max(0, firstWord - 0.4), out: Math.min(kon.duration, lastWord + 0.6) },
        { type: 'clip.update', clipId: cOrtam.id, patch: { gainDb: -20 } },
        { type: 'look.set', look: { preset: 'sicak', intensity: 0.35 } },
        { type: 'output.setFraming', outputId: story.id, clipId: cOrtam.id, framing: { mode: 'fill', x: 0.35 } },
      ],
    });
    // 4) Müzik (konuşma algılandığı için "Konuşmada kıs" önerilir)
    const mimp = await api('POST', '/api/import/paths', { projectId: pid, paths: [path.join(media, 'muzik.m4a')] });
    st = mimp.state;
    check('Müzik eklendi, konuşma algılandığı için "Konuşmada kıs" seçildi', st.project.music?.mode === 'duck', st.project.music?.mode);
    await waitFor(async () => A(mimp.assets[0].id)?.status === 'ready' || (await api('GET', `/api/assets/${mimp.assets[0].id}`)).status === 'ready', 'müzik');

    // 5) Altyazı düzeltme: ikinci kelime
    const key = `${kon.id}:1`;
    st = await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'captions.editWord', key, text: 'BUGÜN' }] });
    check('Altyazı kelimesi düzeltildi', st.project.captions.edits[key] === 'BUGÜN');

    // 6) Post kadrajını kaydır → Story kadrajı korunmalı
    const storyFramingBefore = JSON.stringify(st.project.outputs.find((o: any) => o.id === story.id).framing[cFoto.id] ?? null);
    st = await api('POST', `/api/projects/${pid}/ops`, {
      ops: [{ type: 'output.setFraming', outputId: post.id, clipId: cFoto.id, framing: { x: 0.62, y: 0.4, zoom: 1.25 } }],
    });
    const storyFramingAfter = JSON.stringify(st.project.outputs.find((o: any) => o.id === story.id).framing[cFoto.id] ?? null);
    check('Post kadrajı Story kadrajını değiştirmedi', storyFramingBefore === storyFramingAfter);
    check('Post karesi açılış fotoğrafı', st.project.outputs.find((o: any) => o.id === post.id).still?.clipId === cFoto.id);

    // 7) Geri al / yinele
    const un = await api('POST', `/api/projects/${pid}/undo`);
    const re = await api('POST', `/api/projects/${pid}/redo`);
    check('Geri al / yinele', !un.project.outputs.find((o: any) => o.id === post.id).framing[cFoto.id] && !!re.project.outputs.find((o: any) => o.id === post.id).framing[cFoto.id]);

    // 8) Uygulamayı kapatıp açma: yeni bir depo örneği aynı klasörü okur
    await api('POST', `/api/projects/${pid}/ui`, { step: 'altyazi', selectedClipId: cKonusma.id });
    const { Store } = await import('../src/server/store');
    const fresh = new Store(home);
    await fresh.init();
    const reopened = await fresh.getProject(pid);
    check(
      'Yeniden açınca proje, son adım ve düzeltme yerinde',
      fresh.state.lastProjectId === pid && reopened.ui.step === 'altyazi' && reopened.captions.edits[key] === 'BUGÜN' && reopened.clips.length === 3,
      `son proje=${fresh.state.lastProjectId === pid}, adım=${reopened.ui.step}`,
    );

    // Oynatma konumu kaydı (önizleme bunu sık yapar) son adımı bozmamalı
    await api('POST', `/api/projects/${pid}/ui`, { frame: 120 });
    const stUi = await api('GET', `/api/projects/${pid}`);
    check('Oynatma konumu kaydı son adımı korur', stUi.project.ui.step === 'altyazi' && stUi.project.ui.frame === 120, `adım=${stUi.project.ui.step}`);

    // 9) Dışa aktarma: Story (müzikli + müziksiz) ve 4:5 post
    const renderIn = async (projectId: string, outputId: string, variant = 'full') => {
      const job = await api('POST', `/api/projects/${projectId}/render`, { outputId, variant });
      let j: any;
      await waitFor(async () => {
        j = (await api<any[]>('GET', '/api/jobs')).find((x) => x.id === job.id);
        if (j.status === 'error') throw new Error(`Render hatası: ${j.error}`);
        return j.status === 'done';
      }, 'render', 1_800_000);
      return j.result;
    };
    const render = (outputId: string, variant = 'full') => renderIn(pid, outputId, variant);
    const tStory = Date.now();
    const eStory = await render(story.id);
    const storySec = (Date.now() - tStory) / 1000;
    const eNoMusic = await render(story.id, 'nomusic');
    const ePost = await render(post.id);
    for (const e of [eStory, eNoMusic, ePost]) {
      check(`Çıktı doğrulandı: ${e.name}`, e.verification.ok, e.verification.checks.map((c: any) => `${c.label}: ${c.detail}`).join(' · '));
    }
    check('Story süresi ≈15 sn', Math.abs(eStory.verification.duration - 15) < 2.5, `${eStory.verification.duration.toFixed(2)} sn (render ${storySec.toFixed(0)} sn)`);

    // 10) Müzik kısma ölçümü: müzikli − müziksiz = yalnız müzik
    const full = path.join(home, eStory.file);
    const nomus = path.join(home, eNoMusic.file);
    const musicLevel = async (from: number, to: number) => {
      const r = await run('ffmpeg', [
        '-hide_banner', '-i', full, '-i', nomus, '-filter_complex',
        `[0:a]atrim=${from}:${to},pan=mono|c0=c0[a];[1:a]atrim=${from}:${to},pan=mono|c0=c0,volume=-1[b];[a][b]amix=inputs=2:normalize=0,volumedetect`,
        '-f', 'null', '-',
      ]);
      return Number(/mean_volume:\s*(-?[\d.]+)/.exec(r.stderr)?.[1] ?? '-99');
    };
    const speechStart = 6 + 0.4; // fotoğraf 3 + ortam 3 + konuşma öncesi 0.4
    const onPhoto = await musicLevel(1, 2.5);
    const inSpeech = await musicLevel(speechStart + 1, speechStart + 3);
    check('Müzik fotoğrafta duyuluyor, konuşmada kısılıyor', onPhoto - inSpeech >= 8, `fotoğrafta ${onPhoto.toFixed(1)} dB, konuşmada ${inSpeech.toFixed(1)} dB`);

    // 11) Sessiz klip: altyazı atlanır, çıktı yine üretilir
    const s2 = await api('POST', '/api/projects', { name: 'Sessiz deneme', formats: [{ format: 'reel' }] });
    const imp2 = await api('POST', '/api/import/paths', { projectId: s2.project.id, paths: [path.join(media, 'sessiz.mp4')] });
    await waitFor(async () => {
      const a = await api('GET', `/api/assets/${imp2.assets[0].id}`);
      return a.status === 'ready' && !['pending', 'running'].includes(a.transcript.status);
    }, 'sessiz klip');
    const sa = await api('GET', `/api/assets/${imp2.assets[0].id}`);
    check('Sessiz klipte altyazı atlandı', sa.transcript.status === 'silent', sa.transcript.message);
    const job2 = await api('POST', `/api/projects/${s2.project.id}/render`, { outputId: s2.project.outputs[0].id });
    let j2: any;
    await waitFor(async () => {
      j2 = (await api<any[]>('GET', '/api/jobs')).find((x) => x.id === job2.id);
      if (j2.status === 'error') throw new Error(j2.error);
      return j2.status === 'done';
    }, 'sessiz render', 900_000);
    check('Sessiz klipten Reel üretildi', j2.result.verification.ok, j2.result.verification.checks.map((c: any) => c.detail).join(' · '));

    // 12) Renk: kamera log dönüşümü ve kendi .cube LUT'um render'a uygulanıyor mu?
    const s3 = await api('POST', '/api/projects', { name: 'LUT testi', formats: [{ format: 'post', kind: 'image' }] });
    const p3 = s3.project.id;
    const imp3 = await api('POST', '/api/import/paths', { projectId: p3, paths: [path.join(media, 'ortam.mp4')] });
    check('Aynı dosya ikinci kez kopyalanmadı (kütüphane)', imp3.assets[0].id === ortam.id);
    const c3 = imp3.state.project.clips[0].id;
    const o3 = imp3.state.project.outputs[0].id;
    const ops3 = (ops: unknown[]) => api('POST', `/api/projects/${p3}/ops`, { ops });
    // Piksel piksel karşılaştırma (aynı ölçü, RGB)
    const pixels = async (rel: string) => (await sharp(path.join(home, rel)).removeAlpha().raw().toBuffer());
    const meanAbsDiff = (a: Buffer, b: Buffer, invert = false) => {
      let s = 0;
      for (let i = 0; i < a.length; i++) s += Math.abs((invert ? 255 - a[i] : a[i]) - b[i]);
      return s / a.length;
    };
    await ops3([{ type: 'output.setStill', outputId: o3, clipId: c3, at: 1 }, { type: 'clip.update', clipId: c3, patch: { camera: 'none' } }]);
    const eA = await renderIn(p3, o3);
    await ops3([{ type: 'clip.update', clipId: c3, patch: { camera: 'sony-slog3-sgamut3cine' } }]);
    const eB = await renderIn(p3, o3);
    const fd = new FormData();
    const inv = ['LUT_3D_SIZE 2', '1 1 1', '0 1 1', '1 0 1', '0 0 1', '1 1 0', '0 1 0', '1 0 0', '0 0 0'].join('\n');
    fd.append('files', new Blob([inv]), 'ters.cube');
    const lutRes = await (await fetch(`${base}/api/luts`, { method: 'POST', body: fd })).json();
    await ops3([{ type: 'clip.update', clipId: c3, patch: { camera: 'none' } }, { type: 'look.set', look: { lut: lutRes.added[0].id, lutIntensity: 1 } }]);
    const eC = await renderIn(p3, o3);
    const [pA, pB, pC] = [await pixels(eA.file), await pixels(eB.file), await pixels(eC.file)];
    check('Üç ayrı çıktı dosyası (üzerine yazılmadı)', new Set([eA.file, eB.file, eC.file]).size === 3, [eA.name, eB.name, eC.name].join(', '));
    const dB = meanAbsDiff(pA, pB);
    check('Kamera log dönüşümü (S-Log3) render\'a uygulandı', dB > 5, `LUT'suz ile ortalama piksel farkı ${dB.toFixed(1)}`);
    const dC = meanAbsDiff(pA, pC, true);
    check('Kendi .cube LUT\'um (ters çevirme) render\'a uygulandı', dC < 6, `ters görüntüden ortalama sapma ${dC.toFixed(1)} / 255`);

    console.log(`\nÇıktılar: ${path.join(home, 'projeler', pid, 'exports')}`);
  } finally {
    await app.close();
    void svc;
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} kontrol geçti · ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => {
  console.error('\n✗ Test durdu:', e.message);
  process.exit(1);
});
