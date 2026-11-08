import Anthropic from '@anthropic-ai/sdk';
import type { Plan, PlanCandidate, PlanRange } from '../core/commands';
import { applyOps, OpSchema, type OpContext, type OpInput } from '../core/ops';
import type { AssetRef, Project } from '../core/schema';
import { formatTime, layoutClips, sentences, timelineWords, totalDuration } from '../core/timeline';

/**
 * İsteğe bağlı: kural tabanlı anlayıcının çözemediği serbest Türkçe komutları Claude ile işlem planına çevirir.
 * Claude yalnız plan önerir; her işlem uygulanmadan önce çekirdek şemayla ve deneme uygulamasıyla doğrulanır.
 */

export const DEFAULT_AI_MODEL = 'claude-opus-5-5';
export type AiUsage = { model: string; input: number; output: number; usd: number };

const OPS_DOC = `İşlemler (JSON). Zamanlar saniye. "timeline" = zaman çizelgesi zamanı, "kaynak" = klibin kendi dosyasındaki zaman.
- {"type":"timeline.deleteRange","start":T,"end":T}  zaman çizelgesinden aralığı çıkarır, sonrası kayar (kesme için bunu kullan)
- {"type":"clip.split","clipId":ID,"at":T}  klibi zaman çizelgesindeki anda böler
- {"type":"clip.trim","clipId":ID,"in":K,"out":K}  kaynak giriş/çıkış
- {"type":"clips.reorder","order":[ID,...]} · {"type":"clips.remove","clipId":ID} · {"type":"clips.add","assetIds":[ID]}
- {"type":"clip.update","clipId":ID,"patch":{"gainDb":dB,"muted":bool,"musicMuted":bool,"audioFadeIn":sn,"audioFadeOut":sn}} (audioFadeIn/Out: klip sesinin yumuşak girişi/çıkışı, 0–5 sn)
- {"type":"overlay.add","assetId":ID,"at":T,"duration":S}  üst iz (B-roll), ana ses devam eder
- {"type":"overlay.update","id":ID,"patch":{"at":T,"in":K,"out":K}} · {"type":"overlay.remove","id":ID}
- {"type":"output.setFraming","outputId":ID,"clipId":KLIP_VEYA_UST_IZ_ID,"framing":{"mode":"fill|fit-blur|fit","zoom":0.1..4,"x":0..1,"y":0..1}}
    kadraj, çıktı (oran) başına: fill = ekranı kaplar (zoom 1), fit-blur = tamamı görünür + bulanık arka plan, fit = tamamı görünür + siyah.
    zoom 0.5 = yarı boyut. Görüntü kareden küçükse x/y karedeki yeridir (0 sol/üst, 0.5 orta, 1 sağ/alt; sağ alt köşe ≈ x 0.94, y 0.92);
    büyükse kaynaktaki odak noktasıdır. "Küçült" için genellikle mode "fit-blur" ve zoom<1 kullan; "tam ekran / doldur" = mode "fill", zoom 1, x/y 0.5.
- {"type":"output.add","format":"story|reel|post|square|landscape","kind":"video|image"} · {"type":"output.update","outputId":ID,"patch":{"resolution":"720|1080|1440|2160"}}
- {"type":"look.set","look":{"preset":"dogal|sicak|soguk|canli|film|sb","intensity":0..1,"adjust":{"exposure":-3..3,"contrast":-1..1,"highlights":-1..1,"shadows":-1..1,"temp":-1..1,"tint":-1..1,"vibrance":-1..1,"saturation":-1..1,"sharpen":0..1,"vignette":0..1,"fade":0..1}}}
- {"type":"clip.setLook","clipId":ID,"look":{...aynı alanlar}}
- LUT: look.set veya clip.setLook içinde "lut": bağlamdaki lutlar[].id (null = kaldır), "lutIntensity": 0..1. Kullanıcı LUT'u adıyla, etiketiyle ("film", "sıcak") veya "favori LUT'um" diye anabilir. Teknik LUT'u (tur=teknik, giris=log…) normal videoya önerme; önerirsen summary'de uyar.
- Referanstan renk eşleme bir işlem değildir: kullanıcı "şu fotoğrafın rengini al" derse understood=false, hint olarak "Sol paneldeki Referans sekmesinde referansı seçip “Rengi eşle”ye basın" yaz.
- {"type":"music.set","music":{"mode":"bed|duck|fixed","gainDb":dB,"bedDb":dB,"duckDb":dB,"start":K}} veya {"type":"music.set","music":null}
- {"type":"captions.set","enabled":bool,"style":{"color":"#RRGGBB","highlight":"#RRGGBB","size":24..140,"maxLines":1..3,"uppercase":bool,"box":bool,"outline":bool,"position":"bottom|middle|top","offset":-600..600}}  offset: piksel, + yukarı
- {"type":"captions.editWord","key":"assetId:index","text":"yeni" veya ""}
- {"type":"text.add","text":{"text":"...","start":T,"end":T,"anchor":"tl|tc|tr|ml|mc|mr|bl|bc|br","size":20..220,"style":"shadow|box|outline","anim":"yok|solma|yukari|buyume"}} · {"type":"text.update","id":ID,"patch":{...}} · {"type":"text.remove","id":ID}
- Konum (anchor): t/m/b = üst/orta/alt, l/c/r = sol/orta/sağ; her oranın Instagram güvenli alanı içinde hesaplanır. Serbest konum için anchor:null ve x,y (0..1).
- {"type":"logo.add","assetId":ID,"logo":{"anchor":"tr","size":0.03..0.9,"opacity":0..1,"anim":"yok|solma|yukari|buyume","full":true}} (logo: görsel kaynak; full=false ise start/end) · {"type":"logo.update","id":ID,"patch":{...aynı alanlar}} · {"type":"logo.remove","id":ID}
- Yalnız bir oranda farklı yerleşim: {"type":"element.place","kind":"text|logo","id":ID,"outputId":ID,"place":{"anchor":"bl","x":0.5,"y":0.5,"scale":1}} (place:null → genel yerleşime döner)
- Hareket (Ken Burns): {"type":"clip.update","clipId":ID,"patch":{"motion":{"kind":"yakinlas|uzaklas|sola|saga|yukari|asagi","amount":0.03..0.6,"duration":null|saniye}}} (duration: yalnız girişte; null = klip boyunca; motion:null kaldırır)
- Kesimi müziğe oturtmak için muzik.vuruslar listesini kullan: clip.trim ile klip sonunu en yakın vuruşa (kurgu zamanı) kaydır.
- {"type":"project.restoreOriginal"} (orijinale dön: kesimler geri gelir, renk/LUT ve kadraj sıfırlanır; dış ses, müzik, yazı, altyazı kalır)
- {"type":"voice.update","id":ID,"patch":{"at":T,"gainDb":dB,"fadeIn":sn,"fadeOut":sn}} · {"type":"voice.remove","id":ID}`;

