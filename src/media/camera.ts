import { open, stat } from 'node:fs/promises';
import type { ProbeInfo } from './probe';

export type CameraInfo = { detected: string | null; make: string; model: string; reason: string };

/**
 * Kameradan bağımsız log algılama.
 * - Sony: MP4 içindeki XML üst verisinde CaptureGammaEquation / CaptureColorPrimaries
 * - Diğer markalar: üst veri metninde log profili adı (V-Log, C-Log, F-Log, N-Log, D-Log, Apple Log)
 * Algılanamazsa kullanıcı klip başına "Kamera dönüşümü" listesinden seçer.
 */
const readEdges = async (file: string, bytes = 4 * 1024 * 1024) => {
  const { size } = await stat(file);
  const fh = await open(file, 'r');
  try {
    const head = Buffer.alloc(Math.min(bytes, size));
    await fh.read(head, 0, head.length, 0);
    let tail = Buffer.alloc(0);
    if (size > bytes) {
      tail = Buffer.alloc(Math.min(bytes, size - bytes));
      await fh.read(tail, 0, tail.length, size - tail.length);
    }
    return head.toString('latin1') + '\n' + tail.toString('latin1');
  } finally {
    await fh.close();
  }
};

export const mapSony = (gamma: string, primaries: string): string | null => {
  const g = gamma.toLowerCase();
  const p = primaries.toLowerCase();
  if (g.includes('s-log3')) return g.includes('cine') || p.includes('cine') ? 'sony-slog3-sgamut3cine' : 'sony-slog3-sgamut3';
  if (g.includes('s-log2')) return 'sony-slog2-sgamut';
  return null;
};

export const detectCamera = async (file: string, info: ProbeInfo): Promise<CameraInfo> => {
  const res: CameraInfo = { detected: null, make: '', model: '', reason: '' };
  if (info.kind !== 'video') return res;
  let text = '';
  try {
    text = await readEdges(file);
  } catch {
    return res;
  }
  const dev = /<Device\s+manufacturer="([^"]*)"\s+modelName="([^"]*)"/i.exec(text);
  if (dev) {
    res.make = dev[1];
    res.model = dev[2];
  }
  const gamma = /CaptureGammaEquation"\s+value="([^"]+)"/i.exec(text)?.[1];
  if (gamma) {
    const prim = /CaptureColorPrimaries"\s+value="([^"]+)"/i.exec(text)?.[1] ?? '';
    res.detected = mapSony(gamma, prim);
    res.reason = `Kamera üst verisi: ${gamma}${prim ? ' / ' + prim : ''}`;
    return res;
  }
  const tagText = Object.entries(info.tags)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');
  if (!res.make) {
    res.make = info.tags['com.apple.quicktime.make'] ?? info.tags.make ?? info.tags.manufacturer ?? '';
    res.model = info.tags['com.apple.quicktime.model'] ?? info.tags.model ?? '';
  }
  const hay = `${tagText}\n${text.slice(0, 200_000)}`;
  const rules: [RegExp, string, string][] = [
    [/apple\s?log/i, 'apple-log', 'Apple Log'],
    [/\bV-?Log\b/, 'panasonic-vlog', 'V-Log'],
    [/C-?Log\s?3|Canon\s?Log\s?3/i, 'canon-clog3', 'Canon Log 3'],
    [/F-?Log2/, 'fujifilm-flog2', 'F-Log2'],
    [/\bF-?Log\b/, 'fujifilm-flog', 'F-Log'],
    [/\bN-?Log\b/, 'nikon-nlog', 'N-Log'],
    [/\bD-?Log\b/, 'dji-dlog', 'D-Log'],
  ];
  for (const [re, id, label] of rules) {
    if (re.test(hay)) {
      res.detected = id;
      res.reason = `Üst veride "${label}" bulundu`;
      return res;
    }
  }
  if (info.bitDepth >= 10 && !info.hdr && /sony/i.test(res.make)) {
    res.reason = '10-bit Sony çekimi: log ile çektiyseniz kamera dönüşümünü seçin';
  }
  return res;
};
