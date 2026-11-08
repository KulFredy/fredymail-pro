import { describe, expect, it } from 'vitest';
import { BrandSchema, brandPlan, slug } from '../src/core/brand';
import { captionsFor, normalizeTags, outputTitle, CHANNELS } from '../src/core/channels';
import { captionCues, deliveryChecks, misspellings, toSrt, toVtt } from '../src/core/delivery';
import { applyOps, newProject, type OpContext } from '../src/core/ops';
import { ProjectSchema, type AssetRef, type Word } from '../src/core/schema';

let n = 0;
const ctx: OpContext = {
  assets: {
    vid: { kind: 'video', duration: 12, width: 1920, height: 1080 },
    logo: { kind: 'image', duration: 0, width: 400, height: 200 },
    ref1: { kind: 'image', duration: 0, width: 800, height: 600 },
    gen: { kind: 'image', duration: 0, width: 1024, height: 1024 },
  },
  newId: (p) => `${p}${++n}`,
  now: () => '2026-11-08T00:00:00.000Z',
};
const words: Word[] = [
  { t0: 0.2, t1: 0.6, text: 'Yeni', p: 0.9 },
  { t0: 0.6, t1: 1.1, text: 'Kahvemz', p: 0.4 },
  { t0: 1.1, t1: 1.6, text: 'geldi.', p: 0.95 },
  { t0: 2.4, t1: 2.9, text: 'Kahvemizi', p: 0.9 },
  { t0: 2.9, t1: 3.4, text: 'deneyin.', p: 0.9 },
];
const refs: Record<string, AssetRef> = {
  vid: { id: 'vid', kind: 'video', name: 'konusma.mp4', url: '', width: 1920, height: 1080, duration: 12, hasAudio: true, words, transcriptStatus: 'done', cameraDetected: null },
  logo: { id: 'logo', kind: 'image', name: 'logo.png', url: '', width: 400, height: 200, duration: 0, hasAudio: false, alpha: true, words: [], transcriptStatus: 'done', cameraDetected: null },
};
const brand = BrandSchema.parse({
  id: 'b1',
  name: 'Köşe Kahve',
  createdAt: ctx.now(),
  updatedAt: ctx.now(),
  logoAssetIds: ['logo'],
  palette: ['#3B2A20', '#E8C07D'],
  textColor: '#FFF8EE',
  accentColor: '#E8C07D',
  fonts: { heading: 'Playfair Display', body: 'Poppins' },
  tone: 'samimi, kısa',
  hashtags: ['köşekahve', 'kahve'],
  lutIds: ['lut-sicak'],
  referenceAssetIds: ['ref1'],
  products: [{ id: 'u1', name: 'Kahvemiz', notes: '250 g çekirdek' }],
  channels: ['yt-video', 'ig-reels', 'yt-shorts'],
});
const base = () => applyOps(newProject('p', 'Kampanya', ctx.now()), [{ type: 'clips.add', assetIds: ['vid'] }, { type: 'text.add', text: { text: 'Yeni Kahvemiz', start: 0, end: 3 } }], ctx);

