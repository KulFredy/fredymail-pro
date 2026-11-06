import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseCube, sampleLut } from '../src/core/lut';
import { applyOps, newProject, type OpContext } from '../src/core/ops';
import type { AssetRef, Project } from '../src/core/schema';
import { captionPages, computeBox, dbToGain, layoutClips, musicGainAt, panFraming, speechIntervals, timelineWords, totalDuration } from '../src/core/timeline';
import { mapSony } from '../src/media/camera';
import { cleanWords, parseWhisperJson } from '../src/media/whisper';

let n = 0;
const ctx: OpContext = {
  assets: {
    foto: { kind: 'image', duration: 0, width: 3000, height: 4000 },
    ortam: { kind: 'video', duration: 6, width: 3840, height: 2160 },
    konusma: { kind: 'video', duration: 10, width: 1080, height: 1920 },
    muzik: { kind: 'audio', duration: 25, width: 0, height: 0 },
  },
  newId: (p) => `${p}${++n}`,
  now: () => '2026-11-06T00:00:00.000Z',
  photoDuration: 3,
};

const base = () =>
  applyOps(newProject('p1', 'Test', ctx.now()), [
    { type: 'output.add', format: 'story' },
    { type: 'output.add', format: 'post', kind: 'image' },
    { type: 'clips.add', assetIds: ['foto', 'ortam', 'konusma'] },
  ], ctx);

const ref = (id: string, extra: Partial<AssetRef> = {}): AssetRef => ({
  id, kind: ctx.assets[id].kind, name: id, url: '', width: ctx.assets[id].width, height: ctx.assets[id].height,
  duration: ctx.assets[id].duration, hasAudio: true, words: [], transcriptStatus: 'done', cameraDetected: null, ...extra,
});

