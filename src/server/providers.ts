/**
 * Dış servis istemcileri (Faz 5). Her biri resmi API biçimine göre yazıldı:
 *  - ElevenLabs: resmi Python SDK'sından (api.elevenlabs.io, xi-api-key, /v1/text-to-speech/{voice_id}, /v1/voices, /v1/models, /v1/user/subscription)
 *  - Google Gemini (Nano Banana 2 = gemini-3.1-flash-image): resmi google-genai SDK'sından
 *    (generativelanguage.googleapis.com/v1beta/models/{model}:generateContent, x-goog-api-key,
 *     generationConfig.responseModalities, generationConfig.imageConfig.aspectRatio/imageSize, parts[].inlineData)
 * Testlerde temel adresler FABRIKA_ELEVENLABS_URL / FABRIKA_GEMINI_URL ile sahte sunucuya yönlendirilir.
 * Hata iletileri Türkçeleştirilir; anahtar asla iletiye eklenmez.
 */

export class ProviderError extends Error {
  constructor(
    message: string,
    public status: number,
    public kind: 'anahtar' | 'kredi' | 'sinir' | 'istek' | 'sunucu' | 'ag',
  ) {
    super(message);
  }
}

const scrub = (s: string, key: string) => (key ? s.split(key).join('••••') : s);

const httpError = async (r: Response, service: string, key: string) => {
  let detail = '';
  try {
    const t = await r.text();
    try {
      const j = JSON.parse(t);
      detail = j?.detail?.message ?? j?.detail?.status ?? (typeof j?.detail === 'string' ? j.detail : '') ?? '';
      detail = detail || j?.error?.message || j?.message || '';
    } catch {
      detail = t.slice(0, 200);
    }
  } catch {
    /* gövde yok */
  }
  detail = scrub(String(detail), key);
  const s = r.status;
  if (s === 401 || s === 403) return new ProviderError(`${service}: anahtar geçersiz veya yetkisiz${detail ? ` (${detail})` : ''}`, s, 'anahtar');
  if (s === 402) return new ProviderError(`${service}: kredi yetersiz${detail ? ` (${detail})` : ''}`, s, 'kredi');
  if (s === 429) return new ProviderError(`${service}: kota veya hız sınırı aşıldı${detail ? ` (${detail})` : ''}`, s, 'sinir');
  if (s >= 500) return new ProviderError(`${service}: servis şu an yanıt vermiyor (${s})`, s, 'sunucu');
  return new ProviderError(`${service}: istek reddedildi (${s})${detail ? `: ${detail}` : ''}`, s, 'istek');
};

const call = async (service: string, key: string, url: string, init: RequestInit, timeoutMs = 120_000) => {
  let r: Response;
  try {
    r = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    const err = e as Error;
    throw new ProviderError(`${service}: ${err.name === 'TimeoutError' ? 'zaman aşımı' : 'bağlantı kurulamadı'}`, 0, 'ag');
  }
  if (!r.ok) throw await httpError(r, service, key);
  return r;
};

// ---------------- ElevenLabs ----------------
const EL = () => process.env.FABRIKA_ELEVENLABS_URL ?? 'https://api.elevenlabs.io';
const elHeaders = (key: string, accept = 'application/json') => ({ 'xi-api-key': key, 'content-type': 'application/json', accept });

export type ElVoice = { id: string; name: string; category: string; labels: Record<string, string>; previewUrl: string | null };
export type ElModel = { id: string; name: string; tts: boolean; turkish: boolean; costMultiplier: number; maxChars: number | null };

