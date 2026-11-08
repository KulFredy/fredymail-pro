import { z } from 'zod';
import { FORMATS } from './formats';
import { layoutClips } from './timeline';
import {
  DEFAULT_LOOK,
  AdjustSchema,
  CaptionStyleSchema,
  ClipSchema,
  FORMAT_IDS,
  RESOLUTIONS,
  FramingSchema,
  LookSchema,
  MusicSchema,
  ProjectSchema,
  TextOverlaySchema,
  OverlaySchema,
  VoiceSchema,
  ReferenceSchema,
  LogoSchema,
  PlacementSchema,
  type Look,
  type Output,
  type Project,
} from './schema';

/**
 * Kurgu işlemleri. Arayüz, MCP ve (Faz 2'de) sesli komut aynı işlemleri kullanır.
 * Her işlem saf bir fonksiyondur: (proje, işlem) → yeni proje.
 */
/**
 * Kısmi güncelleme şeması: zod v4'te .partial() varsayılanları yine doldurur;
 * burada varsayılanlar kaldırılır, böylece verilmeyen alanlar mevcut değeri korur.
 */
export const patchOf = <T extends z.ZodRawShape>(schema: z.ZodObject<T>) =>
  z.object(
    Object.fromEntries(
      Object.entries(schema.shape).map(([k, v]) => [k, (v instanceof z.ZodDefault ? (v.unwrap() as z.ZodType) : (v as z.ZodType)).optional()]),
    ),
  ) as unknown as z.ZodType<Partial<z.infer<z.ZodObject<T>>>>;

const LookPatch = z.object({
  preset: z.string().optional(),
  intensity: z.number().min(0).max(1).optional(),
  adjust: patchOf(AdjustSchema).optional(),
  lut: z.string().nullable().optional(),
  lutIntensity: z.number().min(0).max(1).optional(),
});

