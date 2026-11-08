import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { Transcript, Word } from '../core/schema';
import { getTools, run, runOk, which } from './proc';

export type WhisperConfig = { bin: string | null; model: string | null; vadModel: string | null; mode: 'whisper' | 'fixture' };

/** Whisper'ın uydurduğu bilinen Türkçe kalıplar (sessizlik/müzikte) */
const HALLUCINATIONS = [
  'altyazı m.k.',
  'altyazı m.k',
  'izlediğiniz için teşekkür ederim',
  'izlediğiniz için teşekkürler',
  'abone olmayı unutmayın',
  'altyazılar',
  'altyazı',
  'müzik',
];

export const findWhisper = async (home: string): Promise<WhisperConfig> => {
  if (process.env.FABRIKA_TRANSCRIBER === 'fixture') return { bin: null, model: null, vadModel: null, mode: 'fixture' };
  const bin =
    (process.env.FABRIKA_WHISPER_BIN ? await which(process.env.FABRIKA_WHISPER_BIN) : null) ??
    (await which('whisper-cli')) ??
    (await which('whisper-cpp'));
  let model = process.env.FABRIKA_WHISPER_MODEL ?? null;
  const dir = path.join(home, 'modeller');
  let vadModel: string | null = null;
  try {
    const files = await readdir(dir);
    if (!model) {
      const prefer = ['ggml-large-v3-turbo-q5_0.bin', 'ggml-large-v3-turbo.bin', 'ggml-large-v3-turbo-q8_0.bin', 'ggml-medium.bin', 'ggml-small.bin', 'ggml-base.bin'];
      const hit = prefer.find((f) => files.includes(f)) ?? files.find((f) => /^ggml-.*\.bin$/.test(f) && !f.includes('silero'));
      if (hit) model = path.join(dir, hit);
    }
    const vad = files.find((f) => f.includes('silero') && f.endsWith('.bin'));
    if (vad) vadModel = path.join(dir, vad);
  } catch {
    /* modeller klasörü yok */
  }
  if (model) {
    try {
      await stat(model);
    } catch {
      model = null;
    }
  }
  return { bin, model, vadModel, mode: 'whisper' };
};

const dtwPreset = (model: string) => {
  const n = path.basename(model);
  if (n.includes('large-v3-turbo')) return 'large.v3.turbo';
  if (n.includes('large-v3')) return 'large.v3';
  if (n.includes('large-v2')) return 'large.v2';
  for (const s of ['medium', 'small', 'base', 'tiny']) if (n.includes(s)) return s;
  return null;
};

const normalize = (s: string) => s.toLocaleLowerCase('tr-TR').replace(/[^\p{L}\p{N}. ]/gu, '').trim();

/** Uydurma kalıpları ve düşük güvenli kelimeleri temizler */
export const cleanWords = (words: Word[]): Word[] => {
  let ws = words.filter((w) => w.text.trim() && w.p >= 0.12 && !/^\[.*\]$|^\(.*\)$|^♪+$/.test(w.text.trim()));
  const norm = ws.map((w) => normalize(w.text));
  const drop = new Set<number>();
  for (const phrase of HALLUCINATIONS) {
    const parts = phrase.split(' ');
    for (let i = 0; i + parts.length <= norm.length; i++) {
      if (parts.every((p, k) => norm[i + k] === p || norm[i + k] === p.replace(/\.$/, ''))) {
        // Tek başına (çevresinde konuşma yokken) geçiyorsa uydurmadır
        const before = ws[i - 1];
        const after = ws[i + parts.length];
        const isolated = (!before || ws[i].t0 - before.t1 > 1) && (!after || after.t0 - ws[i + parts.length - 1].t1 > 1);
        if (isolated) for (let k = 0; k < parts.length; k++) drop.add(i + k);
      }
    }
  }
  ws = ws.filter((_, i) => !drop.has(i));
  // Zaman sıralaması ve en kısa süre
  ws.sort((a, b) => a.t0 - b.t0);
  return ws.map((w) => ({ ...w, text: w.text.trim(), t1: Math.max(w.t1, w.t0 + 0.08) }));
};

type WJson = {
  result?: { language?: string };
  transcription?: {
    offsets: { from: number; to: number };
    text: string;
    tokens?: { text: string; p?: number }[];
  }[];
};

