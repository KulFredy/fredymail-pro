import { describe, expect, it } from 'vitest';
import { applyOps, newProject, type OpContext } from '../src/core/ops';
import type { AssetRef, Project, Word } from '../src/core/schema';
import { layoutClips, timelineWords, totalDuration } from '../src/core/timeline';
import { buildTranscript, cutSentenceOps, editSentenceOps, sentenceAt, sourceToTimeline, timelineToSource } from '../src/core/transcript';

let n = 0;
const ctx: OpContext = {
  assets: {
    foto: { kind: 'image', duration: 0, width: 3000, height: 4000 },
    kon: { kind: 'video', duration: 12, width: 1920, height: 1080 },
    ses: { kind: 'audio', duration: 4, width: 0, height: 0 },
  },
  newId: (p) => `${p}${++n}`,
  now: () => '2026-11-07T00:00:00.000Z',
  photoDuration: 3,
};

// Kaynakta: "Merhaba arkadaşlar." (1–2.4) "Bugün kahve yapıyoruz." (3–5) "Çok güzel oldu." (6–7.6) "Afiyet olsun." (9–10)
const W = (t0: number, t1: number, text: string): Word => ({ t0, t1, text, p: 0.9 });
const konWords = [
  W(1, 1.6, 'Merhaba'), W(1.7, 2.4, 'arkadaşlar.'),
  W(3, 3.5, 'Bugün'), W(3.6, 4.1, 'kahve'), W(4.2, 5, 'yapıyoruz.'),
  W(6, 6.4, 'Çok'), W(6.5, 7, 'güzel'), W(7.1, 7.6, 'oldu.'),
  W(9, 9.5, 'Afiyet'), W(9.6, 10, 'olsun.'),
];
const sesWords = [W(0.2, 0.8, 'Hafta'), W(0.9, 1.4, 'sonu'), W(1.5, 2.2, 'bekliyoruz.')];
const assets: Record<string, AssetRef> = {
  foto: { id: 'foto', kind: 'image', name: 'foto.jpg', url: '', width: 3000, height: 4000, duration: 0, hasAudio: false, words: [], transcriptStatus: 'done', cameraDetected: null },
  kon: { id: 'kon', kind: 'video', name: 'konusma.mp4', url: '', width: 1920, height: 1080, duration: 12, hasAudio: true, words: konWords, transcriptStatus: 'done', cameraDetected: null },
  ses: { id: 'ses', kind: 'audio', name: 'dis-ses.m4a', url: '', width: 0, height: 0, duration: 4, hasAudio: true, words: sesWords, transcriptStatus: 'done', cameraDetected: null },
};

/** Foto (3 sn) + konuşma (0–12) + dış ses 1. saniyede */
const base = (): Project =>
  applyOps(newProject('p1', 'Test', ctx.now()), [
    { type: 'output.add', format: 'landscape' },
    { type: 'clips.add', assetIds: ['foto', 'kon'] },
    { type: 'voice.add', assetId: 'ses', at: 1 },
  ], ctx);

const section = (p: Project, source: 'clip' | 'voice' = 'clip') => buildTranscript(p, assets).find((s) => s.source === source)!;

describe('kaynak ↔ kurgu zamanı', () => {
  it('fotoğraftan sonra gelen klipte kaynak zamanı 3 sn kayar', () => {
    const p = base();
    expect(sourceToTimeline(p, 'kon', 3)).toEqual([{ clipId: p.clips[1].id, t0: 6, t1: 6 }]);
    expect(timelineToSource(p, 6.5)).toMatchObject({ clipId: p.clips[1].id, assetId: 'kon', src: 3.5 });
    expect(timelineToSource(p, 1)).toMatchObject({ assetId: 'foto' });
    expect(timelineToSource(p, 99)).toBeNull();
  });

  it('bölme ve kırpmadan sonra eşleme korunur, kesilen kaynak zamanı kurguda yoktur', () => {
    let p = base();
    p = applyOps(p, [{ type: 'clip.split', clipId: p.clips[1].id, at: 8 }], ctx); // kaynakta 5'te böl
    p = applyOps(p, [{ type: 'clip.trim', clipId: p.clips[2].id, in: 6, out: 12 }], ctx); // 5–6 kesildi
    expect(sourceToTimeline(p, 'kon', 5.5)).toEqual([]);
    expect(sourceToTimeline(p, 'kon', 6)[0].t0).toBeCloseTo(8);
    expect(timelineToSource(p, 8.5)!.src).toBeCloseTo(6.5);
  });
});

describe('transkript', () => {
  it('cümlelere böler; kurgu zamanı altyazıyla aynı', () => {
    const p = base();
    const s = section(p);
    expect(s.sentences.map((x) => x.text)).toEqual(['Merhaba arkadaşlar.', 'Bugün kahve yapıyoruz.', 'Çok güzel oldu.', 'Afiyet olsun.']);
    expect(s.sentences[1].start).toBeCloseTo(6);
    expect(s.sentences[1].end).toBeCloseTo(8);
    // altyazı (timelineWords) ile aynı zamanlar
    const cap = timelineWords(p, assets).filter((w) => w.key.startsWith('kon:'));
    expect(cap.map((w) => w.t0)).toEqual(s.sentences.flatMap((x) => x.words).map((w) => w.at!.t0));
  });

  it('dış ses ayrı bölüm, zaman dış sesin yerine göre', () => {
    const v = section(base(), 'voice');
    expect(v.name).toBe('dis-ses.m4a');
    expect(v.sentences[0].start).toBeCloseTo(1.2);
    expect(cutSentenceOps(base(), v, v.sentences[0])).toBeNull();
  });

  it('oynatma anındaki cümle bulunur', () => {
    const secs = buildTranscript(base(), assets);
    expect(sentenceAt(secs, 9.5)?.text).toBe('Çok güzel oldu.');
    expect(sentenceAt(secs, 8.5)).toBeNull();
  });
});