const SYSTEM = `Sen İçerik Fabrikası video kurgu uygulamasının komut yorumlayıcısısın. Kullanıcı Türkçe konuşarak veya yazarak kurgu talimatı verir. Görevin talimatı aşağıdaki işlemlere çevirip "kurgu_plani" aracını tam bir kez çağırmaktır. Metin yanıt yazma.

${OPS_DOC}

Kurallar:
- Yalnız bağlamda verilen kimlikleri (klip, kaynak, üst iz, yazı) kullan; uydurma.
- "Burası, buradan, şimdi" oynatma imlecini (imlec_sn) ifade eder.
- Konuşmaya dayalı yerleri cümle/kelime zamanlarından bul.
- Talimat birden çok yere uyabiliyorsa ops'u boş bırak, her olası yer için bir aday ver (en çok 4), etiketlerde zaman kodu yaz.
- "Bundan sonra / her zaman / artık" ile gelen altyazı tercihlerini ayrıca personal.captionStyle olarak da ver. "Bu sefer / bu videoda" ile gelen talimat için note yaz.
- Kadraj komutlarını (küçült, büyüt, köşeye al, doldur) etkin çıktıya (aktif_cikti) ve aksi söylenmedikçe imlecin üstündeki ya da seçili klibe uygula; mevcut kadraj değerlerini (kadraj) dikkate al.
- "Geri al" / "yinele" isteklerinde ops boş, action "undo" veya "redo" ver.
- Yapamayacağın şeyi (ör. yeni görüntü üretmek) yapıyormuş gibi gösterme: understood=false ve kısa bir açıklama ver.
- summary ve etiketler kısa, doğal Türkçe olsun; zamanları 0:12,4 biçiminde yaz.
- ranges: değişen zaman aralıkları (kind: delete | overlay | change).`;