describe('kanal profilleri', () => {
  it('aynı biçimden iki kanal (Reels + Shorts) ayrı çıktı olur; kadraj ikizden kopyalanır; YouTube altyazıyı görüntüye yazmaz', () => {
    let p = applyOps(base(), [{ type: 'output.addChannel', channel: 'ig-reels' }], ctx);
    const reels = p.outputs[0];
    p = applyOps(p, [{ type: 'output.setFraming', outputId: reels.id, clipId: p.clips[0].id, framing: { x: 0.3 } }, { type: 'output.addChannel', channel: 'yt-shorts' }, { type: 'output.addChannel', channel: 'yt-video' }], ctx);
    expect(p.outputs.map((o) => o.channel)).toEqual(['ig-reels', 'yt-shorts', 'yt-video']);
    const shorts = p.outputs[1];
    expect(shorts.format).toBe('reel');
    expect(shorts.framing[p.clips[0].id].x).toBeCloseTo(0.3);
    expect(captionsFor(p, p.outputs[2]).enabled).toBe(false);
    expect(captionsFor(p, shorts).enabled).toBe(true);
    expect(outputTitle(p.outputs[2])).toBe('YouTube video · 16:9 · MP4');
    // tekrar eklemek çoğaltmaz
    expect(applyOps(p, [{ type: 'output.addChannel', channel: 'ig-reels' }], ctx).outputs).toHaveLength(3);
  });

  it('kanalsız aynı biçimli çıktı kanala dönüşür (eski projeler)', () => {
    const p = applyOps(base(), [{ type: 'output.add', format: 'landscape' }, { type: 'output.addChannel', channel: 'yt-video' }], ctx);
    expect(p.outputs).toHaveLength(1);
    expect(p.outputs[0].channel).toBe('yt-video');
    expect(p.outputs[0].captions).toEqual({ enabled: false });
  });

  it('çıktıya özel altyazı, kapak ve metin; diğer çıktılar etkilenmez', () => {
    let p = applyOps(base(), [{ type: 'output.addChannel', channel: 'ig-reels' }, { type: 'output.addChannel', channel: 'ig-story' }], ctx);
    const [reels, story] = p.outputs;
    p = applyOps(
      p,
      [
        { type: 'output.update', outputId: reels.id, patch: { captions: { position: 'middle' }, cover: { at: 2.5 }, meta: { description: 'Yeni kahve' } } },
        { type: 'output.update', outputId: reels.id, patch: { captions: { size: 80 }, meta: { tags: ['kahve'] } } },
      ],
      ctx,
    );
    const r = p.outputs[0];
    expect(r.captions).toEqual({ position: 'middle', size: 80 });
    expect(r.cover).toEqual({ at: 2.5, title: '' });
    expect(r.meta).toMatchObject({ description: 'Yeni kahve', tags: ['kahve'] });
    expect(captionsFor(p, r).style).toMatchObject({ position: 'middle', size: 80, font: 'Inter' });
    expect(captionsFor(p, p.outputs[1]).style.position).toBe('bottom');
    expect(p.outputs[1].meta.description).toBe('');
    p = applyOps(p, [{ type: 'output.update', outputId: reels.id, patch: { captions: null, cover: null } }], ctx);
    expect(p.outputs[0].captions).toBeNull();
    expect(p.outputs[0].cover).toBeNull();
    void story;
  });

  it('etiketler platform biçiminde', () => {
    expect(normalizeTags(['#kahve', 'köşe kahve', 'Kahve', ' sabah ,akşam'], CHANNELS['ig-reels'])).toEqual(['#kahve', '#köşekahve', '#sabah', '#akşam']);
    expect(normalizeTags(['#kahve', 'köşe kahve'], CHANNELS['yt-video'])).toEqual(['kahve', 'köşe kahve']);
  });

  it('eski proje (marka/kanal alanı yok) açılır', () => {
    const raw = JSON.parse(JSON.stringify(base()));
    delete raw.brand;
    raw.outputs = [{ id: 'o1', format: 'story', kind: 'video', framing: {}, still: null }];
    const p = ProjectSchema.parse(raw);
    expect(p.brand).toBeNull();
    expect(p.outputs[0]).toMatchObject({ channel: null, captions: null, cover: null, meta: { title: '', tags: [] } });
  });
});

describe('marka profili', () => {
  it('uygulama planı: bağ, logo, altyazı, yazı, referans, kanallar; LUT isteğe bağlı', () => {
    const b0 = base();
    const plan = brandPlan(b0, brand, { productId: 'u1', campaign: 'Yaz 2026' });
    const types = plan.ops.map((o) => o.type);
    expect(types).toEqual(['project.setBrand', 'logo.add', 'captions.set', 'text.update', 'reference.add', 'output.addChannel', 'output.addChannel', 'output.addChannel']);
    expect(plan.items[0]).toContain('Köşe Kahve → Kahvemiz → Yaz 2026');
    const p = applyOps(b0, plan.ops, ctx);
    expect(p.brand).toMatchObject({ brandId: 'b1', brandName: 'Köşe Kahve', productName: 'Kahvemiz', campaign: 'Yaz 2026' });
    expect(p.captions.style).toMatchObject({ font: 'Poppins', color: '#FFF8EE', highlight: '#E8C07D' });
    expect(p.texts[0]).toMatchObject({ font: 'Playfair Display', color: '#FFF8EE' });
    expect(p.logos).toHaveLength(1);
    expect(p.look.lut).toBeNull();
    // ikinci kez uygulamak bir şey değiştirmez
    expect(brandPlan(p, brand, { productId: 'u1', campaign: 'Yaz 2026' }).ops).toEqual([]);
    const withLook = brandPlan(p, brand, { productId: 'u1', campaign: 'Yaz 2026' }, { logo: true, captions: true, texts: true, look: true, references: true, channels: true }, { 'lut-sicak': 'Sıcak' });
    expect(withLook.ops).toEqual([{ type: 'look.set', look: { lut: 'lut-sicak', lutIntensity: 0.8 } }]);
    expect(withLook.items[0]).toContain('Sıcak');
  });

  it('dosya adı', () => {
    expect(slug('Köşe Kahve / Yaz Şöleni')).toBe('kose-kahve-yaz-soleni');
    expect(slug('İĞDE')).toBe('igde');
  });
});