export const elevenlabs = {
  async subscription(key: string) {
    const j = await (await call('ElevenLabs', key, `${EL()}/v1/user/subscription`, { headers: elHeaders(key) }, 20_000)).json();
    return { tier: String(j.tier ?? ''), used: Number(j.character_count ?? 0), limit: Number(j.character_limit ?? 0), resetUnix: j.next_character_count_reset_unix ?? null };
  },
  async voices(key: string): Promise<ElVoice[]> {
    const j = await (await call('ElevenLabs', key, `${EL()}/v1/voices`, { headers: elHeaders(key) }, 30_000)).json();
    return (j.voices ?? []).map((v: any) => ({ id: v.voice_id, name: v.name ?? v.voice_id, category: v.category ?? '', labels: v.labels ?? {}, previewUrl: v.preview_url ?? null }));
  },
  async models(key: string): Promise<ElModel[]> {
    const j = await (await call('ElevenLabs', key, `${EL()}/v1/models`, { headers: elHeaders(key) }, 30_000)).json();
    return (Array.isArray(j) ? j : []).map((m: any) => ({
      id: m.model_id,
      name: m.name ?? m.model_id,
      tts: m.can_do_text_to_speech !== false,
      turkish: (m.languages ?? []).some((l: any) => /^tr/i.test(l.language_id ?? '') || /türk|turkish/i.test(l.name ?? '')),
      costMultiplier: Number(m.model_rates?.character_cost_multiplier ?? 1),
      maxChars: m.max_characters_request_subscribed_user ?? m.maximum_text_length_per_request ?? null,
    }));
  },
  /** Metinden konuşma → MP3 (44,1 kHz, 128 kbps) */
  async tts(key: string, voiceId: string, body: { text: string; model_id: string; seed?: number; voice_settings?: Record<string, number | boolean> }) {
    const r = await call('ElevenLabs', key, `${EL()}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: elHeaders(key, 'audio/mpeg'),
      body: JSON.stringify(body),
    });
    return { audio: Buffer.from(await r.arrayBuffer()), requestId: r.headers.get('request-id') };
  },
};

/** Türkçe destekleyen, en uygun varsayılan model (kalite öncelikli) */
export const pickElModel = (models: ElModel[]) => {
  const tts = models.filter((m) => m.tts);
  const tr = tts.filter((m) => m.turkish);
  return tr.find((m) => m.id === 'eleven_multilingual_v2') ?? tr[0] ?? tts[0] ?? null;
};

// ---------------- Google Gemini (Nano Banana) ----------------
const GM = () => process.env.FABRIKA_GEMINI_URL ?? 'https://generativelanguage.googleapis.com';
export const GEMINI_IMAGE_MODELS = [
  { id: 'gemini-3.1-flash-image', name: 'Nano Banana 2 (önerilen)' },
  { id: 'gemini-3.1-flash-lite-image', name: 'Nano Banana 2 Lite (en hızlı, en ucuz)' },
  { id: 'gemini-3-pro-image-preview', name: 'Nano Banana Pro (en yüksek kalite)' },
] as const;
export const DEFAULT_GEMINI_IMAGE_MODEL = 'gemini-3.1-flash-image';

export const gemini = {
  async model(key: string, model: string) {
    const r = await call('Google Gemini', key, `${GM()}/v1beta/models/${encodeURIComponent(model)}`, { headers: { 'x-goog-api-key': key } }, 20_000);
    return r.json();
  },
  /** Fotoğrafı metinle düzenler; dönen ilk görseli verir */
  async editImage(key: string, model: string, image: { data: Buffer; mime: string }, prompt: string, aspectRatio?: string) {
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: image.mime, data: image.data.toString('base64') } }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { ...(aspectRatio ? { aspectRatio } : {}), imageSize: '1K' } },
    };
    const r = await call('Google Gemini', key, `${GM()}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, 180_000);
    const j = await r.json();
    const parts: any[] = j?.candidates?.[0]?.content?.parts ?? [];
    const img = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
    const text = parts.map((p) => p.text).filter(Boolean).join(' ').trim();
    if (!img) {
      const reason = j?.promptFeedback?.blockReason ?? j?.candidates?.[0]?.finishReason ?? '';
      throw new ProviderError(`Google Gemini görsel üretmedi${reason ? ` (${reason})` : ''}${text ? `: ${text.slice(0, 160)}` : ''}`, 200, 'istek');
    }
    const d = img.inlineData ?? img.inline_data;
    return { data: Buffer.from(d.data, 'base64'), mime: String(d.mimeType ?? d.mime_type ?? 'image/png'), text };
  },
};

/** Ürünün kendisini koruyarak yalnız arka planı değiştiren talimat */
export const backgroundPrompt = (userPrompt: string, variant: number) =>
  [
    'Edit this product photo. Keep the product itself exactly unchanged: the same shape, proportions, colors, materials, logo, label text and packaging.',
    'Do not redraw, translate or alter any text, logo or label on the product. Do not add extra products.',
    `Replace only the background and surroundings with: "${userPrompt.replace(/"/g, "'")}".`,
    'Keep lighting, reflections and contact shadows physically consistent with the new scene. Photorealistic, commercial product photography.',
    variant > 1 ? `This is variation ${variant}: choose a different camera-independent composition of the background than other variations.` : '',
  ]
    .filter(Boolean)
    .join(' ');
