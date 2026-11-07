/**
 * Faz 3 kabul testi: İNTERNET KAPALIYKEN yerel kurgu ve çıktı.
 *  - Eski (Faz 1 + Faz 2 sürümüyle kaydedilmiş) proje klasörü açılır (tests/fixtures/eski-ev).
 *  - Yeni klip eklenir, kesilir, LUT uygulanır, altyazı düzeltilir, kaydedilip yeniden açılır.
 *  - 1080p MP4 ve JPEG çıktı alınır; önceden kaydedilmiş dış ses çıktıda duyulur.
 *  - Komut mikrofonu (yerel yazıya çevirme) ve yerel komut anlayıcı çalışır; Claude'a gidilmez.
 *  - Süreç içinde dışarıya açılmaya çalışılan her bağlantı kaydedilir ve test düşer.
 * Linux'ta (bulut) test kendini ağsız bir ad alanında (unshare -n, yalnız loopback) yeniden başlatır.
 * Mac'te: Wi-Fi'yi kapatıp `npm run e2e:offline` çalıştırın (süreç içi bekçi yine çalışır).
 */
import { spawnSync } from 'node:child_process';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { run, runOk, which } from '../src/media/proc';

const ROOT = path.resolve(import.meta.dirname, '..');
const results: { name: string; ok: boolean; detail: string }[] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
};
const ff = (args: string[]) => runOk('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);

// ---------- Ağ bekçisi: loopback dışındaki her bağlantı denemesi kaydedilir ve reddedilir ----------
const outbound: string[] = [];
const isLocal = (h: string | undefined) => !h || h === 'localhost' || h === '::1' || h.startsWith('127.');
const origConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: any[]) {
  const o = args[0];
  const host = typeof o === 'object' && o ? (o.path ? 'localhost' : o.host) : typeof args[1] === 'string' ? args[1] : typeof o === 'string' ? 'localhost' : undefined;
  if (!isLocal(host)) {
    outbound.push(`${host}:${typeof o === 'object' ? o.port : o}`);
    const err = Object.assign(new Error(`Çevrimdışı test: dış bağlantı engellendi (${host})`), { code: 'ENETUNREACH' });
    process.nextTick(() => this.destroy(err));
    return this;
  }
  return (origConnect as any).apply(this, args);
} as any;

/** Linux'ta ağsız ad alanında yeniden başlat (yalnız loopback açık) */
const reexecOffline = (): boolean => {
  if (process.env.FABRIKA_OFFLINE_CHILD || process.platform !== 'linux' || process.env.FABRIKA_OFFLINE_NO_NS) return false;
  const probe = spawnSync('unshare', ['-n', 'sh', '-c', 'ip link set lo up'], { stdio: 'ignore' });
  if (probe.status !== 0) {
    console.log('! unshare/ip yok: yalnız süreç içi bekçiyle çalışılıyor');
    return false;
  }
  const tsx = path.join(ROOT, 'node_modules', '.bin', 'tsx');
  const r = spawnSync('unshare', ['-n', 'sh', '-c', `ip link set lo up && exec "${tsx}" "${path.join(ROOT, 'scripts', 'e2e-offline.ts')}"`], {
    stdio: 'inherit',
    env: { ...process.env, FABRIKA_OFFLINE_CHILD: '1' },
  });
  process.exit(r.status ?? 1);
};

const SENTENCE = 'Tezgahta taze kurabiyeler var. Hepsi bugün pişti.';

