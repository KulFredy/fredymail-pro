import { describe, expect, it } from 'vitest';
import { buildXmeml, pathUrl, type XmlAsset } from '../src/core/xmeml';
import { applyOps, newProject, type OpContext } from '../src/core/ops';

let n = 0;
const ctx: OpContext = {
  assets: {
    v: { kind: 'video', duration: 10, width: 1920, height: 1080 },
    f: { kind: 'image', duration: 0, width: 1200, height: 800 },
    m: { kind: 'audio', duration: 60, width: 0, height: 0 },
    vo: { kind: 'audio', duration: 4, width: 0, height: 0 },
  },
  newId: (p) => `${p}${++n}`,
  now: () => '2026-11-08T00:00:00.000Z',
  photoDuration: 3,
};
const assets: Record<string, XmlAsset> = {
  v: { id: 'v', name: 'Çekim 1.mp4', path: '/Users/ali/İçerik Fabrikası/kutuphane/originals/a/Çekim 1.mp4', kind: 'video', duration: 10, width: 1920, height: 1080, hasAudio: true },
  f: { id: 'f', name: 'foto.jpg', path: '/Users/ali/foto.jpg', kind: 'image', duration: 0, width: 1200, height: 800, hasAudio: false },
  m: { id: 'm', name: 'müzik & ritim.mp3', path: '/Users/ali/m.mp3', kind: 'audio', duration: 60, width: 0, height: 0, hasAudio: true },
  vo: { id: 'vo', name: 'dis-ses.m4a', path: '/Users/ali/vo.m4a', kind: 'audio', duration: 4, width: 0, height: 0, hasAudio: true },
};

describe('Premiere/Resolve XML (xmeml)', () => {
  it('V1 klipleri giriş/çıkışıyla, klip sesi, dış ses ve müzik ayrı izlerde; dosya bir kez tanımlanır', () => {
    let p = applyOps(newProject('p', 'Kafe <Story>', ctx.now()), [{ type: 'output.add', format: 'landscape' }, { type: 'clips.add', assetIds: ['v', 'f'] }], ctx);
    p = applyOps(p, [{ type: 'clip.trim', clipId: p.clips[0].id, in: 2, out: 6 }, { type: 'voice.add', assetId: 'vo', at: 1 }, { type: 'music.set', music: { assetId: 'm', start: 5 } }, { type: 'overlay.add', assetId: 'v', at: 1, duration: 2, in: 7 }], ctx);
    const xml = buildXmeml(p, assets);
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="4">')).toBe(true);
    expect(xml).toContain('<name>Kafe &lt;Story&gt;</name>');
    expect(xml).toContain('<duration>210</duration>'); // 4 sn + 3 sn foto = 7 sn × 30
    // V1: ilk klip kaynakta 2–6 sn (60–180), kurguda 0–120
    expect(xml).toMatch(/<start>0<\/start><end>120<\/end><in>60<\/in><out>180<\/out>/);
    // Foto: kurguda 120–210
    expect(xml).toMatch(/<name>foto\.jpg<\/name><enabled>TRUE<\/enabled><duration>\d+<\/duration><rate>.*?<\/rate><start>120<\/start><end>210<\/end>/);
    // Aynı video dosyası (V1 + ses + V2) tek <file> tanımı, sonra referans
    expect(xml.match(/<pathurl>/g)?.length).toBe(4);
    expect(xml).toContain('<file id="file-1"/>');
    // Türkçe ve boşluklu yol yüzde kodlu
    expect(xml).toContain(`<pathurl>${pathUrl(assets.v.path)}</pathurl>`);
    expect(pathUrl('/Users/a b/İ.mp4')).toBe('file://localhost/Users/a%20b/%C4%B0.mp4');
    // Ses izleri: klip sesi, dış ses (30–150), müzik (kaynak 5 sn'den)
    expect((xml.match(/<track>/g) ?? []).length).toBe(5);
    expect(xml).toMatch(/<name>dis-ses\.m4a<\/name>.*?<start>30<\/start><end>150<\/end><in>0<\/in>/);
    expect(xml).toMatch(/<name>müzik &amp; ritim\.mp3<\/name>.*?<start>0<\/start><end>210<\/end><in>150<\/in>/);
    // V2 üst iz: 1 sn'de, kaynak 7 sn
    expect(xml).toMatch(/<start>30<\/start><end>90<\/end><in>210<\/in><out>270<\/out>/);
  });
});