export const OpSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('project.rename'), name: z.string().min(1) }),
  z.object({ type: z.literal('project.setDescription'), text: z.string() }),
  z.object({ type: z.literal('project.addNote'), text: z.string().min(1) }),
  /** Orijinale dön: kesimler geri gelir (her kaynak bir kez, tam uzunlukta), renk/LUT ve kadraj sıfırlanır; dış ses, müzik, yazı, altyazı korunur */
  z.object({ type: z.literal('project.restoreOriginal') }),
  z.object({
    type: z.literal('clips.add'),
    assetIds: z.array(z.string()).min(1),
    index: z.number().int().min(0).optional(),
  }),
  z.object({ type: z.literal('clips.remove'), clipId: z.string() }),
  z.object({ type: z.literal('clips.reorder'), order: z.array(z.string()) }),
  z.object({ type: z.literal('clip.trim'), clipId: z.string(), in: z.number().min(0), out: z.number().positive() }),
  z.object({
    type: z.literal('clip.update'),
    clipId: z.string(),
    patch: patchOf(ClipSchema.pick({ camera: true, gainDb: true, muted: true, musicMuted: true, audioFadeIn: true, audioFadeOut: true })),
  }),
  /** look: null → projenin ayarına döner */
  z.object({ type: z.literal('clip.setLook'), clipId: z.string(), look: LookPatch.nullable() }),
  z.object({ type: z.literal('look.set'), look: LookPatch }),
  /** Bir klibin renk ayarını tüm projeye uygular, klip ayarlarını temizler */
  z.object({ type: z.literal('look.applyToAll'), fromClipId: z.string().optional() }),
  z.object({ type: z.literal('output.add'), format: z.enum(FORMAT_IDS), kind: z.enum(['video', 'image']).optional(), resolution: z.enum(RESOLUTIONS).optional() }),
  z.object({ type: z.literal('output.update'), outputId: z.string(), patch: z.object({ resolution: z.enum(RESOLUTIONS).optional(), kind: z.enum(['video', 'image']).optional() }) }),
  z.object({ type: z.literal('output.remove'), outputId: z.string() }),
  z.object({
    type: z.literal('output.setFraming'),
    outputId: z.string(),
    clipId: z.string(),
    framing: patchOf(FramingSchema),
  }),
  z.object({ type: z.literal('output.setStill'), outputId: z.string(), clipId: z.string(), at: z.number().min(0).default(0) }),
  z.object({ type: z.literal('music.set'), music: patchOf(MusicSchema).nullable() }),
  z.object({
    type: z.literal('captions.set'),
    enabled: z.boolean().optional(),
    style: patchOf(CaptionStyleSchema).optional(),
  }),
  /** text: null → düzeltmeyi kaldırır, '' → kelimeyi gizler */
  z.object({ type: z.literal('captions.editWord'), key: z.string(), text: z.string().nullable() }),
  z.object({ type: z.literal('text.add'), text: TextOverlaySchema.omit({ id: true }).partial().extend({ text: z.string().min(1) }) }), // eklemede varsayılanlar istenir
  z.object({ type: z.literal('text.update'), id: z.string(), patch: patchOf(TextOverlaySchema.omit({ id: true })) }),
  z.object({ type: z.literal('text.remove'), id: z.string() }),
  /** Klibi zaman çizelgesindeki bir anda ikiye böler */
  z.object({ type: z.literal('clip.split'), clipId: z.string(), at: z.number().min(0) }),
  /** Zaman çizelgesinden bir aralığı çıkarır, sonrası kayar (ripple) */
  z.object({ type: z.literal('timeline.deleteRange'), start: z.number().min(0), end: z.number().positive() }),
  z.object({ type: z.literal('overlay.add'), assetId: z.string(), at: z.number().min(0), duration: z.number().positive(), in: z.number().min(0).optional() }),
  z.object({ type: z.literal('overlay.update'), id: z.string(), patch: patchOf(OverlaySchema.omit({ id: true, assetId: true })) }),
  z.object({ type: z.literal('overlay.remove'), id: z.string() }),
  z.object({ type: z.literal('voice.add'), assetId: z.string(), at: z.number().min(0) }),
  z.object({ type: z.literal('voice.update'), id: z.string(), patch: patchOf(VoiceSchema.omit({ id: true, assetId: true })) }),
  z.object({ type: z.literal('voice.remove'), id: z.string() }),
  z.object({ type: z.literal('reference.add'), assetId: z.string(), at: z.number().min(0).optional() }),
  z.object({ type: z.literal('reference.update'), id: z.string(), patch: patchOf(ReferenceSchema.omit({ id: true, assetId: true })) }),
  z.object({ type: z.literal('reference.remove'), id: z.string() }),
  z.object({ type: z.literal('logo.add'), assetId: z.string(), logo: patchOf(LogoSchema.omit({ id: true, assetId: true, placements: true })).optional() }),
  z.object({ type: z.literal('logo.update'), id: z.string(), patch: patchOf(LogoSchema.omit({ id: true, assetId: true, placements: true })) }),
  z.object({ type: z.literal('logo.remove'), id: z.string() }),
  /** Yazı/logoyu yalnız bir çıktıda farklı yerleştir (null → genel yerleşime dön) */
  z.object({ type: z.literal('element.place'), kind: z.enum(['text', 'logo']), id: z.string(), outputId: z.string(), place: PlacementSchema.nullable() }),
]);
export type Op = z.infer<typeof OpSchema>;
export type OpInput = z.input<typeof OpSchema>;

export type OpContext = {
  assets: Record<string, { kind: 'video' | 'image' | 'audio'; duration: number; width: number; height: number }>;
  newId: (prefix: string) => string;
  now: () => string;
  /** Fotoğraf klibinin varsayılan süresi */
  photoDuration?: number;
};

export class OpError extends Error {}

