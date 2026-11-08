import { EventEmitter } from 'node:events';
import { appendFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { customAlphabet } from 'nanoid';
import { applyOps, describeOp, newProject, type OpContext, type OpInput } from '../core/ops';
import { AssetSchema, CaptionStyleSchema, ProjectSchema, UiStateSchema, type Asset, type CaptionStyle, type Project, type UiState } from '../core/schema';

export const newId = customAlphabet('0123456789abcdefghijkmnpqrstuvwxyz', 10);

export const defaultHome = () => process.env.FABRIKA_HOME ?? path.join(os.homedir(), 'İçerik Fabrikası');

const writeJson = async (file: string, data: unknown) => {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, file);
};

const readJson = async <T>(file: string, fallback: T): Promise<T> => {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
};

/** Aynı dosyaya eşzamanlı yazmaları sıraya koyar */
class Serial {
  private chain = Promise.resolve();
  run<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.then(
      () => undefined,
      () => undefined,
    );
    return p;
  }
}

export type PersonalStyle = { captionStyle?: Partial<CaptionStyle>; photoDuration?: number };
type History = { past: { at: string; label: string; project: Project }[]; future: { at: string; label: string; project: Project }[] };
export type Version = { id: string; name: string; at: string };
export type ProjectSummary = {
  id: string;
  name: string;
  updatedAt: string;
  clipCount: number;
  outputs: string[];
  poster: string | null;
  duration: number;
  brand: Project['brand'];
};

const HISTORY_LIMIT = 100;

export class Store extends EventEmitter {
  library = new Map<string, Asset>();
  private projects = new Map<string, { project: Project; history: History; serial: Serial }>();
  private libSerial = new Serial();
  state: { lastProjectId: string | null } = { lastProjectId: null };
  style: PersonalStyle = {};

  constructor(public home: string) {
    super();
  }

  p = (...parts: string[]) => path.join(this.home, ...parts);
  rel = (abs: string) => path.relative(this.home, abs).split(path.sep).join('/');
  abs = (rel: string) => path.join(this.home, ...rel.split('/'));

  async init() {
    for (const d of ['kutuphane/originals', 'kutuphane/cache', 'kutuphane/luts', 'projeler', 'modeller', 'stil', 'tmp'])
      await mkdir(this.p(...d.split('/')), { recursive: true });
    const lib = await readJson<Record<string, unknown>>(this.p('kutuphane', 'library.json'), {});
    for (const [id, raw] of Object.entries(lib)) {
      const r = AssetSchema.safeParse(raw);
      if (r.success) this.library.set(id, r.data);
    }
    this.state = await readJson(this.p('state.json'), { lastProjectId: null });
    this.style = await readJson(this.p('stil', 'kisisel.json'), {});
  }

  // ---------- Kütüphane ----------
  saveLibrary() {
    return this.libSerial.run(() => writeJson(this.p('kutuphane', 'library.json'), Object.fromEntries(this.library)));
  }

  upsertAsset(a: Asset) {
    this.library.set(a.id, AssetSchema.parse(a));
    this.emit('asset', this.library.get(a.id));
    return this.saveLibrary();
  }

  patchAsset(id: string, patch: Partial<Asset>) {
    const a = this.library.get(id);
    if (!a) return;
    return this.upsertAsset({ ...a, ...patch });
  }

  findBySha(sha: string) {
    for (const a of this.library.values()) if (a.sha256 === sha) return a;
    return undefined;
  }

  opContext(): OpContext {
    const assets: OpContext['assets'] = {};
    for (const a of this.library.values()) assets[a.id] = { kind: a.kind, duration: a.duration, width: a.width, height: a.height };
    return { assets, newId: (prefix) => `${prefix}_${newId()}`, now: () => new Date().toISOString(), photoDuration: this.style.photoDuration ?? 3 };
  }

  // ---------- Projeler ----------
  private dir = (id: string) => this.p('projeler', id);

