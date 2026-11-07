export type Lut3D = { size: number; data: Float32Array; title: string };

/** .cube (Adobe/Resolve) 3B LUT dosyasını okur. Kırmızı en hızlı değişen eksendir. */
export const parseCube = (text: string): Lut3D => {
  let size = 0;
  let title = '';
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const upper = line.toUpperCase();
    if (upper.startsWith('TITLE')) {
      title = line.replace(/^TITLE\s*/i, '').replace(/^"|"$/g, '');
      continue;
    }
    if (upper.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1], 10);
      continue;
    }
    if (upper.startsWith('LUT_1D_SIZE')) throw new Error('1B LUT desteklenmiyor; 3B .cube dosyası seçin');
    if (upper.startsWith('DOMAIN_MIN')) {
      min = line.split(/\s+/).slice(1, 4).map(Number);
      continue;
    }
    if (upper.startsWith('DOMAIN_MAX')) {
      max = line.split(/\s+/).slice(1, 4).map(Number);
      continue;
    }
    if (/^[A-Z_]/.test(upper)) continue; // bilinmeyen anahtar
    const parts = line.split(/\s+/);
    if (parts.length >= 3) values.push(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }
  if (!size || size < 2 || size > 129) throw new Error('Geçersiz LUT: LUT_3D_SIZE bulunamadı');
  if (values.length !== size * size * size * 3)
    throw new Error(`Geçersiz LUT: ${size}³ değer bekleniyordu, ${values.length / 3} bulundu`);
  if (min.some((v) => v !== 0) || max.some((v) => v !== 1)) {
    // Çıkış alanını 0..1'e normalize etmeye gerek yok; giriş alanı farklıysa uyarı amaçlı başlığa not düş
    title = `${title} (alan ${min.join(',')}–${max.join(',')})`;
  }
  const data = new Float32Array(size * size * size * 4);
  for (let i = 0, j = 0; i < values.length; i += 3, j += 4) {
    data[j] = values[i];
    data[j + 1] = values[i + 1];
    data[j + 2] = values[i + 2];
    data[j + 3] = 1;
  }
  return { size, data, title };
};

/** Trilineer örnekleme (testler ve CPU tarafı kontroller için) */
export const sampleLut = (lut: Lut3D, r: number, g: number, b: number): [number, number, number] => {
  const n = lut.size;
  const f = (v: number) => Math.min(n - 1, Math.max(0, v * (n - 1)));
  const [x, y, z] = [f(r), f(g), f(b)];
  const [x0, y0, z0] = [Math.floor(x), Math.floor(y), Math.floor(z)];
  const [x1, y1, z1] = [Math.min(n - 1, x0 + 1), Math.min(n - 1, y0 + 1), Math.min(n - 1, z0 + 1)];
  const [dx, dy, dz] = [x - x0, y - y0, z - z0];
  const at = (i: number, j: number, k: number, c: number) => lut.data[((k * n + j) * n + i) * 4 + c];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = at(x0, y0, z0, c) * (1 - dx) + at(x1, y0, z0, c) * dx;
    const c10 = at(x0, y1, z0, c) * (1 - dx) + at(x1, y1, z0, c) * dx;
    const c01 = at(x0, y0, z1, c) * (1 - dx) + at(x1, y0, z1, c) * dx;
    const c11 = at(x0, y1, z1, c) * (1 - dx) + at(x1, y1, z1, c) * dx;
    out[c] = (c00 * (1 - dy) + c10 * dy) * (1 - dz) + (c01 * (1 - dy) + c11 * dy) * dz;
  }
  return out;
};