const TOOL: Anthropic.Beta.BetaTool = {
  name: 'kurgu_plani',
  description: 'Kullanıcının kurgu talimatından çıkarılan işlem planı.',
  input_schema: {
    type: 'object',
    properties: {
      understood: { type: 'boolean' },
      summary: { type: 'string', description: 'Ne yapılacağının kısa Türkçe özeti' },
      ops: { type: 'array', items: { type: 'object' }, description: 'Belirsizlik yoksa uygulanacak işlemler' },
      ranges: { type: 'array', items: { type: 'object', properties: { start: { type: 'number' }, end: { type: 'number' }, kind: { type: 'string', enum: ['delete', 'overlay', 'change'] } } } },
      candidates: {
        type: 'array',
        items: { type: 'object', properties: { label: { type: 'string' }, summary: { type: 'string' }, ops: { type: 'array', items: { type: 'object' } } }, required: ['label', 'ops'] },
      },
      personal: { type: 'object', properties: { captionStyle: { type: 'object' } } },
      note: { type: 'string' },
      action: { type: 'string', enum: ['undo', 'redo'] },
    },
    required: ['understood', 'summary', 'ops'],
  },
};

/** Claude'a giden bağlam: projeyi ve konuşmayı zaman kodlarıyla özetler */
export type AiLut = { id: string; ad: string; tur: string; giris: string | null; etiketler: string[]; favori: boolean };

export const buildContext = (project: Project, assets: Record<string, AssetRef>, playhead: number, selectedClipId: string | null, luts: AiLut[] = []) => {
  const tw = timelineWords(project, assets);
  const used = new Set(project.clips.map((c) => c.assetId));
  return {
    imlec_sn: Number(playhead.toFixed(2)),
    toplam_sn: Number(totalDuration(project).toFixed(2)),
    secili_klip: selectedClipId,
    ciktilar: project.outputs.map((o) => ({ id: o.id, bicim: o.format, tur: o.kind, cozunurluk: o.resolution })),
    aktif_cikti: project.ui.activeOutputId ?? project.outputs[0]?.id ?? null,
    klipler: layoutClips(project).map((l, i) => ({
      sira: i + 1,
      id: l.clip.id,
      kaynak: assets[l.clip.assetId]?.name,
      tur: assets[l.clip.assetId]?.kind,
      zaman: [Number(l.start.toFixed(2)), Number(l.end.toFixed(2))],
      kaynak_aralik: [l.clip.in, l.clip.out],
      olcu: assets[l.clip.assetId] ? `${assets[l.clip.assetId].width}x${assets[l.clip.assetId].height}` : null,
      ses_db: l.clip.gainDb,
      sessiz: l.clip.muted,
      lut: (l.clip.look ?? project.look).lut,
      hareket: l.clip.motion,
      kadraj: (project.outputs.find((o) => o.id === project.ui.activeOutputId) ?? project.outputs[0])?.framing[l.clip.id] ?? { mode: 'fill', zoom: 1, x: 0.5, y: 0.5 },
    })),
    ust_iz: project.overlays.map((o) => ({ id: o.id, kaynak: assets[o.assetId]?.name, at: o.at, sure: o.out - o.in })),
    dis_ses: project.voice.map((v) => ({ id: v.id, at: v.at, sure: v.out - v.in })),
    yazilar: project.texts.map((t) => ({ id: t.id, metin: t.text, start: t.start, end: t.end, konum: t.anchor ?? `serbest ${t.x.toFixed(2)},${t.y.toFixed(2)}`, boyut: t.size, ozel_oranlar: Object.keys(t.placements) })),
    logolar: project.logos.map((l) => ({ id: l.id, kaynak: assets[l.assetId]?.name, konum: l.anchor ?? `serbest ${l.x.toFixed(2)},${l.y.toFixed(2)}`, boyut: l.size, saydamlik: l.opacity, tum_video: l.full, ozel_oranlar: Object.keys(l.placements) })),
    gorseller: Object.values(assets)
      .filter((a) => a.kind === 'image')
      .slice(0, 20)
      .map((a) => ({ id: a.id, ad: a.name, saydam: !!a.alpha })),
    muzik: project.music
      ? {
          mod: project.music.mode,
          seviye_db: project.music.gainDb,
          bpm: assets[project.music.assetId]?.bpm ?? null,
          /** Kurgu zamanında ilk 64 vuruş (sn) */
          vuruslar: (assets[project.music.assetId]?.beats ?? []).map((b) => +(b - project.music!.start).toFixed(2)).filter((b) => b > 0).slice(0, 64),
        }
      : null,
    renk: { gorunum: project.look.preset, yogunluk: project.look.intensity, lut: project.look.lut, lut_yogunluk: project.look.lutIntensity },
    /** Kullanıcının LUT kütüphanesi (look.lut olarak id verilir) */
    lutlar: luts.slice(0, 120),
    referanslar: project.references.map((r) => ({ id: r.id, ad: assets[r.assetId]?.name, tur: assets[r.assetId]?.kind, kare_sn: r.at })),
    altyazi: { acik: project.captions.enabled, stil: project.captions.style },
    cumleler: sentences(tw).map((s) => ({ bas: formatTime(s.start), son: formatTime(s.end), bas_sn: Number(s.start.toFixed(2)), son_sn: Number(s.end.toFixed(2)), metin: s.text })),
    kelimeler: tw.slice(0, 600).map((w) => [w.text, Number(w.t0.toFixed(2)), w.key]),
    kullanilmayan_medya: Object.values(assets)
      .filter((a) => !used.has(a.id) && a.kind !== 'audio')
      .sort((a, b) => (b.importedAt ?? '').localeCompare(a.importedAt ?? ''))
      .slice(0, 12)
      .map((a) => ({ id: a.id, ad: a.name, tur: a.kind, sure: a.duration, yuklenme: a.importedAt })),
  };
};

