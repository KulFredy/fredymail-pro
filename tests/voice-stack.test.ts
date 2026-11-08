import { describe, expect, it } from 'vitest';
import { stackRows, voiceFreeAt, voiceOverlaps } from '../src/core/timeline';

const v = (id: string, at: number, len: number) => ({ id, at, in: 0, out: len });

describe('dış ses çakışmaları', () => {
  it('aynı noktadaki sesler ayrı satırlara dağılır', () => {
    const r = stackRows([{ start: 58.6, end: 61 }, { start: 58.6, end: 62 }, { start: 70, end: 72 }]);
    expect(r.rows).toEqual([0, 1, 0]);
    expect(r.count).toBe(2);
  });
  it('uç uca sesler aynı satırda kalır', () => {
    expect(stackRows([{ start: 0, end: 2 }, { start: 2, end: 4 }]).count).toBe(1);
    expect(stackRows([]).count).toBe(1);
  });
  it('boş an: çalan seslerin sonuna atlar, zincirleme', () => {
    const list = [v('a', 10, 3), v('b', 13, 2)];
    expect(voiceFreeAt(list, 5)).toBe(5);
    expect(voiceFreeAt(list, 10)).toBe(13 + 2);
    expect(voiceFreeAt(list, 11.5)).toBe(15);
    expect(voiceFreeAt(list, 15)).toBe(15);
  });
  it('çakışan sesleri bulur', () => {
    const list = [v('a', 10, 3), v('b', 12, 2), v('c', 13, 1)];
    expect(voiceOverlaps(list, 'a').map((x) => x.id)).toEqual(['b']);
    expect(voiceOverlaps(list, 'c').map((x) => x.id)).toEqual(['b']);
    expect(voiceOverlaps(list, 'x')).toEqual([]);
  });
});

import { applyOps, newProject, type OpContext } from '../src/core/ops';

describe('çoğaltma işlemleri', () => {
  let n = 0;
  const ctx: OpContext = {
    assets: { vid: { kind: 'video', duration: 20, width: 1920, height: 1080 }, ses: { kind: 'audio', duration: 3, width: 0, height: 0 } },
    newId: (p) => `${p}${++n}`,
    now: () => '2026-11-08T00:00:00.000Z',
  };
  it('klip çoğalt: hemen arkasına aynı kesim ve kadrajla', () => {
    let p = applyOps(newProject('p', 'T', ctx.now()), [{ type: 'output.add', format: 'reel' }, { type: 'clips.add', assetIds: ['vid', 'vid'] }], ctx);
    const [a, b] = p.clips.map((c) => c.id);
    const out = p.outputs[0].id;
    p = applyOps(p, [{ type: 'clip.trim', clipId: a, in: 2, out: 6 }, { type: 'clip.update', clipId: a, patch: { muted: true } }, { type: 'output.setFraming', outputId: out, clipId: a, framing: { x: 0.2 } }, { type: 'clip.duplicate', clipId: a }], ctx);
    expect(p.clips).toHaveLength(3);
    expect(p.clips[0].id).toBe(a);
    expect(p.clips[2].id).toBe(b);
    const c = p.clips[1];
    expect(c.id).not.toBe(a);
    expect([c.in, c.out, c.muted]).toEqual([2, 6, true]);
    expect(p.outputs[0].framing[c.id].x).toBe(0.2);
    expect(() => applyOps(p, [{ type: 'clip.duplicate', clipId: 'yok' }], ctx)).toThrow();
  });
  it('dış ses çoğalt: bitişine, sonraki seslerin üstüne binmeden', () => {
    let p = applyOps(newProject('p', 'T', ctx.now()), [{ type: 'clips.add', assetIds: ['vid'] }, { type: 'voice.add', assetId: 'ses', at: 1 }, { type: 'voice.add', assetId: 'ses', at: 4 }], ctx);
    p = applyOps(p, [{ type: 'voice.update', id: p.voice[0].id, patch: { gainDb: -4 } }, { type: 'voice.duplicate', id: p.voice[0].id }], ctx);
    expect(p.voice).toHaveLength(3);
    expect(p.voice[2].at).toBeCloseTo(7);
    expect(p.voice[2].gainDb).toBe(-4);
  });
});

import { clipIndexAt } from '../src/core/timeline';
describe('imlece ekleme sırası', () => {
  it('ortası imleçten önce kalan klipler önde kalır', () => {
    let n2 = 0;
    const c2: OpContext = { assets: { v: { kind: 'video', duration: 10, width: 1920, height: 1080 } }, newId: (p) => `${p}${++n2}`, now: () => '2026-11-08T00:00:00.000Z' };
    const p = applyOps(newProject('p', 'T', c2.now()), [{ type: 'clips.add', assetIds: ['v', 'v'] }], c2);
    expect(clipIndexAt(p, 0)).toBe(0);
    expect(clipIndexAt(p, 4)).toBe(0);
    expect(clipIndexAt(p, 6)).toBe(1);
    expect(clipIndexAt(p, 20)).toBe(2);
  });
});
