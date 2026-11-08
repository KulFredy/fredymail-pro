import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import fastifyStatic from '@fastify/static';
import multipart from '@fastify/multipart';
import QRCode from 'qrcode';
import { z } from 'zod';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { readFile, writeFile } from 'node:fs/promises';
import { planCommand } from '../core/commands';
import { AI_MODELS, DEFAULT_AI_MODEL, planWithClaude } from './ai';
import { FORMATS, outputLabel } from '../core/formats';
import { buildRefs } from '../core/refs';
import { OpError, OpSchema, patchOf } from '../core/ops';
import { UiStateSchema } from '../core/schema';
import { LutPatchSchema } from '../core/lutlib';
import { Connections } from './connections';
import { GEMINI_IMAGE_MODELS, ProviderError } from './providers';
import { BrandInput, BrandPatch, Brands } from './brands';
import { Delivery } from './delivery';
import { Publisher } from './publish';
import { YouTube, YouTubeError } from './youtube';
import { claudeMeta, localMeta } from './copywriter';
import { DEFAULT_APPLY, brandPlan } from '../core/brand';
import { Generator } from './generate';
import { createSecrets } from './secrets';
import { getTools } from '../media/proc';
import { MOBILE_TOKEN, downloadsPage, lanAddress, uploadPage } from './mobile';
import { handleStrayError, warmUp } from './render';
import { ROOT, Service } from './service';
import { defaultHome } from './store';

const PORT = Number(process.env.FABRIKA_PORT ?? 4747);
const HOST = process.env.FABRIKA_HOST ?? '0.0.0.0';

