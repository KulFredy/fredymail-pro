/**
 * Marka profili (Faz 6): logo, renkler, yazı tipleri, metin tonu, LUT favorileri, referanslar,
 * tercih edilen dış ses, ürünler ve varsayılan kanallar. Markalar projelerden bağımsız saklanır;
 * projeye uygulanırken mevcut işlemlere çevrilir (geri alınabilir, MCP ve komutlar aynı yolu kullanır).
 */
import { z } from 'zod';
import { CHANNEL_IDS, CHANNELS } from './channels';
import type { OpInput } from './ops';
import { FONTS, type Project, type ProjectBrand } from './schema';

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Renk #RRGGBB biçiminde olmalı');

export const ProductSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** Kısa not: içerik, boyut, öne çıkan özellik (metin yazımında kullanılır) */
  notes: z.string().default(''),
});
export type Product = z.infer<typeof ProductSchema>;

export const BrandSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Kütüphanedeki logo görselleri (ilki ana logo) */
  logoAssetIds: z.array(z.string()).default([]),
  /** Marka renkleri (gösterim + seçim için) */
  palette: z.array(hex).max(8).default([]),
  /** Yazı ve altyazı rengi */
  textColor: hex.default('#FFFFFF'),
  /** Vurgu rengi (altyazıda konuşulan kelime) */
  accentColor: hex.default('#FFD60A'),
  fonts: z.object({ heading: z.enum(FONTS).default('Montserrat'), body: z.enum(FONTS).default('Inter') }).default({ heading: 'Montserrat', body: 'Inter' }),
  /** Metin tonu: “samimi, kısa cümleler, emoji yok” gibi */
  tone: z.string().default(''),
  /** Her paylaşımda kullanılacak etiketler */
  hashtags: z.array(z.string()).default([]),
  /** LUT favorileri; ilki “marka görünümü” olarak uygulanabilir */
  lutIds: z.array(z.string()).default([]),
  lutIntensity: z.number().min(0).max(1).default(0.8),
  referenceAssetIds: z.array(z.string()).default([]),
  /** Tercih edilen dış ses (ElevenLabs) */
  voice: z.object({ voiceId: z.string(), voiceName: z.string().default('') }).nullable().default(null),
  captionBox: z.boolean().default(false),
  captionUppercase: z.boolean().default(false),
  products: z.array(ProductSchema).default([]),
  channels: z.array(z.enum(CHANNEL_IDS)).default(['ig-reels', 'ig-story']),
});
export type Brand = z.infer<typeof BrandSchema>;

/** Markayı projeye uygularken neler yapılsın (arayüzde kutucuklar) */
export type BrandApplyOptions = { logo: boolean; captions: boolean; texts: boolean; look: boolean; references: boolean; channels: boolean };
export const DEFAULT_APPLY: BrandApplyOptions = { logo: true, captions: true, texts: true, look: false, references: true, channels: true };

export const projectBrandOf = (brand: Brand, productId: string | null, campaign: string): ProjectBrand => {
  const product = brand.products.find((p) => p.id === productId) ?? null;
  return { brandId: brand.id, brandName: brand.name, productId: product?.id ?? null, productName: product?.name ?? '', campaign: campaign.trim() };
};

export type BrandPlan = { ops: OpInput[]; items: string[] };

/**
 * Marka uygulama planı: hangi işlemler yapılacak ve kullanıcıya ne söylenecek.
 * Saf fonksiyon; zaten uygunsa işlem üretmez (tekrar uygulamak güvenli).
 */
export const brandPlan = (
  project: Project,
  brand: Brand,
  link: { productId: string | null; campaign: string },
  opts: BrandApplyOptions = DEFAULT_APPLY,
  lutNames: Record<string, string> = {},
): BrandPlan => {
  const ops: OpInput[] = [];
  const items: string[] = [];
  const pb = projectBrandOf(brand, link.productId, link.campaign);
  const cur = project.brand;
  if (!cur || cur.brandId !== pb.brandId || cur.productId !== pb.productId || cur.campaign !== pb.campaign || cur.brandName !== pb.brandName || cur.productName !== pb.productName) {
    ops.push({ type: 'project.setBrand', brand: pb });
    items.push(`Proje ${[pb.brandName, pb.productName, pb.campaign].filter(Boolean).join(' → ')} altına alınır`);
  }
  const logoId = brand.logoAssetIds[0];
  if (opts.logo && logoId && !project.logos.some((l) => brand.logoAssetIds.includes(l.assetId))) {
    ops.push({ type: 'logo.add', assetId: logoId });
    items.push('Marka logosu eklenir (sağ üst, her oranın güvenli alanında)');
  }
  if (opts.captions) {
    const st = project.captions.style;
    const want = { font: brand.fonts.body, color: brand.textColor, highlight: brand.accentColor, box: brand.captionBox, uppercase: brand.captionUppercase };
    const diff = Object.fromEntries(Object.entries(want).filter(([k, v]) => st[k as keyof typeof st] !== v));
    if (Object.keys(diff).length) {
      ops.push({ type: 'captions.set', style: diff });
      items.push(`Altyazı: ${brand.fonts.body}, yazı ${brand.textColor}, vurgu ${brand.accentColor}${brand.captionBox ? ', kutulu' : ''}${brand.captionUppercase ? ', büyük harf' : ''}`);
    }
  }
  if (opts.texts) {
    const changed = project.texts.filter((t) => t.font !== brand.fonts.heading || t.color.toUpperCase() !== brand.textColor.toUpperCase());
    for (const t of changed) ops.push({ type: 'text.update', id: t.id, patch: { font: brand.fonts.heading, color: brand.textColor } });
    if (changed.length) items.push(`${changed.length} yazı ${brand.fonts.heading} ve marka rengine geçer`);
  }
  const lut = brand.lutIds[0];
  if (opts.look && lut && (project.look.lut !== lut || Math.abs(project.look.lutIntensity - brand.lutIntensity) > 0.01)) {
    ops.push({ type: 'look.set', look: { lut, lutIntensity: brand.lutIntensity } });
    items.push(`Marka görünümü: ${lutNames[lut] ?? lut} (%${Math.round(brand.lutIntensity * 100)})`);
  }
  if (opts.references) {
    const missing = brand.referenceAssetIds.filter((id) => !project.references.some((r) => r.assetId === id));
    for (const id of missing) ops.push({ type: 'reference.add', assetId: id });
    if (missing.length) items.push(`${missing.length} marka referansı Referanslar'a eklenir`);
  }
  if (opts.channels) {
    const missing = brand.channels.filter((c) => !project.outputs.some((o) => o.channel === c));
    for (const c of missing) ops.push({ type: 'output.addChannel', channel: c });
    if (missing.length) items.push(`Kanallar: ${missing.map((c) => CHANNELS[c].label).join(', ')}`);
  }
  return { ops, items };
};

/** Dosya adı için güvenli parça: “Kahve Dükkanı / Yaz” → “kahve-dukkani-yaz” */
export const slug = (s: string) =>
  s
    .toLocaleLowerCase('tr-TR')
    .replace(/[çğıöşü]/g, (c) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' })[c] ?? c)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'proje';