const validOps = (raw: unknown[], project: Project, ctx: OpContext, lutIds?: Set<string>): { ops: OpInput[]; error: string | null } => {
  const ops: OpInput[] = [];
  for (const r of raw ?? []) {
    const p = OpSchema.safeParse(r);
    if (!p.success) return { ops: [], error: `Geçersiz işlem önerisi: ${JSON.stringify(r).slice(0, 120)}` };
    // Var olmayan LUT önerisi sessizce etkisiz kalmasın
    const op = p.data as OpInput & { look?: { lut?: string | null } | null };
    const lut = (op.type === 'look.set' || op.type === 'clip.setLook') && op.look ? op.look.lut : undefined;
    if (lutIds && lut && !lutIds.has(lut)) return { ops: [], error: `Bilinmeyen LUT: ${lut}` };
    ops.push(p.data as OpInput);
  }
  try {
    applyOps(project, ops, ctx); // deneme: uygulanabiliyor mu?
  } catch (e) {
    return { ops: [], error: (e as Error).message };
  }
  return { ops, error: null };
};

export const planWithClaude = async (opts: {
  apiKey: string;
  model: string;
  text: string;
  project: Project;
  assets: Record<string, AssetRef>;
  playhead: number;
  selectedClipId: string | null;
  opCtx: OpContext;
  luts?: AiLut[];
}): Promise<Plan & { source: 'claude'; usage?: AiUsage }> => {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: 60_000, maxRetries: 1 });
  const context = buildContext(opts.project, opts.assets, opts.playhead, opts.selectedClipId, opts.luts ?? []);
  const fail = (summary: string, hint?: string): Plan & { source: 'claude'; usage?: AiUsage } => ({ understood: false, summary, ops: [], ranges: [], candidates: [], hint, source: 'claude' });
  const base = {
    model: opts.model,
    max_tokens: 8000,
    system: [{ type: 'text' as const, text: SYSTEM, cache_control: { type: 'ephemeral' as const } }],
    tools: [TOOL],
    tool_choice: { type: 'auto' as const },
    messages: [
      {
        role: 'user' as const,
        content: `Proje bağlamı (JSON):\n${JSON.stringify(context)}\n\nKullanıcının talimatı: «${opts.text}»\n\nPlanı kurgu_plani aracıyla ver.`,
      },
    ],
  };
  // Hesapta açık olmayan bir özellik 400 verirse daha sade istekle yeniden dene
  // Sunucu tarafı yedek (ret durumunda başka modelle sürdürme) Haiku'da yok
  const withFallback = !opts.model.startsWith('claude-haiku');
  const attempts: (() => Promise<Anthropic.Beta.BetaMessage>)[] = [
    ...(withFallback
      ? [() => client.beta.messages.create({ ...base, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default', output_config: { effort: 'low' } })]
      : []),
    () => client.beta.messages.create({ ...base, output_config: { effort: 'low' } }),
    () => client.beta.messages.create({ ...base }),
  ];
  let response: Anthropic.Beta.BetaMessage | null = null;
  let lastBadRequest = '';
  for (const attempt of attempts) {
    try {
      response = await attempt();
      break;
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError) {
        lastBadRequest = e.message;
        console.error('[claude] 400:', e.message);
        continue;
      }
      if (e instanceof Anthropic.AuthenticationError) return fail('Claude API anahtarı geçersiz.', 'Claude düğmesinden anahtarı kontrol edin.');
      if (e instanceof Anthropic.PermissionDeniedError) return fail('Bu API anahtarının bu modele erişimi yok.', `Model: ${opts.model}`);
      if (e instanceof Anthropic.NotFoundError) return fail(`Model bulunamadı: ${opts.model}`);
      if (e instanceof Anthropic.RateLimitError) return fail('Claude şu an yoğun veya kredi sınırına ulaşıldı; biraz sonra tekrar deneyin.');
      if (e instanceof Anthropic.APIConnectionError) return fail('Claude’a bağlanılamadı (internet bağlantısını kontrol edin).');
      if (e instanceof Anthropic.APIError) return fail(`Claude hata verdi (${e.status}): ${e.message.slice(0, 200)}`);
      throw e;
    }
  }
  if (!response) {
    const credit = /credit|balance|billing/i.test(lastBadRequest);
    return fail(
      credit ? 'Anthropic hesabında kredi yok.' : 'Claude isteği kabul etmedi (400).',
      credit ? 'console.anthropic.com → Billing bölümünden kredi ekleyin.' : lastBadRequest.slice(0, 300),
    );
  }
  if (response.stop_reason === 'refusal') return fail('Claude bu talimatı işlemedi.');
  const call = response.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'kurgu_plani');
  if (!call) return fail('Claude bir plan döndürmedi; talimatı biraz daha açık söyleyin.');
  const input = call.input as {
    understood?: boolean;
    summary?: string;
    ops?: unknown[];
    ranges?: PlanRange[];
    candidates?: { label: string; summary?: string; ops: unknown[]; ranges?: PlanRange[] }[];
    personal?: Plan['personal'];
    note?: string;
    action?: 'undo' | 'redo';
  };
  const usage = { model: response.model, input: response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0) + (response.usage.cache_creation_input_tokens ?? 0), output: response.usage.output_tokens, usd: costUsd(response.model, response.usage) };
  if (input.action === 'undo' || input.action === 'redo')
    return { understood: true, summary: input.summary || (input.action === 'undo' ? 'Geri alınacak.' : 'Yinelenecek.'), ops: [], ranges: [], candidates: [], action: input.action, source: 'claude', usage };
  if (!input.understood) return { ...fail(input.summary || 'Claude talimatı anlayamadı.'), usage };
  const lutIds = opts.luts ? new Set(opts.luts.map((l) => l.id)) : undefined;
  const main = validOps(input.ops ?? [], opts.project, opts.opCtx, lutIds);
  const candidates: PlanCandidate[] = [];
  for (const c of input.candidates ?? []) {
    const v = validOps(c.ops ?? [], opts.project, opts.opCtx, lutIds);
    if (!v.error && v.ops.length) candidates.push({ label: c.label, summary: c.summary ?? c.label, ops: v.ops, ranges: (c.ranges ?? []).filter((r) => typeof r.start === 'number') });
  }
  if (main.error && !candidates.length) return fail(`Önerilen değişiklik uygulanamadı: ${main.error}`);
  if (!main.ops.length && !candidates.length && !input.personal?.captionStyle) return fail(input.summary || 'Yapılacak bir değişiklik bulunamadı.');
  return {
    understood: true,
    summary: input.summary ?? '',
    ops: candidates.length > 1 ? [] : main.ops.length ? main.ops : (candidates[0]?.ops ?? []),
    ranges: (input.ranges ?? []).filter((r) => typeof r?.start === 'number' && typeof r?.end === 'number'),
    candidates: candidates.length > 1 ? candidates : [],
    personal: input.personal?.captionStyle ? { captionStyle: input.personal.captionStyle } : undefined,
    note: input.note || undefined,
    source: 'claude',
    usage,
  };
};

/** Yaklaşık maliyet (USD) — 1M token başına liste fiyatları */
const PRICES: Record<string, { in: number; out: number; cacheRead: number }> = {
  'claude-opus-5-5': { in: 4, out: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, cacheRead: 0.01 },
};
export const AI_MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 — en iyi anlama', approx: 'komut başına ≈ 3–5 sent' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — hızlı, yarı fiyat', approx: 'komut başına ≈ 1,5–2,5 sent' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 — en ucuz', approx: 'komut başına ≈ 0,1 sent' },
];
const costUsd = (model: string, u: Anthropic.Beta.BetaUsage) => {
  const key = Object.keys(PRICES).find((k) => model.startsWith(k)) ?? DEFAULT_AI_MODEL;
  const p = PRICES[key];
  const cacheWrite = (u.cache_creation_input_tokens ?? 0) * p.in * 1.25;
  return (u.input_tokens * p.in + (u.cache_read_input_tokens ?? 0) * p.cacheRead + cacheWrite + u.output_tokens * p.out) / 1e6;
};
