/**
 * Eski sürümlerle kaydedilmiş gerçek proje klasörü üretir (uyumluluk testi için).
 * Kullanım (depo kökünden):
 *   git worktree add /tmp/wt-faz1 80209d5 && ln -s "$PWD/node_modules" /tmp/wt-faz1/
 *   git worktree add /tmp/wt-faz2 3a0071f && ln -s "$PWD/node_modules" /tmp/wt-faz2/
 *   npx tsx scripts/eski-proje-uret.ts medya <medya klasörü>
 *   npx tsx scripts/eski-proje-uret.ts faz1 /tmp/wt-faz1 <ev> <medya>
 *   npx tsx scripts/eski-proje-uret.ts faz2 /tmp/wt-faz2 <ev> <medya>
 * Çıktı `tests/fixtures/eski-ev` içine kopyalanır (bkz. docs/DEVAM.md).
 */
import { mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { runOk, which } from '../src/media/proc';

const ff = (args: string[]) => runOk('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);

/** Kelime kelime espeak: kesin zamanlı Türkçe konuşma + words.json */
const speech = async (dir: string, sentence: string, name: string) => {
  const tmp = path.join(dir, `tmp-${name}`);
  await mkdir(tmp, { recursive: true });
  const espeak = await which('espeak-ng');
  if (!espeak) throw new Error('espeak-ng gerekli');
  const list: string[] = [];
  const timed: { t0: number; t1: number; text: string }[] = [];
  let t = 0.5;
  await ff(['-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(t), path.join(tmp, 'pre.wav')]);
  list.push(`file '${path.join(tmp, 'pre.wav')}'`);
  const words = sentence.split(' ');
  for (let i = 0; i < words.length; i++) {
    const wav = path.join(tmp, `w${i}.wav`);
    await runOk(espeak, ['-v', 'tr', '-s', '165', '-w', wav, words[i].replace(/[.,]/g, '')]);
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
  const out = path.join(tmp, 'speech.wav');
  await ff(['-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-ar', '48000', out]);
  return { wav: out, timed, dur: t + 0.5, tmp };
};

const makeMedia = async (dir: string) => {
  await mkdir(dir, { recursive: true });
  // Fotoğraf (küçük)
  await ff(['-f', 'lavfi', '-i', 'testsrc2=size=960x720:rate=1', '-frames:v', '1', '-q:v', '4', path.join(dir, 'foto.jpg')]);
  // Konuşmalı dikey video (küçük, 540×960)
  const s = await speech(dir, 'Merhaba, bugün kafemizdeyiz. Yeni kahvemiz çok güzel.', 'konusma');
  const dur = Math.ceil(s.dur);
  await ff([
    '-f', 'lavfi', '-i', `testsrc=size=540x960:rate=30:duration=${dur}`, '-i', s.wav,
    '-filter_complex', '[1:a]apad[a]', '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '32', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-t', String(dur),
    path.join(dir, 'konusma.mp4'),
  ]);
  await writeFile(path.join(dir, 'konusma.mp4.words.json'), JSON.stringify(s.timed, null, 2));
  await rm(s.tmp, { recursive: true, force: true });
  // Dış ses kaydı (uygulamada kaydedilmiş gibi)
  const v = await speech(dir, 'Bu hafta sonu bekliyoruz.', 'dis-ses');
  await ff(['-i', v.wav, '-c:a', 'aac', '-b:a', '64k', path.join(dir, 'dis-ses.m4a')]);
  await writeFile(path.join(dir, 'dis-ses.m4a.words.json'), JSON.stringify(v.timed, null, 2));
  await rm(v.tmp, { recursive: true, force: true });
};

const serve = async (code: string, home: string, media: string) => {
  process.env.FABRIKA_HOME = home;
  process.env.FABRIKA_TRANSCRIBER = 'fixture';
  process.env.FABRIKA_FIXTURES = media;
  const { createServer } = await import(path.join(path.resolve(code), 'src/server/index.ts'));
  const { app } = await createServer(home);
  await app.listen({ port: 4850, host: '127.0.0.1' });
  const base = 'http://127.0.0.1:4850';
  const api = async (method: string, url: string, body?: unknown): Promise<any> => {
    const r = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    const j = await r.json();
    if (!r.ok) throw new Error(`${method} ${url}: ${j.error}`);
    return j;
  };
  const ready = async (ids: string[]) => {
    for (let i = 0; i < 600; i++) {
      const lib: any[] = await api('GET', '/api/library');
      if (ids.every((id) => { const a = lib.find((x) => x.id === id); return a.status === 'ready' && !['pending', 'running'].includes(a.transcript.status); })) return lib;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('içe aktarma bitmedi');
  };
  return { app, api, ready, base };
};

const main = async () => {
  const [phase, ...a] = process.argv.slice(2);
  if (phase === 'medya') return makeMedia(path.resolve(a[0]));
  const [code, home, media] = a.map((x) => path.resolve(x));
  const { app, api, ready, base } = await serve(code, home, media);
  try {
    if (phase === 'faz1') {
      // Faz 1: Hızlı Edit projesi (Story + 4:5 post), fotoğraf + konuşma, kadraj, renk, altyazı düzeltmesi
      let st = await api('POST', '/api/projects', { name: 'Eski Faz 1 projesi', formats: [{ format: 'story' }, { format: 'post', kind: 'image' }] });
      const pid = st.project.id;
      const story = st.project.outputs.find((o: any) => o.format === 'story');
      st = (await api('POST', '/api/import/paths', { projectId: pid, paths: ['foto.jpg', 'konusma.mp4'].map((f) => path.join(media, f)) })).state;
      const [cFoto, cKon] = st.project.clips;
      const lib = await ready([cFoto.assetId, cKon.assetId]);
      const kon = lib.find((x) => x.id === cKon.assetId);
      await api('POST', `/api/projects/${pid}/ops`, {
        ops: [
          { type: 'clip.trim', clipId: cFoto.id, in: 0, out: 2 },
          { type: 'look.set', look: { preset: 'sicak', intensity: 0.4 } },
          { type: 'output.setFraming', outputId: story.id, clipId: cFoto.id, framing: { mode: 'fill', x: 0.4 } },
          { type: 'captions.editWord', key: `${kon.id}:1`, text: 'BUGÜN' },
        ],
      });
      await api('POST', `/api/projects/${pid}/ui`, { step: 'altyazi', selectedClipId: cKon.id });
      console.log(`faz1 proje: ${pid}`);
    } else if (phase === 'faz2') {
      // Faz 2: Stüdyo projesi (yatay), konuşma + kaydedilmiş dış ses + yazı
      let st = await api('POST', '/api/projects', { name: 'Eski Faz 2 projesi', formats: [{ format: 'landscape' }] });
      const pid = st.project.id;
      st = (await api('POST', '/api/import/paths', { projectId: pid, paths: [path.join(media, 'konusma.mp4')] })).state;
      const fd = new FormData();
      fd.append('files', new Blob([await readFile(path.join(media, 'dis-ses.m4a'))]), 'dis-ses.m4a');
      const vr = await (await fetch(`${base}/api/import?projectId=${pid}&role=voiceover&at=0.2`, { method: 'POST', body: fd })).json();
      await ready([st.project.clips[0].assetId, vr.assets[0].id]);
      await api('POST', `/api/projects/${pid}/ops`, {
        ops: [
          { type: 'clip.update', clipId: st.project.clips[0].id, patch: { gainDb: -12 } },
          { type: 'text.add', text: { text: 'Hafta sonu', start: 0.5, end: 2.5 } },
        ],
      });
      console.log(`faz2 proje: ${pid}`);
    }
  } finally {
    await app.close();
  }
};

main().then(() => process.exit(0), (e) => {
  console.error(e);
  process.exit(1);
});
