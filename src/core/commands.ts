import { PRESETS } from './looks';
import type { OpInput } from './ops';
import type { AssetRef, CaptionStyle, Project } from './schema';
import { formatTime, layoutClips, sentences, timelineWords, totalDuration, type Sentence, type TimedWord } from './timeline';

/**
 * Türkçe kurgu komutlarını işlem planına çevirir (kural tabanlı, yerel, ücretsiz).
 * Mikrofon ve yazı aynı yolu kullanır. Belirsizlikte adayları zaman koduyla sunar.
 */

export type PlanRange = { start: number; end: number; kind: 'delete' | 'overlay' | 'change' };
export type PlanCandidate = { label: string; ops: OpInput[]; ranges: PlanRange[]; summary: string };
export type Plan = {
  understood: boolean;
  summary: string;
  ops: OpInput[];
  ranges: PlanRange[];
  /** İki veya daha çok olası yer: kullanıcı seçer */
  candidates: PlanCandidate[];
  /** "Bundan sonra…" → kişisel stile kaydedilecek */
  personal?: { captionStyle?: Partial<CaptionStyle> };
  /** "Bu sefer…" → proje notu */
  note?: string;
  hint?: string;
  /** Kurgu dışı eylem: geri al / yinele */
  action?: 'undo' | 'redo';
  source?: 'kural' | 'claude';
};

export type CommandContext = {
  project: Project;
  assets: Record<string, AssetRef>;
  /** Oynatma imleci (sn) */
  playhead: number;
  selectedClipId: string | null;
};

const fail = (summary: string, hint?: string): Plan => ({ understood: false, summary, ops: [], ranges: [], candidates: [], hint });

