/**
 * Faz 2 kabul testi (Kurgu Stüdyosu, konuşarak kurgu):
 *  1) Yatay konuşma videosu + yakın plan yüklenir.
 *  2) Mikrofon yolu (/api/stt) ile iki revizyon verilir:
 *     "İkinci kez söylediğim cümleyi çıkar" ve
 *     "Ürünün adını söylediğim yerde yüklediğim yakın planı iki saniye göster, sesim devam etsin".
 *  3) Render: kesme uygulanmış, yakın plan doğru anda görünür, ses o sırada sürer.
 *  4) İki kez geri al → render: önceki kurgu yeniden üretilir.
 * Çalıştırma: npm run e2e:studio
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { run, runOk, which } from '../src/media/proc';

const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const ff = (args: string[]) => runOk('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);

const SPEECH = 'Merhaba, bugün yeni ürünümüzü tanıtıyorum. Bu kahve çok güzel. Bu kahve çok güzel. Adı da Kahvemiz ve çok lezzetli.';

const makeMedia = async (dir: string) => {
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, 'tmp');
  await mkdir(tmp, { recursive: true });
  const espeak = await which('espeak-ng');
  const words = SPEECH.split(' ');
  const list: string[] = [];
  const timed: { t0: number; t1: number; text: string }[] = [];
  let t = 1.0;
  await ff(['-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(t), path.join(tmp, 'pre.wav')]);
  list.push(`file '${path.join(tmp, 'pre.wav')}'`);
  for (let i = 0; i < words.length; i++) {
    const wav = path.join(tmp, `w${i}.wav`);
    if (espeak) await runOk(espeak, ['-v', 'tr', '-s', '160', '-w', wav, words[i].replace(/[.,]/g, '')]);
    else await ff(['-f', 'lavfi', '-i', `sine=frequency=${220 + i * 15}:duration=0.35`, '-ar', '22050', '-ac', '1', wav]);
    const tr = path.join(tmp, `t${i}.wav`);
    await ff(['-i', wav, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', '-ar', '22050', '-ac', '1', tr]);
    const d = Number((await runOk('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tr])).stdout.trim());
    timed.push({ t0: +t.toFixed(3), t1: +(t + d).toFixed(3), text: words[i] });
    list.push(`file '${tr}'`);
    const gap = /[.]$/.test(words[i]) ? 0.6 : /,$/.test(words[i]) ? 0.3 : 0.08;
    const g = path.join(tmp, `g${i}.wav`);
    await ff(['-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(gap), g]);
    list.push(`file '${g}'`);
    t += d + gap;
  }
  await writeFile(path.join(tmp, 'list.txt'), list.join('\n'));
  const speech = path.join(tmp, 'speech.wav');
  await ff(['-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-ar', '48000', speech]);
  const dur = Math.ceil(t + 1);
  await ff([
    '-f', 'lavfi', '-i', `testsrc2=size=1920x1080:rate=30:duration=${dur}`, '-i', speech,
    '-filter_complex', '[1:a]apad[a]', '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', String(dur),
    path.join(dir, 'yatay.mp4'),
  ]);
  await writeFile(path.join(dir, 'yatay.mp4.words.json'), JSON.stringify(timed, null, 2));
  // Yakın plan: düz kırmızı (karede kolay ayırt edilir)
  await ff(['-f', 'lavfi', '-i', 'color=c=0xD02020:size=1920x1080:rate=30:duration=5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(dir, 'yakin.mp4')]);
  // Mikrofon kaydı yerine geçen kısa ses (içerik test çözümleyicisinden gelir)
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.5', path.join(dir, 'mikrofon.wav')]);
  await rm(tmp, { recursive: true, force: true });
  return { timed, dur };
};

const main = async () => {
  const t0 = Date.now();
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'studyo') : await mkdtemp(path.join(os.tmpdir(), 'fabrika-studyo-'));
  const media = path.join(work, 'medya');
  const home = path.join(work, 'ev');
  await rm(home, { recursive: true, force: true });
  const { timed, dur } = await makeMedia(media);
  console.log(`Test medyası: ${dur} sn yatay konuşma, ${timed.length} kelime`);

  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4849';
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
    if (!r.ok) throw new Error(`${method} ${url}: ${j.error}`);
    return j as T;
  };
  const waitFor = async (pred: () => Promise<boolean>, label: string, ms = 900_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await pred()) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`Zaman aşımı: ${label}`);
  };
  /** Mikrofon yolu: ses dosyası → /api/stt → metin → plan → işlemler */
  const speak = async (pid: string, sentence: string, playhead = 0) => {
    process.env.FABRIKA_STT_FIXTURE = sentence;
    const fd = new FormData();
    fd.append('files', new Blob([await import('node:fs/promises').then((f) => f.readFile(path.join(media, 'mikrofon.wav')))]), 'mikrofon.wav');
    const stt = await (await fetch(`${base}/api/stt`, { method: 'POST', body: fd })).json();
    const plan = await api('POST', `/api/projects/${pid}/command`, { text: stt.text, playhead });
    return { text: stt.text as string, plan };
  };
  const render = async (pid: string, outputId: string) => {
    const job = await api('POST', `/api/projects/${pid}/render`, { outputId });
    let j: any;
    await waitFor(async () => {
      j = (await api<any[]>('GET', '/api/jobs')).find((x) => x.id === job.id);
      if (j.status === 'error') throw new Error(`Render hatası: ${j.error}`);
      return j.status === 'done';
    }, 'render', 1_800_000);
    return j.result;
  };
  const frameAt = async (rel: string, sec: number) => {
    const out = path.join(work, `kare-${sec}.png`);
    await ff(['-ss', String(sec), '-i', path.join(home, rel), '-frames:v', '1', out]);
    const st = await sharp(out).stats();
    const [r, g, b] = st.channels.map((c) => c.mean);
    return { r, g, b, red: r > 150 && g < 80 && b < 80 };
  };
  const loudness = async (rel: string, from: number, to: number) => {
    const r = await run('ffmpeg', ['-hide_banner', '-i', path.join(home, rel), '-af', `atrim=${from}:${to},volumedetect`, '-f', 'null', '-']);
    return Number(/mean_volume:\s*(-?[\d.]+)/.exec(r.stderr)?.[1] ?? '-99');
  };

  try {
    const st0 = await api('POST', '/api/projects', { name: 'Stüdyo testi', formats: [{ format: 'landscape' }] });
    const pid = st0.project.id;
    const out = st0.project.outputs[0].id;
    const imp = await api('POST', '/api/import/paths', { projectId: pid, paths: [path.join(media, 'yatay.mp4')] });
    const yakin = await api('POST', '/api/import/paths', { paths: [path.join(media, 'yakin.mp4')] });
    const ids = [imp.assets[0].id, yakin.assets[0].id];
    await waitFor(async () => {
      const lib = await api<any[]>('GET', '/api/library');
      return ids.every((id) => {
        const a = lib.find((x) => x.id === id);
        return a.status === 'ready' && !['pending', 'running'].includes(a.transcript.status);
      });
    }, 'içe aktarma');

    const before = (await api('GET', `/api/projects/${pid}`)).project;
    const beforeDur = before.clips.reduce((s: number, c: any) => s + c.out - c.in, 0);

    // Revizyon 1
    const r1 = await speak(pid, 'İkinci kez söylediğim cümleyi çıkar');
    check('Mikrofon talimatı yazıya çevrildi (kayıt kütüphaneye girmedi)', r1.text.startsWith('İkinci') && !(await api<any[]>('GET', '/api/library')).some((a) => a.name.startsWith('mikrofon')), r1.text);
    check('Revizyon 1 anlaşıldı', r1.plan.understood && r1.plan.ops.length === 1, r1.plan.summary);
    const cut = r1.plan.ops[0];
    const second = timed.filter((w) => w.text === 'Bu')[1];
    check('Doğru cümle seçildi (ikinci “Bu kahve çok güzel.”)', Math.abs(cut.start - second.t0) < 0.2, `${cut.start.toFixed(2)}–${cut.end.toFixed(2)} sn`);
    await api('POST', `/api/projects/${pid}/ops`, { ops: r1.plan.ops, label: 'Komut: tekrarı çıkar' });

    // Revizyon 2
    const r2 = await speak(pid, 'Ürünün adını söylediğim yerde yüklediğim yakın planı iki saniye göster, sesim devam etsin');
    const ops2 = r2.plan.ops.length ? r2.plan.ops : r2.plan.candidates[0]?.ops ?? [];
    check('Revizyon 2 anlaşıldı (yakın plan ürün adında)', r2.plan.understood && ops2[0]?.type === 'overlay.add' && ops2[0].assetId === yakin.assets[0].id, r2.plan.summary);
    const st2 = await api('POST', `/api/projects/${pid}/ops`, { ops: ops2, label: 'Komut: yakın plan' });
    const ov = st2.project.overlays[0];
    const cutLen = cut.end - cut.start;
    const kahvemiz = timed.find((w) => w.text === 'Kahvemiz')!;
    check('Yakın plan kesmeden sonra doğru zamanda', Math.abs(ov.at - (kahvemiz.t0 - cutLen)) < 0.05 && Math.abs(ov.out - ov.in - 2) < 0.01, `${ov.at.toFixed(2)} sn, 2 sn`);

    const e1 = await render(pid, out);
    check('Render doğrulandı (1920×1080 H.264/AAC)', e1.verification.ok, e1.verification.checks.map((c: any) => `${c.label}: ${c.detail}`).join(' · '));
    check('Kesme uygulandı (süre kısaldı)', Math.abs(e1.verification.duration - (beforeDur - cutLen)) < 0.15, `${beforeDur.toFixed(2)} → ${e1.verification.duration.toFixed(2)} sn`);
    const fIn = await frameAt(e1.file, ov.at + 1);
    const fOut = await frameAt(e1.file, ov.at + 2.8);
    check('Yakın plan o anda görünüyor, sonra ana görüntüye dönüyor', fIn.red && !fOut.red, `içinde rgb(${fIn.r.toFixed(0)},${fIn.g.toFixed(0)},${fIn.b.toFixed(0)})`);
    const vIn = await loudness(e1.file, ov.at + 0.1, ov.at + 1.9);
    check('Yakın plan sırasında ses sürüyor', vIn > -40, `${vIn.toFixed(1)} dB`);

    // Kişisel stil / proje talimatı ayrımı
    const p3 = await api('POST', `/api/projects/${pid}/command`, { text: 'Bundan sonra altyazılarımı beyaz ve iki satır yap' });
    const p4 = await api('POST', `/api/projects/${pid}/command`, { text: 'Bu sefer siyah beyaz yap' });
    check('“Bundan sonra…” kişisel stile, “bu sefer…” projeye', !!p3.personal?.captionStyle && !p4.personal && !!p4.note, `${p3.summary} / ${p4.summary}`);

    // Geri al → önceki kurgu
    await api('POST', `/api/projects/${pid}/undo`);
    const u = await api('POST', `/api/projects/${pid}/undo`);
    check('İki revizyon geri alındı', u.project.overlays.length === 0 && u.project.clips.length === 1);
    const e2 = await render(pid, out);
    const fBack = await frameAt(e2.file, ov.at + 1);
    check('Geri alınca önceki kurgu yeniden üretildi', Math.abs(e2.verification.duration - beforeDur) < 0.15 && !fBack.red, `${e2.verification.duration.toFixed(2)} sn`);
    console.log(`\nÇıktılar: ${path.join(home, 'projeler', pid, 'exports')}`);
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
