import { describe, expect, it } from 'vitest';
import { analyzeBeats, nearestBeat } from '../src/core/beats';
import { motionFraming } from '../src/core/timeline';

/** Metronom: her vuruşta kısa, sönümlenen tık + hafif gürültü */
const clickTrack = (bpm: number, seconds: number, rate = 22050, offset = 0.2, accentEvery = 0) => {
  const pcm = new Float32Array(Math.floor(seconds * rate));
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.02;
  for (let i = 0; i < pcm.length; i++) pcm[i] = rnd();
  const period = 60 / bpm;
  let k = 0;
  for (let t = offset; t < seconds; t += period, k++) {
    const start = Math.floor(t * rate);
    const amp = accentEvery && k % accentEvery === 0 ? 0.9 : 0.6;
    for (let j = 0; j < rate * 0.06 && start + j < pcm.length; j++) pcm[start + j] += amp * Math.sin((2 * Math.PI * 880 * j) / rate) * Math.exp(-j / (rate * 0.012));
  }
  return { pcm, rate, period, offset };
};

describe('vuruş algılama', () => {
  for (const bpm of [90, 120, 140]) {
    it(`${bpm} BPM metronom`, () => {
      const { pcm, rate, period, offset } = clickTrack(bpm, 20);
      const r = analyzeBeats(pcm, rate);
      expect(Math.abs(r.bpm - bpm)).toBeLessThan(2.5);
      // Vuruşlar gerçek tıklara 40 ms içinde oturur
      const errs = r.beats.slice(1, -1).map((b) => {
        const k = Math.round((b - offset) / period);
        return Math.abs(b - (offset + k * period));
      });
      expect(Math.max(...errs)).toBeLessThan(0.04);
      expect(r.beats.length).toBeGreaterThan(20 / period - 3);
    });
  }
  it('sessizlikte vuruş yok / kısa ses', () => {
    expect(analyzeBeats(new Float32Array(22050 * 2), 22050).beats).toEqual([]);
  });
  it('en yakın vuruş', () => {
    expect(nearestBeat([0.5, 1, 1.5], 1.2)).toBe(1);
    expect(nearestBeat([], 1)).toBeNull();
  });
});

describe('Ken Burns', () => {
  const f = { mode: 'fill' as const, x: 0.5, y: 0.5, zoom: 1 };
  it('yakınlaşma: başta 1, sonda 1+a; girişte süreli', () => {
    const m = { kind: 'yakinlas' as const, amount: 0.2, duration: null };
    expect(motionFraming(f, m, 0, 5).zoom).toBeCloseTo(1);
    expect(motionFraming(f, m, 5, 5).zoom).toBeCloseTo(1.2);
    expect(motionFraming(f, m, 2.5, 5).zoom).toBeCloseTo(1.1);
    const g = { ...m, duration: 1 };
    expect(motionFraming(f, g, 1, 5).zoom).toBeCloseTo(1.2);
    expect(motionFraming(f, g, 4, 5).zoom).toBeCloseTo(1.2);
  });
  it('kaydırma: büyütür ve odağı taşır; hareket yoksa aynı', () => {
    const m = { kind: 'sola' as const, amount: 0.2, duration: null };
    const a = motionFraming(f, m, 0, 4);
    const b = motionFraming(f, m, 4, 4);
    expect(a.zoom).toBeCloseTo(1.2);
    expect(b.x - a.x).toBeCloseTo(0.4);
    expect(motionFraming(f, null, 2, 4)).toBe(f);
  });
});
