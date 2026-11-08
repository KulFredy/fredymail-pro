import { describe, expect, it } from 'vitest';
import { animAt, fixPlacement, logoBox, safeAreaIssues, safeRect, textBox } from '../src/core/graphics';
import { applyOps, newProject, type OpContext } from '../src/core/ops';
import type { AssetRef } from '../src/core/schema';

let n = 0;
const ctx: OpContext = {
  assets: {
    vid: { kind: 'video', duration: 10, width: 1920, height: 1080 },
    logo: { kind: 'image', duration: 0, width: 400, height: 200 },
  },
  newId: (p) => `${p}${++n}`,
  now: () => '2026-11-08T00:00:00.000Z',
};
const refs: Record<string, AssetRef> = {
  logo: { id: 'logo', kind: 'image', name: 'logo.png', url: '', width: 400, height: 200, duration: 0, hasAudio: false, alpha: true, words: [], transcriptStatus: 'done', cameraDetected: null },
};
const base = () =>
  applyOps(newProject('p', 'G', ctx.now()), [{ type: 'output.add', format: 'landscape' }, { type: 'output.add', format: 'story' }, { type: 'clips.add', assetIds: ['vid'] }], ctx);

describe('logo ve yerleşim', () => {
  it('logo varsayılan: sağ üst, her çıktının güvenli alanı içinde', () => {
    const p = applyOps(base(), [{ type: 'logo.add', assetId: 'logo' }], ctx);
    const l = p.logos[0];
    expect(l).toMatchObject({ anchor: 'tr', full: true, opacity: 1 });
    const [land, story] = p.outputs;
    const bS = logoBox(l, refs.logo, story);
    const rS = safeRect(story);
    expect(bS.cy - bS.h / 2).toBeGreaterThanOrEqual(rS.top); // Instagram üst bilgisinin altında
    expect(bS.cx + bS.w / 2).toBeLessThanOrEqual(rS.right);
    const bL = logoBox(l, refs.logo, land);
    expect(bL.cy).toBeLessThan(200); // yatayda üstte, köşeye yakın
    expect(bL.w).toBeCloseTo(0.18 * 1080);
    expect(bL.h).toBeCloseTo(bL.w / 2);
    expect(safeAreaIssues(p, refs)).toEqual([]);
  });

  it("serbest konumlu eski yazı Story'de üst bilginin altında kalırsa uyarır; düzeltme yalnız o oranı değiştirir", () => {
    let p = applyOps(base(), [{ type: 'text.add', text: { text: 'Hafta sonu', start: 0, end: 3, y: 0.05 } }], ctx);
    const issues = safeAreaIssues(p, refs);
    expect(issues).toHaveLength(2); // yatayda da üstte (güvenli payın dışında)
    const story = p.outputs[1];
    const st = issues.find((i) => i.outputId === story.id)!;
    expect(st.text).toMatch(/Story 9:16.*Instagram üst bilgisinin/);
    const t = p.texts[0];
    p = applyOps(p, [{ type: 'element.place', kind: 'text', id: t.id, outputId: story.id, place: fixPlacement(t, textBox(t, story), story) }], ctx);
    expect(p.texts[0].placements[story.id].anchor).toBe('tc');
    expect(safeAreaIssues(p, refs, story.id)).toEqual([]);
    expect(safeAreaIssues(p, refs, p.outputs[0].id)).toHaveLength(1); // yatay değişmedi
    p = applyOps(p, [{ type: 'element.place', kind: 'text', id: t.id, outputId: story.id, place: null }], ctx);
    expect(p.texts[0].placements).toEqual({});
  });

  it('çok büyük öğe düzeltilince küçültülür', () => {
    let p = applyOps(base(), [{ type: 'logo.add', assetId: 'logo', logo: { size: 0.9, anchor: null, x: 0.5, y: 0.5 } }], ctx);
    const story = p.outputs[1];
    const l = p.logos[0];
    expect(safeAreaIssues(p, refs, story.id)).toHaveLength(1);
    p = applyOps(p, [{ type: 'element.place', kind: 'logo', id: l.id, outputId: story.id, place: fixPlacement(l, logoBox(l, refs.logo, story), story) }], ctx);
    expect(p.logos[0].placements[story.id].scale).toBeLessThan(1);
    expect(safeAreaIssues(p, refs, story.id)).toEqual([]);
  });

  it('düzenleme, kaldırma; görsel olmayan logo olamaz; aralık silmede zamanlı logo kayar', () => {
    let p = applyOps(base(), [{ type: 'logo.add', assetId: 'logo' }, { type: 'logo.add', assetId: 'logo', logo: { full: false, start: 6, end: 8 } }], ctx);
    p = applyOps(p, [{ type: 'logo.update', id: p.logos[0].id, patch: { opacity: 0.5, anchor: 'bl', anim: 'buyume' } }], ctx);
    expect(p.logos[0]).toMatchObject({ opacity: 0.5, anchor: 'bl', anim: 'buyume', size: 0.18 });
    expect(() => applyOps(p, [{ type: 'logo.add', assetId: 'vid' }], ctx)).toThrow();
    p = applyOps(p, [{ type: 'timeline.deleteRange', start: 1, end: 3 }], ctx);
    expect(p.logos[1]).toMatchObject({ start: 4, end: 6 });
    p = applyOps(p, [{ type: 'logo.remove', id: p.logos[0].id }], ctx);
    expect(p.logos).toHaveLength(1);
  });

  it('animasyon: giriş/çıkış 0,4 sn, “yok” sabit', () => {
    expect(animAt('solma', 0, 90, 30).opacity).toBe(0);
    expect(animAt('solma', 12, 90, 30).opacity).toBe(1);
    expect(animAt('solma', 84, 90, 30).opacity).toBeLessThan(1);
    expect(animAt('buyume', 0, 90, 30).scale).toBeCloseTo(0.85);
    expect(animAt('yukari', 0, 90, 30).dy).toBe(20);
    expect(animAt('yok', 0, 90, 30)).toEqual({ opacity: 1, dy: 0, scale: 1 });
  });
});

describe('uyarı metni orana göre', () => {
  it('Story: Instagram alanı · yatay: kenar payı', () => {
    const p = applyOps(base(), [{ type: 'text.add', text: { text: 'Üstte', start: 0, end: 2, y: 0.02 } }], ctx);
    const texts = safeAreaIssues(p, refs).map((i) => i.text);
    expect(texts.find((t) => t.startsWith('Story'))).toMatch(/Instagram üst bilgisinin altında kalıyor/);
    expect(texts.find((t) => t.startsWith('Yatay'))).toMatch(/üst kenara çok yakın/);
  });
});
