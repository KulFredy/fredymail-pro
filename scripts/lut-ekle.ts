/**
 * Bir klasördeki bütün LUT'ları (alt klasörler dahil) açık uygulamanın LUT kütüphanesine ekler.
 * Kullanım:  npm run lut-ekle -- ~/Desktop/LUTlarim
 * Uygulama açık olmalı (npm run fabrika). Asıl dosyalara dokunulmaz; aynı LUT ikinci kez eklenmez.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const BASE = process.env.FABRIKA_URL ?? 'http://127.0.0.1:4747';
const LUT_EXT = /\.(cube|3dl|zip|look|xmp)$/i;

const walk = async (dir: string): Promise<string[]> => {
  const out: string[] = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
};

const main = async () => {
  const arg = process.argv[2] ?? path.join(os.homedir(), 'Desktop', 'LUTlarim');
  const dir = path.resolve(arg.replace(/^~(?=$|\/)/, os.homedir()));
  if (!(await stat(dir).catch(() => null))?.isDirectory()) {
    console.error(`✗ Klasör bulunamadı: ${dir}`);
    process.exit(1);
  }
  const all = await walk(dir);
  const files = all.filter((f) => LUT_EXT.test(f));
  console.log(`▸ ${dir}\n▸ ${all.length} dosya bulundu, ${files.length} tanesi LUT olabilir${all.length > files.length ? ` (${all.length - files.length} başka dosya atlandı)` : ''}`);
  if (!files.length) return;

  try {
    await fetch(`${BASE}/api/luts`, { signal: AbortSignal.timeout(4000) });
  } catch {
    console.error('✗ Uygulama açık değil. Başka bir Terminal penceresinde “npm run fabrika” çalıştırıp tekrar deneyin.');
    process.exit(1);
  }

  // Büyük paketleri parça parça gönder (tek istekte çok büyük olmasın)
  type Row = { file: string; status: 'eklendi' | 'vardi' | 'hata'; name?: string; reason?: string; kind?: string; input?: string | null };
  const report: Row[] = [];
  for (let i = 0; i < files.length; i += 20) {
    const fd = new FormData();
    for (const f of files.slice(i, i + 20)) fd.append('files', new Blob([new Uint8Array(await readFile(f))]), path.relative(dir, f));
    const r = await fetch(`${BASE}/api/luts`, { method: 'POST', body: fd });
    const j = await r.json();
    if (!r.ok) {
      console.error(`✗ Sunucu hatası: ${j.error ?? r.status}`);
      process.exit(1);
    }
    report.push(...(j.report as Row[]));
    process.stdout.write(`\r▸ Gönderildi: ${Math.min(i + 20, files.length)}/${files.length}`);
  }
  console.log('\n');
  const by = (s: Row['status']) => report.filter((r) => r.status === s);
  const added = by('eklendi');
  console.log(`✓ ${added.length} LUT eklendi (${added.filter((r) => r.kind === 'gorunum').length} görünüm, ${added.filter((r) => r.kind === 'teknik').length} teknik)`);
  if (by('vardi').length) console.log(`= ${by('vardi').length} zaten vardı (aynı içerik)`);
  if (by('hata').length) {
    console.log(`✗ ${by('hata').length} okunamadı:`);
    const reasons = new Map<string, string[]>();
    for (const r of by('hata')) reasons.set(r.reason ?? '?', [...(reasons.get(r.reason ?? '?') ?? []), r.file]);
    for (const [reason, list] of reasons) console.log(`   • ${reason} (${list.length}): ${list.slice(0, 4).join(', ')}${list.length > 4 ? ' …' : ''}`);
  }
  console.log('\nStüdyo → LUT\'larım sekmesinde görünürler (açıksa sayfayı yenileyin: ⌘R).');
};

main().catch((e) => {
  console.error('✗', (e as Error).message);
  process.exit(1);
});