describe('kurgu işlemleri', () => {
  it('klipleri seçim sırasıyla ekler, fotoğraf 3 sn olur, post karesi fotoğraftır', () => {
    const p = base();
    expect(p.clips.map((c) => c.assetId)).toEqual(['foto', 'ortam', 'konusma']);
    expect(p.clips[0].out - p.clips[0].in).toBe(3);
    const post = p.outputs.find((o) => o.format === 'post')!;
    expect(post.still?.clipId).toBe(p.clips[0].id);
    expect(totalDuration(p)).toBeCloseTo(19, 5);
  });

  it('kadraj çıktı başına saklanır', () => {
    let p = base();
    const [story, post] = p.outputs;
    const foto = p.clips[0].id;
    p = applyOps(p, [{ type: 'output.setFraming', outputId: post.id, clipId: foto, framing: { x: 0.7, zoom: 1.4 } }], ctx);
    expect(p.outputs[1].framing[foto]).toMatchObject({ mode: 'fill', x: 0.7, zoom: 1.4 });
    expect(p.outputs[0].framing[foto]).toBeUndefined();
    expect(story.id).not.toBe(post.id);
  });

  it('kırpmayı kaynak süresiyle sınırlar', () => {
    let p = base();
    const ortam = p.clips[1].id;
    p = applyOps(p, [{ type: 'clip.trim', clipId: ortam, in: 2, out: 99 }], ctx);
    expect(p.clips[1]).toMatchObject({ in: 2, out: 6 });
  });

  it('sıralama ve silme', () => {
    let p = base();
    const ids = p.clips.map((c) => c.id);
    p = applyOps(p, [{ type: 'clips.reorder', order: [ids[2], ids[0], ids[1]] }], ctx);
    expect(p.clips.map((c) => c.assetId)).toEqual(['konusma', 'foto', 'ortam']);
    p = applyOps(p, [{ type: 'clips.remove', clipId: ids[0] }], ctx);
    expect(p.clips).toHaveLength(2);
    // Post karesi silinen fotoğraftan başka klibe geçer
    expect(p.outputs[1].still?.clipId).toBe(ids[2]);
    expect(() => applyOps(p, [{ type: 'clips.reorder', order: ['x'] }], ctx)).toThrow();
  });

  it('renk: proje ve klip ayarı, tümüne uygula', () => {
    let p = base();
    p = applyOps(p, [{ type: 'look.set', look: { preset: 'sicak', intensity: 0.35, adjust: { exposure: 0.3 } } }], ctx);
    expect(p.look).toMatchObject({ preset: 'sicak', intensity: 0.35 });
    expect(p.look.adjust.exposure).toBe(0.3);
    expect(p.look.adjust.contrast).toBe(0);
    const c = p.clips[1].id;
    p = applyOps(p, [{ type: 'clip.setLook', clipId: c, look: { preset: 'sb' } }], ctx);
    expect(p.clips[1].look?.preset).toBe('sb');
    expect(p.clips[1].look?.adjust.exposure).toBe(0.3); // proje ayarından türedi
    p = applyOps(p, [{ type: 'look.applyToAll', fromClipId: c }], ctx);
    expect(p.look.preset).toBe('sb');
    expect(p.clips.every((x) => x.look === null)).toBe(true);
  });

  it('müzik: ses dosyası gerekli, mod elle değişince kilitlenir', () => {
    let p = base();
    expect(() => applyOps(p, [{ type: 'music.set', music: { mode: 'bed' } }], ctx)).toThrow();
    expect(() => applyOps(p, [{ type: 'music.set', music: { assetId: 'foto' } }], ctx)).toThrow();
    p = applyOps(p, [{ type: 'music.set', music: { assetId: 'muzik', mode: 'fixed' } }], ctx);
    expect(p.music?.modeLocked).toBe(false);
    p = applyOps(p, [{ type: 'music.set', music: { mode: 'bed' } }], ctx);
    expect(p.music).toMatchObject({ mode: 'bed', modeLocked: true, bedDb: -18 });
  });

  it('kısmi güncelleme diğer alanları korur', () => {
    let p = base();
    const [story] = p.outputs;
    const c = p.clips[1].id;
    p = applyOps(p, [
      { type: 'output.setFraming', outputId: story.id, clipId: c, framing: { zoom: 1.8, x: 0.3 } },
      { type: 'music.set', music: { assetId: 'muzik', gainDb: -9, start: 4 } },
      { type: 'captions.set', style: { color: '#FF0000', size: 80 } },
      { type: 'look.set', look: { intensity: 0.4, adjust: { temp: 0.2 } } },
    ], ctx);
    p = applyOps(p, [
      { type: 'output.setFraming', outputId: story.id, clipId: c, framing: { y: 0.2 } },
      { type: 'music.set', music: { mode: 'duck' } },
      { type: 'captions.set', style: { uppercase: true } },
      { type: 'look.set', look: { preset: 'film', adjust: { contrast: 0.1 } } },
      { type: 'clip.update', clipId: c, patch: { muted: true } },
    ], ctx);
    expect(p.outputs[0].framing[c]).toMatchObject({ zoom: 1.8, x: 0.3, y: 0.2 });
    expect(p.music).toMatchObject({ gainDb: -9, start: 4, mode: 'duck' });
    expect(p.captions.style).toMatchObject({ color: '#FF0000', size: 80, uppercase: true });
    expect(p.look).toMatchObject({ preset: 'film', intensity: 0.4 });
    expect(p.look.adjust).toMatchObject({ temp: 0.2, contrast: 0.1 });
    expect(p.clips[1]).toMatchObject({ muted: true, gainDb: 0, camera: 'auto' });
  });

  it('ses dosyası klip olarak eklenemez', () => {
    expect(() => applyOps(base(), [{ type: 'clips.add', assetIds: ['muzik'] }], ctx)).toThrow(/müzik/);
  });
});