export const createServer = async (home = defaultHome()) => {
  const svc = new Service(home);
  svc.port = PORT;
  await svc.init();
  const { store, jobs } = svc;
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  await app.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 * 1024, files: 200 } });

  const isLocal = (req: FastifyRequest) => {
    const ip = req.socket.remoteAddress ?? '';
    return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  };

  // Güvenlik: Mac dışından yalnız anahtarlı telefon sayfalarına izin ver
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url;
    if (!isLocal(req) && !url.startsWith(`/m/${MOBILE_TOKEN}`) && !url.startsWith(`/api/m/${MOBILE_TOKEN}`)) {
      return reply.code(403).type('text/plain; charset=utf-8').send('Bu adres yalnızca Mac üzerinden açılabilir.');
    }
    if (url.startsWith('/files/') && !/^\/files\/(kutuphane|projeler)\//.test(url)) return reply.code(404).send();
  });
  // Remotion render tarayıcısı farklı porttan okur
  app.addHook('onSend', async (req, reply) => {
    if (req.url.startsWith('/files/') || req.url.startsWith('/luts/')) reply.header('Access-Control-Allow-Origin', '*');
  });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    const isZod = err instanceof z.ZodError;
    // Dış servis hataları (anahtar, kredi, kota…): kullanıcıya anlaşılır ileti, sunucu hatası sayılmaz
    const code = err instanceof OpError || isZod ? 400 : err instanceof ProviderError ? (err.kind === 'kredi' ? 402 : err.kind === 'sinir' ? 429 : err.kind === 'ag' || err.kind === 'sunucu' ? 502 : 400) : err instanceof YouTubeError ? err.kind === 'istek' ? (err.status >= 400 && err.status < 500 ? err.status : 400) : err.kind === 'kota' ? 429 : err.kind === 'baglanti' ? 401 : 502 : (err.statusCode ?? 500);
    if (code >= 500) console.error(err);
    reply.code(code).send({ error: isZod ? `Geçersiz istek: ${err.issues.map((i) => i.path.join('.') + ' ' + i.message).join('; ')}` : err.message });
  });

  await app.register(fastifyStatic, { root: home, prefix: '/files/', decorateReply: false, acceptRanges: true, cacheControl: false });
  await app.register(fastifyStatic, { root: path.join(ROOT, 'assets', 'luts'), prefix: '/luts/', decorateReply: false });
  const webDist = path.join(ROOT, 'web', 'dist');
  if (existsSync(webDist)) await app.register(fastifyStatic, { root: webDist, prefix: '/' });

  // ---------- Genel ----------
  app.get('/api/health', async () => {
    const t = await getTools();
    const lan = lanAddress();
    return {
      ok: true,
      version: '0.1.0',
      home,
      whisper: {
        mode: svc.whisper.mode,
        available: svc.whisper.mode === 'fixture' || !!(svc.whisper.bin && svc.whisper.model),
        bin: svc.whisper.bin,
        model: svc.whisper.model ? path.basename(svc.whisper.model) : null,
      },
      encoder: t.h264Encoder,
      hdrToneMap: t.zscale,
      lanUrl: lan ? `http://${lan}:${PORT}` : null,
    };
  });

  app.get('/api/state', async () => ({ lastProjectId: store.state.lastProjectId, projects: await store.listProjects(), style: store.style }));

  app.put('/api/style', async (req) => store.saveStyle(req.body as object));

  app.get('/api/events', (req, reply) => {
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    const send = (type: string, data: unknown) => reply.raw.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    const onJob = (j: unknown) => send('job', j);
    const onAsset = (a: unknown) => send('asset', a);
    const onProject = (p: unknown) => send('project', p);
    const onExport = (e: unknown) => send('export', e);
    jobs.on('job', onJob);
    store.on('asset', onAsset);
    store.on('project', onProject);
    store.on('export', onExport);
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 20_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      jobs.off('job', onJob);
      store.off('asset', onAsset);
      store.off('project', onProject);
      store.off('export', onExport);
    });
  });

  app.get('/api/jobs', async () => jobs.list());

  // ---------- Kütüphane ----------
  app.get('/api/library', async () => [...store.library.values()].sort((a, b) => b.importedAt.localeCompare(a.importedAt)));
  app.get('/api/assets/:id', async (req, reply) => {
    const a = store.library.get((req.params as { id: string }).id);
    return a ?? reply.code(404).send({ error: 'Kaynak bulunamadı' });
  });
  app.post('/api/assets/:id/transcribe', async (req) => {
    const { id } = req.params as { id: string };
    svc.whisper = await (await import('../media/whisper')).findWhisper(home);
    svc.enqueueTranscribe(id);
    return { ok: true };
  });

  const handleUpload = async (req: FastifyRequest, projectId: string | undefined) => {
    const assets = [];
    for await (const part of req.parts()) {
      if (part.type === 'file') assets.push(await svc.importStream(part.file, part.filename || 'dosya'));
    }
    let state = null;
    if (projectId) state = await svc.addAssetsToProject(projectId, assets, 'import');
    return { assets, state };
  };

  app.post('/api/import', async (req) => {
    const q = req.query as { projectId?: string; role?: string; at?: string };
    if (q.role === 'reference' && q.projectId) {
      const known = new Set(store.library.keys());
      const r = await handleUpload(req, undefined);
      let state = null;
      for (const a of r.assets) state = await svc.addReference(q.projectId, a, !known.has(a.id));
      return { assets: r.assets, state };
    }
    if (q.role === 'voiceover' && q.projectId) {
      const r = await handleUpload(req, undefined);
      let state = null;
      for (const a of r.assets) state = await svc.addVoiceover(q.projectId, a, Number(q.at ?? 0) || 0);
      return { assets: r.assets, state };
    }
    return handleUpload(req, q.projectId);
  });

  // Kurgu talimatı (mikrofon): yazıya çevir, kaydetme
  app.post('/api/stt', async (req) => {
    for await (const part of req.parts()) {
      if (part.type !== 'file') continue;
      const tmp = store.p('tmp', `komut-${Date.now()}${path.extname(part.filename || '.webm') || '.webm'}`);
      await pipeline(part.file, createWriteStream(tmp));
      return svc.speechToText(tmp);
    }
    return { text: '', status: 'error', message: 'Ses gelmedi' };
  });

  // ---------- Ayarlar ve bağlantılar (anahtarlar kasada: Mac'te Anahtar Zinciri) ----------
  const settingsFile = store.p('ayarlar.json');
  const conns = new Connections(home, createSecrets(home));
  svc.conns = conns;
  if (await conns.migrateLegacy(settingsFile).catch(() => false)) console.log(`  Claude anahtarı ${conns.secrets.kind === 'anahtarlik' ? 'Anahtar Zinciri\'ne' : 'gizli dosyaya'} taşındı.`);
  const readSettings = async (): Promise<{ aiModel?: string; aiMode?: 'always' | 'fallback' }> => {
    try {
      return JSON.parse(await readFile(settingsFile, 'utf8'));
    } catch {
      return {};
    }
  };
  const aiKey = async () => (await conns.key('anthropic'))?.value ?? null;
  app.get('/api/settings', async () => {
    const st = await readSettings();
    const k = await conns.key('anthropic');
    return {
      aiConfigured: !!k,
      keySource: k ? (k.source === 'kasa' ? 'uygulama' : 'ortam') : null,
      keyStore: conns.secrets.kind,
      aiModel: st.aiModel || DEFAULT_AI_MODEL,
      /** always: her komut Claude'a gider · fallback: yalnız kurallar anlamazsa */
      aiMode: st.aiMode ?? 'always',
      models: AI_MODELS,
      usage: await conns.usage(),
    };
  });
  app.put('/api/settings', async (req) => {
    const body = z
      .object({
        anthropicApiKey: z.string().trim().nullable().optional(),
        aiModel: z.enum(AI_MODELS.map((m) => m.id) as [string, ...string[]]).optional(),
        aiMode: z.enum(['always', 'fallback']).optional(),
      })
      .parse(req.body);
    const st = await readSettings();
    if (body.anthropicApiKey !== undefined) {
      if (body.anthropicApiKey) await conns.secrets.set('anthropic', body.anthropicApiKey);
      else await conns.remove('anthropic');
    }
    if (body.aiModel) st.aiModel = body.aiModel;
    if (body.aiMode) st.aiMode = body.aiMode;
    await writeFile(settingsFile, JSON.stringify(st, null, 2), { mode: 0o600 });
    return { ok: true, aiConfigured: !!(await conns.key('anthropic')) };
  });

  // Bağlantılar: durum, anahtar ekle/test/kaldır, servis ayarları. Anahtarın kendisi asla dönmez.
  const ConnIdSchema = z.enum(['anthropic', 'elevenlabs', 'gemini', 'higgsfield', 'youtube']);
  const youtube = new YouTube(conns.secrets);
  conns.youtube = youtube;
  app.get('/api/connections', async (req) => conns.list((req.query as { test?: string }).test === '1'));
  app.put('/api/connections/:id', async (req) => {
    const id = ConnIdSchema.parse((req.params as { id: string }).id);
    const { key } = z.object({ key: z.string().min(4).max(400) }).parse(req.body);
    const status = await conns.set(id, key);
    return { status, connections: await conns.list() };
  });
  app.post('/api/connections/:id/test', async (req) => conns.test(ConnIdSchema.parse((req.params as { id: string }).id)));
  app.delete('/api/connections/:id', async (req) => {
    await conns.remove(ConnIdSchema.parse((req.params as { id: string }).id));
    return { connections: await conns.list() };
  });
  app.put('/api/connections-settings', async (req) => {
    const body = z
      .object({
        elevenlabs: z.object({ voiceId: z.string().optional(), modelId: z.string().optional() }).optional(),
        gemini: z.object({ model: z.enum(GEMINI_IMAGE_MODELS.map((m) => m.id) as [string, ...string[]]).optional() }).optional(),
      })
      .parse(req.body);
    return conns.saveSettings(body);
  });

  // ---------- Üretim (ücretli servisler; önce tahmin, sonra onaylı üretim) ----------
  const gen = new Generator(svc);
  app.get('/api/uret/dis-ses/katalog', async (req) => gen.elCatalog((req.query as { yenile?: string }).yenile === '1'));
  app.post('/api/uret/dis-ses/tahmin', async (req) => {
    const b = z.object({ text: z.string().min(1).max(10000), voiceId: z.string().optional(), modelId: z.string().optional() }).parse(req.body);
    return gen.ttsEstimate(b.text, b.voiceId, b.modelId);
  });
  app.post('/api/uret/dis-ses/ornek', async (req) => {
    const b = z.object({ text: z.string().min(1), voiceId: z.string(), modelId: z.string() }).parse(req.body);
    return gen.ttsSample(b.text, b.voiceId, b.modelId);
  });
  app.post('/api/projects/:id/uret/dis-ses', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ text: z.string().min(1).max(10000), voiceId: z.string(), modelId: z.string(), at: z.number().min(0).default(0), voiceItemId: z.string().nullable().optional() }).parse(req.body);
    return gen.tts(id, b);
  });
  app.post('/api/projects/:id/uret/arka-plan', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ assetId: z.string(), prompt: z.string().min(3).max(600), aspectRatio: z.enum(['1:1', '4:5', '9:16', '16:9', '3:4', '4:3']).nullable().optional(), count: z.number().int().min(1).max(4).optional() }).parse(req.body);
    return gen.backgrounds(id, b);
  });
  app.get('/api/projects/:id/uretimler', async (req) => gen.list((req.params as { id: string }).id));
  app.post('/api/uretimler/:id/onayla', async (req) => {
    const b = z.object({ assetIds: z.array(z.string()).min(1) }).parse(req.body);
    return gen.approve((req.params as { id: string }).id, b.assetIds);
  });

  app.post('/api/projects/:id/command/ai', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ text: z.string().min(1), playhead: z.number().default(0), selectedClipId: z.string().nullable().optional() }).parse(req.body);
    const key = await aiKey();
    if (!key) return { understood: false, summary: 'Claude ile anlama kapalı.', hint: 'Komut panelindeki “Claude” düğmesinden API anahtarı ekleyin.', ops: [], ranges: [], candidates: [] };
    const project = await store.getProject(id);
    const plan = await planWithClaude({
      apiKey: key,
      model: (await readSettings()).aiModel || DEFAULT_AI_MODEL,
      text: body.text,
      project,
      assets: buildRefs(store.library.values(), '', 'preview'),
      playhead: body.playhead,
      selectedClipId: body.selectedClipId ?? project.ui.selectedClipId,
      opCtx: store.opContext(),
      luts: (await svc.listLuts())
        .filter((l) => l.meta)
        .map((l) => ({ id: l.id, ad: l.meta!.name, tur: l.meta!.kind, giris: l.meta!.input, etiketler: l.meta!.tags, favori: l.meta!.favorite })),
    });
    if (plan.usage) await conns.recordUsage({ at: new Date().toISOString(), model: plan.usage.model, input: plan.usage.input, output: plan.usage.output, usd: plan.usage.usd }).catch(() => undefined);
    return plan;
  });

  // ---------- Markalar ve kanal teslimi (Faz 6) ----------
  const brands = new Brands(home);
  const delivery = new Delivery(svc, brands);
  app.get('/api/markalar', async () => brands.list());
  app.post('/api/markalar', async (req) => brands.create(req.body as z.input<typeof BrandInput>));
  app.put('/api/markalar/:id', async (req) => brands.update((req.params as { id: string }).id, req.body as z.input<typeof BrandPatch>));
  app.delete('/api/markalar/:id', async (req) => (await brands.remove((req.params as { id: string }).id), brands.list()));
  /** Markayı projeye uygulama planı: işlemler + kullanıcıya gösterilecek maddeler (uygulama /ops ile, geri alınabilir) */
  app.post('/api/projects/:id/marka-plan', async (req) => {
    const { id } = req.params as { id: string };
    const b = z
      .object({
        brandId: z.string(),
        productId: z.string().nullable().default(null),
        campaign: z.string().default(''),
        options: z.object({ logo: z.boolean(), captions: z.boolean(), texts: z.boolean(), look: z.boolean(), references: z.boolean(), channels: z.boolean() }).partial().default({}),
      })
      .parse(req.body);
    const brand = await brands.get(b.brandId);
    if (!brand) throw Object.assign(new Error('Marka bulunamadı'), { statusCode: 404 });
    const project = await store.getProject(id);
    const lutNames = Object.fromEntries((await svc.listLuts()).map((l) => [l.id, l.meta?.name ?? l.title]));
    return brandPlan(project, brand, { productId: b.productId, campaign: b.campaign }, { ...DEFAULT_APPLY, ...b.options }, lutNames);
  });
  app.get('/api/projects/:id/kontrol', async (req) => delivery.checks((req.params as { id: string }).id));
  app.post('/api/projects/:id/paket', async (req) => {
    const b = z.object({ outputIds: z.array(z.string()).min(1) }).parse(req.body);
    return delivery.enqueue((req.params as { id: string }).id, b.outputIds);
  });
  app.get('/api/projects/:id/paketler', async (req) => delivery.list((req.params as { id: string }).id));
  app.post('/api/projects/:id/paketler/:pid/onayla', async (req) => {
    const { id, pid } = req.params as { id: string; pid: string };
    return delivery.approve(id, pid);
  });
  /** Yayın metni önerisi: Claude (anahtar varsa ve istenirse) veya yerel şablon */
  app.post('/api/projects/:id/metin-yaz', async (req) => {
    const { id } = req.params as { id: string };
    const b = z.object({ outputIds: z.array(z.string()).min(1), ai: z.boolean().default(true) }).parse(req.body);
    const project = await store.getProject(id);
    const outputs = project.outputs.filter((o) => b.outputIds.includes(o.id));
    const assets = buildRefs(store.library.values(), '', 'preview');
    const brand = project.brand ? await brands.get(project.brand.brandId) : null;
    const key = b.ai ? await aiKey() : null;
    if (key) {
      try {
        const r = await claudeMeta({ apiKey: key, model: (await readSettings()).aiModel || DEFAULT_AI_MODEL, project, assets, brand, outputs });
        await conns.recordUsage({ at: new Date().toISOString(), ...r.usage }).catch(() => undefined);
        return { source: 'claude', suggestions: r.suggestions, usage: r.usage };
      } catch (e) {
        const msg = (e as Error).message.split(key).join('••••');
        console.error('[claude] metin:', msg.slice(0, 300));
        return { source: 'yerel', suggestions: localMeta(project, assets, brand, outputs), note: `Claude'a ulaşılamadı; yerel şablon kullanıldı (${msg.slice(0, 120)})` };
      }
    }
    return { source: 'yerel', suggestions: localMeta(project, assets, brand, outputs) };
  });

  // ---------- Doğrudan yayın: YouTube (Faz 7) ----------
  const publisher = new Publisher(svc, delivery, youtube);
  const redirectUri = () => `http://127.0.0.1:${svc.port}/api/youtube/callback`;
  app.get('/api/youtube/baglan', async (_req, reply) => reply.redirect(await youtube.authUrl(redirectUri())));
  app.get('/api/youtube/callback', async (req, reply) => {
    const q = req.query as { code?: string; state?: string; error?: string };
    const page = (title: string, msg: string, ok: boolean) =>
      reply
        .code(ok ? 200 : 400)
        .type('text/html; charset=utf-8')
        .send(`<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font-family:system-ui;background:#111318;color:#eee;display:grid;place-items:center;height:100vh;margin:0"><div style="max-width:520px;text-align:center"><h2>${title}</h2><p>${msg}</p><p style="color:#999">Bu sekmeyi kapatıp İçerik Fabrikası'na dönebilirsiniz.</p></div><script>try{window.opener&&window.opener.postMessage('youtube-baglandi','*')}catch(e){}</script>`);
    if (q.error || !q.code || !q.state) return page('Bağlanmadı', q.error === 'access_denied' ? 'İzin verilmedi.' : 'Google bir kod döndürmedi.', false);
    try {
      const ch = await youtube.finish(q.code, q.state);
      return page('YouTube bağlandı', `Kanal: <b>${ch.title.replace(/[<>&]/g, '')}</b>`, true);
    } catch (e) {
      return page('Bağlanmadı', (e as Error).message.replace(/[<>&]/g, ''), false);
    }
  });
  app.delete('/api/youtube/baglanti', async () => (await youtube.disconnect(), { ok: true }));
  app.get('/api/projects/:id/yayin/onizleme', async (req) => {
    const q = z.object({ pkgId: z.string(), outputId: z.string() }).parse(req.query);
    return publisher.preview((req.params as { id: string }).id, q.pkgId, q.outputId);
  });
  app.post('/api/projects/:id/yayin', async (req) => {
    const b = z
      .object({ pkgId: z.string(), outputId: z.string(), privacy: z.enum(['private', 'unlisted', 'public']), publishAt: z.string().nullable().optional(), madeForKids: z.boolean().default(false), containsSyntheticMedia: z.boolean().default(false), confirm: z.boolean().default(false) })
      .parse(req.body);
    return publisher.publish((req.params as { id: string }).id, b);
  });
  app.get('/api/projects/:id/yayinlar', async (req) => publisher.list((req.params as { id: string }).id));
  app.post('/api/projects/:id/yayinlar/:yid/durum', async (req) => {
    const { id, yid } = req.params as { id: string; yid: string };
    return publisher.refresh(id, yid);
  });

  // Yazılı/sesli komut → işlem planı (arayüz aynı planı yerelde de hesaplar; MCP ve testler için)
  app.post('/api/projects/:id/command', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ text: z.string(), playhead: z.number().default(0), selectedClipId: z.string().nullable().optional() }).parse(req.body);
    const project = await store.getProject(id);
    const assets = buildRefs(store.library.values(), '', 'preview');
    return planCommand(body.text, { project, assets, playhead: body.playhead, selectedClipId: body.selectedClipId ?? project.ui.selectedClipId });
  });

  app.post('/api/import/paths', async (req) => {
    const body = z.object({ paths: z.array(z.string()).min(1), projectId: z.string().optional() }).parse(req.body);
    const assets = [];
    for (const p of body.paths) assets.push(await svc.importPath(p));
    const state = body.projectId ? await svc.addAssetsToProject(body.projectId, assets, 'mcp') : null;
    return { assets, state };
  });

  // ---------- LUT ----------
  app.get('/api/luts', async (req) => svc.listLuts((req.query as { kullanim?: string }).kullanim === '1'));
  /** Toplu içe aktarma: .cube / .3dl / .zip; dosya başına rapor */
  app.post('/api/luts', async (req) => {
    const files: { name: string; data: Buffer }[] = [];
    for await (const part of req.parts()) if (part.type === 'file') files.push({ name: part.filename || 'lut.cube', data: await part.toBuffer() });
    const report = await svc.importLuts(files);
    return { added: report.filter((r) => r.id).map((r) => ({ id: r.id })), report, luts: await svc.listLuts() };
  });
  app.patch('/api/luts/:id', async (req) => {
    const { id } = req.params as { id: string };
    const meta = await svc.updateLut(id, LutPatchSchema.parse(req.body));
    return { meta, luts: await svc.listLuts() };
  });
  app.delete('/api/luts/:id', async (req) => {
    await svc.deleteLut((req.params as { id: string }).id);
    return { luts: await svc.listLuts() };
  });
  /** Referanstan renk eşleme → LUT üretir (uygulamaz) */
  app.post('/api/projects/:id/color-match', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ referenceId: z.string(), clipId: z.string().nullable().default(null) }).parse(req.body);
    const r = await svc.colorMatch(id, body.referenceId, body.clipId);
    return { ...r, luts: await svc.listLuts() };
  });
  app.get('/api/assets/:id/frame', async (req, reply) => {
    const { id } = req.params as { id: string };
    const q = req.query as { t?: string; w?: string };
    const file = await svc.assetFrame(id, Number(q.t ?? 0) || 0, Number(q.w ?? 320) || 320);
    reply.header('cache-control', 'max-age=3600').type('image/jpeg');
    return reply.send(await readFile(file));
  });

  // ---------- Projeler ----------
  app.get('/api/projects', async () => store.listProjects());
  app.post('/api/projects', async (req) => {
    const body = z
      .object({ name: z.string().optional(), formats: z.array(z.object({ format: z.enum(['story', 'reel', 'post', 'square', 'landscape']), kind: z.enum(['video', 'image']).optional() })).optional() })
      .parse(req.body ?? {});
    const name = body.name || `Yeni proje · ${new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}`;
    const formats = body.formats ?? [{ format: 'story' as const }];
    const project = await store.createProject(name, formats.map((f) => ({ type: 'output.add' as const, ...f })));
    return store.getProjectState(project.id);
  });
  app.get('/api/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const st = await store.getProjectState(id);
    if (store.state.lastProjectId !== id) await store.setLast(id);
    return st;
  });
  app.delete('/api/projects/:id', async (req) => {
    await store.deleteProject((req.params as { id: string }).id);
    return { ok: true };
  });
  app.post('/api/projects/:id/ops', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ ops: z.array(OpSchema).min(1), label: z.string().optional(), source: z.string().optional() }).parse(req.body);
    return store.applyOps(id, body.ops, body.source ?? 'ui', body.label);
  });
  app.post('/api/projects/:id/ui', async (req) => {
    const { id } = req.params as { id: string };
    await store.setUi(id, patchOf(UiStateSchema).parse(req.body));
    return { ok: true };
  });
  app.post('/api/projects/:id/undo', async (req) => store.undo((req.params as { id: string }).id));
  app.post('/api/projects/:id/redo', async (req) => store.undo((req.params as { id: string }).id, true));
  app.get('/api/projects/:id/versions', async (req) => store.listVersions((req.params as { id: string }).id));
  app.post('/api/projects/:id/versions', async (req) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    return store.saveVersion((req.params as { id: string }).id, name);
  });
  app.post('/api/projects/:id/versions/:vid/restore', async (req) => {
    const { id, vid } = req.params as { id: string; vid: string };
    return store.restoreVersion(id, vid);
  });
  app.get('/api/projects/:id/props', async (req) => {
    const { id } = req.params as { id: string };
    const q = req.query as { outputId?: string; variant?: 'full' | 'nomusic' };
    const project = await store.getProject(id);
    return svc.compProps(project, q.outputId ?? project.outputs[0]?.id ?? '', q.variant ?? 'full', 'preview');
  });
  app.post('/api/projects/:id/render', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ outputId: z.string(), variant: z.enum(['full', 'nomusic']).default('full') }).parse(req.body);
    return svc.enqueueRender(id, body.outputId, body.variant);
  });
  app.get('/api/projects/:id/exports', async (req) => svc.listExports((req.params as { id: string }).id));

  app.post('/api/reveal', async (req) => {
    const { file } = z.object({ file: z.string() }).parse(req.body);
    const abs = store.abs(file);
    await stat(abs);
    const [cmd, args] = process.platform === 'darwin' ? ['open', ['-R', abs]] : ['xdg-open', [path.dirname(abs)]];
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => undefined).unref();
    return { ok: true };
  });

  // ---------- Telefon ----------
  app.get('/api/mobile', async (req) => {
    const { projectId, page } = req.query as { projectId?: string; page?: 'upload' | 'indir' };
    const lan = lanAddress();
    if (!lan) return { url: null, qr: null, reason: 'Wi-Fi bağlantısı bulunamadı' };
    const url =
      page === 'indir'
        ? `http://${lan}:${PORT}/m/${MOBILE_TOKEN}/indir${projectId ? `?p=${projectId}` : ''}`
        : `http://${lan}:${PORT}/m/${MOBILE_TOKEN}${projectId ? `?p=${projectId}` : ''}`;
    return { url, qr: await QRCode.toString(url, { type: 'svg', margin: 1, color: { dark: '#000000', light: '#ffffff' } }) };
  });

  const mobileProject = async (req: FastifyRequest) => {
    const p = (req.query as { p?: string }).p ?? store.state.lastProjectId;
    return p ? store.getProject(p).catch(() => null) : null;
  };

  app.get(`/m/${MOBILE_TOKEN}`, async (req, reply) => {
    const project = await mobileProject(req);
    reply.type('text/html; charset=utf-8').send(uploadPage(project?.name ?? null));
  });
  app.post(`/api/m/${MOBILE_TOKEN}/upload`, async (req) => {
    const project = await mobileProject(req);
    const r = await handleUpload(req, project?.id);
    return { count: r.assets.length };
  });
  app.get(`/m/${MOBILE_TOKEN}/indir`, async (req, reply) => {
    const project = await mobileProject(req);
    if (!project) return reply.type('text/html; charset=utf-8').send(downloadsPage(MOBILE_TOKEN, 'Proje yok', [], ''));
    const exports = await svc.listExports(project.id);
    // Her çıktının ve varyantın en yenisi
    const seen = new Set<string>();
    const items = [];
    for (const e of exports) {
      const key = `${e.outputId}:${e.variant}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const out = project.outputs.find((o) => o.id === e.outputId);
      items.push({
        name: e.name,
        size: e.verification.size,
        label: `${out ? outputLabel(out.format, out.kind) : FORMATS[e.format as keyof typeof FORMATS]?.label}${e.variant === 'nomusic' ? ' · müziksiz' : ''}`,
        url: `/api/m/${MOBILE_TOKEN}/file?p=${project.id}&f=${encodeURIComponent(e.name)}`,
      });
    }
    reply.type('text/html; charset=utf-8').send(downloadsPage(MOBILE_TOKEN, project.name, items, project.description));
  });
  app.get(`/api/m/${MOBILE_TOKEN}/file`, async (req, reply) => {
    const { p, f } = req.query as { p: string; f: string };
    if (!/^[\w.-]+$/.test(f) || !/^[\w-]+$/.test(p)) return reply.code(400).send();
    const dir = store.exportsDir(p);
    return (reply as FastifyReply & { sendFile: (f: string, root: string) => unknown }).sendFile(f, dir);
  });

  // Tek sayfa uygulama: bilinmeyen adresler arayüze
  app.setNotFoundHandler((req, reply) => {
    if (req.method === 'GET' && !req.url.startsWith('/api/') && existsSync(path.join(webDist, 'index.html')))
      return (reply as FastifyReply & { sendFile: (f: string) => unknown }).sendFile('index.html');
    reply.code(404).send({ error: 'Bulunamadı' });
  });

  return { app, svc };
};

const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('src', 'server', 'index.ts'));
if (isMain) {
  const { app } = await createServer();
  // Beklenmeyen bir hata (ör. ağ kesintisi) uygulamayı kapatmasın: Terminal'e yaz, çalışmaya devam et
  process.on('uncaughtException', (e) => {
    if (!handleStrayError(e)) console.error('[hata]', e.message);
  });
  process.on('unhandledRejection', (e) => console.error('[hata]', (e as Error)?.message ?? e));
  // Ctrl+C her durumda kapatsın (render sürüyor olsa bile)
  for (const sig of ['SIGINT', 'SIGTERM'] as const)
    process.on(sig, () => {
      console.log('\n  Kapatılıyor…');
      setTimeout(() => process.exit(0), 1500).unref();
      app.close().finally(() => process.exit(0));
    });
  try {
    await app.listen({ port: PORT, host: HOST });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'EADDRINUSE') {
      console.error(`\n  ${PORT} portu kullanımda: İçerik Fabrikası zaten açık olabilir → http://localhost:${PORT}\n  Kapatmak için açık olan Terminal penceresinde Ctrl+C'ye basın.\n`);
      process.exit(1);
    }
    throw e;
  }
  const lan = lanAddress();
  console.log(`\n  İçerik Fabrikası hazır →  http://localhost:${PORT}`);
  if (lan) console.log(`  Telefon (aynı Wi-Fi): uygulamadaki “Telefondan ekle” QR kodunu kullanın`);
  console.log(`  Veri klasörü: ${defaultHome()}\n`);
  // Render tarayıcısı ve kompozisyonu arka planda hazırla: ilk dışa aktarma beklemesin
  warmUp().catch(() => undefined);
}