const makeMedia = async (dir: string) => {
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, 'tmp');
  await mkdir(tmp, { recursive: true });
  const espeak = await which('espeak-ng');
  const list: string[] = [];
  const timed: { t0: number; t1: number; text: string }[] = [];
  let t = 0.5;
  await ff(['-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(t), path.join(tmp, 'pre.wav')]);
  list.push(`file '${path.join(tmp, 'pre.wav')}'`);
  const words = SENTENCE.split(' ');
  for (let i = 0; i < words.length; i++) {
    const wav = path.join(tmp, `w${i}.wav`);
    if (espeak) await runOk(espeak, ['-v', 'tr', '-s', '165', '-w', wav, words[i].replace(/[.,]/g, '')]);
    else await ff(['-f', 'lavfi', '-i', `sine=frequency=${240 + i * 20}:duration=0.35`, '-ar', '22050', '-ac', '1', wav]);
    const tr = path.join(tmp, `t${i}.wav`);
    await ff(['-i', wav, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', '-ar', '22050', '-ac', '1', tr]);
    const d = Number((await runOk('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', tr])).stdout.trim());
    timed.push({ t0: +t.toFixed(3), t1: +(t + d).toFixed(3), text: words[i] });
    list.push(`file '${tr}'`);
    const gap = /[.]$/.test(words[i]) ? 0.5 : 0.08;
    const g = path.join(tmp, `g${i}.wav`);
    await ff(['-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(gap), g]);
    list.push(`file '${g}'`);
    t += d + gap;
  }
  await writeFile(path.join(tmp, 'list.txt'), list.join('\n'));
  await ff(['-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-ar', '48000', path.join(tmp, 's.wav')]);
  const dur = Math.ceil(t + 0.5);
  await ff([
    '-f', 'lavfi', '-i', `testsrc2=size=1280x720:rate=30:duration=${dur}`, '-i', path.join(tmp, 's.wav'),
    '-filter_complex', '[1:a]apad[a]', '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', String(dur),
    path.join(dir, 'yeni-klip.mp4'),
  ]);
  await writeFile(path.join(dir, 'yeni-klip.mp4.words.json'), JSON.stringify(timed, null, 2));
  await ff(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1.2', path.join(dir, 'mikrofon.wav')]);
  await rm(tmp, { recursive: true, force: true });
  return { timed, dur };
};

const main = async () => {
  const t0 = Date.now();
  const work = process.env.FABRIKA_E2E_DIR ? path.join(process.env.FABRIKA_E2E_DIR, 'cevrimdisi') : path.join(os.tmpdir(), 'fabrika-cevrimdisi');
  const media = path.join(work, 'medya');
  const home = path.join(work, 'ev');
  if (!process.env.FABRIKA_OFFLINE_CHILD) {
    // Kurulum aşaması (ağ olabilir): eski proje klasörü + yeni test medyası
    await rm(work, { recursive: true, force: true });
    await mkdir(work, { recursive: true });
    await cp(path.join(ROOT, 'tests', 'fixtures', 'eski-ev'), home, { recursive: true });
    const m = await makeMedia(media);
    console.log(`Kurulum: eski proje klasörü kopyalandı, yeni klip ${m.dur} sn`);
    reexecOffline();
  }
  const timed: { t0: number; t1: number; text: string }[] = JSON.parse(await readFile(path.join(media, 'yeni-klip.mp4.words.json'), 'utf8'));

  // Dış ağ gerçekten kapalı mı? (ad alanında DNS bile çözülmez)
  const net0 = await fetch('https://api.anthropic.com', { signal: AbortSignal.timeout(4000) }).then(() => 'açık', (e) => `kapalı (${e.cause?.code ?? e.message})`);
  outbound.length = 0; // bu deneme bilinçli; sayma
  console.log(`Dış ağ: ${net0}${process.env.FABRIKA_OFFLINE_CHILD ? ' · ağsız ad alanı' : ''}`);

  delete process.env.ANTHROPIC_API_KEY;
  process.env.FABRIKA_HOME = home;
  if (!process.env.FABRIKA_E2E_REAL_WHISPER) {
    process.env.FABRIKA_TRANSCRIBER = 'fixture';
    process.env.FABRIKA_FIXTURES = media;
  }
  process.env.FABRIKA_PORT = process.env.FABRIKA_PORT ?? '4851';
  const { createServer } = await import('../src/server/index');
  const port = Number(process.env.FABRIKA_PORT);
  let srv = await createServer(home);
  await srv.app.listen({ port, host: '127.0.0.1' });
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
  const loudness = async (rel: string, from: number, to: number) => {
    const r = await run('ffmpeg', ['-hide_banner', '-i', path.join(home, rel), '-af', `atrim=${from}:${to},volumedetect`, '-f', 'null', '-']);
    return Number(/mean_volume:\s*(-?[\d.]+)/.exec(r.stderr)?.[1] ?? '-99');
  };

  try {
    // 1) Eski projeler açılıyor mu?
    const list = await api<any[]>('GET', '/api/projects');
    const p1 = list.find((p) => p.name === 'Eski Faz 1 projesi');
    const p2 = list.find((p) => p.name === 'Eski Faz 2 projesi');
    check('Eski projeler listelendi (Faz 1 ve Faz 2 sürümüyle kaydedilmiş)', !!p1 && !!p2, list.map((p) => p.name).join(', '));
    const pid = p2.id;
    const old = (await api('GET', `/api/projects/${pid}`)).project;
    check('Eski Faz 2 projesi: dış ses, yazı ve klip yerinde', old.voice.length === 1 && old.texts.length === 1 && old.clips.length === 1, `${old.clips.length} klip, ${old.voice.length} dış ses`);

    // 2) Yeni klip ekle (içe aktarma + yerel konuşma çözümü)
    const imp = await api('POST', '/api/import/paths', { projectId: pid, paths: [path.join(media, 'yeni-klip.mp4')] });
    const asset = imp.assets[0];
    await waitFor(async () => {
      const a = (await api<any[]>('GET', '/api/library')).find((x) => x.id === asset.id);
      return a.status === 'ready' && !['pending', 'running'].includes(a.transcript.status);
    }, 'içe aktarma');
    const lib = await api<any[]>('GET', '/api/library');
    const A = lib.find((x) => x.id === asset.id);
    check('Yeni klip eklendi ve konuşması yerelde yazıya çevrildi', imp.state.project.clips.length === 2 && A.transcript.status === 'done' && A.transcript.words.length === timed.length, `${A.transcript.words.length} kelime · ${A.transcript.engine}`);
    const newClip = imp.state.project.clips[1];

    // 3) Kes, LUT, altyazı düzelt; konuşma kliplerini sustur (dış sesi ayrıca ölçmek için)
    const fd = new FormData();
    const warm = ['LUT_3D_SIZE 2', '0.1 0 0', '1 0 0', '0.1 1 0', '1 1 0', '0.1 0 1', '1 0 1', '0.1 1 1', '1 1 1'].join('\n');
    fd.append('files', new Blob([warm]), 'sicak-test.cube');
    const lutRes = await (await fetch(`${base}/api/luts`, { method: 'POST', body: fd })).json();
    const firstWord = timed[0];
    const lastWord = timed.at(-1)!;
    const key = `${asset.id}:1`;
    const st3 = await api('POST', `/api/projects/${pid}/ops`, {
      ops: [
        { type: 'clip.trim', clipId: newClip.id, in: Math.max(0, firstWord.t0 - 0.3), out: lastWord.t1 + 0.4 },
        { type: 'clip.setLook', clipId: newClip.id, look: { lut: lutRes.added[0].id, lutIntensity: 1 } },
        { type: 'clip.update', clipId: old.clips[0].id, patch: { muted: true } },
        { type: 'clip.update', clipId: newClip.id, patch: { muted: true } },
        { type: 'output.add', format: 'post', kind: 'image' },
      ],
      label: 'Çevrimdışı kurgu',
    });
    const c2 = st3.project.clips[1];
    check('Kesme ve LUT uygulandı', Math.abs(c2.out - c2.in - (lastWord.t1 + 0.4 - Math.max(0, firstWord.t0 - 0.3))) < 0.01 && c2.look?.lut === lutRes.added[0].id);
    const st4 = await api('POST', `/api/projects/${pid}/ops`, { ops: [{ type: 'captions.editWord', key, text: 'TAZECİK' }], label: 'Altyazı düzeltmesi' });
    check(
      'Altyazı düzeltildi, kesimler ve zamanlar değişmedi',
      st4.project.captions.edits[key] === 'TAZECİK' && JSON.stringify(st4.project.clips) === JSON.stringify(st3.project.clips) && JSON.stringify(st4.project.voice) === JSON.stringify(st3.project.voice),
    );

    // 4) Komut mikrofonu → yerel yazıya çevirme → yerel anlayıcı (anahtar yok, ağ yok)
    const settings = await api('GET', '/api/settings');
    process.env.FABRIKA_STT_FIXTURE = 'Bu sefer siyah beyaz yap';
    const mf = new FormData();
    mf.append('files', new Blob([await readFile(path.join(media, 'mikrofon.wav'))]), 'mikrofon.wav');
    const stt = await (await fetch(`${base}/api/stt`, { method: 'POST', body: mf })).json();
    const plan = await api('POST', `/api/projects/${pid}/command`, { text: stt.text, playhead: 0 });
    check('Komut mikrofonu yerelde yazıya çevrildi', stt.text === 'Bu sefer siyah beyaz yap', `${stt.text} · ${stt.engine ?? stt.status ?? ''}`);
    check('Yerel komut anlayıcı çalıştı (Claude anahtarı yok)', !settings.aiConfigured && plan.understood, plan.summary);

    // 5) Kaydet ve yeniden aç (sunucuyu kapatıp açmak = uygulamayı kapatıp açmak)
    await srv.app.close();
    srv = await createServer(home);
    await srv.app.listen({ port, host: '127.0.0.1' });
    const re = (await api('GET', `/api/projects/${pid}`)).project;
    check('Yeniden açınca düzenlemeler yerinde', re.clips.length === 2 && re.captions.edits[key] === 'TAZECİK' && re.clips[1].look?.lut === lutRes.added[0].id && re.outputs.length === 2);

    // 6) Çıktılar: 1080p MP4 (yatay) ve JPEG (4:5)
    const vOut = re.outputs.find((o: any) => o.format === 'landscape');
    const iOut = re.outputs.find((o: any) => o.kind === 'image');
    const eV = await render(pid, vOut.id);
    check('1080p MP4 çıktı doğrulandı', eV.verification.ok && /1920.1080/.test(eV.verification.checks.map((c: any) => c.detail).join(' ')), eV.verification.checks.map((c: any) => `${c.label}: ${c.detail}`).join(' · '));
    const eI = await render(pid, iOut.id);
    const meta = await sharp(path.join(home, eI.file)).metadata();
    check('JPEG çıktı alındı', eI.file.endsWith('.jpg') && meta.width === 1080 && meta.height === 1350, `${meta.width}×${meta.height}`);

    // 7) Önceden kaydedilmiş dış ses çıktıda duyuluyor mu? (konuşma klipleri susturuldu)
    const v = re.voice[0];
    const vEnd = v.at + (v.out - v.in);
    const inVoice = await loudness(eV.file, v.at + 0.3, vEnd - 0.2);
    const after = await loudness(eV.file, vEnd + 0.5, Math.min(eV.verification.duration - 0.2, vEnd + 3));
    check('Dış ses çıktıda duyuluyor (kendi süresinde), sonrası sessiz', inVoice > -35 && after < -60, `dış ses ${inVoice.toFixed(1)} dB · sonrası ${after.toFixed(1)} dB`);

    console.log(`\nÇıktılar: ${path.join(home, 'projeler', pid, 'exports')}`);
  } catch (e) {
    check('Test akışı tamamlandı', false, (e as Error).message);
  } finally {
    await srv.app.close();
  }
  check('Dışarıya hiç bağlantı denenmedi', outbound.length === 0, outbound.length ? [...new Set(outbound)].join(', ') : 'süreç içinde 0 deneme');
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} kontrol geçti · ${((Date.now() - t0) / 1000).toFixed(0)} sn`);
  process.exit(failed.length ? 1 : 0);
};

main().catch((e) => {
  console.error('\n✗ Test durdu:', e.message);
  process.exit(1);
});