describe('zaman çizelgesi', () => {
  it('kadraj: doldur ve kaydırma sınırları', () => {
    // 4K yatay → 1080x1920 dikey: yükseklik dolar, genişlik taşar
    const b = computeBox(3840, 2160, 1080, 1920, { mode: 'fill', x: 0.5, y: 0.5, zoom: 1 });
    expect(b.height).toBeCloseTo(1920);
    expect(b.width).toBeCloseTo(3413.33, 1);
    expect(b.left).toBeCloseTo((1080 - b.width) / 2);
    // Kenara kaydırınca boşluk kalmaz
    const edge = computeBox(3840, 2160, 1080, 1920, { mode: 'fill', x: 0, y: 0.5, zoom: 1 });
    expect(edge.left).toBe(0);
    const panned = panFraming({ mode: 'fill', x: 0.5, y: 0.5, zoom: 1 }, b, -341, 0);
    expect(panned.x).toBeCloseTo(0.6, 2);
    // Sığdır: tamamı görünür
    const fit = computeBox(3840, 2160, 1080, 1920, { mode: 'fit-blur', x: 0.5, y: 0.5, zoom: 1 });
    expect(fit.width).toBeCloseTo(1080);
    expect(fit.top).toBeGreaterThan(0);
  });

  it('kelimeleri zaman çizelgesine taşır, düzeltme ve gizlemeyi uygular', () => {
    let p = base();
    const words = [
      { t0: 1.0, t1: 1.4, text: 'Merhaba,', p: 1 },
      { t0: 1.5, t1: 1.9, text: 'bugün', p: 1 },
      { t0: 2.0, t1: 2.3, text: 'eee', p: 1 },
      { t0: 9.5, t1: 9.9, text: 'dışarıda', p: 1 },
    ];
    p = applyOps(p, [
      { type: 'clip.trim', clipId: p.clips[2].id, in: 0.5, out: 9 },
      { type: 'captions.editWord', key: 'konusma:1', text: 'Bugün' },
      { type: 'captions.editWord', key: 'konusma:2', text: '' },
    ], ctx);
    const assets = { foto: ref('foto'), ortam: ref('ortam'), konusma: ref('konusma', { words }) };
    const tw = timelineWords(p, assets);
    expect(tw.map((w) => w.text)).toEqual(['Merhaba,', 'Bugün']);
    // foto 3 + ortam 6 = 9 → konuşma 9 sn'de başlar, kaynak 0.5'ten
    expect(tw[0].t0).toBeCloseTo(9 + 0.5);
    const pages = captionPages(tw, { maxChars: 20, maxLines: 2 });
    expect(pages).toHaveLength(1);
    expect(pages[0].lines.flat().map((w) => w.text).join(' ')).toBe('Merhaba, Bugün');
  });

  it('altyazı sayfaları satır ve cümle sınırına uyar', () => {
    const mk = (texts: string[]) =>
      texts.map((text, i) => ({ key: String(i), text, t0: i * 0.4, t1: i * 0.4 + 0.35, clipId: 'c', p: 1 }));
    const pages = captionPages(mk(['Bugün', 'size', 'sahildeki', 'küçük', 'kafemizi', 'gösteriyorum.', 'Kahvemiz', 'güzel.']), { maxChars: 16, maxLines: 2 });
    expect(pages[0].lines.length).toBeLessThanOrEqual(2);
    expect(pages.flatMap((p) => p.lines.flat()).length).toBe(8);
    // Cümle sonu sayfayı böler
    expect(pages.some((p) => p.lines.flat()[0].text === 'Kahvemiz')).toBe(true);
  });

  it('müzik modları: kısık arka plan, konuşmada kıs, sabit', () => {
    let p = base();
    p = applyOps(p, [{ type: 'music.set', music: { assetId: 'muzik', mode: 'duck', gainDb: -6, duckDb: -14, fadeIn: 0, fadeOut: 0 } }], ctx);
    const total = totalDuration(p);
    const speech = speechIntervals([{ t0: 10, t1: 12 }, { t0: 12.3, t1: 14 }]);
    expect(speech).toEqual([[10, 14]]);
    const g = (t: number) => musicGainAt(t, p, speech, total);
    expect(g(2)).toBeCloseTo(dbToGain(-6));
    expect(g(11)).toBeCloseTo(dbToGain(-20));
    expect(g(9.85)).toBeLessThan(g(2)); // konuşmadan hemen önce inmeye başlar
    expect(g(14.3)).toBeGreaterThan(g(11)); // sonra yumuşakça geri gelir
    p = applyOps(p, [{ type: 'music.set', music: { mode: 'bed' } }], ctx);
    expect(musicGainAt(2, p, speech, total)).toBeCloseTo(dbToGain(-18));
    expect(musicGainAt(11, p, speech, total)).toBeCloseTo(dbToGain(-18));
    p = applyOps(p, [{ type: 'music.set', music: { mode: 'fixed' } }], ctx);
    expect(musicGainAt(11, p, speech, total)).toBeCloseTo(dbToGain(-6));
    // Klipte müziği sustur
    p = applyOps(p, [{ type: 'clip.update', clipId: p.clips[1].id, patch: { musicMuted: true } }], ctx);
    const lay = layoutClips(p);
    expect(musicGainAt((lay[1].start + lay[1].end) / 2, p, speech, total)).toBe(0);
  });
});