describe('teslim öncesi kontroller', () => {
  it('ürün adı: yanlış yazım yakalanır, Türkçe ekler sorun değil', () => {
    expect(misspellings('Yeni Kahvemz geldi', 'Kahvemiz')).toEqual(['Kahvemz']);
    expect(misspellings("Kahvemizi deneyin, Kahvemiz'in tadı", 'Kahvemiz')).toEqual([]);
    expect(misspellings('kahveler burada', 'Kahvemiz')).toEqual([]);
    expect(misspellings('Köşe Kahwe açıldı', 'Köşe Kahve')).toEqual(['Köşe Kahwe']);
    expect(misspellings('Ayva', 'Ayla')).toEqual([]); // kısa adlarda bakılmaz
  });

  it('kanal kontrolleri: ad yazımı, logo, süre, altyazı, ses, metin sınırı, kapak', () => {
    const b0 = base();
    let p = applyOps(b0, brandPlan(b0, brand, { productId: 'u1', campaign: '' }, { logo: false, captions: true, texts: true, look: false, references: false, channels: true }).ops, ctx);
    const yt = p.outputs.find((o) => o.channel === 'yt-video')!;
    p = applyOps(p, [{ type: 'output.update', outputId: yt.id, patch: { meta: { title: 'x'.repeat(101), description: 'Kahvemız burada' } } }, { type: 'music.set', music: { assetId: 'vid', mode: 'fixed', gainDb: -6 } }], ctx);
    const out = p.outputs.find((o) => o.channel === 'yt-video')!;
    const checks = deliveryChecks({ project: p, assets: refs, output: out, brand, loudness: { lufs: -20.3, truePeak: -0.2 } });
    const by = (id: string) => checks.find((c) => c.id === id);
    expect(by('urun-logo')?.level).toBe('uyari');
    expect(by('urun-logo')?.fix?.ops[0]).toMatchObject({ type: 'logo.add', assetId: 'logo' });
    expect(by('urun-ad')?.text).toContain('altyazı: “Kahvemz” → “Kahvemiz”?');
    expect(by('urun-ad')?.text).toContain('açıklama: “Kahvemız”');
    expect(by('metin-title')?.level).toBe('hata');
    expect(by('kapak')?.level).toBe('uyari');
    expect(by('ses-muzik')?.fix?.ops[0]).toEqual({ type: 'music.set', music: { mode: 'duck' } });
    expect(by('ses-lufs')?.text).toContain('-20.3 LUFS');
    expect(by('ses-tepe')?.level).toBe('uyari');
    expect(by('altyazi-dosya')?.level).toBe('ok');
    expect(by('altyazi-kapali')).toBeUndefined(); // YouTube'da görüntüye yazılmaz, dosya verilir
    // Shorts: altyazı kapatılırsa uyarır ve düzeltme önerir; emin olunamayan kelime sayılır
    const sh = p.outputs.find((o) => o.channel === 'yt-shorts')!;
    const p2 = applyOps(p, [{ type: 'output.update', outputId: sh.id, patch: { captions: { enabled: false } } }], ctx);
    const c2 = deliveryChecks({ project: p2, assets: refs, output: p2.outputs.find((o) => o.id === sh.id)!, brand });
    expect(c2.find((c) => c.id === 'altyazi-kapali')?.fix?.ops[0]).toMatchObject({ patch: { captions: { enabled: true } } });
    const c3 = deliveryChecks({ project: p, assets: refs, output: sh, brand });
    expect(c3.find((c) => c.id === 'altyazi-emin')?.text).toMatch(/^1 kelime/);
  });

  it('onaysız üretilmiş görsel hata; Story 60 sn sınırı', () => {
    let p = applyOps(base(), [{ type: 'clips.add', assetIds: ['gen'] }, { type: 'output.addChannel', channel: 'ig-story' }], ctx);
    p = applyOps(p, [{ type: 'clip.trim', clipId: p.clips[0].id, in: 0, out: 12 }], ctx);
    const c = deliveryChecks({ project: p, assets: refs, output: p.outputs[0], unapprovedAssetIds: new Set(['gen']) });
    expect(c.find((x) => x.id === 'urun-onay')?.level).toBe('hata');
    expect(c.find((x) => x.id === 'sure')?.level).toBe('ok');
    const long = { ...p, clips: [...p.clips, ...Array.from({ length: 5 }, (_, i) => ({ ...p.clips[0], id: `k${i}` }))] };
    expect(deliveryChecks({ project: long, assets: refs, output: p.outputs[0] }).find((x) => x.id === 'sure')?.level).toBe('hata');
  });

  it('altyazı dosyası: düzeltmeler uygulanır, SRT/VTT zaman biçimi', () => {
    let p = base();
    p = applyOps(p, [{ type: 'captions.editWord', key: 'vid:1', text: 'Kahvemiz' }], ctx);
    const cues = captionCues(p, refs);
    expect(cues).toHaveLength(2);
    expect(cues[0].text).toBe('Yeni Kahvemiz geldi.');
    const srt = toSrt(cues);
    expect(srt.startsWith('1\n00:00:00,200 --> 00:00:02,100\nYeni Kahvemiz geldi.\n\n2\n')).toBe(true);
    expect(srt).toContain('2\n00:00:02,400 --> ');
    expect(toVtt(cues)).toMatch(/^WEBVTT\n\n00:00:00\.200 --> /);
  });
});
