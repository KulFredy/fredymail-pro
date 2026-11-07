/**
 * İçerik Fabrikası MCP sunucusu.
 * Claude Code / Claude Desktop, arayüzde yapılabilen işlemleri buradaki araçlarla yapar.
 * Uygulamanın çalışıyor olması gerekir (npm run fabrika). Adres: FABRIKA_URL (varsayılan http://127.0.0.1:4747).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { FORMATS } from '../core/formats';
import { PRESETS } from '../core/looks';
import { layoutClips, totalDuration } from '../core/timeline';
import type { Asset, Project } from '../core/schema';

const BASE = process.env.FABRIKA_URL ?? 'http://127.0.0.1:4747';

const call = async <T = any>(method: string, path: string, body?: unknown): Promise<T> => {
  let r: Response;
  try {
    r = await fetch(BASE + path, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(`İçerik Fabrikası'na ulaşılamadı (${BASE}). Uygulamayı "npm run fabrika" ile başlatın.`);
  }
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.error ?? `Hata ${r.status}`);
  return data as T;
};

const text = (v: unknown) => ({ content: [{ type: 'text' as const, text: typeof v === 'string' ? v : JSON.stringify(v, null, 2) }] });

/** Projeyi Claude için okunur özet hâline getirir */
const summarize = (project: Project, library: Asset[]) => {
  const lib = new Map(library.map((a) => [a.id, a]));
  return {
    id: project.id,
    ad: project.name,
    sure_sn: Number(totalDuration(project).toFixed(2)),
    klipler: layoutClips(project).map((l, i) => {
      const a = lib.get(l.clip.assetId);
      return {
        sira: i + 1,
        klip_id: l.clip.id,
        kaynak: a?.name,
        tur: a?.kind,
        zaman_cizelgesi: [Number(l.start.toFixed(2)), Number(l.end.toFixed(2))],
        kaynak_araligi: [l.clip.in, l.clip.out],
        kaynak_suresi: a?.duration,
        olcu: a ? `${a.width}x${a.height}` : null,
        ses_db: l.clip.gainDb,
        sessiz: l.clip.muted,
        kamera_donusumu: l.clip.camera,
        algilanan_log: a?.camera.detected ?? null,
        konusma: a?.kind === 'video' ? { durum: a.transcript.status, kelime: a.transcript.words.length } : undefined,
        kendi_renk_ayari: !!l.clip.look,
      };
    }),
    ciktilar: project.outputs.map((o) => ({ cikti_id: o.id, bicim: o.format, tur: o.kind, olcu: `${FORMATS[o.format].width}x${FORMATS[o.format].height}`, kadraj: o.framing, kare: o.still })),
    renk: project.look,
    muzik: project.music ? { ...project.music, dosya: lib.get(project.music.assetId)?.name } : null,
    altyazi: { acik: project.captions.enabled, stil: project.captions.style, duzeltme_sayisi: Object.keys(project.captions.edits).length },
    yazilar: project.texts,
    aciklama: project.description,
  };
};

const server = new McpServer({ name: 'icerik-fabrikasi', version: '0.1.0' });

server.registerTool(
  'durum',
  { title: 'Durum', description: 'Uygulamanın durumu: Türkçe konuşma çözümleyici, kodlayıcı, son açılan proje.' },
  async () => {
    const [health, state] = await Promise.all([call('GET', '/api/health'), call('GET', '/api/state')]);
    return text({ ...health, son_proje: state.lastProjectId, proje_sayisi: state.projects.length });
  },
);

server.registerTool(
  'proje_listele',
  { title: 'Projeleri listele', description: 'Tüm projeleri son düzenlenme sırasıyla listeler.' },
  async () => text(await call('GET', '/api/projects')),
);

