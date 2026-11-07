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
import { DEFAULT_AI_MODEL, planWithClaude } from './ai';
import { FORMATS, outputLabel } from '../core/formats';
import { buildRefs } from '../core/refs';
import { OpError, OpSchema, patchOf } from '../core/ops';
import { UiStateSchema } from '../core/schema';
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
    const code = err instanceof OpError || isZod ? 400 : (err.statusCode ?? 500);
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

  // ---------- Ayarlar (Claude ile anlama, isteğe bağlı) ----------
  const settingsFile = store.p('ayarlar.json');
  const readSettings = async (): Promise<{ anthropicApiKey?: string; aiModel?: string }> => {
    try {
      return JSON.parse(await readFile(settingsFile, 'utf8'));
    } catch {
      return {};
    }
  };
  const aiKey = async () => (await readSettings()).anthropicApiKey || process.env.ANTHROPIC_API_KEY || null;
  app.get('/api/settings', async () => {
    const st = await readSettings();
    return {
      aiConfigured: !!(st.anthropicApiKey || process.env.ANTHROPIC_API_KEY),
      keySource: st.anthropicApiKey ? 'uygulama' : process.env.ANTHROPIC_API_KEY ? 'ortam' : null,
      aiModel: st.aiModel || DEFAULT_AI_MODEL,
    };
  });
  app.put('/api/settings', async (req) => {
    const body = z.object({ anthropicApiKey: z.string().trim().nullable().optional(), aiModel: z.string().trim().optional() }).parse(req.body);
    const st = await readSettings();
    if (body.anthropicApiKey !== undefined) {
      if (body.anthropicApiKey) st.anthropicApiKey = body.anthropicApiKey;
      else delete st.anthropicApiKey;
    }
    if (body.aiModel) st.aiModel = body.aiModel;
    await writeFile(settingsFile, JSON.stringify(st, null, 2), { mode: 0o600 });
    return { ok: true, aiConfigured: !!(st.anthropicApiKey || process.env.ANTHROPIC_API_KEY) };
  });
  app.post('/api/projects/:id/command/ai', async (req) => {
    const { id } = req.params as { id: string };
    const body = z.object({ text: z.string().min(1), playhead: z.number().default(0), selectedClipId: z.string().nullable().optional() }).parse(req.body);
    const key = await aiKey();
    if (!key) return { understood: false, summary: 'Claude ile anlama kapalı.', hint: 'Komut panelindeki “Claude” düğmesinden API anahtarı ekleyin.', ops: [], ranges: [], candidates: [] };
    const project = await store.getProject(id);
    return planWithClaude({
      apiKey: key,
      model: (await readSettings()).aiModel || DEFAULT_AI_MODEL,
      text: body.text,
      project,
      assets: buildRefs(store.library.values(), '', 'preview'),
      playhead: body.playhead,
      selectedClipId: body.selectedClipId ?? project.ui.selectedClipId,
      opCtx: store.opContext(),
    });
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
  app.get('/api/luts', async () => svc.listLuts());
  app.post('/api/luts', async (req) => {
    const added = [];
    for await (const part of req.parts()) {
      if (part.type === 'file') added.push(await svc.addLut(part.filename, (await part.toBuffer()).toString('utf8')));
    }
    return { added, luts: await svc.listLuts() };
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
