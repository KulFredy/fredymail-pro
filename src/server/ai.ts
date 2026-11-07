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

const OPS_DOC = `İşlemler (JSON). Zamanlar saniye. "timeline" = zaman çizelgesi zamanı, "kaynak" = klibin kendi dosyasındaki zaman.
- {"type":"timeline.deleteRange","start":T,"end":T}  zaman çizelgesinden aralığı çıkarır, sonrası kayar (kesme için bunu kullan)
- {"type":"clip.split","clipId":ID,"at":T}  klibi zaman çizelgesindeki anda böler
- {"type":"clip.trim","clipId":ID,"in":K,"out":K}  kaynak giriş/çıkış
- {"type":"clips.reorder","order":[ID,...]} · {"type":"clips.remove","clipId":ID} · {"type":"clips.add","assetIds":[ID]}
- {"type":"clip.update","clipId":ID,"patch":{"gainDb":dB,"muted":bool,"musicMuted":bool}}
- {"type":"overlay.add","assetId":ID,"at":T,"duration":S}  üst iz (B-roll), ana ses devam eder
- {"type":"overlay.update","id":ID,"patch":{"at":T,"in":K,"out":K}} · {"type":"overlay.remove","id":ID}
- {"type":"look.set","look":{"preset":"dogal|sicak|soguk|canli|film|sb","intensity":0..1,"adjust":{"exposure":-3..3,"contrast":-1..1,"highlights":-1..1,"shadows":-1..1,"temp":-1..1,"tint":-1..1,"vibrance":-1..1,"saturation":-1..1,"sharpen":0..1,"vignette":0..1,"fade":0..1}}}
- {"type":"clip.setLook","clipId":ID,"look":{...aynı alanlar}}
- {"type":"music.set","music":{"mode":"bed|duck|fixed","gainDb":dB,"bedDb":dB,"duckDb":dB,"start":K}} veya {"type":"music.set","music":null}
- {"type":"captions.set","enabled":bool,"style":{"color":"#RRGGBB","highlight":"#RRGGBB","size":24..140,"maxLines":1..3,"uppercase":bool,"box":bool,"outline":bool,"position":"bottom|middle|top","offset":-600..600}}  offset: piksel, + yukarı
- {"type":"captions.editWord","key":"assetId:index","text":"yeni" veya ""}
- {"type":"text.add","text":{"text":"...","start":T,"end":T,"y":0..1,"size":20..220,"style":"shadow|box|outline"}} · {"type":"text.update","id":ID,"patch":{...}} · {"type":"text.remove","id":ID}
- {"type":"voice.update","id":ID,"patch":{"at":T,"gainDb":dB}} · {"type":"voice.remove","id":ID}`;

const SYSTEM = `Sen İçerik Fabrikası video kurgu uygulamasının komut yorumlayıcısısın. Kullanıcı Türkçe konuşarak veya yazarak kurgu talimatı verir. Görevin talimatı aşağıdaki işlemlere çevirip "kurgu_plani" aracını tam bir kez çağırmaktır. Metin yanıt yazma.

${OPS_DOC}

Kurallar:
- Yalnız bağlamda verilen kimlikleri (klip, kaynak, üst iz, yazı) kullan; uydurma.
- "Burası, buradan, şimdi" oynatma imlecini (imlec_sn) ifade eder.
- Konuşmaya dayalı yerleri cümle/kelime zamanlarından bul.
- Talimat birden çok yere uyabiliyorsa ops'u boş bırak, her olası yer için bir aday ver (en çok 4), etiketlerde zaman kodu yaz.
- "Bundan sonra / her zaman / artık" ile gelen altyazı tercihlerini ayrıca personal.captionStyle olarak da ver. "Bu sefer / bu videoda" ile gelen talimat için note yaz.
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
    },
    required: ['understood', 'summary', 'ops'],
  },
};

/** Claude'a giden bağlam: projeyi ve konuşmayı zaman kodlarıyla özetler */
export const buildContext = (project: Project, assets: Record<string, AssetRef>, playhead: number, selectedClipId: string | null) => {
  const tw = timelineWords(project, assets);
  const used = new Set(project.clips.map((c) => c.assetId));
  return {
    imlec_sn: Number(playhead.toFixed(2)),
    toplam_sn: Number(totalDuration(project).toFixed(2)),
    secili_klip: selectedClipId,
    ciktilar: project.outputs.map((o) => `${o.format}:${o.kind}`),
    klipler: layoutClips(project).map((l, i) => ({
      sira: i + 1,
      id: l.clip.id,
      kaynak: assets[l.clip.assetId]?.name,
      tur: assets[l.clip.assetId]?.kind,
      zaman: [Number(l.start.toFixed(2)), Number(l.end.toFixed(2))],
      kaynak_aralik: [l.clip.in, l.clip.out],
      ses_db: l.clip.gainDb,
      sessiz: l.clip.muted,
    })),
    ust_iz: project.overlays.map((o) => ({ id: o.id, kaynak: assets[o.assetId]?.name, at: o.at, sure: o.out - o.in })),
    dis_ses: project.voice.map((v) => ({ id: v.id, at: v.at, sure: v.out - v.in })),
    yazilar: project.texts.map((t) => ({ id: t.id, metin: t.text, start: t.start, end: t.end })),
    muzik: project.music ? { mod: project.music.mode, seviye_db: project.music.gainDb } : null,
    renk: { gorunum: project.look.preset, yogunluk: project.look.intensity },
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

const validOps = (raw: unknown[], project: Project, ctx: OpContext): { ops: OpInput[]; error: string | null } => {
  const ops: OpInput[] = [];
  for (const r of raw ?? []) {
    const p = OpSchema.safeParse(r);
    if (!p.success) return { ops: [], error: `Geçersiz işlem önerisi: ${JSON.stringify(r).slice(0, 120)}` };
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
}): Promise<Plan & { source: 'claude' }> => {
  const client = new Anthropic({ apiKey: opts.apiKey, timeout: 60_000, maxRetries: 1 });
  const context = buildContext(opts.project, opts.assets, opts.playhead, opts.selectedClipId);
  const fail = (summary: string, hint?: string): Plan & { source: 'claude' } => ({ understood: false, summary, ops: [], ranges: [], candidates: [], hint, source: 'claude' });
  let response: Anthropic.Beta.BetaMessage;
  try {
    response = await client.beta.messages.create({
      model: opts.model,
      max_tokens: 8000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'low' },
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      tools: [TOOL],
      tool_choice: { type: 'auto' },
      messages: [
        {
          role: 'user',
          content: `Proje bağlamı (JSON):\n${JSON.stringify(context)}\n\nKullanıcının talimatı: «${opts.text}»\n\nPlanı kurgu_plani aracıyla ver.`,
        },
      ],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fail('Claude API anahtarı geçersiz.', 'Ayarlar’dan anahtarı kontrol edin.');
    if (e instanceof Anthropic.RateLimitError) return fail('Claude şu an yoğun; biraz sonra tekrar deneyin.');
    if (e instanceof Anthropic.APIConnectionError) return fail('Claude’a bağlanılamadı (internet bağlantısını kontrol edin).');
    if (e instanceof Anthropic.APIError) return fail(`Claude hata verdi (${e.status}).`);
    throw e;
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
  };
  if (!input.understood) return fail(input.summary || 'Claude talimatı anlayamadı.');
  const main = validOps(input.ops ?? [], opts.project, opts.opCtx);
  const candidates: PlanCandidate[] = [];
  for (const c of input.candidates ?? []) {
    const v = validOps(c.ops ?? [], opts.project, opts.opCtx);
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
  };
};
