import { describe, expect, it } from 'vitest';
import { captionCues } from '../src/core/delivery';
import { applyOps, newProject, type OpContext } from '../src/core/ops';
import type { AssetRef } from '../src/core/schema';
import { captionWords, timelineWords, transcriptSegments } from '../src/core/timeline';

let n = 0;
const ctx: OpContext = {
  assets: { v: { kind: 'video', duration: 20, width: 1080, height: 1920 } },
  newId: (p) => `${p}${++n}`,
  now: () => '2026-11-09T00:00:00.000Z',
};
const W = (text: string, t0: number) => ({ text, t0, t1: t0 + 0.4, p: 0.3 });
const words = [W('No', 1), W('need', 1.5), W('to', 2), W('rebalance.', 2.5), W('Just', 4), W('shoot.', 4.5)];
const assets: Record<string, AssetRef> = {
  v: { id: 'v', kind: 'video', name: 'v.mp4', url: '/v', width: 1080, height: 1920, duration: 20, hasAudio: true, words, transcriptStatus: 'done', cameraDetected: null, importedAt: '' } as AssetRef,
};

describe('altyazı çevirisi', () => {
  it('kaynak satırlar cümle cümle, kaynak zamanında', () => {
    const p = applyOps(newProject('p', 'T', ctx.now()), [{ type: 'clips.add', assetIds: ['v'] }], ctx);
    const segs = transcriptSegments(p, assets);
    expect(segs).toHaveLength(1);
    expect(segs[0].segs.map((s) => s.text)).toEqual(['No need to rebalance.', 'Just shoot.']);
    expect(segs[0].segs[1].t0).toBeCloseTo(4);
  });

  it('çeviri altyazıda görünür, transkript orijinal kalır; kırpma zamanı korunur; düzelt / geri dön', () => {
    let p = applyOps(newProject('p', 'T', ctx.now()), [{ type: 'clips.add', assetIds: ['v'] }], ctx);
    p = applyOps(p, [{ type: 'clip.trim', clipId: p.clips[0].id, in: 0.5, out: 10 }, { type: 'captions.set', inVideo: true }], ctx);
    p = applyOps(
      p,
      [{ type: 'captions.setTranslation', translation: { lang: 'tr', from: 'en', byAsset: { v: [{ t0: 1, t1: 2.9, text: 'Yeniden dengelemeye gerek yok.' }, { t0: 4, t1: 4.9, text: 'Sadece çek.' }] } } }],
      ctx,
    );
    expect(p.captions.enabled).toBe(true);
    expect(p.captions.inVideo).toBe(false);
    const cw = captionWords(p, assets);
    expect(cw.map((w) => w.text).join(' ')).toBe('Yeniden dengelemeye gerek yok. Sadece çek.');
    expect(cw[0].t0).toBeCloseTo(0.5); // kaynak 1 sn, klip 0.5'ten başlıyor
    expect(cw.every((w) => w.p === 1)).toBe(true);
    expect(timelineWords(p, assets)[0].text).toBe('No'); // transkript ve kesimler orijinal
    expect(captionCues(p, assets).map((c) => c.text.replace('\n', ' ')).join(' | ')).toContain('Sadece çek.');
    p = applyOps(p, [{ type: 'captions.editTranslation', assetId: 'v', index: 1, text: 'Hemen çek.' }], ctx);
    expect(captionWords(p, assets).map((w) => w.text).slice(-2)).toEqual(['Hemen', 'çek.']);
    expect(() => applyOps(p, [{ type: 'captions.editTranslation', assetId: 'v', index: 9, text: 'x' }], ctx)).toThrow();
    p = applyOps(p, [{ type: 'captions.setTranslation', translation: null }], ctx);
    expect(captionWords(p, assets)[0].text).toBe('No');
  });
});