server.registerTool(
  'proje_olustur',
  {
    title: 'Proje oluştur',
    description: 'Yeni proje. Biçimler: story, reel (9:16), post (4:5 fotoğraf JPEG), post_video (4:5 MP4), square (1:1 MP4), square_foto (1:1 JPEG), landscape (16:9 MP4).',
    inputSchema: {
      ad: z.string().describe('Proje adı'),
      bicimler: z.array(z.enum(['story', 'reel', 'post', 'post_video', 'square', 'square_foto', 'landscape'])).default(['story']),
    },
  },
  async ({ ad, bicimler }) => {
    const formats = bicimler.map((b) =>
      b === 'post_video' ? { format: 'post', kind: 'video' } : b === 'post' ? { format: 'post', kind: 'image' } : b === 'square_foto' ? { format: 'square', kind: 'image' } : { format: b },
    );
    const st = await call('POST', '/api/projects', { name: ad, formats });
    return text({ proje_id: st.project.id, ciktilar: st.project.outputs });
  },
);

server.registerTool(
  'proje_ac',
  { title: 'Projeyi oku', description: 'Projenin klipleri, çıktıları, renk, müzik ve altyazı durumunu özetler.', inputSchema: { proje_id: z.string() } },
  async ({ proje_id }) => {
    const [st, lib] = await Promise.all([call('GET', `/api/projects/${proje_id}`), call<Asset[]>('GET', '/api/library')]);
    return text({ ...summarize(st.project, lib), geri_alinabilir: st.canUndo, son_islem: st.undoLabel });
  },
);

server.registerTool(
  'medya_ice_aktar',
  {
    title: 'Medya içe aktar',
    description: 'Mac üzerindeki dosyaları kütüphaneye alır (orijinaller kopyalanır, değiştirilmez). proje_id verilirse seçim sırasıyla klip olarak eklenir; ses dosyası müzik olur.',
    inputSchema: { dosyalar: z.array(z.string()).min(1).describe('Mutlak dosya yolları'), proje_id: z.string().optional() },
  },
  async ({ dosyalar, proje_id }) => {
    const r = await call('POST', '/api/import/paths', { paths: dosyalar, projectId: proje_id });
    return text({ kaynaklar: r.assets.map((a: Asset) => ({ id: a.id, ad: a.name, tur: a.kind, olcu: `${a.width}x${a.height}`, sure: a.duration, durum: a.status })) });
  },
);

const OP_HELP = `İşlem türleri (JSON nesneleri):
clips.add {assetIds[]} · clips.remove {clipId} · clips.reorder {order[]} · clip.trim {clipId,in,out} ·
clip.update {clipId,patch:{camera,gainDb,muted,musicMuted}} · clip.setLook {clipId,look|null} · look.set {look} · look.applyToAll {fromClipId?} ·
output.add {format,kind} · output.remove {outputId} · output.setFraming {outputId,clipId,framing:{mode:fill|fit-blur|fit,x,y,zoom}} · output.setStill {outputId,clipId,at} ·
music.set {music:{assetId,mode:bed|duck|fixed,gainDb,bedDb,duckDb,start,fadeIn,fadeOut}|null} · captions.set {enabled,style} · captions.editWord {key,text|null} ·
text.add {text:{text,start,end,x,y,size,style}} · text.update {id,patch} · text.remove {id} · project.rename {name} · project.setDescription {text} · project.addNote {text}.
Görünüm hazırları: ${PRESETS.map((p) => p.id).join(', ')}.`;

server.registerTool(
  'islem_uygula',
  {
    title: 'Kurgu işlemi uygula',
    description: `Projeye bir veya birden çok işlem uygular (tek geri alma adımı). Arayüzle aynı işlemler. ${OP_HELP}`,
    inputSchema: { proje_id: z.string(), islemler: z.array(z.record(z.string(), z.any())).min(1), etiket: z.string().optional() },
  },
  async ({ proje_id, islemler, etiket }) => {
    const st = await call('POST', `/api/projects/${proje_id}/ops`, { ops: islemler, label: etiket, source: 'mcp' });
    const lib = await call<Asset[]>('GET', '/api/library');
    return text({ tamam: true, proje: summarize(st.project, lib) });
  },
);

server.registerTool(
  'klip_kirp',
  { title: 'Klip kısalt', description: 'Klibin kaynakta başlangıç/bitiş saniyesini ayarlar. Fotoğrafta bitiş−başlangıç = ekranda kalma süresi.', inputSchema: { proje_id: z.string(), klip_id: z.string(), baslangic: z.number(), bitis: z.number() } },
  async ({ proje_id, klip_id, baslangic, bitis }) =>
    text((await call('POST', `/api/projects/${proje_id}/ops`, { ops: [{ type: 'clip.trim', clipId: klip_id, in: baslangic, out: bitis }], source: 'mcp' })).project.clips.find((c: any) => c.id === klip_id)),
);

