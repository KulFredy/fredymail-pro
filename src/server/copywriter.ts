/**
 * Yayın metinleri (Faz 6): başlık, açıklama, etiket, reklam başlığı/metni.
 * Claude anahtarı varsa marka tonu, ürün notu ve konuşma metninden yazar; yoksa yerel şablon.
 * Sonuç öneridir; arayüzde düzenlenip output.update işlemiyle kaydedilir (geri alınabilir).
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Brand } from '../core/brand';
import { channelOf, type ChannelInfo } from '../core/channels';
import type { AssetRef, Output, OutputMeta, Project } from '../core/schema';
import { sentences, timelineWords } from '../core/timeline';
import { costUsd, type AiUsage } from './ai';

export type MetaSuggestion = { outputId: string; meta: Partial<OutputMeta> };

const cut = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1).replace(/\s+\S*$/, '')}…`);

/** İnternetsiz şablon: ürün + kampanya başlığı, konuşmanın ilk cümleleri, marka etiketleri */
export const localMeta = (project: Project, assets: Record<string, AssetRef>, brand: Brand | null, outputs: Output[]): MetaSuggestion[] => {
  const b = project.brand;
  const product = b?.productName || project.name;
  const said = sentences(timelineWords(project, assets))
    .map((s) => s.text)
    .slice(0, 3)
    .join(' ');
  const notes = brand?.products.find((p) => p.id === b?.productId)?.notes ?? '';
  const baseTags = [...(brand?.hashtags ?? []), b?.productName ?? '', b?.brandName ?? ''].filter(Boolean);
  return outputs.map((o) => {
    const ch: ChannelInfo | null = channelOf(o);
    const meta: Partial<OutputMeta> = {};
    const f = ch?.fields ?? {};
    if (f.title) meta.title = cut([product, b?.campaign, b?.brandName && b.brandName !== product ? b.brandName : ''].filter(Boolean).join(' | '), f.title.max);
    if (f.description) meta.description = cut([said || notes || product, notes && said ? notes : ''].filter(Boolean).join('\n\n'), f.description.max);
    if (f.tags) meta.tags = baseTags;
    if (f.headline) meta.headline = cut(b?.campaign ? `${product}: ${b.campaign}` : product, f.headline.max);
    if (f.primaryText) meta.primaryText = cut(said.split(/(?<=[.!?…])\s/)[0] || notes || product, f.primaryText.max);
    return { outputId: o.id, meta };
  });
};

const TOOL = {
  name: 'yayin_metinleri',
  description: 'Her kanal için yayın metinlerini verir.',
  input_schema: {
    type: 'object' as const,
    properties: {
      kanallar: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            outputId: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            tags: { type: 'array', items: { type: 'string' } },
            headline: { type: 'string' },
            primaryText: { type: 'string' },
          },
          required: ['outputId'],
        },
      },
    },
    required: ['kanallar'],
  },
};

export const claudeMeta = async (opts: {
  apiKey: string;
  model: string;
  project: Project;
  assets: Record<string, AssetRef>;
  brand: Brand | null;
  outputs: Output[];
}): Promise<{ suggestions: MetaSuggestion[]; usage: AiUsage }> => {
  const { project, brand } = opts;
  const b = project.brand;
  const product = brand?.products.find((p) => p.id === b?.productId);
  const said = timelineWords(project, opts.assets)
    .map((w) => w.text)
    .join(' ')
    .slice(0, 4000);
  const kanallar = opts.outputs.map((o) => {
    const ch = channelOf(o);
    return {
      outputId: o.id,
      kanal: ch?.label ?? 'Instagram',
      alanlar: Object.fromEntries(Object.entries(ch?.fields ?? { description: { label: 'Açıklama', max: 2200 } }).map(([k, f]) => [k, `${f!.label}, en çok ${f!.max}${f!.hint ? ` (${f!.hint})` : ''}`])),
      mevcut: o.meta,
    };
  });
  const context = {
    proje: project.name,
    marka: b?.brandName ?? null,
    urun: b?.productName ?? null,
    urunNotu: product?.notes ?? null,
    kampanya: b?.campaign ?? null,
    ton: brand?.tone || 'sade, samimi Türkçe',
    markaEtiketleri: brand?.hashtags ?? [],
    konusma: said || null,
    yazilar: project.texts.map((t) => t.text),
    kanallar,
  };
  const client = new Anthropic({ apiKey: opts.apiKey, authToken: null, timeout: 60_000, maxRetries: 1 });
  const response = await client.messages.create({
    model: opts.model,
    max_tokens: 3000,
    system:
      'Türkçe sosyal medya ve reklam metni yazarısın. Verilen markanın tonuna uy; ürün ve marka adlarını aynen verilen yazımla kullan. ' +
      'Uydurma iddia, fiyat, indirim veya sağlık iddiası ekleme; yalnız bağlamdaki bilgileri kullan. Sınırları aşma. ' +
      'Instagram etiketlerinde # kullanma (sistem ekler), 5–12 etiket yeter. YouTube başlığı merak uyandıran ama abartısız olsun. ' +
      'Sonucu yayin_metinleri aracıyla ver; yalnız kanalın alanlarını doldur.',
    tools: [TOOL],
    messages: [{ role: 'user', content: `Bağlam (JSON):\n${JSON.stringify(context)}` }],
  });
  const call = response.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use' && c.name === TOOL.name);
  const usage: AiUsage = {
    model: response.model,
    input: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0),
    output: response.usage.output_tokens,
    usd: costUsd(response.model, response.usage as Anthropic.Beta.BetaUsage),
  };
  if (!call) throw new Error('Claude metin döndürmedi');
  const rows = ((call.input as { kanallar?: (Partial<OutputMeta> & { outputId: string })[] }).kanallar ?? []).filter((r) => opts.outputs.some((o) => o.id === r.outputId));
  const suggestions = rows.map(({ outputId, ...meta }) => {
    const o = opts.outputs.find((x) => x.id === outputId)!;
    const allowed = Object.keys(channelOf(o)?.fields ?? { description: 1 });
    const clean: Partial<OutputMeta> = {};
    for (const k of allowed) {
      const v = meta[k as keyof OutputMeta];
      if (k === 'tags' && Array.isArray(v)) clean.tags = v.map(String);
      else if (typeof v === 'string') (clean as Record<string, string>)[k] = v.trim();
    }
    return { outputId, meta: clean };
  });
  return { suggestions, usage };
};
