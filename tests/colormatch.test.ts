import { describe, expect, it } from 'vitest';
import { buildMatchLut, colorStats, describeMatch, labToRgb, mergeStats, rgbToLab } from '../src/core/colormatch';
import { sampleLut } from '../src/core/lut';

/** w×h boyutlu RGBA görüntü; renk(i) piksel rengi */
const img = (n: number, color: (i: number) => [number, number, number]) => {
  const px = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = color(i);
    px.set([r, g, b, 255], i * 4);
  }
  return px;
};
const dist = (a: number[], b: number[]) => Math.hypot(...a.map((v, i) => v - b[i]));

describe('Lab dönüşümü', () => {
  it('gidiş-dönüş', () => {
    for (const c of [[0.2, 0.5, 0.8], [1, 1, 1], [0, 0, 0], [0.9, 0.3, 0.1]] as [number, number, number][]) {
      const back = labToRgb(rgbToLab(...c));
      expect(dist(back, c)).toBeLessThan(1e-3);
    }
    expect(rgbToLab(1, 1, 1)[0]).toBeCloseTo(100, 1);
    expect(rgbToLab(0.5, 0.5, 0.5)[1]).toBeCloseTo(0, 1);
  });
});

describe('renk eşleme', () => {
  // Hedef: soğuk, soluk gri-mavi tonlar · Referans: sıcak turuncu tonlar
  const target = colorStats(img(400, (i) => [90 + (i % 40), 110 + (i % 40), 140 + (i % 40)]));
  const ref = colorStats(img(400, (i) => [190 + (i % 50), 120 + (i % 40), 60 + (i % 30)]));

  it('aynı istatistikte LUT özdeşliğe yakındır', () => {
    const lut = buildMatchLut(target, target, 17);
    for (const c of [[0.4, 0.45, 0.55], [0.1, 0.2, 0.3], [0.8, 0.7, 0.6]] as [number, number, number][]) expect(dist(sampleLut(lut, ...c), c)).toBeLessThan(0.01);
  });

  it('hedefin ortalama rengini referansa yaklaştırır (sınır içinde)', () => {
    const lut = buildMatchLut(target, ref, 33);
    const t = target.mean;
    const before = labToRgb(t);
    const after = sampleLut(lut, ...before);
    const labAfter = rgbToLab(...after);
    expect(dist(labAfter, ref.mean)).toBeLessThan(dist(t, ref.mean) * 0.75);
    expect(labAfter[2]).toBeGreaterThan(t[2] + 8); // daha sarı/sıcak
  });

  it('siyah ve beyaz korunur', () => {
    const lut = buildMatchLut(target, ref, 33);
    expect(dist(sampleLut(lut, 0, 0, 0), [0, 0, 0])).toBeLessThan(0.05);
    expect(sampleLut(lut, 1, 1, 1)[0]).toBeGreaterThan(0.9);
  });

  it('Türkçe özet', () => {
    const d = describeMatch(target, ref);
    expect(d.join(' · ')).toMatch(/sıcak/);
    expect(describeMatch(target, target)[0]).toMatch(/çok yakın/);
    const night = colorStats(img(100, () => [10, 12, 20]));
    expect(describeMatch(target, night).join(' ')).toMatch(/sınırlandı/);
  });

  it('kareleri birleştirir', () => {
    const m = mergeStats([target, target]);
    expect(m.mean[0]).toBeCloseTo(target.mean[0], 5);
    expect(m.std[1]).toBeCloseTo(target.std[1], 5);
  });
});

describe('referans işlemleri', async () => {
  const { applyOps, newProject } = await import('../src/core/ops');
  let n = 0;
  const ctx = {
    assets: { foto: { kind: 'image' as const, duration: 0, width: 100, height: 100 }, vid: { kind: 'video' as const, duration: 8, width: 100, height: 100 }, ses: { kind: 'audio' as const, duration: 5, width: 0, height: 0 } },
    newId: (p: string) => `${p}${++n}`,
    now: () => '2026-11-08T00:00:00.000Z',
  };
  it('ekle, kare seç, kaldır; ses referans olamaz; kurguya girmez', () => {
    let p = applyOps(newProject('p', 'R', ctx.now()), [{ type: 'reference.add', assetId: 'foto' }, { type: 'reference.add', assetId: 'vid', at: 20 }], ctx);
    expect(p.references.map((r) => r.assetId)).toEqual(['foto', 'vid']);
    expect(p.references[1].at).toBeCloseTo(7.95);
    expect(p.clips).toHaveLength(0);
    p = applyOps(p, [{ type: 'reference.update', id: p.references[1].id, patch: { at: 3.5 } }], ctx);
    expect(p.references[1].at).toBe(3.5);
    expect(() => applyOps(p, [{ type: 'reference.add', assetId: 'ses' }], ctx)).toThrow();
    p = applyOps(p, [{ type: 'reference.remove', id: p.references[0].id }], ctx);
    expect(p.references).toHaveLength(1);
  });
});