export const normalizeTr = (s: string) =>
  s
    .toLocaleLowerCase('tr-TR')
    .replace(/[“”"'’‘`´]/g, ' ')
    .replace(/[.,!?;:()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const NUM_WORDS: Record<string, number> = {
  bir: 1, iki: 2, üç: 3, dört: 4, beş: 5, altı: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10,
  yirmi: 20, otuz: 30, yarım: 0.5,
};
const ORDINALS: Record<string, number> = {
  ilk: 1, birinci: 1, ikinci: 2, üçüncü: 3, dördüncü: 4, beşinci: 5, son: -1, sonuncu: -1,
};

/** "3 saniye", "üç saniye", "2,5 sn", "bir buçuk saniye", "yarım saniye" */
export const parseSeconds = (t: string): number | null => {
  const m = /(\d+(?:[.,]\d+)?|[a-zçğıöşü]+)(\s+buçuk)?\s*(saniye|sn|saniyelik)/.exec(t);
  if (!m) return null;
  let v = /\d/.test(m[1]) ? Number(m[1].replace(',', '.')) : NUM_WORDS[m[1]];
  if (v === undefined || Number.isNaN(v)) return null;
  if (m[2]) v += 0.5;
  return v;
};

const parseOrdinal = (t: string): number | null => {
  const m = /(ilk|birinci|ikinci|üçüncü|dördüncü|beşinci|sonuncu|son)\s+(kez|defa|sefer|kere|cümle|söyle|tekrar)/.exec(t);
  if (m) return ORDINALS[m[1]];
  const d = /(\d+)\s*\.?\s*(kez|defa|sefer|kere)/.exec(t);
  return d ? Number(d[1]) : null;
};

const quoted = (raw: string) => {
  const m = /[“"']([^“”"']{2,60})[”"']/.exec(raw);
  return m ? m[1].trim() : null;
};

const words = (s: string) => normalizeTr(s).split(' ').filter((w) => w.length > 1);

const similarity = (a: string, b: string) => {
  const A = new Set(words(a));
  const B = new Set(words(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((w) => B.has(w) && inter++);
  return inter / Math.max(A.size, B.size);
};

const deleteSentence = (s: Sentence, all: Sentence[], total: number): { op: OpInput; range: PlanRange } => {
  // Cümleyi ve hemen ardındaki duraksamayı al; sonraki cümleye taşma
  const i = all.indexOf(s);
  const next = all[i + 1];
  const start = Math.max(0, s.start - 0.06);
  const end = Math.min(total, next ? Math.min(next.start - 0.04, s.end + 0.35) : s.end + 0.3);
  return { op: { type: 'timeline.deleteRange', start, end }, range: { start, end, kind: 'delete' } };
};

const fmt = (t: number) => formatTime(t).replace('.', ',');

// ---------------- Kurallar ----------------

const ruleOverlay = (raw: string, t: string, ctx: CommandContext, tw: TimedWord[]): Plan | null => {
  if (!/(göster|koy|ekle|yerleştir|bindir)/.test(t)) return null;
  if (!/(yakın plan|yakın çekim|görüntü|fotoğraf|video|klib|b-?roll|plan|çekim)/.test(t)) return null;
  const dur = parseSeconds(t) ?? 2;
  const project = ctx.project;
  // Yüklenen yakın plan: projede ana izde olmayan en son içe aktarılmış görüntü
  const used = new Set([...project.clips.map((c) => c.assetId), ...project.overlays.map((o) => o.assetId)]);
  const cands = Object.values(ctx.assets)
    .filter((a) => (a.kind === 'video' || a.kind === 'image') && a.url !== undefined && !used.has(a.id))
    .sort((a, b) => (b.importedAt ?? '').localeCompare(a.importedAt ?? ''));
  const named = Object.values(ctx.assets).find((a) => a.kind !== 'audio' && t.includes(normalizeTr(a.name.replace(/\.[^.]+$/, ''))));
  const asset = named ?? cands[0];
  if (!asset) return fail('Gösterilecek yakın planı bulamadım.', 'Önce yakın plan görüntüsünü yükleyin (Ekle adımı veya Telefondan ekle).');

  // Nerede? "X dediğim/söylediğim yerde", "buraya", tırnaklı kelime
  const mk = (at: number, label: string): PlanCandidate => ({
    label,
    ops: [{ type: 'overlay.add', assetId: asset.id, at, duration: dur }],
    ranges: [{ start: at, end: at + dur, kind: 'overlay' }],
    summary: `${fmt(at)}'da “${asset.name}” ${dur} sn gösterilecek; ses devam edecek.`,
  });
  if (/(burada|buraya|şimdi|imlecin olduğu)/.test(t) && !/(dediğim|söylediğim)/.test(t)) {
    const c = mk(ctx.playhead, 'Oynatma imleci');
    return { understood: true, summary: c.summary, ops: c.ops, ranges: c.ranges, candidates: [] };
  }
  let key = quoted(raw);
  if (!key) {
    const m = /([a-zçğıöşü]+(?:\s+[a-zçğıöşü]+)?)\s+(?:kelimesini\s+|sözcüğünü\s+)?(dediğim|söylediğim|geçtiği|andığım|bahsettiğim)/.exec(t);
    if (m) key = m[1].replace(/(nın|nin|nun|nün|ın|in|un|ün|ı|i|u|ü|yı|yi|yu|yü|nı|ni|nu|nü)$/u, '');
  }
  const generic = !key || /^(ürün|ürünün ad|ürünün adı|adı|ismi|marka|markanın ad)/.test(key) || /ürünün ad/.test(t);
  let hits: TimedWord[] = [];
  if (key && !generic) {
    const k = normalizeTr(key);
    hits = tw.filter((w) => normalizeTr(w.text).startsWith(k) || (k.length > 3 && normalizeTr(w.text).includes(k)));
  }
  if (generic) {
    // Ürün adını bilmiyoruz: cümle başı olmayan büyük harfli kelimeler aday
    const seen = new Set<string>();
    hits = tw.filter((w, i) => {
      const prev = tw[i - 1];
      const cap = /^[A-ZÇĞİÖŞÜ]/.test(w.text) && prev && !/[.!?…]$/.test(prev.text) && w.text.length > 2;
      const n = normalizeTr(w.text);
      if (!cap || seen.has(n)) return false;
      seen.add(n);
      return true;
    });
    if (!hits.length)
      return fail('Ürünün adını konuşmada bulamadım.', 'Adı tırnak içinde söyleyin/yazın: “Kahvemiz” dediğim yerde yakın planı 2 saniye göster.');
  }
  if (!hits.length) return fail(`“${key}” kelimesini konuşmada bulamadım.`, 'Altyazı adımındaki kelimelere bakıp yazılışı kontrol edin.');
  const candidates = hits.slice(0, 4).map((w) => mk(w.t0, `“${w.text}” · ${fmt(w.t0)}`));
  if (candidates.length === 1) return { understood: true, summary: candidates[0].summary, ops: candidates[0].ops, ranges: candidates[0].ranges, candidates: [] };
  return {
    understood: true,
    summary: generic ? 'Ürünün adı hangisi? Olası yerler:' : `“${key}” ${candidates.length} yerde geçiyor. Hangisi?`,
    ops: [],
    ranges: candidates.flatMap((c) => c.ranges),
    candidates,
  };
};

const ruleRepeatedSentence = (raw: string, t: string, ctx: CommandContext, tw: TimedWord[]): Plan | null => {
  if (!/(çıkar|sil|kes|at|kaldır)/.test(t) || !/(cümle|söz|kısım|bölüm|tekrar|kez|defa|kere)/.test(t)) return null;
  const nth = parseOrdinal(t);
  if (nth === null && !quoted(raw)) return null;
  const all = sentences(tw);
  const total = totalDuration(ctx.project);
  if (!all.length) return fail('Bu projede konuşma bulunamadı; cümle seçemiyorum.');
  const q = quoted(raw);
  let groups: Sentence[][];
  if (q) {
    groups = [all.filter((s) => normalizeTr(s.text).includes(normalizeTr(q)) || similarity(s.text, q) >= 0.6)];
  } else {
    // Tekrarlanan cümle kümeleri
    groups = [];
    const used = new Set<Sentence>();
    for (const s of all) {
      if (used.has(s) || words(s.text).length < 2) continue;
      const g = all.filter((o) => !used.has(o) && similarity(s.text, o.text) >= 0.6);
      if (g.length >= 2) {
        g.forEach((o) => used.add(o));
        groups.push(g);
      }
    }
  }
  groups = groups.filter((g) => g.length);
  if (!groups.length) return fail(q ? `“${q}” cümlesini bulamadım.` : 'Tekrarlanan bir cümle bulamadım.', 'Cümleyi tırnak içinde yazabilirsiniz.');
  const pick = (g: Sentence[]) => (nth === -1 ? g[g.length - 1] : g[(nth ?? 1) - 1]);
  const cands = groups
    .map((g) => pick(g))
    .filter((s): s is Sentence => !!s)
    .map((s) => {
      const d = deleteSentence(s, all, total);
      return {
        label: `“${s.text.slice(0, 48)}${s.text.length > 48 ? '…' : ''}” · ${fmt(d.range.start)}–${fmt(d.range.end)}`,
        ops: [d.op],
        ranges: [d.range],
        summary: `${fmt(d.range.start)}–${fmt(d.range.end)} arası (“${s.text.slice(0, 60)}”) çıkarılacak; sonrası kayacak.`,
      };
    });
  if (!cands.length) return fail(`O sırada bir tekrar yok (en çok ${Math.max(...groups.map((g) => g.length))} kez söylenmiş).`);
  if (cands.length === 1) return { understood: true, summary: cands[0].summary, ops: cands[0].ops, ranges: cands[0].ranges, candidates: [] };
  return { understood: true, summary: 'Birden çok tekrarlanan cümle var. Hangisi?', ops: [], ranges: cands.flatMap((c) => c.ranges), candidates: cands };
};

const ruleRelativeCut = (_raw: string, t: string, ctx: CommandContext): Plan | null => {
  if (!/(kes|sil|çıkar|at|kırp)/.test(t)) return null;
  const total = totalDuration(ctx.project);
  const p = ctx.playhead;
  const sec = parseSeconds(t);
  let range: [number, number] | null = null;
  if (/(buradan|şuradan|imleçten)?\s*sonraki/.test(t) && sec) range = [p, p + sec];
  else if (/(buradan|şuradan|imleçten)?\s*önceki/.test(t) && sec) range = [p - sec, p];
  else if (/(ilk|baştaki|baştan|başından)/.test(t) && sec) range = [0, sec];
  else if (/(son|sondaki|sondan|sonundan)/.test(t) && sec) range = [total - sec, total];
  else if (/(buradan|şuradan)\s+sonras/.test(t)) range = [p, total];
  else if (/(buraya|buradan)\s+kadar/.test(t) || /(öncesini|öncesi)/.test(t)) range = [0, p];
  if (!range) return null;
  const start = Math.max(0, range[0]);
  const end = Math.min(total, range[1]);
  if (end - start < 0.05) return fail('Kesilecek aralık boş (oynatma imleci videonun sonunda olabilir).');
  return {
    understood: true,
    summary: `${fmt(start)}–${fmt(end)} arası (${(end - start).toFixed(1).replace('.', ',')} sn) kesilecek; sonrası kayacak.`,
    ops: [{ type: 'timeline.deleteRange', start, end }],
    ranges: [{ start, end, kind: 'delete' }],
    candidates: [],
  };
};

const COLORS: Record<string, string> = { beyaz: '#FFFFFF', sarı: '#FFD60A', siyah: '#111111', kırmızı: '#FF3B30', mavi: '#0A84FF', yeşil: '#30D158', turuncu: '#FF7A3D' };

const ruleCaptionStyle = (_raw: string, t: string): Plan | null => {
  if (!/altyazı/.test(t)) return null;
  const style: Partial<CaptionStyle> = {};
  for (const [w, c] of Object.entries(COLORS)) if (new RegExp(`${w}`).test(t)) style.color = c;
  const lines = /(bir|tek|1|iki|2|üç|3)\s+satır/.exec(t);
  if (lines) style.maxLines = ({ bir: 1, tek: 1, '1': 1, iki: 2, '2': 2, üç: 3, '3': 3 } as Record<string, number>)[lines[1]];
  if (/büyük harf/.test(t)) style.uppercase = true;
  if (/küçük harf/.test(t)) style.uppercase = false;
  if (/(daha büyük|büyüt)/.test(t)) style.size = 80;
  if (/(daha küçük|küçült)/.test(t)) style.size = 52;
  if (/(üstte|üste|yukarı)/.test(t)) style.position = 'top';
  if (/(ortada|ortaya)/.test(t)) style.position = 'middle';
  if (/(altta|alta|aşağı)/.test(t)) style.position = 'bottom';
  if (/kutu/.test(t)) style.box = !/(kutusuz|kutuyu kaldır)/.test(t);
  const off = /(altyazıyı|altyazıları)\s+(kapat|kaldır|gizle)/.test(t);
  const on = /(altyazıyı|altyazıları)\s+(aç|göster|ekle)/.test(t);
  if (!Object.keys(style).length && !off && !on) return null;
  const personal = /(bundan sonra|her zaman|hep|artık|varsayılan|bütün videolarda|tüm videolarda)/.test(t);
  const ops: OpInput[] = [];
  if (off || on) ops.push({ type: 'captions.set', enabled: on });
  if (Object.keys(style).length) ops.push({ type: 'captions.set', style });
  const parts = [
    style.color ? `renk ${Object.entries(COLORS).find(([, c]) => c === style.color)?.[0]}` : '',
    style.maxLines ? `${style.maxLines} satır` : '',
    style.uppercase !== undefined ? (style.uppercase ? 'büyük harf' : 'küçük harf') : '',
    style.position ? { top: 'üstte', middle: 'ortada', bottom: 'altta' }[style.position] : '',
    off ? 'kapalı' : on ? 'açık' : '',
  ].filter(Boolean);
  return {
    understood: true,
    summary: `Altyazı: ${parts.join(', ')}.${personal ? ' Kişisel stilinize de kaydedilecek (sonraki projelerde de böyle olacak).' : ''}`,
    ops,
    ranges: [],
    candidates: [],
    personal: personal && Object.keys(style).length ? { captionStyle: style } : undefined,
  };
};

const ruleLook = (_raw: string, t: string, ctx: CommandContext): Plan | null => {
  const map: [RegExp, string][] = [
    [/siyah[\s-]?beyaz/, 'sb'],
    [/(sıcak|ılık)/, 'sicak'],
    [/soğuk/, 'soguk'],
    [/canlı/, 'canli'],
    [/(film|sinematik|retro)/, 'film'],
    [/(doğal|normal renk|rengi sıfırla|filtreyi kaldır)/, 'dogal'],
  ];
  if (/altyazı/.test(t)) return null;
  const hit = map.find(([re]) => re.test(t));
  if (!hit || !/(yap|ver|uygula|olsun|çevir|ton|görünüm|renk|filtre)/.test(t)) return null;
  const preset = hit[1];
  const pct = /%\s*(\d+)|yüzde\s*(\d+)/.exec(t);
  const intensity = pct ? Number(pct[1] ?? pct[2]) / 100 : /(^| )(hafif|hafifçe|biraz|az)( |$)/.test(t) ? 0.4 : /(^| )(çok|iyice|tam|tamamen)( |$)/.test(t) ? 1 : undefined;
  const clipScope = /(bu klip|bu klibi|bu klibe|sadece burada|seçili)/.test(t) && ctx.selectedClipId;
  const look = { preset, ...(intensity !== undefined ? { intensity } : {}) };
  const label = PRESETS.find((p) => p.id === preset)?.label ?? preset;
  const once = /(bu sefer|bu videoda|bu projede|bu kez)/.test(t);
  return {
    understood: true,
    summary: `${clipScope ? 'Seçili klip' : 'Tüm proje'}: ${label}${intensity !== undefined ? ` (%${Math.round(intensity * 100)})` : ''}.${once ? ' Yalnız bu projeye özel not olarak kaydedilecek.' : ''}`,
    ops: [clipScope ? { type: 'clip.setLook', clipId: ctx.selectedClipId!, look } : { type: 'look.set', look }],
    ranges: [],
    candidates: [],
    note: once ? `Renk: ${label}` : undefined,
  };
};

const ruleMusic = (_raw: string, t: string): Plan | null => {
  if (!/müzi/.test(t)) return null;
  let music: Record<string, unknown> | null | undefined;
  let summary = '';
  if (/(kaldır|sil|çıkar|kapat)/.test(t)) {
    music = null;
    summary = 'Müzik kaldırılacak.';
  } else if (/(konuşurken|konuşmada|konuştuğum)/.test(t)) {
    music = { mode: 'duck' };
    summary = 'Müzik konuşurken kısılacak, sonra geri gelecek.';
  } else if (/(arka plan|hep kısık|kısık|alçak|kıs)/.test(t)) {
    music = { mode: 'bed' };
    summary = 'Müzik baştan sona arka planda kısık akacak.';
  } else if (/(yükselt|aç|artır|daha yüksek)/.test(t)) {
    music = { mode: 'fixed', gainDb: -3 };
    summary = 'Müzik sabit ve daha yüksek (−3 dB).';
  }
  if (music === undefined) return null;
  return { understood: true, summary, ops: [{ type: 'music.set', music: music as never }], ranges: [], candidates: [] };
};

const ruleMuteClip = (_raw: string, t: string, ctx: CommandContext): Plan | null => {
  if (!/(sesini|sesi)/.test(t) || !/(klib|klip|bu)/.test(t) || !ctx.selectedClipId) return null;
  if (/(kapat|sustur|kıs|sil)/.test(t))
    return { understood: true, summary: 'Seçili klibin sesi kapatılacak.', ops: [{ type: 'clip.update', clipId: ctx.selectedClipId, patch: { muted: true } }], ranges: [], candidates: [] };
  if (/(aç|geri getir)/.test(t))
    return { understood: true, summary: 'Seçili klibin sesi açılacak.', ops: [{ type: 'clip.update', clipId: ctx.selectedClipId, patch: { muted: false } }], ranges: [], candidates: [] };
  return null;
};

const ruleSplit = (_raw: string, t: string, ctx: CommandContext): Plan | null => {
  if (!/(böl|ikiye ayır|parçala)/.test(t)) return null;
  const item = layoutClips(ctx.project).find((l) => ctx.playhead > l.start + 0.1 && ctx.playhead < l.end - 0.1);
  if (!item) return fail('Bölmek için oynatma imlecini bir klibin içine getirin.');
  return {
    understood: true,
    summary: `Klip ${fmt(ctx.playhead)}'da ikiye bölünecek.`,
    ops: [{ type: 'clip.split', clipId: item.clip.id, at: ctx.playhead }],
    ranges: [{ start: ctx.playhead, end: ctx.playhead + 0.05, kind: 'change' }],
    candidates: [],
  };
};

const ruleUndo = (_raw: string, t: string): Plan | null => {
  if (/^(geri al|son (işlemi|değişikliği) geri al|bunu geri al|vazgeç|iptal et)$/.test(t) || /(geri al)$/.test(t))
    return { understood: true, summary: 'Son değişiklik geri alınacak.', ops: [], ranges: [], candidates: [], action: 'undo' };
  if (/^(yinele|ileri al|tekrar uygula|geri aldığımı geri getir)$/.test(t))
    return { understood: true, summary: 'Geri alınan değişiklik yeniden uygulanacak.', ops: [], ranges: [], candidates: [], action: 'redo' };
  return null;
};

/** "Altyazıları yukarı kaydır", "altyazıyı biraz aşağı al", "altyazıları kaydır" (yön yoksa sorar) */
const ruleCaptionMove = (_raw: string, t: string, ctx: CommandContext): Plan | null => {
  if (!/altyazı/.test(t) || !/(kaydır|taşı|al|çek|it|götür|yerleştir)/.test(t)) return null;
  if (/(satır|renk|beyaz|sarı|siyah|büyük harf|küçük harf|kapat|aç|kaldır|gizle)/.test(t)) return null;
  const cur = ctx.project.captions.style.offset ?? 0;
  const step = /(biraz|az|hafif)/.test(t) ? 60 : /(çok|epey|iyice)/.test(t) ? 220 : 120;
  const mk = (label: string, style: Record<string, unknown>, summary: string): PlanCandidate => ({
    label,
    summary,
    ops: [{ type: 'captions.set', style }],
    ranges: [],
  });
  const up = mk('Yukarı taşı', { offset: Math.min(600, cur + step) }, `Altyazı ${step} px yukarı taşınacak.`);
  const down = mk('Aşağı taşı', { offset: Math.max(-600, cur - step) }, `Altyazı ${step} px aşağı taşınacak.`);
  const mid = mk('Ortaya al', { position: 'middle', offset: 0 }, 'Altyazı ekranın ortasına alınacak.');
  const top = mk('En üste al', { position: 'top', offset: 0 }, 'Altyazı ekranın üstüne alınacak.');
  const one = (c: PlanCandidate): Plan => ({ understood: true, summary: c.summary, ops: c.ops, ranges: [], candidates: [] });
  if (/(yukarı|yukarıya|üste doğru|yükselt)/.test(t)) return one(up);
  if (/(aşağı|aşağıya|alta doğru|indir)/.test(t)) return one(down);
  if (/(ortaya|ortada|merkez)/.test(t)) return one(mid);
  if (/(en üste|tepeye)/.test(t)) return one(top);
  return { understood: true, summary: 'Altyazıyı nereye taşıyayım?', ops: [], ranges: [], candidates: [up, down, mid, top] };
};

const RULES = [ruleUndo, ruleCaptionMove, ruleOverlay, ruleRepeatedSentence, ruleRelativeCut, ruleCaptionStyle, ruleLook, ruleMusic, ruleMuteClip, ruleSplit];

export const planCommand = (raw: string, ctx: CommandContext): Plan => {
  const t = normalizeTr(raw);
  if (!t) return fail('Komut boş.');
  const tw = timelineWords(ctx.project, ctx.assets);
  for (const rule of RULES) {
    const plan = rule(raw, t, ctx, tw);
    if (plan) return plan;
  }
  return fail(
    'Bu komutu anlayamadım.',
    'Örnekler: “Buradan sonraki üç saniyeyi kes” · “İkinci kez söylediğim cümleyi çıkar” · ““Kahvemiz” dediğim yerde yakın planı iki saniye göster” · “Bu sefer siyah beyaz yap” · “Bundan sonra altyazılarımı beyaz ve iki satır yap” · “Müziği arka planda kısık yap”',
  );
};

export const COMMAND_EXAMPLES = [
  'Buradan sonraki üç saniyeyi kes',
  'İkinci kez söylediğim cümleyi çıkar',
  'Ürünün adını söylediğim yerde yüklediğim yakın planı iki saniye göster, sesim devam etsin',
  'Bu sefer siyah beyaz yap',
  'Bundan sonra altyazılarımı beyaz ve iki satır yap',
  'Müziği konuşurken kıs',
];
