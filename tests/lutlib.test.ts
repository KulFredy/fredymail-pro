import { describe, expect, it } from 'vitest';
import { parseCube, sampleLut } from '../src/core/lut';
import { classifyLut, inputLabel, lutFormat, parse3dl, sameInput, toCube, unsupportedReason } from '../src/core/lutlib';

describe('LUT sınıflandırma (kullanıcının gerçek dosya adları)', () => {
  const c = (n: string) => classifyLut(n);
  it('görünüm LUT\'ları', () => {
    for (const n of ['Los Feliz.cube', 'Bloodbag.cube', 'Candlelight.CUBE', 'Fuji ETERNA 250D Kodak 2395 (by Adobe).cube', 'Prolost Flat Cinematic.cube', 'NightFromDay.CUBE', 'Vibrance Thing.cube'])
      expect(c(n).kind, n).toBe('gorunum');
    expect(c('Fuji ETERNA 250D Kodak 2395 (by Adobe).cube').tags).toContain('film');
    expect(c('Candlelight.CUBE').tags).toContain('sıcak');
    expect(c('Blue Unity.cube').tags).toContain('soğuk');
  });
  it('teknik LUT\'lar ve beklenen giriş', () => {
    const cases: [string, string][] = [
      ['Sony SLog 3.cube', 'sony-slog3-sgamut3cine'],
      ['SLog3SGamut3.CineToLC-709.cube', 'sony-slog3-sgamut3cine'],
      ['sLog2 Warm.cube', 'sony-slog2-sgamut'],
      ['V-Log to V-709.cube', 'panasonic-vlog'],
      ['DJI_X7_DLOG2Rec709.cube', 'dji-dlog'],
      ['Arri Log C.cube', 'arri-logc3'],
      ['Universal Log Cinematic.cube', 'log'],
      ['ACEScc Log to Rec709 Video.cube', 'log'],
      ['Rec709 Kodak 2383 D65.cube', 'cineon'],
      ['DCI-P3 Fujifilm 3513DI D60.cube', 'cineon'],
      ['Gamma 2.4 to HDR 1000 nits.cube', 'hdr'],
      ['HLG to Gamma 2.4.cube', 'hdr'],
      ['Linear to Rec.709.cube', 'linear'],
      ['Olympus OM-Log400_to_BT.709_v1.0.cube', 'log'],
      ['Blackmagic 4K Film to Rec709 v3.cube', 'log'],
    ];
    for (const [n, input] of cases) expect(c(n), n).toMatchObject({ kind: 'teknik', input });
  });
  it('giriş adları ve aynı eğri', () => {
    expect(inputLabel(null)).toBe('normal video (Rec.709)');
    expect(inputLabel('sony-slog3-sgamut3cine')).toBe('Sony S-Log3');
    expect(sameInput('sony-slog3-sgamut3', 'sony-slog3-sgamut3cine')).toBe(true);
    expect(sameInput('sony-slog3-sgamut3', 'sony-slog2-sgamut')).toBe(false);
  });
  it('biçimler', () => {
    expect(lutFormat('a.CUBE')).toBe('cube');
    expect(lutFormat('Moonlight.3DL')).toBe('3dl');
    expect(lutFormat('paket.zip')).toBe('zip');
    expect(lutFormat('Crisp_Warm.look')).toBeNull();
    expect(unsupportedReason('Crisp_Warm.look')).toMatch(/look/);
  });
});

describe('.3dl okuma', () => {
  /** N ızgaralı, 12 bit, mavi en hızlı; f(r,g,b) çıkışı */
  const make3dl = (n: number, f: (r: number, g: number, b: number) => [number, number, number], header = true) => {
    const mesh = Array.from({ length: n }, (_, i) => Math.round((i * 1023) / (n - 1))).join(' ');
    const rows: string[] = [];
    for (let r = 0; r < n; r++) for (let g = 0; g < n; g++) for (let b = 0; b < n; b++) rows.push(f(r / (n - 1), g / (n - 1), b / (n - 1)).map((v) => Math.round(v * 4095)).join(' '));
    return (header ? '3DMESH\nMesh 4 12\n' : '') + mesh + '\n' + rows.join('\n') + '\n';
  };
  it('özdeşlik LUT\'u .cube ile aynı sonucu verir (eksen sırası doğru)', () => {
    const lut = parse3dl(make3dl(5, (r, g, b) => [r, g, b]));
    expect(lut.size).toBe(5);
    const s = sampleLut(lut, 0.2, 0.6, 0.9);
    expect(s[0]).toBeCloseTo(0.2, 2);
    expect(s[1]).toBeCloseTo(0.6, 2);
    expect(s[2]).toBeCloseTo(0.9, 2);
  });
  it('kanal değiştiren LUT (r↔b) doğru okunur; başlıksız dosyada çıkış derinliği tahmin edilir', () => {
    const lut = parse3dl(make3dl(3, (r, g, b) => [b, g, r], false));
    const s = sampleLut(lut, 1, 0, 0);
    expect(s).toEqual([0, 0, 1].map((v) => expect.closeTo(v, 2)) as unknown as [number, number, number]);
  });
  it('.cube\'a dönüştürülüp tekrar okunabilir', () => {
    const lut = parse3dl(make3dl(4, (r, g, b) => [1 - r, g, b * 0.5]));
    const back = parseCube(toCube(lut, 'Ters "kırmızı"'));
    expect(back.size).toBe(4);
    expect(back.title).toBe("Ters 'kırmızı'");
    expect(sampleLut(back, 0.25, 0.5, 1)[0]).toBeCloseTo(0.75, 3);
    expect(sampleLut(back, 0.25, 0.5, 1)[2]).toBeCloseTo(0.5, 3);
  });
  it('bozuk dosyada anlaşılır hata', () => {
    expect(() => parse3dl('0 512 1023\n1 2 3\n4 5 6\n')).toThrow(/küp/);
  });
});