server.registerTool(
  'kadraj_ayarla',
  {
    title: 'Kadraj',
    description: 'Bir çıktıda (ör. Story) bir klibin kadrajı. Diğer çıktıları etkilemez. mod: fill (doldur/kırp), fit-blur (sığdır, bulanık arka plan), fit (sığdır, siyah). x,y: görüntü kareden büyükse odak noktası, küçükse karedeki yeri (0..1). zoom 0.1..4 (0.5 = yarı boyut).',
    inputSchema: { proje_id: z.string(), cikti_id: z.string(), klip_id: z.string(), mod: z.enum(['fill', 'fit-blur', 'fit']).optional(), x: z.number().min(0).max(1).optional(), y: z.number().min(0).max(1).optional(), zoom: z.number().min(0.1).max(4).optional() },
  },
  async ({ proje_id, cikti_id, klip_id, mod, x, y, zoom }) => {
    const framing = Object.fromEntries(Object.entries({ mode: mod, x, y, zoom }).filter(([, v]) => v !== undefined));
    const st = await call('POST', `/api/projects/${proje_id}/ops`, { ops: [{ type: 'output.setFraming', outputId: cikti_id, clipId: klip_id, framing }], source: 'mcp' });
    return text(st.project.outputs.find((o: any) => o.id === cikti_id).framing[klip_id]);
  },
);

server.registerTool(
  'gorunum_ayarla',
  {
    title: 'Renk görünümü',
    description: `Renk ayarı. klip_id verilmezse tüm projeye. Hazır görünümler: ${PRESETS.map((p) => `${p.id} (${p.label})`).join(', ')}. ayarlar: exposure(-3..3), contrast, highlights, shadows, temp, tint, vibrance, saturation (-1..1), sharpen, vignette, fade (0..1).`,
    inputSchema: {
      proje_id: z.string(),
      klip_id: z.string().optional(),
      gorunum: z.string().optional(),
      yogunluk: z.number().min(0).max(1).optional(),
      ayarlar: z.record(z.string(), z.number()).optional(),
      lut: z.string().nullable().optional().describe('Kullanıcı LUT kimliği (kullanici:dosya.cube) veya null'),
      lut_yogunlugu: z.number().min(0).max(1).optional(),
    },
  },
  async ({ proje_id, klip_id, gorunum, yogunluk, ayarlar, lut, lut_yogunlugu }) => {
    const look = Object.fromEntries(Object.entries({ preset: gorunum, intensity: yogunluk, adjust: ayarlar, lut, lutIntensity: lut_yogunlugu }).filter(([, v]) => v !== undefined));
    const op = klip_id ? { type: 'clip.setLook', clipId: klip_id, look } : { type: 'look.set', look };
    const st = await call('POST', `/api/projects/${proje_id}/ops`, { ops: [op], source: 'mcp' });
    return text(klip_id ? st.project.clips.find((c: any) => c.id === klip_id).look : st.project.look);
  },
);

server.registerTool(
  'muzik_ayarla',
  {
    title: 'Müzik',
    description: 'Müzik ekler veya ayarlar. mod: bed (arka planda sabit kısık), duck (konuşmada kıs), fixed (sabit seviye). dosya verilirse içe aktarılıp müzik yapılır. kaldir=true müziği kaldırır.',
    inputSchema: {
      proje_id: z.string(),
      dosya: z.string().optional(),
      asset_id: z.string().optional(),
      mod: z.enum(['bed', 'duck', 'fixed']).optional(),
      seviye_db: z.number().optional(),
      arka_plan_db: z.number().optional(),
      kisma_db: z.number().optional(),
      baslangic_sn: z.number().optional(),
      kaldir: z.boolean().optional(),
    },
  },
  async ({ proje_id, dosya, asset_id, mod, seviye_db, arka_plan_db, kisma_db, baslangic_sn, kaldir }) => {
    if (kaldir) return text((await call('POST', `/api/projects/${proje_id}/ops`, { ops: [{ type: 'music.set', music: null }], source: 'mcp' })).project.music);
    let assetId = asset_id;
    if (dosya) assetId = (await call('POST', '/api/import/paths', { paths: [dosya] })).assets[0].id;
    const music = Object.fromEntries(
      Object.entries({ assetId, mode: mod, gainDb: seviye_db, bedDb: arka_plan_db, duckDb: kisma_db, start: baslangic_sn }).filter(([, v]) => v !== undefined),
    );
    const st = await call('POST', `/api/projects/${proje_id}/ops`, { ops: [{ type: 'music.set', music }], source: 'mcp' });
    return text(st.project.music);
  },
);

