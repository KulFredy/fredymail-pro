/**
 * Ayarlar → Bağlantılar (Faz 5): servisler, durumları, anahtarları (kasada), ayarları ve Claude kullanım özeti.
 * Anahtar önceliği: kasa (Anahtar Zinciri / gizli dosya) → ortam değişkeni.
 */
import Anthropic from '@anthropic-ai/sdk';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_GEMINI_IMAGE_MODEL, GEMINI_IMAGE_MODELS, ProviderError, elevenlabs, gemini, pickElModel } from './providers';
import { maskKey, type Secrets } from './secrets';

export type ConnId = 'anthropic' | 'elevenlabs' | 'gemini' | 'higgsfield';

export const CONNECTIONS: {
  id: ConnId;
  name: string;
  capabilities: string[];
  env: string[];
  where: string;
  verified: boolean;
  note?: string;
}[] = [
  { id: 'anthropic', name: 'Claude (Anthropic API)', capabilities: ['Serbest Türkçe kurgu komutlarını anlama'], env: ['ANTHROPIC_API_KEY'], where: 'console.anthropic.com → API Keys (hesapta kredi olmalı)', verified: true },
  { id: 'elevenlabs', name: 'ElevenLabs', capabilities: ['Metinden Türkçe dış ses', 'Kısa örnek dinleme', 'Kalan karakter kredisi'], env: ['ELEVENLABS_API_KEY'], where: 'elevenlabs.io → sağ altta profil → API Keys', verified: true },
  { id: 'gemini', name: 'Google Gemini · Nano Banana 2', capabilities: ['Ürün fotoğrafına yeni arka plan (ürün, logo, etiket korunur)'], env: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'], where: 'aistudio.google.com → Get API key', verified: true },
  {
    id: 'higgsfield',
    name: 'Higgsfield',
    capabilities: ['Görselden kısa video (henüz uygulama içinden değil)'],
    env: ['HF_KEY'],
    where: 'cloud.higgsfield.ai → API Keys (Key ID ve Secret; “KEY_ID:SECRET” biçiminde girin)',
    verified: false,
    note: 'Resmi API belgelerine (docs.higgsfield.ai) bu çalışma ortamından ulaşılamadı; yerel fotoğraf yükleme uç noktası doğrulanmadı. Anahtar güvenle saklanır; üretim şimdilik Higgsfield sitesinde veya Claude Code ile yapılıp sonuç Medya\'ya içe aktarılır.',
  },
];

export type ConnSettings = { elevenlabs?: { voiceId?: string; modelId?: string }; gemini?: { model?: string } };
export type UsageRow = { at: string; model: string; input: number; output: number; usd: number };

export class Connections {
  private settingsFile: string;
  private usageFile: string;
  constructor(
    home: string,
    public secrets: Secrets,
  ) {
    this.settingsFile = path.join(home, 'baglantilar.json');
    this.usageFile = path.join(home, 'kullanim.json');
  }

  async key(id: ConnId): Promise<{ value: string; source: 'kasa' | 'ortam' } | null> {
    const v = await this.secrets.get(id);
    if (v) return { value: v, source: 'kasa' };
    const def = CONNECTIONS.find((c) => c.id === id)!;
    for (const e of def.env) if (process.env[e]) return { value: process.env[e]!, source: 'ortam' };
    return null;
  }

  async settings(): Promise<ConnSettings> {
    try {
      return JSON.parse(await readFile(this.settingsFile, 'utf8'));
    } catch {
      return {};
    }
  }
  async saveSettings(patch: ConnSettings) {
    const cur = await this.settings();
    const next = { ...cur, elevenlabs: { ...cur.elevenlabs, ...patch.elevenlabs }, gemini: { ...cur.gemini, ...patch.gemini } };
    await writeFile(this.settingsFile, JSON.stringify(next, null, 2));
    return next;
  }

  /** Bağlantı denemesi: anahtar geçerli mi, ne kadar kullanım kaldı */
  async test(id: ConnId): Promise<{ ok: boolean; detail: string }> {
    const k = await this.key(id);
    if (!k) return { ok: false, detail: 'Anahtar yok' };
    try {
      if (id === 'anthropic') {
        const client = new Anthropic({ apiKey: k.value, authToken: null, timeout: 20_000, maxRetries: 0 });
        await client.models.list({ limit: 1 });
        return { ok: true, detail: 'Anahtar geçerli' };
      }
      if (id === 'elevenlabs') {
        const s = await elevenlabs.subscription(k.value);
        return { ok: true, detail: `${s.tier} · kalan ${Math.max(0, s.limit - s.used).toLocaleString('tr-TR')} / ${s.limit.toLocaleString('tr-TR')} karakter` };
      }
      if (id === 'gemini') {
        const model = (await this.settings()).gemini?.model ?? DEFAULT_GEMINI_IMAGE_MODEL;
        await gemini.model(k.value, model);
        return { ok: true, detail: `Anahtar geçerli · ${GEMINI_IMAGE_MODELS.find((m) => m.id === model)?.name ?? model}` };
      }
      return { ok: /^[^:\s]+:[^:\s]+$/.test(k.value), detail: /^[^:\s]+:[^:\s]+$/.test(k.value) ? 'Kaydedildi (bağlantı denemesi doğrulanmadı)' : 'Biçim “KEY_ID:SECRET” olmalı' };
    } catch (e) {
      const err = e as { status?: number; message?: string };
      const msg = e instanceof ProviderError ? e.message : err.status === 401 ? 'Anahtar geçersiz' : `Bağlanılamadı: ${String(err.message ?? '').split(k.value).join('••••').slice(0, 160)}`;
      return { ok: false, detail: msg };
    }
  }

  async list(withTest = false) {
    const st = await this.settings();
    const usage = await this.usage();
    return Promise.all(
      CONNECTIONS.map(async (c) => {
        const k = await this.key(c.id);
        return {
          ...c,
          configured: !!k,
          source: k ? (k.source === 'kasa' ? this.secrets.kind : 'ortam') : null,
          hint: maskKey(k?.value ?? null),
          status: withTest && k ? await this.test(c.id) : null,
          settings: c.id === 'elevenlabs' ? (st.elevenlabs ?? {}) : c.id === 'gemini' ? { model: st.gemini?.model ?? DEFAULT_GEMINI_IMAGE_MODEL, models: GEMINI_IMAGE_MODELS } : {},
          usage: c.id === 'anthropic' ? usage : undefined,
        };
      }),
    );
  }

  async set(id: ConnId, value: string) {
    const v = value.trim();
    if (!v) throw new Error('Anahtar boş');
    await this.secrets.set(id, v);
    if ((await this.secrets.get(id)) !== v) throw new Error('Anahtar kaydedilemedi');
    return this.test(id);
  }
  async remove(id: ConnId) {
    await this.secrets.remove(id);
  }

  /** Uygulama içi Claude kullanımı (Claude Code'un kendi aboneliği buraya girmez) */
  async recordUsage(row: UsageRow) {
    let rows: UsageRow[] = [];
    try {
      rows = JSON.parse(await readFile(this.usageFile, 'utf8'));
    } catch {
      /* ilk kayıt */
    }
    rows.push(row);
    await writeFile(this.usageFile, JSON.stringify(rows.slice(-2000)));
  }
  async usage() {
    let rows: UsageRow[] = [];
    try {
      rows = JSON.parse(await readFile(this.usageFile, 'utf8'));
    } catch {
      return { commands: 0, usd: 0, todayCommands: 0, todayUsd: 0 };
    }
    const today = new Date().toISOString().slice(0, 10);
    const t = rows.filter((r) => r.at.startsWith(today));
    return { commands: rows.length, usd: rows.reduce((s, r) => s + r.usd, 0), todayCommands: t.length, todayUsd: t.reduce((s, r) => s + r.usd, 0) };
  }

  /** Eski sürümde ayarlar.json'da duran Claude anahtarını kasaya taşı (geri okunup doğrulandıktan sonra dosyadan silinir) */
  async migrateLegacy(settingsFile: string) {
    let st: Record<string, unknown>;
    try {
      st = JSON.parse(await readFile(settingsFile, 'utf8'));
    } catch {
      return false;
    }
    const legacy = typeof st.anthropicApiKey === 'string' ? (st.anthropicApiKey as string) : null;
    if (!legacy) return false;
    await this.secrets.set('anthropic', legacy);
    if ((await this.secrets.get('anthropic')) !== legacy) return false;
    delete st.anthropicApiKey;
    await writeFile(settingsFile, JSON.stringify(st, null, 2), { mode: 0o600 });
    return true;
  }
}

export { pickElModel };
