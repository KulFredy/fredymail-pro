/**
 * Ücretli üretim işleri (Faz 5): ElevenLabs dış ses, Gemini ürün arka planı.
 * - Önce tahmin (karakter/kredi, gönderilecek medya), sonra üretim; sonuç yerel medya olarak saklanır.
 * - Her iş uretimler.json'a yazılır. Aynı dış ses isteği (metin+ses+model) tekrar harcama yapmaz;
 *   süren bir iş varken aynı istek ikinci kez gönderilmez (çift tıklama / zaman aşımı).
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Asset } from '../core/schema';
import { DEFAULT_GEMINI_IMAGE_MODEL, ProviderError, backgroundPrompt, elevenlabs, gemini, pickElModel, type ElModel, type ElVoice } from './providers';
import type { Service } from './service';
import { newId } from './store';

export type GenKind = 'dis-ses' | 'arka-plan';
export type GenStatus = 'calisiyor' | 'bitti' | 'onay-bekliyor' | 'onaylandi' | 'hata';
export type Generation = {
  id: string;
  kind: GenKind;
  provider: 'elevenlabs' | 'gemini';
  model: string;
  projectId: string;
  status: GenStatus;
  key: string;
  request: Record<string, unknown>;
  estimate: { units: number; unit: string; credits?: number; note?: string };
  resultAssetIds: string[];
  approvedAssetIds: string[];
  error?: string;
  createdAt: string;
  finishedAt?: string;
};

const sha = (o: unknown) => createHash('sha256').update(JSON.stringify(o)).digest('hex').slice(0, 20);
const STALE_MS = 5 * 60_000;

export class Generator {
  private file: string;
  private cache: { at: number; models?: ElModel[]; voices?: ElVoice[] } = { at: 0 };
  constructor(private svc: Service) {
    this.file = svc.store.p('uretimler.json');
  }

  async list(projectId?: string): Promise<Generation[]> {
    let all: Generation[] = [];
    try {
      all = JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      /* ilk iş */
    }
    return projectId ? all.filter((g) => g.projectId === projectId) : all;
  }
  private async save(g: Generation) {
    const all = await this.list();
    const i = all.findIndex((x) => x.id === g.id);
    if (i >= 0) all[i] = g;
    else all.unshift(g);
    await writeFile(this.file, JSON.stringify(all.slice(0, 500), null, 2));
    return g;
  }

  private async key(id: 'elevenlabs' | 'gemini') {
    const k = await this.svc.conns.key(id);
    if (!k) throw new ProviderError(id === 'elevenlabs' ? 'ElevenLabs bağlı değil. Ayarlar → Bağlantılar\'dan anahtar ekleyin.' : 'Google Gemini bağlı değil. Ayarlar → Bağlantılar\'dan anahtar ekleyin.', 0, 'anahtar');
    return k.value;
  }

  // ---------------- ElevenLabs ----------------
  async elCatalog(force = false) {
    const key = await this.key('elevenlabs');
    if (force || !this.cache.models || Date.now() - this.cache.at > 10 * 60_000) {
      const [models, voices] = await Promise.all([elevenlabs.models(key), elevenlabs.voices(key)]);
      this.cache = { at: Date.now(), models, voices };
    }
    const st = (await this.svc.conns.settings()).elevenlabs ?? {};
    const def = pickElModel(this.cache.models!);
    return {
      models: this.cache.models!.filter((m) => m.tts),
      voices: this.cache.voices!,
      defaultModelId: st.modelId ?? def?.id ?? null,
      defaultVoiceId: st.voiceId ?? this.cache.voices![0]?.id ?? null,
    };
  }

  /** Harcamadan önce: kaç karakter, kaç kredi, ne kadar kalmış */
  async ttsEstimate(text: string, voiceId?: string, modelId?: string) {
    const key = await this.key('elevenlabs');
    const cat = await this.elCatalog();
    const model = cat.models.find((m) => m.id === (modelId ?? cat.defaultModelId)) ?? cat.models[0];
    const voice = cat.voices.find((v) => v.id === (voiceId ?? cat.defaultVoiceId)) ?? cat.voices[0];
    if (!model || !voice) throw new ProviderError('ElevenLabs: kullanılabilir ses veya model bulunamadı', 0, 'istek');
    const chars = [...text.trim()].length;
    const sub = await elevenlabs.subscription(key).catch(() => null);
    return {
      chars,
      credits: Math.ceil(chars * model.costMultiplier),
      remaining: sub ? Math.max(0, sub.limit - sub.used) : null,
      model: { id: model.id, name: model.name, turkish: model.turkish, maxChars: model.maxChars },
      voice: { id: voice.id, name: voice.name },
    };
  }

  /** Kısa örnek (ilk cümle, ≤120 karakter); projeye eklenmez */
  async ttsSample(text: string, voiceId: string, modelId: string) {
    const key = await this.key('elevenlabs');
    const first = (text.trim().match(/^[^.!?…\n]{1,120}[.!?…]?/)?.[0] ?? text.trim().slice(0, 120)).trim();
    const { audio } = await elevenlabs.tts(key, voiceId, { text: first, model_id: modelId });
    const dir = this.svc.store.p('kutuphane', 'cache', 'ornekler');
    await mkdir(dir, { recursive: true });
    const name = `ornek-${sha({ first, voiceId, modelId })}.mp3`;
    await writeFile(path.join(dir, name), audio);
    return { file: `kutuphane/cache/ornekler/${name}`, text: first, chars: [...first].length };
  }

  /** Dış ses üret ve ize ekle (voiceItemId varsa o öğenin kaydını değiştir) */
  async tts(projectId: string, req: { text: string; voiceId: string; modelId: string; at: number; voiceItemId?: string | null }) {
    const text = req.text.trim();
    if (!text) throw new ProviderError('Metin boş', 0, 'istek');
    const key = sha({ kind: 'dis-ses', text, voiceId: req.voiceId, modelId: req.modelId });
    const all = await this.list();
    const project = await this.svc.store.getProject(projectId);
    const cat = await this.elCatalog();
    const voiceName = cat.voices.find((v) => v.id === req.voiceId)?.name ?? '';
    const ttsMeta = { provider: 'elevenlabs', text, voiceId: req.voiceId, voiceName, modelId: req.modelId };
    const place = async (assetId: string) =>
      req.voiceItemId && project.voice.some((v) => v.id === req.voiceItemId)
        ? this.svc.store.applyOps(projectId, [{ type: 'voice.setAsset', id: req.voiceItemId, assetId, tts: ttsMeta }], 'ui', 'Dış ses yeniden üretildi')
        : this.svc.store.applyOps(projectId, [{ type: 'voice.add', assetId, at: req.at, tts: ttsMeta }], 'ui', 'Dış ses üretildi');

    // Aynı istek daha önce bitti: yeniden harcama yok
    const done = all.find((g) => g.key === key && g.status === 'bitti' && g.resultAssetIds[0] && this.svc.store.library.has(g.resultAssetIds[0]));
    if (done) return { generation: done, reused: true, state: await place(done.resultAssetIds[0]) };
    // Aynı istek şu an sürüyor: ikinci kez gönderme
    const running = all.find((g) => g.key === key && g.status === 'calisiyor' && Date.now() - Date.parse(g.createdAt) < STALE_MS);
    if (running) return { generation: running, reused: false, running: true, state: null };

    const model = cat.models.find((m) => m.id === req.modelId);
    const g = await this.save({
      id: newId(),
      kind: 'dis-ses',
      provider: 'elevenlabs',
      model: req.modelId,
      projectId,
      status: 'calisiyor',
      key,
      request: { text, voiceId: req.voiceId, voiceName, modelId: req.modelId },
      estimate: { units: [...text].length, unit: 'karakter', credits: Math.ceil([...text].length * (model?.costMultiplier ?? 1)) },
      resultAssetIds: [],
      approvedAssetIds: [],
      createdAt: new Date().toISOString(),
    });
    try {
      const apiKey = await this.key('elevenlabs');
      const { audio } = await elevenlabs.tts(apiKey, req.voiceId, { text, model_id: req.modelId });
      const tmp = this.svc.store.p('tmp', `dis-ses-${g.id}.mp3`);
      await writeFile(tmp, audio);
      const asset = await this.svc.importFile(tmp, `Dış ses · ${voiceName || 'ElevenLabs'} · ${text.slice(0, 24)}.mp3`);
      await this.svc.store.patchAsset(asset.id, { role: 'voiceover', generated: { provider: 'elevenlabs', model: req.modelId, prompt: text, sourceAssetId: null, genId: g.id } });
      g.status = 'bitti';
      g.resultAssetIds = [asset.id];
      g.approvedAssetIds = [asset.id];
      g.finishedAt = new Date().toISOString();
      await this.save(g);
      return { generation: g, reused: false, state: await place(asset.id) };
    } catch (e) {
      g.status = 'hata';
      g.error = (e as Error).message;
      g.finishedAt = new Date().toISOString();
      await this.save(g);
      throw e;
    }
  }

  // ---------------- Gemini: ürün fotoğrafına yeni arka plan ----------------
  async backgrounds(projectId: string, req: { assetId: string; prompt: string; aspectRatio?: string | null; count?: number }) {
    const src = this.svc.store.library.get(req.assetId);
    if (!src || src.kind !== 'image') throw new ProviderError('Bir ürün fotoğrafı seçin', 0, 'istek');
    const model = (await this.svc.conns.settings()).gemini?.model ?? DEFAULT_GEMINI_IMAGE_MODEL;
    const count = Math.max(1, Math.min(4, req.count ?? 2));
    const key = sha({ kind: 'arka-plan', assetId: req.assetId, prompt: req.prompt, aspect: req.aspectRatio ?? null, model, count });
    const running = (await this.list()).find((g) => g.key === key && g.status === 'calisiyor' && Date.now() - Date.parse(g.createdAt) < STALE_MS);
    if (running) return { generation: running, running: true };
    const g = await this.save({
      id: newId(),
      kind: 'arka-plan',
      provider: 'gemini',
      model,
      projectId,
      status: 'calisiyor',
      key,
      request: { assetId: req.assetId, assetName: src.name, prompt: req.prompt, aspectRatio: req.aspectRatio ?? null, count },
      estimate: { units: count, unit: 'görsel', note: 'Google AI Studio fiyatlandırmasına göre; 1 fotoğraf Google\'a gönderilir' },
      resultAssetIds: [],
      approvedAssetIds: [],
      createdAt: new Date().toISOString(),
    });
    try {
      const apiKey = await this.key('gemini');
      const sharp = (await import('sharp')).default;
      // Gönderilecek görsel: en çok 1536 px JPEG (gereksiz büyük yükleme yapılmaz)
      const data = await sharp(this.svc.store.abs(src.render ?? src.original)).rotate().resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
      const out: Asset[] = [];
      for (let i = 1; i <= count; i++) {
        const r = await gemini.editImage(apiKey, model, { data, mime: 'image/jpeg' }, backgroundPrompt(req.prompt, i), req.aspectRatio ?? undefined);
        const ext = r.mime.includes('png') ? 'png' : r.mime.includes('webp') ? 'webp' : 'jpg';
        const tmp = this.svc.store.p('tmp', `arka-plan-${g.id}-${i}.${ext}`);
        await writeFile(tmp, r.data);
        const a = await this.svc.importFile(tmp, `${src.name.replace(/\.[^.]+$/, '')} · arka plan ${i}.${ext}`);
        await this.svc.store.patchAsset(a.id, { role: 'uretim', generated: { provider: 'gemini', model, prompt: req.prompt, sourceAssetId: src.id, genId: g.id } });
        out.push(a);
        g.resultAssetIds = out.map((x) => x.id);
        await this.save(g);
      }
      g.status = 'onay-bekliyor';
      g.finishedAt = new Date().toISOString();
      await this.save(g);
      return { generation: g };
    } catch (e) {
      g.status = g.resultAssetIds.length ? 'onay-bekliyor' : 'hata';
      g.error = (e as Error).message;
      g.finishedAt = new Date().toISOString();
      await this.save(g);
      throw e;
    }
  }

  /** Seçilen sonuçları Medya'ya al (yerel medya olarak kalır; servis kapansa da kullanılabilir) */
  async approve(genId: string, assetIds: string[]) {
    const g = (await this.list()).find((x) => x.id === genId);
    if (!g) throw new Error('Üretim kaydı bulunamadı');
    for (const id of assetIds) {
      if (!g.resultAssetIds.includes(id)) throw new Error('Bu üretime ait olmayan dosya');
      await this.svc.store.patchAsset(id, { role: 'media' });
    }
    g.approvedAssetIds = [...new Set([...g.approvedAssetIds, ...assetIds])];
    g.status = 'onaylandi';
    return this.save(g);
  }
}