describe('cümleyi kes', () => {
  it('yalnız o cümleyi, komşu kelimelere taşmadan küçük payla çıkarır', () => {
    const p = base();
    const s = section(p);
    const ops = cutSentenceOps(p, s, s.sentences[2])!; // "Çok güzel oldu." kurguda 9–10.6
    expect(ops).toHaveLength(1);
    const op = ops[0] as { start: number; end: number };
    expect(op.start).toBeCloseTo(8.92);
    expect(op.end).toBeCloseTo(10.68);
    const q = applyOps(p, ops, ctx);
    expect(totalDuration(q)).toBeCloseTo(totalDuration(p) - 1.76, 1);
    const after = section(q);
    expect(after.sentences[2].cut).toBe('all');
    expect(after.sentences.filter((x) => x.cut === 'none').map((x) => x.text)).toEqual(['Merhaba arkadaşlar.', 'Bugün kahve yapıyoruz.', 'Afiyet olsun.']);
    // Sonraki cümle kesimden sonra da doğru yerde: kaynak 9 → kurgu 3 + 9 − 1,76
    expect(after.sentences[3].start).toBeCloseTo(3 + 9 - 1.76, 1);
    // Dış ses kesimden önce başladığı için yerinde kalır
    expect(q.voice[0].at).toBe(1);
  });

  it('kesilen cümle tekrar kesilemez; bölünmüş cümle parça parça kesilir', () => {
    let p = base();
    let s = section(p);
    p = applyOps(p, cutSentenceOps(p, s, s.sentences[2])!, ctx);
    s = section(p);
    expect(cutSentenceOps(p, s, s.sentences[2])).toBeNull();
    // "Bugün kahve yapıyoruz." ortasından böl → iki parça, sondan başa
    let q = base();
    q = applyOps(q, [{ type: 'clip.split', clipId: q.clips[1].id, at: 7.15 }], ctx); // kaynak 4.15
    const s2 = section(q);
    expect(s2.sentences[1].words.map((w) => w.at?.clipId).filter((v, i, a) => a.indexOf(v) === i)).toHaveLength(2);
    const ops = cutSentenceOps(q, s2, s2.sentences[1])!;
    expect(ops).toHaveLength(2);
    expect((ops[0] as { start: number }).start).toBeGreaterThan((ops[1] as { start: number }).start);
    const r = applyOps(q, ops, ctx);
    expect(section(r).sentences[1].cut).toBe('all');
    expect(section(r).sentences[0].cut).toBe('none');
  });

  it('klibin başındaki cümlede kırıntı bırakmaz', () => {
    let p = base();
    p = applyOps(p, [{ type: 'clip.trim', clipId: p.clips[1].id, in: 0.95, out: 12 }], ctx);
    const s = section(p);
    const op = cutSentenceOps(p, s, s.sentences[0])![0] as { start: number; end: number };
    expect(op.start).toBeCloseTo(layoutClips(p)[1].start);
  });
});

describe('altyazıyı düzelt', () => {
  it('kelime yuvalarına dağıtır, kesimlere dokunmaz', () => {
    const p = base();
    const s = section(p);
    const ops = editSentenceOps(s.sentences[1], 'Bugün kahve demliyoruz.');
    expect(ops).toEqual([{ type: 'captions.editWord', key: 'kon:4', text: 'demliyoruz.' }]);
    const q = applyOps(p, ops, ctx);
    expect(q.clips).toEqual(p.clips);
    expect(section(q).sentences[1].text).toBe('Bugün kahve demliyoruz.');
  });

  it('kelime sayısı değişince fazlası sona eklenir, eksik yuvalar boşalır; aslına dönünce düzeltme kalkar', () => {
    const p = base();
    const s = section(p).sentences[2]; // Çok güzel oldu.
    const longer = applyOps(p, editSentenceOps(s, 'Çok ama çok güzel oldu.'), ctx);
    expect(section(longer).sentences[2].text).toBe('Çok ama çok güzel oldu.');
    const shorter = applyOps(p, editSentenceOps(s, 'Harika.'), ctx);
    expect(section(shorter).sentences[2].text).toBe('Harika.');
    expect(timelineWords(shorter, assets).filter((w) => w.key === 'kon:6' || w.key === 'kon:7')).toHaveLength(0);
    const back = applyOps(longer, editSentenceOps(section(longer).sentences[2], 'Çok güzel oldu.'), ctx);
    expect(Object.keys(back.captions.edits).filter((k) => back.captions.edits[k] !== undefined && k.startsWith('kon:'))).toEqual([]);
  });
});
