/**
 * Altyazı çevirisi: konuşmanın cümleleri Claude ile hedef dile çevrilir; zamanlar korunur.
 * Sonuç bir öneri olarak döner; arayüz captions.setTranslation işlemiyle uygular (tek adımda geri alınır).
 * Anahtar yalnız bu yerel sunucuda kullanılır; tarayıcıya, proje dosyasına, loga yazılmaz.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { CaptionTranslation } from '../core/schema';
import { costUsd, type AiUsage } from './ai';

export type SourceSegs = { assetId: string; segs: { t0: number; t1: number; text: string }[] }[];

export const LANG_NAMES: Record<string, string> = { tr: 'Türkçe', en: 'İngilizce', de: 'Almanca', fr: 'Fransızca', es: 'İspanyolca', it: 'İtalyanca', ar: 'Arapça', ru: 'Rusça', zh: 'Çince', ja: 'Japonca' };

/** Kabaca maliyet: ~3,5 karakter = 1 token; çıktı yaklaşık girdi kadar */
export const translateEstimate = (src: SourceSegs, model: string) => {
  const lines = src.reduce((n, a) => n + a.segs.length, 0);
  const chars = src.reduce((n, a) => n + a.segs.reduce((m, s) => m + s.text.length, 0), 0);
  const inTok = Math.ceil(chars / 3.5) + 900;
  const outTok = Math.ceil(chars / 3) + 200;
  const usd = costUsd(model, { input_tokens: inTok, output_tokens: outTok, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } as Anthropic.Beta.BetaUsage);
  return { lines, chars, usd };
};

const TOOL = {
  name: 'altyazi_cevirisi',
  description: 'Altyazı satırlarının çevirisini sırasıyla verir.',
  input_schema: {
    type: 'object' as const,
    properties: {
      kaynakDil: { type: 'string', description: 'Kaynak konuşmanın dili (ISO 639-1, ör. en)' },
      satirlar: { type: 'array', items: { type: 'object', properties: { i: { type: 'integer' }, metin: { type: 'string' } }, required: ['i', 'metin'] } },
      not: { type: 'string', description: 'Kaynak metin anlamsız/bozuksa kısa açıklama; yoksa boş' },
    },
    required: ['satirlar'],
  },
};

export const claudeTranslate = async (opts: {
  apiKey: string;
  model: string;
  src: SourceSegs;
  lang: string;
  /** Çevrilmeyecek adlar: marka, ürün */
  keep: string[];
  context?: string;
}): Promise<{ translation: CaptionTranslation; usage: AiUsage; note: string }> => {
  const flat = opts.src.flatMap((a) => a.segs.map((s) => ({ assetId: a.assetId, ...s })));
  const client = new Anthropic({ apiKey: opts.apiKey, authToken: null, timeout: 120_000, maxRetries: 1 });
  const target = LANG_NAMES[opts.lang] ?? opts.lang;
  const out = new Map<number, string>();
  let from = '';
  let note = '';
  const usage: AiUsage = { model: opts.model, input: 0, output: 0, usd: 0 };
  // Uzun videolar parça parça (her istekte ≤120 satır); satır numaraları genel
  for (let start = 0; start < flat.length; start += 120) {
    const chunk = flat.slice(start, start + 120).map((s, k) => ({ i: start + k, metin: s.text }));
    const response = await client.messages.create({
      model: opts.model,
      max_tokens: 8000,
      system:
        `Profesyonel video altyazı çevirmenisin. Satırları ${target} diline çevir. ` +
        'Her satır ayrı bir altyazıdır: satır sayısı, sırası ve numaraları aynen kalsın; satırları birleştirme veya bölme. ' +
        'Kısa, doğal, okunur cümleler kur; konuşma dilini koru, birebir kelime çevirisi yapma. ' +
        `Şu adları çevirme, aynen yaz: ${opts.keep.filter(Boolean).join(', ') || '(yok)'}. Teknik terimlerde sektörde yaygın karşılığı kullan; ölçü birimlerini ve sayıları koru. ` +
        'Kaynak satır otomatik konuşma tanımadan gelir; bariz tanıma hatalarını bağlamdan düzeltip çevir. Anlamsız satırı uydurma: en yakın makul çeviriyi yaz ve not alanında belirt. ' +
        'Sonucu altyazi_cevirisi aracıyla ver.',
      tools: [TOOL],
      messages: [{ role: 'user', content: `Bağlam: ${opts.context || '-'}\nSatırlar (JSON):\n${JSON.stringify(chunk)}` }],
    });
    usage.model = response.model;
    usage.input += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0);
    usage.output += response.usage.output_tokens;
    usage.usd += costUsd(response.model, response.usage as Anthropic.Beta.BetaUsage);
    const call = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === TOOL.name);
    if (!call) throw new Error('Claude çeviri döndürmedi');
    const inp = call.input as { kaynakDil?: string; satirlar?: { i: number; metin: string }[]; not?: string };
    from ||= inp.kaynakDil ?? '';
    if (inp.not) note = note ? `${note} ${inp.not}` : inp.not;
    for (const r of inp.satirlar ?? []) if (Number.isInteger(r.i) && typeof r.metin === 'string') out.set(r.i, r.metin.trim());
  }
  const missing = flat.filter((_, i) => !out.get(i)).length;
  if (missing > flat.length / 4) throw new Error(`Claude ${flat.length} satırın ${missing} tanesini çevirmedi`);
  const byAsset: CaptionTranslation['byAsset'] = {};
  flat.forEach((s, i) => {
    (byAsset[s.assetId] ??= []).push({ t0: s.t0, t1: s.t1, text: out.get(i) || s.text });
  });
  return { translation: { lang: opts.lang, from, byAsset }, usage, note };
};