server.registerTool(
  'komut',
  {
    title: 'Türkçe kurgu komutu',
    description:
      'Uygulamanın Türkçe komut anlayıcısıyla plan çıkarır; uygula=true ise uygular (tek geri alma adımı). Örnekler: "Buradan sonraki üç saniyeyi kes" (imlec saniyesi gerekir), "İkinci kez söylediğim cümleyi çıkar", "“Kahvemiz” dediğim yerde yakın planı iki saniye göster", "Bu sefer siyah beyaz yap", "Bundan sonra altyazılarımı beyaz ve iki satır yap". Birden çok aday dönerse aday=sıra ile seçin. Anlaşılmayan komutlar için islem_uygula ile doğrudan işlem gönderebilirsiniz.',
    inputSchema: {
      proje_id: z.string(),
      metin: z.string(),
      imlec: z.number().min(0).default(0).describe('Oynatma imleci (sn)'),
      uygula: z.boolean().default(false),
      aday: z.number().int().min(0).optional().describe('Adaylardan hangisi (0 ilk)'),
    },
  },
  async ({ proje_id, metin, imlec, uygula, aday }) => {
    const plan = await call('POST', `/api/projects/${proje_id}/command`, { text: metin, playhead: imlec });
    const chosen = aday !== undefined ? plan.candidates?.[aday] : null;
    const ops = chosen ? chosen.ops : plan.ops;
    if (!uygula || !plan.understood || !ops?.length) return text({ plan, uygulandi: false });
    if (plan.note) ops.push({ type: 'project.addNote', text: plan.note });
    await call('POST', `/api/projects/${proje_id}/ops`, { ops, label: `Komut: ${metin.slice(0, 40)}`, source: 'mcp' });
    if (plan.personal?.captionStyle) {
      const st = await call('GET', '/api/state');
      await call('PUT', '/api/style', { captionStyle: { ...(st.style?.captionStyle ?? {}), ...plan.personal.captionStyle } });
    }
    return text({ uygulandi: true, ozet: chosen?.summary ?? plan.summary, kisisel_stil: plan.personal ?? null });
  },
);

server.registerTool(
  'altyazi_getir',
  { title: 'Altyazı kelimeleri', description: 'Zaman çizelgesindeki altyazı kelimelerini anahtar ve zamanlarıyla verir (düzeltmeler uygulanmış).', inputSchema: { proje_id: z.string() } },
  async ({ proje_id }) => {
    const [st, lib] = await Promise.all([call('GET', `/api/projects/${proje_id}`), call<Asset[]>('GET', '/api/library')]);
    const project = st.project as Project;
    const libMap = new Map(lib.map((a) => [a.id, a]));
    const words: { anahtar: string; metin: string; asil: string; zaman: number }[] = [];
    for (const l of layoutClips(project)) {
      const a = libMap.get(l.clip.assetId);
      if (!a || a.kind !== 'video') continue;
      a.transcript.words.forEach((w, i) => {
        if ((w.t0 + w.t1) / 2 < l.clip.in || (w.t0 + w.t1) / 2 > l.clip.out) return;
        const key = `${a.id}:${i}`;
        words.push({ anahtar: key, metin: project.captions.edits[key] ?? w.text, asil: w.text, zaman: Number((l.start + w.t0 - l.clip.in).toFixed(2)) });
      });
    }
    return text({ altyazi_acik: project.captions.enabled, kelimeler: words });
  },
);