describe('LUT', () => {
  it('.cube okur ve trilineer örnekler', () => {
    const cube = ['TITLE "x"', 'LUT_3D_SIZE 2', '0 0 0', '1 0 0', '0 1 0', '1 1 0', '0 0 1', '1 0 1', '0 1 1', '1 1 1'].join('\n');
    const lut = parseCube(cube);
    expect(lut.size).toBe(2);
    const s = sampleLut(lut, 0.25, 0.5, 0.75);
    expect(s[0]).toBeCloseTo(0.25);
    expect(s[1]).toBeCloseTo(0.5);
    expect(s[2]).toBeCloseTo(0.75);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow();
  });

  it('kamera LUT\'ları: %18 gri log değeri ≈ 0.44 ekran değerine gider', () => {
    const dir = path.join(__dirname, '..', 'assets', 'luts', 'kamera');
    const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8')) as { id: string; grey18: number }[];
    expect(index.length).toBeGreaterThanOrEqual(10);
    for (const { id, grey18 } of index) {
      const lut = parseCube(readFileSync(path.join(dir, `${id}.cube`), 'utf8'));
      const [r, g, b] = sampleLut(lut, grey18, grey18, grey18);
      expect(Math.abs(g - 0.441), id).toBeLessThan(0.02);
      expect(Math.abs(r - b), `${id} nötr gri`).toBeLessThan(0.02);
    }
  });

  it('Sony üst verisini eşler', () => {
    expect(mapSony('s-log3-cine', 'S-Gamut3.Cine')).toBe('sony-slog3-sgamut3cine');
    expect(mapSony('s-log3', 'S-Gamut3')).toBe('sony-slog3-sgamut3');
    expect(mapSony('s-log2', 'S-Gamut')).toBe('sony-slog2-sgamut');
    expect(mapSony('rec709', 'rec709')).toBeNull();
  });
});

describe('Whisper çıktısı', () => {
  it('kelime bölümlerini okur, noktalamayı birleştirir', () => {
    const words = parseWhisperJson({
      transcription: [
        { offsets: { from: 800, to: 1200 }, text: ' Merhaba', tokens: [{ text: ' Merhaba', p: 0.9 }] },
        { offsets: { from: 1200, to: 1220 }, text: ',', tokens: [{ text: ',', p: 0.9 }] },
        { offsets: { from: 1300, to: 1700 }, text: ' bugün', tokens: [{ text: '[_BEG_]', p: 1 }, { text: ' bug', p: 0.8 }, { text: 'ün', p: 0.7 }] },
      ],
    });
    expect(words.map((w) => w.text)).toEqual(['Merhaba,', 'bugün']);
    expect(words[1].t0).toBeCloseTo(1.3);
    expect(words[1].p).toBeCloseTo(0.75);
  });

  it('sessizlikte uydurulan kalıpları atar, konuşma içindekini korur', () => {
    const w = (text: string, t0: number) => ({ text, t0, t1: t0 + 0.3, p: 0.9 });
    expect(cleanWords([w('Altyazı', 5), w('M.K.', 5.3)])).toHaveLength(0);
    expect(cleanWords([w('İzlediğiniz', 1), w('için', 1.3), w('teşekkürler', 1.6)])).toHaveLength(0);
    const keep = cleanWords([w('Bu', 0), w('müzik', 0.3), w('çok', 0.6), w('güzel', 0.9)]);
    expect(keep).toHaveLength(4);
    expect(cleanWords([{ text: 'eee', t0: 0, t1: 0.2, p: 0.05 }])).toHaveLength(0);
  });
});