const mergeLook = (base: Look, patch: z.infer<typeof LookPatch>): Look =>
  LookSchema.parse({ ...base, ...patch, adjust: { ...base.adjust, ...(patch.adjust ?? {}) } });

const findClip = (p: Project, id: string) => {
  const c = p.clips.find((x) => x.id === id);
  if (!c) throw new OpError(`Klip bulunamadı: ${id}`);
  return c;
};
const findOutput = (p: Project, id: string) => {
  const o = p.outputs.find((x) => x.id === id);
  if (!o) throw new OpError(`Çıktı bulunamadı: ${id}`);
  return o;
};

/** Görsel çıktının kaynak karesi yoksa ilk fotoğrafı (yoksa ilk klibi) seçer */
const ensureStills = (p: Project, ctx: OpContext): Project => {
  const firstPhoto = p.clips.find((c) => ctx.assets[c.assetId]?.kind === 'image') ?? p.clips[0];
  return {
    ...p,
    outputs: p.outputs.map((o) =>
      o.kind === 'image' && (!o.still || !p.clips.some((c) => c.id === o.still!.clipId))
        ? { ...o, still: firstPhoto ? { clipId: firstPhoto.id, at: 0 } : null }
        : o,
    ),
  };
};

export const applyOp = (project: Project, rawOp: OpInput, ctx: OpContext): Project => {
  const op = OpSchema.parse(rawOp);
  let p: Project = structuredClone(project);
  switch (op.type) {
    case 'project.rename':
      p.name = op.name;
      break;
    case 'project.setDescription':
      p.description = op.text;
      break;
    case 'project.addNote':
      p.notes = [...p.notes, op.text];
      break;
    case 'project.restoreOriginal': {
      const order: string[] = [];
      for (const c of p.clips) if (!order.includes(c.assetId) && ctx.assets[c.assetId] && ctx.assets[c.assetId].kind !== 'audio') order.push(c.assetId);
      p.clips = order.map((assetId) => {
        const a = ctx.assets[assetId];
        const dur = a.kind === 'image' ? (ctx.photoDuration ?? 3) : a.duration;
        return ClipSchema.parse({ id: ctx.newId('c'), assetId, in: 0, out: Math.max(0.1, dur) });
      });
      p.look = structuredClone(DEFAULT_LOOK);
      p.outputs = p.outputs.map((o) => ({ ...o, framing: {}, still: null }));
      p = ensureStills(p, ctx);
      p.ui.selectedClipId = p.clips[0]?.id ?? null;
      break;
    }
    case 'clips.add': {
      const newClips = op.assetIds.map((assetId) => {
        const a = ctx.assets[assetId];
        if (!a) throw new OpError(`Kaynak bulunamadı: ${assetId}`);
        if (a.kind === 'audio') throw new OpError('Ses dosyası klip olarak eklenemez; müzik olarak ekleyin.');
        const dur = a.kind === 'image' ? (ctx.photoDuration ?? 3) : a.duration;
        return ClipSchema.parse({ id: ctx.newId('c'), assetId, in: 0, out: Math.max(0.1, dur) });
      });
      const at = op.index ?? p.clips.length;
      p.clips = [...p.clips.slice(0, at), ...newClips, ...p.clips.slice(at)];
      p = ensureStills(p, ctx);
      if (!p.ui.selectedClipId) p.ui.selectedClipId = newClips[0].id;
      break;
    }
    case 'clips.remove':
      findClip(p, op.clipId);
      p.clips = p.clips.filter((c) => c.id !== op.clipId);
      p.outputs = p.outputs.map((o) => {
        const framing = { ...o.framing };
        delete framing[op.clipId];
        return { ...o, framing };
      });
      p = ensureStills(p, ctx);
      if (p.ui.selectedClipId === op.clipId) p.ui.selectedClipId = p.clips[0]?.id ?? null;
      break;
    case 'clips.reorder': {
      const ids = new Set(p.clips.map((c) => c.id));
      if (op.order.length !== ids.size || !op.order.every((id) => ids.has(id))) throw new OpError('Sıralama listesi kliplerle uyuşmuyor');
      p.clips = op.order.map((id) => findClip(p, id));
      break;
    }
    case 'clip.trim': {
      const c = findClip(p, op.clipId);
      const a = ctx.assets[c.assetId];
      const max = a && a.kind === 'video' ? a.duration : Infinity;
      const inT = Math.min(op.in, max - 0.1);
      const outT = Math.min(Math.max(op.out, inT + 0.1), max);
      if (a?.kind === 'image') {
        c.in = 0;
        c.out = Math.max(0.3, op.out - op.in);
      } else {
        c.in = Math.max(0, inT);
        c.out = outT;
      }
      break;
    }
    case 'clip.update':
      Object.assign(findClip(p, op.clipId), op.patch);
      break;
    case 'clip.setLook': {
      const c = findClip(p, op.clipId);
      c.look = op.look === null ? null : mergeLook(c.look ?? p.look, op.look);
      break;
    }
    case 'look.set':
      p.look = mergeLook(p.look, op.look);
      break;
    case 'look.applyToAll': {
      if (op.fromClipId) {
        const c = findClip(p, op.fromClipId);
        if (c.look) p.look = c.look;
      }
      p.clips = p.clips.map((c) => ({ ...c, look: null }));
      break;
    }
    case 'output.add': {
      const kind = op.kind ?? FORMATS[op.format].defaultKind;
      if (p.outputs.some((o) => o.format === op.format && o.kind === kind)) break;
      const out: Output = { id: ctx.newId('o'), format: op.format, kind, framing: {}, still: null, resolution: op.resolution ?? '1080' };
      p.outputs = [...p.outputs, out];
      p = ensureStills(p, ctx);
      if (!p.ui.activeOutputId) p.ui.activeOutputId = out.id;
      break;
    }
    case 'output.update': {
      const o = findOutput(p, op.outputId);
      if (op.patch.resolution) o.resolution = op.patch.resolution;
      if (op.patch.kind && op.patch.kind !== o.kind) {
        if (p.outputs.some((x) => x.id !== o.id && x.format === o.format && x.kind === op.patch.kind)) throw new OpError('Bu biçim zaten var');
        o.kind = op.patch.kind;
        p = ensureStills(p, ctx);
      }
      break;
    }
    case 'output.remove':
      findOutput(p, op.outputId);
      p.outputs = p.outputs.filter((o) => o.id !== op.outputId);
      if (p.ui.activeOutputId === op.outputId) p.ui.activeOutputId = p.outputs[0]?.id ?? null;
      break;
    case 'output.setFraming': {
      const o = findOutput(p, op.outputId);
      findClip(p, op.clipId);
      const prev = o.framing[op.clipId] ?? { mode: 'fill', x: 0.5, y: 0.5, zoom: 1 };
      o.framing = { ...o.framing, [op.clipId]: FramingSchema.parse({ ...prev, ...op.framing }) };
      break;
    }
    case 'output.setStill': {
      const o = findOutput(p, op.outputId);
      findClip(p, op.clipId);
      o.still = { clipId: op.clipId, at: op.at };
      break;
    }
    case 'music.set':
      if (op.music === null) p.music = null;
      else {
        if (!p.music && !op.music.assetId) throw new OpError('Müzik eklemek için assetId gerekli');
        if (op.music.assetId) {
          const kind = ctx.assets[op.music.assetId]?.kind;
          if (kind !== 'audio' && kind !== 'video') throw new OpError('Müzik için ses dosyası seçin');
        }
        // Var olan müzikte modu elle değiştirmek öneriyi kilitler
        const modeLocked = op.music.modeLocked ?? (p.music && op.music.mode !== undefined ? true : (p.music?.modeLocked ?? false));
        p.music = MusicSchema.parse({ ...(p.music ?? {}), ...op.music, modeLocked });
      }
      break;
    case 'captions.set':
      if (op.enabled !== undefined) p.captions.enabled = op.enabled;
      if (op.style) p.captions.style = CaptionStyleSchema.parse({ ...p.captions.style, ...op.style });
      break;
    case 'captions.editWord': {
      const edits = { ...p.captions.edits };
      if (op.text === null) delete edits[op.key];
      else edits[op.key] = op.text;
      p.captions.edits = edits;
      break;
    }
    case 'text.add':
      p.texts = [
        ...p.texts,
        TextOverlaySchema.parse({ start: 0, end: 3, ...op.text, id: ctx.newId('t') }),
      ];
      break;
    case 'text.update': {
      const t = p.texts.find((x) => x.id === op.id);
      if (!t) throw new OpError(`Yazı bulunamadı: ${op.id}`);
      Object.assign(t, TextOverlaySchema.parse({ ...t, ...op.patch }));
      break;
    }
    case 'text.remove':
      p.texts = p.texts.filter((t) => t.id !== op.id);
      break;
    case 'clip.split': {
      const item = layoutClips(p).find((l) => l.clip.id === op.clipId);
      if (!item) throw new OpError(`Klip bulunamadı: ${op.clipId}`);
      const off = op.at - item.start;
      if (off < 0.1 || off > item.duration - 0.1) throw new OpError('Bölme noktası klibin içinde olmalı');
      const a = item.clip;
      const kind = ctx.assets[a.assetId]?.kind;
      const second = { ...structuredClone(a), id: ctx.newId('c'), in: kind === 'image' ? 0 : a.in + off, out: kind === 'image' ? a.out - a.in - off : a.out };
      const first = { ...a, out: a.in + off };
      const i = p.clips.findIndex((c) => c.id === a.id);
      p.clips.splice(i, 1, first, second);
      p.outputs = p.outputs.map((o) => (o.framing[a.id] ? { ...o, framing: { ...o.framing, [second.id]: o.framing[a.id] } } : o));
      break;
    }
    case 'timeline.deleteRange': {
      const s0 = op.start;
      const e0 = op.end;
      if (e0 - s0 < 0.05) throw new OpError('Silinecek aralık çok kısa');
      const len = e0 - s0;
      const kept: typeof p.clips = [];
      const extra: Record<string, string> = {};
      for (const item of layoutClips(p)) {
        const c = item.clip;
        const kind = ctx.assets[c.assetId]?.kind;
        const os = Math.max(s0, item.start);
        const oe = Math.min(e0, item.end);
        if (oe - os <= 0.001) {
          kept.push(c);
          continue;
        }
        const before = os - item.start; // korunacak baş (sn)
        const after = item.end - oe; // korunacak son (sn)
        const mk = (srcIn: number, dur: number, id: string) =>
          kind === 'image' ? { ...c, id, in: 0, out: dur } : { ...c, id, in: srcIn, out: srcIn + dur };
        if (before >= 0.05) kept.push(mk(c.in, before, c.id));
        if (after >= 0.05) {
          const id = before >= 0.05 ? ctx.newId('c') : c.id;
          if (id !== c.id) extra[id] = c.id;
          kept.push(mk(kind === 'image' ? 0 : c.out - after, after, id));
        }
      }
      p.clips = kept;
      p.outputs = p.outputs.map((o) => {
        const framing = { ...o.framing };
        for (const [n, from] of Object.entries(extra)) if (framing[from]) framing[n] = framing[from];
        return { ...o, framing };
      });
      const shift = <T extends { at: number }>(x: T) => (x.at >= e0 ? { ...x, at: x.at - len } : x);
      p.overlays = p.overlays.filter((o) => o.at < s0 || o.at >= e0).map(shift);
      p.voice = p.voice.map(shift);
      p.texts = p.texts
        .filter((t) => t.start < s0 || t.start >= e0)
        .map((t) => (t.start >= e0 ? { ...t, start: t.start - len, end: t.end - len } : t));
      // Zamanı sabit logolar yazı gibi kayar; “tüm video boyunca” olanlar etkilenmez
      p.logos = p.logos
        .filter((l) => l.full || l.start < s0 || l.start >= e0)
        .map((l) => (!l.full && l.start >= e0 ? { ...l, start: l.start - len, end: l.end - len } : l));
      p = ensureStills(p, ctx);
      if (!p.clips.some((c) => c.id === p.ui.selectedClipId)) p.ui.selectedClipId = p.clips[0]?.id ?? null;
      break;
    }
    case 'overlay.add': {
      const a = ctx.assets[op.assetId];
      if (!a || a.kind === 'audio') throw new OpError('Üst ize görüntü veya fotoğraf eklenebilir');
      const inT = a.kind === 'image' ? 0 : Math.min(op.in ?? 0, Math.max(0, a.duration - 0.1));
      const dur = a.kind === 'image' ? op.duration : Math.min(op.duration, a.duration - inT);
      p.overlays = [...p.overlays, OverlaySchema.parse({ id: ctx.newId('v'), assetId: op.assetId, at: op.at, in: inT, out: inT + Math.max(0.1, dur) })];
      break;
    }
    case 'overlay.update': {
      const o = p.overlays.find((x) => x.id === op.id);
      if (!o) throw new OpError(`Üst iz öğesi bulunamadı: ${op.id}`);
      Object.assign(o, OverlaySchema.parse({ ...o, ...op.patch }));
      break;
    }
    case 'overlay.remove':
      p.overlays = p.overlays.filter((o) => o.id !== op.id);
      break;
    case 'voice.add': {
      const a = ctx.assets[op.assetId];
      if (!a || a.kind === 'image') throw new OpError('Dış ses için ses kaydı gerekli');
      p.voice = [...p.voice, VoiceSchema.parse({ id: ctx.newId('s'), assetId: op.assetId, at: op.at, in: 0, out: Math.max(0.1, a.duration) })];
      break;
    }
    case 'voice.update': {
      const v = p.voice.find((x) => x.id === op.id);
      if (!v) throw new OpError(`Dış ses bulunamadı: ${op.id}`);
      Object.assign(v, VoiceSchema.parse({ ...v, ...op.patch }));
      break;
    }
    case 'voice.remove':
      p.voice = p.voice.filter((v) => v.id !== op.id);
      break;
    case 'reference.add': {
      const a = ctx.assets[op.assetId];
      if (!a || a.kind === 'audio') throw new OpError('Referans olarak fotoğraf veya video eklenebilir');
      p.references = [...p.references, ReferenceSchema.parse({ id: ctx.newId('r'), assetId: op.assetId, at: Math.min(op.at ?? 0, Math.max(0, a.duration - 0.05)) })];
      break;
    }
    case 'reference.update': {
      const r = p.references.find((x) => x.id === op.id);
      if (!r) throw new OpError('Referans bulunamadı');
      Object.assign(r, op.patch);
      break;
    }
    case 'reference.remove':
      p.references = p.references.filter((x) => x.id !== op.id);
      break;
    case 'logo.add': {
      const a = ctx.assets[op.assetId];
      if (!a || a.kind !== 'image') throw new OpError('Logo olarak bir görsel (PNG, SVG, JPG) ekleyin');
      p.logos = [...p.logos, LogoSchema.parse({ ...(op.logo ?? {}), id: ctx.newId('g'), assetId: op.assetId })];
      break;
    }
    case 'logo.update': {
      const l = p.logos.find((x) => x.id === op.id);
      if (!l) throw new OpError('Logo bulunamadı');
      Object.assign(l, LogoSchema.parse({ ...l, ...op.patch }));
      break;
    }
    case 'logo.remove':
      p.logos = p.logos.filter((x) => x.id !== op.id);
      break;
    case 'element.place': {
      if (!p.outputs.some((o) => o.id === op.outputId)) throw new OpError('Çıktı bulunamadı');
      const el = op.kind === 'text' ? p.texts.find((x) => x.id === op.id) : p.logos.find((x) => x.id === op.id);
      if (!el) throw new OpError(op.kind === 'text' ? 'Yazı bulunamadı' : 'Logo bulunamadı');
      const next = { ...el.placements };
      if (op.place) next[op.outputId] = op.place;
      else delete next[op.outputId];
      el.placements = next;
      break;
    }
  }
  p.updatedAt = ctx.now();
  return ProjectSchema.parse(p);
};