server.registerTool(
  'altyazi_kelime_duzelt',
  { title: 'Altyazı kelimesi düzelt', description: 'Bir kelimeyi düzeltir (metin=null düzeltmeyi kaldırır, "" kelimeyi gizler).', inputSchema: { proje_id: z.string(), anahtar: z.string(), metin: z.string().nullable() } },
  async ({ proje_id, anahtar, metin }) => {
    const st = await call('POST', `/api/projects/${proje_id}/ops`, { ops: [{ type: 'captions.editWord', key: anahtar, text: metin }], source: 'mcp' });
    return text({ tamam: true, duzeltmeler: st.project.captions.edits });
  },
);

server.registerTool('geri_al', { title: 'Geri al', description: 'Son işlemi geri alır.', inputSchema: { proje_id: z.string() } }, async ({ proje_id }) => {
  const st = await call('POST', `/api/projects/${proje_id}/undo`);
  return text({ geri_alinabilir: st.canUndo, yinelenebilir: st.canRedo, yinele: st.redoLabel });
});

server.registerTool('yinele', { title: 'Yinele', description: 'Geri alınan işlemi yeniden uygular.', inputSchema: { proje_id: z.string() } }, async ({ proje_id }) => {
  const st = await call('POST', `/api/projects/${proje_id}/redo`);
  return text({ geri_alinabilir: st.canUndo, yinelenebilir: st.canRedo });
});

server.registerTool(
  'disa_aktar',
  {
    title: 'Dışa aktar',
    description: 'Bir çıktıyı render eder (MP4: H.264/AAC, BT.709; görsel: JPEG) ve ffprobe ile doğrular. bekle=true ise bitene kadar bekler ve doğrulamayı döner.',
    inputSchema: {
      proje_id: z.string(),
      cikti_id: z.string(),
      muziksiz: z.boolean().default(false),
      bekle: z.boolean().default(true),
      cozunurluk: z.enum(['720', '1080', '1440', '2160']).optional().describe('Kısa kenar: 720p, 1080p, 2K (1440), 4K (2160)'),
    },
  },
  async ({ proje_id, cikti_id, muziksiz, bekle, cozunurluk }) => {
    if (cozunurluk) await call('POST', `/api/projects/${proje_id}/ops`, { ops: [{ type: 'output.update', outputId: cikti_id, patch: { resolution: cozunurluk } }], source: 'mcp' });
    const job = await call('POST', `/api/projects/${proje_id}/render`, { outputId: cikti_id, variant: muziksiz ? 'nomusic' : 'full' });
    if (!bekle) return text({ is_id: job.id, durum: job.status });
    const end = Date.now() + 30 * 60_000;
    while (Date.now() < end) {
      await new Promise((r) => setTimeout(r, 1500));
      const j = (await call<any[]>('GET', '/api/jobs')).find((x) => x.id === job.id);
      if (j?.status === 'done') {
        const health = await call('GET', '/api/health');
        return text({ dosya: `${health.home}/${j.result.file}`, ad: j.result.name, dogrulama: j.result.verification });
      }
      if (j?.status === 'error') throw new Error(j.error);
    }
    return text({ is_id: job.id, durum: 'sürüyor' });
  },
);

server.registerTool(
  'is_durumu',
  { title: 'İş durumu', description: 'Arka plandaki içe aktarma, konuşma çözümleme ve render işlerini listeler.', inputSchema: { is_id: z.string().optional() } },
  async ({ is_id }) => {
    const jobs = await call<any[]>('GET', '/api/jobs');
    return text(is_id ? jobs.find((j) => j.id === is_id) : jobs.slice(0, 20).map((j) => ({ id: j.id, tur: j.type, baslik: j.title, durum: j.status, ilerleme: j.progress, mesaj: j.error ?? j.message })));
  },
);

server.registerTool(
  'ciktilari_listele',
  { title: 'Çıktılar', description: 'Projenin dışa aktarılmış dosyalarını doğrulama sonuçlarıyla listeler.', inputSchema: { proje_id: z.string() } },
  async ({ proje_id }) => text(await call('GET', `/api/projects/${proje_id}/exports`)),
);

await server.connect(new StdioServerTransport());
