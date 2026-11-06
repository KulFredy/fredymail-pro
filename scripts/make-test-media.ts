/**
 * Kabul testinin otomatik sürümü için örnek medya üretir:
 *  - foto.jpg        : EXIF yönü 6 olan (telefonda dik çekilmiş) fotoğraf
 *  - ortam.mp4       : 4K yatay ortam videosu (ortam sesi)
 *  - konusma.mp4     : dikey klip, döndürme üst verili (telefon gibi), Türkçe konuşma (espeak-ng)
 *  - sessiz.mp4      : konuşmasız dikey klip
 *  - muzik.m4a       : 25 sn müzik
 * Konuşma kelimeleri ayrı ayrı üretildiği için kelime zamanları kesin bilinir
 * (konusma.mp4.words.json → test çözümleyicisi).
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { runOk, which } from '../src/media/proc';

const out = path.resolve(process.argv[2] ?? 'fabrika-veri/test-medya');
const ff = (args: string[]) => runOk('ffmpeg', ['-hide_banner', '-v', 'error', '-y', ...args]);

const SENTENCE = 'Merhaba, bugün size sahildeki küçük kafemizi gösteriyorum. Kahvemiz çok güzel.';

const main = async () => {
  await mkdir(out, { recursive: true });

  // Fotoğraf: 4000x3000 kaydedilmiş, EXIF 6 → dik (3000x4000) görünmeli
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="4000" height="3000">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2b6cb0"/><stop offset="0.5" stop-color="#e2b04a"/><stop offset="1" stop-color="#c05621"/></linearGradient></defs>
    <rect width="4000" height="3000" fill="url(#g)"/>
    <circle cx="2000" cy="1500" r="700" fill="#fff8e7" opacity="0.9"/>
    <text x="2000" y="1600" font-size="360" text-anchor="middle" font-family="sans-serif" font-weight="bold" fill="#333" transform="rotate(-90 2000 1500)">FOTO ↑</text>
  </svg>`;
  await sharp(Buffer.from(svg)).jpeg({ quality: 90 }).withMetadata({ orientation: 6 }).toFile(path.join(out, 'foto.jpg'));

  // 4K ortam videosu
  await ff([
    '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30:duration=6',
    '-f', 'lavfi', '-i', 'anoisesrc=color=brown:amplitude=0.08:duration=6',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest',
    path.join(out, 'ortam.mp4'),
  ]);

  // Konuşma: kelime kelime espeak, kesin zamanlar
  const espeak = await which('espeak-ng');
  const tmp = path.join(out, 'tmp');
  await mkdir(tmp, { recursive: true });
  const words = SENTENCE.split(' ');
  const list: string[] = [];
  const timed: { t0: number; t1: number; text: string }[] = [];
  let t = 0.8; // konuşmadan önce kısa sessizlik
  await ff(['-f', 'lavfi', '-i', `anullsrc=r=22050:cl=mono`, '-t', String(t), path.join(tmp, 'pre.wav')]);
  list.push(`file '${path.join(tmp, 'pre.wav')}'`);
  for (let i = 0; i < words.length; i++) {
    const wav = path.join(tmp, `w${i}.wav`);
    if (espeak) await runOk(espeak, ['-v', 'tr', '-s', '165', '-w', wav, words[i].replace(/[.,]/g, '')]);
    else await ff(['-f', 'lavfi', '-i', `sine=frequency=${200 + i * 20}:duration=0.35`, '-ar', '22050', '-ac', '1', wav]);
    // espeak'in baş/son sessizliğini kırp
    const trimmed = path.join(tmp, `t${i}.wav`);
    await ff(['-i', wav, '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', '-ar', '22050', '-ac', '1', trimmed]);
    const d = Number((await runOk('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', trimmed])).stdout.trim());
    timed.push({ t0: +t.toFixed(3), t1: +(t + d).toFixed(3), text: words[i] });
    list.push(`file '${trimmed}'`);
    const gap = /[.,]$/.test(words[i]) ? 0.35 : 0.08;
    const gw = path.join(tmp, `g${i}.wav`);
    await ff(['-f', 'lavfi', '-i', 'anullsrc=r=22050:cl=mono', '-t', String(gap), gw]);
    list.push(`file '${gw}'`);
    t += d + gap;
  }
  await writeFile(path.join(tmp, 'list.txt'), list.join('\n'));
  const speech = path.join(tmp, 'speech.wav');
  await ff(['-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), '-ar', '48000', speech]);
  const dur = Math.ceil(t + 0.8);
  // 1920x1080 kodlanmış + -90° döndürme üst verisi → oynatıcıda 1080x1920 dikey
  await ff([
    '-f', 'lavfi', '-i', `testsrc=size=1920x1080:rate=30:duration=${dur}`,
    '-i', speech,
    '-filter_complex', '[1:a]apad[a]', '-map', '0:v', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', String(dur),
    '-metadata:s:v:0', 'rotate=90',
    path.join(tmp, 'konusma_raw.mp4'),
  ]);
  await ff(['-display_rotation', '-90', '-i', path.join(tmp, 'konusma_raw.mp4'), '-c', 'copy', path.join(out, 'konusma.mp4')]);
  await writeFile(path.join(out, 'konusma.mp4.words.json'), JSON.stringify(timed, null, 2));

  await ff([
    '-f', 'lavfi', '-i', 'testsrc2=size=1080x1920:rate=30:duration=4',
    '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-t', '4',
    path.join(out, 'sessiz.mp4'),
  ]);

  // Müzik: basit akor dizisi
  await ff([
    '-f', 'lavfi', '-i',
    "aevalsrc='0.25*sin(2*PI*(220+110*floor(mod(t,4)))*t)+0.18*sin(2*PI*330*t)*(0.6+0.4*sin(2*PI*2*t))':s=48000:d=25",
    '-ac', '2', '-c:a', 'aac', '-b:a', '192k', path.join(out, 'muzik.m4a'),
  ]);
  await rm(tmp, { recursive: true, force: true });
  console.log(`Test medyası hazır: ${out}`);
  console.log(`Konuşma: ${timed.length} kelime, ${timed[timed.length - 1].t1.toFixed(2)} sn`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
