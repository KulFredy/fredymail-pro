import { describe, expect, it } from 'vitest';
import { planCommand, parseSeconds } from '../src/core/commands';
import { applyOps, newProject, type OpContext } from '../src/core/ops';
import type { AssetRef, Project } from '../src/core/schema';
import { layoutClips, totalDuration } from '../src/core/timeline';

let n = 0;
const ctx: OpContext = {
  assets: {
    yatay: { kind: 'video', duration: 30, width: 1920, height: 1080 },
    yakin: { kind: 'video', duration: 5, width: 1920, height: 1080 },
    foto: { kind: 'image', duration: 0, width: 4000, height: 3000 },
    ses: { kind: 'audio', duration: 6, width: 0, height: 0 },
  },
  newId: (p) => `${p}${++n}`,
  now: () => '2026-11-07T00:00:00.000Z',
};

// Konuşma: cümle 2 kez söyleniyor, ürün adı "Kahvemiz"
const W = (text: string, t0: number) => ({ text, t0, t1: t0 + 0.4, p: 1 });
const words = [
  W('Merhaba,', 1.0), W('bugün', 1.5), W('yeni', 2.0), W('ürünümüzü', 2.5), W('tanıtıyorum.', 3.0),
  W('Bu', 5.0), W('kahve', 5.5), W('çok', 6.0), W('güzel.', 6.5),
  W('Bu', 8.0), W('kahve', 8.5), W('çok', 9.0), W('güzel.', 9.5),
  W('Adı', 11.0), W('da', 11.5), W('Kahvemiz', 12.0), W('ve', 12.5), W('çok', 13.0), W('lezzetli.', 13.5),
];
const ref = (id: string, extra: Partial<AssetRef> = {}): AssetRef => ({
  id, kind: ctx.assets[id].kind, name: `${id}.mp4`, url: `/files/${id}`, width: ctx.assets[id].width, height: ctx.assets[id].height,
  duration: ctx.assets[id].duration, hasAudio: true, words: [], transcriptStatus: 'done', cameraDetected: null, importedAt: '2026-11-07T00:00:00Z', ...extra,
});
const assets = { yatay: ref('yatay', { words }), yakin: ref('yakin', { importedAt: '2026-11-07T01:00:00Z' }), foto: ref('foto', { importedAt: '2026-11-06T00:00:00Z' }) };

const base = (): Project =>
  applyOps(newProject('p', 'Stüdyo', ctx.now()), [{ type: 'output.add', format: 'landscape' }, { type: 'clips.add', assetIds: ['yatay'] }], ctx);
const plan = (p: Project, text: string, playhead = 0) => planCommand(text, { project: p, assets, playhead, selectedClipId: p.clips[0]?.id ?? null });

describe('yeni kurgu işlemleri', () => {
  it('aralık silme: ortadan keser, sonrası kayar, üst iz ve yazılar kayar', () => {
    let p = base();
    p = applyOps(p, [
      { type: 'overlay.add', assetId: 'yakin', at: 20, duration: 2 },
      { type: 'text.add', text: { text: 'Son', start: 25, end: 27 } },
    ], ctx);
    p = applyOps(p, [{ type: 'timeline.deleteRange', start: 10, end: 13 }], ctx);
    expect(totalDuration(p)).toBeCloseTo(27);
    expect(p.clips.map((c) => [c.in, c.out])).toEqual([[0, 10], [13, 30]]);
    expect(p.overlays[0].at).toBeCloseTo(17);
    expect(p.texts[0].start).toBeCloseTo(22);
  });

  it('bölme ve kadrajın yeni parçaya taşınması', () => {
    let p = base();
    const out = p.outputs[0].id;
    const c = p.clips[0].id;
    p = applyOps(p, [{ type: 'output.setFraming', outputId: out, clipId: c, framing: { x: 0.3 } }, { type: 'clip.split', clipId: c, at: 12 }], ctx);
    expect(p.clips).toHaveLength(2);
    expect(p.clips[1].in).toBeCloseTo(12);
    expect(p.outputs[0].framing[p.clips[1].id].x).toBe(0.3);
    expect(() => applyOps(p, [{ type: 'clip.split', clipId: p.clips[0].id, at: 0.02 }], ctx)).toThrow();
  });

  it('üst iz kaynak süresini aşmaz, ses kaydı üst ize eklenemez', () => {
    const p = applyOps(base(), [{ type: 'overlay.add', assetId: 'yakin', at: 3, duration: 9 }], ctx);
    expect(p.overlays[0].out - p.overlays[0].in).toBeCloseTo(5);
    expect(() => applyOps(base(), [{ type: 'overlay.add', assetId: 'ses', at: 0, duration: 2 }], ctx)).toThrow();
  });
});

