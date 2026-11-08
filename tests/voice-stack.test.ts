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