/** whisper-cli -ml 1 -sow -ojf çıktısı: her bölüm bir kelimedir */
export const parseWhisperJson = (j: WJson): Word[] => {
  const words: Word[] = [];
  for (const seg of j.transcription ?? []) {
    const text = seg.text.trim();
    if (!text) continue;
    const toks = (seg.tokens ?? []).filter((t) => !t.text.startsWith('[_') && !t.text.startsWith('<|'));
    const p = toks.length ? toks.reduce((s, t) => s + (t.p ?? 1), 0) / toks.length : 1;
    // Noktalama tek başına gelirse önceki kelimeye ekle
    if (/^[.,!?;:…'"»)]+$/.test(text) && words.length) {
      words[words.length - 1].text += text;
      continue;
    }
    words.push({ t0: seg.offsets.from / 1000, t1: seg.offsets.to / 1000, text, p });
  }
  return cleanWords(words);
};

const volumeStats = async (wav: string) => {
  const { ffmpeg } = await getTools();
  const r = await run(ffmpeg, ['-hide_banner', '-i', wav, '-af', 'volumedetect', '-f', 'null', '-']);
  const max = Number(/max_volume:\s*(-?[\d.]+|-inf)/.exec(r.stderr)?.[1] ?? '-91');
  const mean = Number(/mean_volume:\s*(-?[\d.]+|-inf)/.exec(r.stderr)?.[1] ?? '-91');
  return { max: Number.isFinite(max) ? max : -91, mean: Number.isFinite(mean) ? mean : -91 };
};

export const transcribe = async (
  file: string,
  assetName: string,
  cfg: WhisperConfig,
  onProgress: (f: number) => void = () => {},
  /** 'auto': whisper dili kendisi bulur; 'tr', 'en'…: o dilde çözer */
  language = 'auto',
): Promise<Pick<Transcript, 'status' | 'words' | 'engine' | 'message' | 'language'>> => {
  const { ffmpeg } = await getTools();
  const tmp = await mkdtemp(path.join(os.tmpdir(), 'fabrika-stt-'));
  try {
    const wav = path.join(tmp, 'ses.wav');
    await runOk(ffmpeg, ['-hide_banner', '-y', '-i', file, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', wav]);
    const vol = await volumeStats(wav);
    if (vol.max < -40) return { status: 'silent', words: [], engine: 'sessizlik', message: 'Konuşma bulunamadı (ses çok düşük)', language };

    if (cfg.mode === 'fixture') {
      const dir = process.env.FABRIKA_FIXTURES ?? '';
      try {
        const words = JSON.parse(await readFile(path.join(dir, `${assetName}.words.json`), 'utf8')) as Word[];
        return { status: 'done', words: cleanWords(words.map((w) => ({ ...w, p: w.p ?? 1 }))), engine: 'test', message: '', language: language === 'auto' ? 'tr' : language };
      } catch {
        return { status: 'done', words: [], engine: 'test', message: 'Konuşma bulunamadı', language };
      }
    }
    if (!cfg.bin || !cfg.model)
      return {
        status: 'unavailable',
        words: [],
        engine: '',
        message: !cfg.bin ? 'Whisper kurulu değil (scripts/setup-mac.sh)' : 'Whisper modeli bulunamadı (scripts/setup-mac.sh)',
        language,
      };

    const base = path.join(tmp, 'sonuc');
    const args = [
      '-m', cfg.model, '-f', wav, '-l', language, '-ojf', '-of', base, '-pp',
      '-ml', '1', '-sow', '-mc', '0',
      '-t', String(Math.max(2, Math.min(8, os.cpus().length - 1))),
      // Türkçe ipucu yalnız Türkçe istendiğinde: otomatikte dili Türkçeye çekip İngilizceyi bozuyordu
      ...(language === 'tr' ? ['--prompt', 'Merhaba, bugün size anlatacağım.'] : []),
    ];
    const dtw = dtwPreset(cfg.model);
    const vad = cfg.vadModel ? ['--vad', '-vm', cfg.vadModel] : [];
    // Kurulu sürüm bir seçeneği desteklemezse daha sade ayarla yeniden dene
    const attempts = [
      [...args, '-sns', ...vad, ...(dtw ? ['-dtw', dtw] : [])],
      [...args, '-sns', ...vad],
      args,
    ];
    const env = { ...process.env, DYLD_LIBRARY_PATH: path.dirname(cfg.bin), LD_LIBRARY_PATH: path.dirname(cfg.bin) };
    let r = { code: -1, stdout: '', stderr: '' };
    for (const a of attempts) {
      r = await run(cfg.bin, a, {
        env,
        onStderr: (s) => {
          const m = /progress\s*=\s*(\d+)%/.exec(s);
          if (m) onProgress(Number(m[1]) / 100);
        },
      });
      if (r.code === 0) break;
    }
    if (r.code !== 0) throw new Error(`Whisper hata verdi: ${r.stderr.slice(-500)}`);
    const json = JSON.parse(await readFile(`${base}.json`, 'utf8')) as WJson;
    const words = parseWhisperJson(json);
    return {
      status: 'done',
      words,
      engine: `whisper.cpp · ${path.basename(cfg.model)}`,
      message: words.length ? '' : 'Konuşma bulunamadı',
      language: json.result?.language || (language === 'auto' ? 'tr' : language),
    };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
};