describe('Türkçe komutlar', () => {
  it('sayıları okur', () => {
    expect(parseSeconds('üç saniyeyi kes')).toBe(3);
    expect(parseSeconds('2,5 sn')).toBe(2.5);
    expect(parseSeconds('bir buçuk saniye')).toBe(1.5);
    expect(parseSeconds('yarım saniye')).toBe(0.5);
  });

  it('“Buradan sonraki üç saniyeyi kes”', () => {
    const r = plan(base(), 'Buradan sonraki üç saniyeyi kes', 7.2);
    expect(r.understood).toBe(true);
    expect(r.ops).toEqual([{ type: 'timeline.deleteRange', start: 7.2, end: 10.2 }]);
    const p = applyOps(base(), r.ops, ctx);
    expect(totalDuration(p)).toBeCloseTo(27);
  });

  it('“İkinci kez söylediğim cümleyi çıkar”', () => {
    const r = plan(base(), 'İkinci kez söylediğim cümleyi çıkar');
    expect(r.understood).toBe(true);
    expect(r.candidates).toHaveLength(0);
    const op = r.ops[0] as { start: number; end: number };
    expect(op.start).toBeCloseTo(7.94, 1);
    expect(op.end).toBeLessThan(11);
    expect(op.end).toBeGreaterThan(9.8);
    const p = applyOps(base(), r.ops, ctx);
    expect(totalDuration(p)).toBeLessThan(28.5);
  });

  it('ürün adını bilmiyorsa adayları zaman koduyla sunar', () => {
    const r = plan(base(), 'Ürünün adını söylediğim yerde yüklediğim yakın planı iki saniye göster, sesim devam etsin');
    expect(r.understood).toBe(true);
    // Cümle başı olmayan büyük harfli kelime: "Kahvemiz"
    const all = r.candidates.length ? r.candidates : [{ ops: r.ops, label: '' }];
    const kahve = all.find((c) => (c.ops[0] as { at: number }).at === 12)!;
    expect(kahve).toBeTruthy();
    expect(kahve.ops[0]).toMatchObject({ type: 'overlay.add', assetId: 'yakin', duration: 2 });
  });

  it('kelime tırnakla verilince doğrudan yerleştirir', () => {
    const r = plan(base(), '“Kahvemiz” dediğim yerde yakın planı 2 saniye göster');
    expect(r.candidates).toHaveLength(0);
    expect(r.ops[0]).toMatchObject({ type: 'overlay.add', at: 12, duration: 2, assetId: 'yakin' });
  });

  it('birden çok yerde geçen kelime için iki aday', () => {
    const r = plan(base(), 'kahve dediğim yerde yakın planı göster');
    expect(r.candidates.length).toBe(3); // kahve, kahve, Kahvemiz (Türkçe ekler)
    expect(r.candidates[0].label).toContain('0:05');
  });

  it('kişisel stil ve proje talimatı ayrımı', () => {
    const a = plan(base(), 'Bundan sonra altyazılarımı beyaz ve iki satır yap');
    expect(a.personal?.captionStyle).toMatchObject({ color: '#FFFFFF', maxLines: 2 });
    expect(a.ops[0]).toMatchObject({ type: 'captions.set', style: { color: '#FFFFFF', maxLines: 2 } });
    const b = plan(base(), 'Bu sefer siyah beyaz yap');
    expect(b.personal).toBeUndefined();
    expect(b.note).toContain('Siyah beyaz');
    expect(b.ops[0]).toEqual({ type: 'look.set', look: { preset: 'sb' } }); // “beyaz” içindeki “az” yoğunluk sayılmaz
    expect(plan(base(), 'biraz sıcak yap').ops[0]).toEqual({ type: 'look.set', look: { preset: 'sicak', intensity: 0.4 } });
  });

  it('müzik ve anlaşılmayan komut', () => {
    expect(plan(base(), 'müziği konuşurken kıs').ops[0]).toMatchObject({ type: 'music.set', music: { mode: 'duck' } });
    expect(plan(base(), 'müziği arka planda kısık yap').ops[0]).toMatchObject({ music: { mode: 'bed' } });
    const x = plan(base(), 'bana bir kahve söyle');
    expect(x.understood).toBe(false);
    expect(x.hint).toBeTruthy();
  });

  it('kesmeden sonra geri alınabilir işlem dizisi', () => {
    const p0 = base();
    const r = plan(p0, 'ilk 2 saniyeyi kes');
    const p1 = applyOps(p0, r.ops, ctx);
    expect(layoutClips(p1)[0].clip.in).toBeCloseTo(2);
    expect(totalDuration(p0)).toBeCloseTo(30);
  });
});