  async listProjects(): Promise<ProjectSummary[]> {
    const ids = await readdir(this.p('projeler')).catch(() => [] as string[]);
    const out: ProjectSummary[] = [];
    for (const id of ids) {
      const pr = await this.getProject(id).catch(() => null);
      if (!pr) continue;
      const first = pr.clips[0] ? this.library.get(pr.clips[0].assetId) : undefined;
      out.push({
        id,
        name: pr.name,
        updatedAt: pr.updatedAt,
        clipCount: pr.clips.length,
        outputs: pr.outputs.map((o) => o.channel ?? `${o.format}:${o.kind}`),
        poster: first?.poster ?? null,
        duration: pr.clips.reduce((s, c) => s + (c.out - c.in), 0),
        brand: pr.brand,
      });
    }
    return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  private async load(id: string) {
    let entry = this.projects.get(id);
    if (entry) return entry;
    if (!/^[a-z0-9_-]+$/i.test(id)) throw new Error('Geçersiz proje');
    const raw = await readFile(path.join(this.dir(id), 'project.json'), 'utf8');
    const project = ProjectSchema.parse(JSON.parse(raw));
    const history = await readJson<History>(path.join(this.dir(id), 'history.json'), { past: [], future: [] });
    entry = { project, history, serial: new Serial() };
    this.projects.set(id, entry);
    return entry;
  }

  async getProject(id: string) {
    return (await this.load(id)).project;
  }

  async getProjectState(id: string) {
    const e = await this.load(id);
    return {
      project: e.project,
      canUndo: e.history.past.length > 0,
      canRedo: e.history.future.length > 0,
      undoLabel: e.history.past.at(-1)?.label ?? null,
      redoLabel: e.history.future.at(-1)?.label ?? null,
    };
  }

  private async persist(id: string, withHistory: boolean) {
    const e = await this.load(id);
    await mkdir(this.dir(id), { recursive: true });
    await writeJson(path.join(this.dir(id), 'project.json'), e.project);
    if (withHistory) await writeJson(path.join(this.dir(id), 'history.json'), e.history);
  }

  async createProject(name: string, ops: OpInput[] = []) {
    const id = `p_${newId()}`;
    const now = new Date().toISOString();
    let project = newProject(id, name, now, {
      captions: { enabled: true, edits: {}, style: CaptionStyleSchema.parse({ ...(this.style.captionStyle ?? {}) }) },
    });
    project = applyOps(project, ops, this.opContext());
    this.projects.set(id, { project, history: { past: [], future: [] }, serial: new Serial() });
    await this.persist(id, true);
    await this.setLast(id);
    this.emit('project', { id, source: 'create' });
    return project;
  }

  async deleteProject(id: string) {
    await this.load(id);
    this.projects.delete(id);
    await rm(this.dir(id), { recursive: true, force: true });
    if (this.state.lastProjectId === id) await this.setLast(null);
  }

  async setLast(id: string | null) {
    this.state.lastProjectId = id;
    await writeJson(this.p('state.json'), this.state);
  }

  /** İşlemleri uygular, geçmişe yazar. Tek çağrı = tek geri alma adımı. */
  async applyOps(id: string, ops: OpInput[], source = 'ui', label?: string) {
    const e = await this.load(id);
    return e.serial.run(async () => {
      const before = e.project;
      const after = applyOps(before, ops, this.opContext());
      const text = label ?? ops.map(describeOp).filter((v, i, arr) => arr.indexOf(v) === i).join(', ');
      e.history.past.push({ at: new Date().toISOString(), label: text, project: before });
      if (e.history.past.length > HISTORY_LIMIT) e.history.past.shift();
      e.history.future = [];
      e.project = after;
      await this.persist(id, true);
      await appendFile(path.join(this.dir(id), 'ops.jsonl'), JSON.stringify({ at: new Date().toISOString(), source, ops }) + '\n');
      this.emit('project', { id, source });
      return this.getProjectState(id);
    });
  }

  async setUi(id: string, ui: Partial<UiState>) {
    const e = await this.load(id);
    return e.serial.run(async () => {
      e.project = { ...e.project, ui: UiStateSchema.parse({ ...e.project.ui, ...ui }) };
      await this.persist(id, false);
      if (this.state.lastProjectId !== id) await this.setLast(id);
    });
  }

  async undo(id: string, redo = false) {
    const e = await this.load(id);
    return e.serial.run(async () => {
      const from = redo ? e.history.future : e.history.past;
      const to = redo ? e.history.past : e.history.future;
      const step = from.pop();
      if (step) {
        to.push({ at: new Date().toISOString(), label: step.label, project: e.project });
        // Arayüz konumu geri alınmaz
        e.project = { ...step.project, ui: e.project.ui, updatedAt: new Date().toISOString() };
        await this.persist(id, true);
        this.emit('project', { id, source: redo ? 'redo' : 'undo' });
      }
      return this.getProjectState(id);
    });
  }

  // ---------- Sürümler ----------
  async listVersions(id: string): Promise<Version[]> {
    return readJson(path.join(this.dir(id), 'versions', 'index.json'), []);
  }

  async saveVersion(id: string, name: string) {
    const e = await this.load(id);
    const vdir = path.join(this.dir(id), 'versions');
    await mkdir(vdir, { recursive: true });
    const v: Version = { id: `v_${newId()}`, name, at: new Date().toISOString() };
    await writeJson(path.join(vdir, `${v.id}.json`), e.project);
    const list = [...(await this.listVersions(id)), v];
    await writeJson(path.join(vdir, 'index.json'), list);
    return v;
  }

  async restoreVersion(id: string, versionId: string) {
    const e = await this.load(id);
    const snap = ProjectSchema.parse(JSON.parse(await readFile(path.join(this.dir(id), 'versions', `${versionId}.json`), 'utf8')));
    return e.serial.run(async () => {
      e.history.past.push({ at: new Date().toISOString(), label: 'Sürüme dönüldü', project: e.project });
      e.history.future = [];
      e.project = { ...snap, ui: e.project.ui, updatedAt: new Date().toISOString() };
      await this.persist(id, true);
      this.emit('project', { id, source: 'version' });
      return this.getProjectState(id);
    });
  }

  async saveStyle(style: PersonalStyle) {
    this.style = { ...this.style, ...style };
    await writeJson(this.p('stil', 'kisisel.json'), this.style);
    return this.style;
  }

  exportsDir(id: string) {
    return path.join(this.dir(id), 'exports');
  }
}