export const applyOps = (project: Project, ops: OpInput[], ctx: OpContext) => ops.reduce((p, op) => applyOp(p, op, ctx), project);

export const newProject = (id: string, name: string, now: string, defaults?: Partial<Project>): Project =>
  ProjectSchema.parse({ id, name, createdAt: now, updatedAt: now, ...defaults });

/** İşlemin Türkçe kısa açıklaması (geçmiş listesinde görünür) */
export const describeOp = (op: OpInput): string => {
  switch (op.type) {
    case 'project.rename': return 'Proje adı değişti';
    case 'project.setDescription': return 'Açıklama düzenlendi';
    case 'project.addNote': return 'Proje notu eklendi';
    case 'project.restoreOriginal': return 'Orijinal haline döndü';
    case 'clips.add': return `${op.assetIds.length} klip eklendi`;
    case 'clips.remove': return 'Klip çıkarıldı';
    case 'clips.reorder': return 'Klip sırası değişti';
    case 'clip.trim': return 'Klip kısaltıldı';
    case 'clip.update': return 'Klip ayarı değişti';
    case 'clip.setLook': return 'Klip rengi değişti';
    case 'look.set': return 'Renk ayarı değişti';
    case 'look.applyToAll': return 'Renk tüm kliplere uygulandı';
    case 'output.add': return `${FORMATS[op.format].label} çıktısı eklendi`;
    case 'output.remove': return 'Çıktı kaldırıldı';
    case 'output.update': return op.patch.resolution ? `Çözünürlük ${op.patch.resolution}p` : 'Çıktı türü değişti';
    case 'output.setFraming': return 'Kadraj değişti';
    case 'output.setStill': return 'Post karesi seçildi';
    case 'music.set': return op.music === null ? 'Müzik kaldırıldı' : 'Müzik ayarı değişti';
    case 'captions.set': return 'Altyazı ayarı değişti';
    case 'captions.editWord': return 'Altyazı kelimesi düzeltildi';
    case 'text.add': return 'Yazı eklendi';
    case 'text.update': return 'Yazı düzenlendi';
    case 'text.remove': return 'Yazı silindi';
    case 'clip.split': return 'Klip bölündü';
    case 'timeline.deleteRange': return `${(op.end - op.start).toFixed(1)} sn kesildi`;
    case 'overlay.add': return 'Üst ize görüntü eklendi';
    case 'overlay.update': return 'Üst iz düzenlendi';
    case 'overlay.remove': return 'Üst iz öğesi silindi';
    case 'voice.add': return 'Dış ses eklendi';
    case 'voice.update': return 'Dış ses düzenlendi';
    case 'voice.remove': return 'Dış ses silindi';
    case 'reference.add': return 'Referans eklendi';
    case 'reference.update': return 'Referans karesi değişti';
    case 'reference.remove': return 'Referans kaldırıldı';
    case 'logo.add': return 'Logo eklendi';
    case 'logo.update': return 'Logo düzenlendi';
    case 'logo.remove': return 'Logo kaldırıldı';
    case 'element.place': return op.place ? 'Bu orana özel yerleşim' : 'Genel yerleşime döndü';
  }
};
