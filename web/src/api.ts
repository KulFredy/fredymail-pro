import type { OpInput } from '../../src/core/ops';
import type { LutInfo } from '../../src/core/refs';
import type { Asset, Project } from '../../src/core/schema';

export type ProjectState = { project: Project; canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null };
export type Editor = 'quick' | 'studio';
export type ProjectSummary = { id: string; name: string; updatedAt: string; clipCount: number; outputs: string[]; poster: string | null; duration: number; brand: Project['brand']; editor: Editor; pinned: boolean };
export type MobileStatus = { active: number; received: number; ready: number; failed: number; error: string | null; lastAt: string | null };
export type Brand = import('../../src/core/brand').Brand;
export type BrandInput = Omit<Brand, 'id' | 'createdAt' | 'updatedAt' | 'products'> & { products: { id?: string; name: string; notes: string }[] };
export type DeliveryCheck = import('../../src/core/delivery').Check;
export type OutputChecks = { outputId: string; label: string; checks: DeliveryCheck[]; errors: number; warnings: number };
export type PackageEntry = import('../../src/server/delivery').PackageEntry;
export type Publication = import('../../src/server/publish').Publication;
export type PublishPreview = Awaited<ReturnType<import('../../src/server/publish').Publisher['preview']>>;
export type MetaSuggestion = { outputId: string; meta: Partial<import('../../src/core/schema').OutputMeta> };
export type Health = {
  ok: boolean;
  build?: string;
  home: string;
  whisper: { mode: string; available: boolean; bin: string | null; model: string | null };
  encoder: string;
  hdrToneMap: boolean;
  lanUrl: string | null;
};
export type Job = {
  id: string;
  type: 'ingest' | 'transcribe' | 'render' | 'paket' | 'yayin';
  title: string;
  status: 'queued' | 'running' | 'done' | 'error';
  progress: number;
  message: string;
  projectId?: string;
  assetId?: string;
  outputId?: string;
  result?: any;
  error?: string;
  createdAt: string;
};
export type Conn = {
  id: 'anthropic' | 'elevenlabs' | 'gemini' | 'higgsfield' | 'youtube';
  name: string;
  capabilities: string[];
  where: string;
  verified: boolean;
  note?: string;
  configured: boolean;
  source: 'anahtarlik' | 'dosya' | 'ortam' | null;
  hint: string | null;
  status: { ok: boolean; detail: string } | null;
  settings: { voiceId?: string; modelId?: string; model?: string; models?: { id: string; name: string }[] };
  usage?: { commands: number; usd: number; todayCommands: number; todayUsd: number };
  /** YouTube: Google hesabı bağlı mı */
  account?: boolean;
};
export type TtsCatalog = {
  models: { id: string; name: string; tts: boolean; turkish: boolean; costMultiplier: number; maxChars: number | null }[];
  voices: { id: string; name: string; category: string; labels: Record<string, string>; previewUrl: string | null }[];
  defaultModelId: string | null;
  defaultVoiceId: string | null;
};
export type Generation = {
  id: string;
  kind: 'dis-ses' | 'arka-plan';
  provider: string;
  model: string;
  status: 'calisiyor' | 'bitti' | 'onay-bekliyor' | 'onaylandi' | 'hata';
  request: Record<string, any>;
  estimate: { units: number; unit: string; credits?: number; note?: string };
  resultAssetIds: string[];
  approvedAssetIds: string[];
  error?: string;
  createdAt: string;
};
export type Check = { label: string; ok: boolean; detail: string };
export type ExportEntry = {
  id: string;
  file: string;
  name: string;
  outputId: string;
  format: string;
  kind: 'video' | 'image';
  variant: 'full' | 'nomusic';
  createdAt: string;
  verification: { width: number; height: number; duration: number; size: number; checks: Check[]; ok: boolean };
};
export type Version = { id: string; name: string; at: string };

const req = async <T>(method: string, url: string, body?: unknown): Promise<T> => {
  const r = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.error ?? `İstek başarısız (${r.status})`);
  return data as T;
};

export const api = {
  health: () => req<Health>('GET', '/api/health'),
  state: () => req<{ lastProjectId: string | null; projects: ProjectSummary[]; style: any }>('GET', '/api/state'),
  saveStyle: (style: unknown) => req('PUT', '/api/style', style),
  library: () => req<Asset[]>('GET', '/api/library'),
  luts: (withUses = false) => req<LutInfo[]>('GET', `/api/luts${withUses ? '?kullanim=1' : ''}`),
  updateLut: (id: string, patch: Partial<{ name: string; kind: 'gorunum' | 'teknik'; input: string | null; tags: string[]; favorite: boolean }>) =>
    req<{ luts: LutInfo[] }>('PATCH', `/api/luts/${encodeURIComponent(id)}`, patch),
  colorMatch: (projectId: string, referenceId: string, clipId: string | null) =>
    req<{ lutId: string; name: string; summary: string[]; swatches: { reference: string; target: string }; clips: number; luts: LutInfo[] }>('POST', `/api/projects/${projectId}/color-match`, { referenceId, clipId }),
  connections: (test = false) => req<Conn[]>('GET', `/api/connections${test ? '?test=1' : ''}`),
  setConnection: (id: string, key: string) => req<{ status: { ok: boolean; detail: string }; connections: Conn[] }>('PUT', `/api/connections/${id}`, { key }),
  testConnection: (id: string) => req<{ ok: boolean; detail: string }>('POST', `/api/connections/${id}/test`),
  removeConnection: (id: string) => req<{ connections: Conn[] }>('DELETE', `/api/connections/${id}`),
  connectionSettings: (patch: { elevenlabs?: { voiceId?: string; modelId?: string }; gemini?: { model?: string } }) => req('PUT', '/api/connections-settings', patch),
  ttsCatalog: (refresh = false) => req<TtsCatalog>('GET', `/api/uret/dis-ses/katalog${refresh ? '?yenile=1' : ''}`),
  ttsEstimate: (text: string, voiceId?: string, modelId?: string) =>
    req<{ chars: number; credits: number; remaining: number | null; model: { id: string; name: string; turkish: boolean; maxChars: number | null }; voice: { id: string; name: string } }>('POST', '/api/uret/dis-ses/tahmin', { text, voiceId, modelId }),
  ttsSample: (text: string, voiceId: string, modelId: string) => req<{ file: string; text: string; chars: number }>('POST', '/api/uret/dis-ses/ornek', { text, voiceId, modelId }),
  tts: (projectId: string, b: { text: string; voiceId: string; modelId: string; at: number; voiceItemId?: string | null }) =>
    req<{ generation: Generation; reused: boolean; running?: boolean; state: ProjectState | null }>('POST', `/api/projects/${projectId}/uret/dis-ses`, b),
  backgrounds: (projectId: string, b: { assetId: string; prompt: string; aspectRatio?: string | null; count?: number }) =>
    req<{ generation: Generation; running?: boolean }>('POST', `/api/projects/${projectId}/uret/arka-plan`, b),
  generations: (projectId: string) => req<Generation[]>('GET', `/api/projects/${projectId}/uretimler`),
  approveGeneration: (id: string, assetIds: string[]) => req<Generation>('POST', `/api/uretimler/${id}/onayla`, { assetIds }),
  deleteLut: (id: string) => req<{ luts: LutInfo[] }>('DELETE', `/api/luts/${encodeURIComponent(id)}`),
  jobs: () => req<Job[]>('GET', '/api/jobs'),
  createProject: (name: string, formats: { format: string; kind?: string }[], mode?: Editor) => req<ProjectState>('POST', '/api/projects', { name, formats, mode }),
  exportXml: (pid: string, outputId?: string) => req<{ file: string; name: string; clips: number }>('POST', `/api/projects/${pid}/xml`, { outputId }),
  shutdown: () => req<{ ok: boolean }>('POST', '/api/kapat'),
  pinProject: (id: string, pinned: boolean) => req<{ ok: boolean }>('PUT', `/api/projects/${id}/sabit`, { pinned }),
  projectOpened: (id: string, editor: Editor) => req<{ ok: boolean }>('POST', `/api/projects/${id}/acildi`, { editor }),
  mobileStatus: (projectId: string, since: string) => req<MobileStatus>('GET', `/api/mobile/durum?projectId=${encodeURIComponent(projectId)}&since=${encodeURIComponent(since)}`),
  brandPlanNew: (body: { brandId: string; productId: string | null; campaign: string; options?: Partial<import('../../src/core/brand').BrandApplyOptions> }) =>
    req<{ ops: OpInput[]; items: string[] }>('POST', '/api/marka-plan', body),
  project: (id: string) => req<ProjectState>('GET', `/api/projects/${id}`),
  deleteProject: (id: string) => req('DELETE', `/api/projects/${id}`),
  ops: (id: string, ops: OpInput[], label?: string) => req<ProjectState>('POST', `/api/projects/${id}/ops`, { ops, label }),
  ui: (id: string, ui: Partial<Project['ui']>) => req('POST', `/api/projects/${id}/ui`, ui),
  undo: (id: string) => req<ProjectState>('POST', `/api/projects/${id}/undo`),
  redo: (id: string) => req<ProjectState>('POST', `/api/projects/${id}/redo`),
  versions: (id: string) => req<Version[]>('GET', `/api/projects/${id}/versions`),
  saveVersion: (id: string, name: string) => req<Version>('POST', `/api/projects/${id}/versions`, { name }),
  restoreVersion: (id: string, vid: string) => req<ProjectState>('POST', `/api/projects/${id}/versions/${vid}/restore`),
  render: (id: string, outputId: string, variant: 'full' | 'nomusic') => req<Job>('POST', `/api/projects/${id}/render`, { outputId, variant }),
  exports: (id: string) => req<ExportEntry[]>('GET', `/api/projects/${id}/exports`),
  reveal: (file: string) => req('POST', '/api/reveal', { file }),
  mobile: (projectId: string | null, page: 'upload' | 'indir') =>
    req<{ url: string | null; qr: string | null; reason?: string }>('GET', `/api/mobile?page=${page}${projectId ? `&projectId=${projectId}` : ''}`),
  settings: () =>
    req<{
      aiConfigured: boolean;
      keySource: string | null;
      aiModel: string;
      aiMode: 'always' | 'fallback';
      models: { id: string; label: string; approx: string }[];
    }>('GET', '/api/settings'),
  saveSettings: (body: { anthropicApiKey?: string | null; aiModel?: string; aiMode?: 'always' | 'fallback' }) => req('PUT', '/api/settings', body),
  aiCommand: (id: string, text: string, playhead: number, selectedClipId: string | null) =>
    req<import('../../src/core/commands').Plan>('POST', `/api/projects/${id}/command/ai`, { text, playhead, selectedClipId }),
  transcribe: (assetId: string) => req('POST', `/api/assets/${assetId}/transcribe`),
  // Faz 6: markalar ve kanal teslimi
  brands: () => req<Brand[]>('GET', '/api/markalar'),
  createBrand: (b: BrandInput) => req<Brand>('POST', '/api/markalar', b),
  updateBrand: (id: string, b: Partial<BrandInput>) => req<Brand>('PUT', `/api/markalar/${id}`, b),
  deleteBrand: (id: string) => req<Brand[]>('DELETE', `/api/markalar/${id}`),
  brandPlan: (pid: string, body: { brandId: string; productId: string | null; campaign: string; options?: Partial<import('../../src/core/brand').BrandApplyOptions> }) =>
    req<{ ops: OpInput[]; items: string[] }>('POST', `/api/projects/${pid}/marka-plan`, body),
  checks: (pid: string) => req<OutputChecks[]>('GET', `/api/projects/${pid}/kontrol`),
  makePackage: (pid: string, outputIds: string[]) => req<Job>('POST', `/api/projects/${pid}/paket`, { outputIds }),
  packages: (pid: string) => req<PackageEntry[]>('GET', `/api/projects/${pid}/paketler`),
  approvePackage: (pid: string, pkgId: string) => req<PackageEntry>('POST', `/api/projects/${pid}/paketler/${pkgId}/onayla`),
  // Faz 7: YouTube'a yayın
  disconnectYoutube: () => req('DELETE', '/api/youtube/baglanti'),
  publishPreview: (pid: string, pkgId: string, outputId: string) => req<PublishPreview>('GET', `/api/projects/${pid}/yayin/onizleme?pkgId=${encodeURIComponent(pkgId)}&outputId=${encodeURIComponent(outputId)}`),
  publish: (pid: string, b: { pkgId: string; outputId: string; privacy: 'private' | 'unlisted' | 'public'; publishAt: string | null; madeForKids: boolean; containsSyntheticMedia: boolean; confirm: boolean }) =>
    req<{ pub: Publication; job: Job | null }>('POST', `/api/projects/${pid}/yayin`, b),
  publications: (pid: string) => req<Publication[]>('GET', `/api/projects/${pid}/yayinlar`),
  refreshPublication: (pid: string, id: string) => req<Publication>('POST', `/api/projects/${pid}/yayinlar/${id}/durum`),
  writeMeta: (pid: string, outputIds: string[], ai: boolean) =>
    req<{ source: 'claude' | 'yerel'; suggestions: MetaSuggestion[]; usage?: { usd: number }; note?: string }>('POST', `/api/projects/${pid}/metin-yaz`, { outputIds, ai }),
};

/** Dosya yükleme (ilerleme yüzdesiyle) */
export const upload = (url: string, files: File[], onProgress: (f: number) => void) =>
  new Promise<any>((resolve, reject) => {
    const fd = new FormData();
    files.forEach((f) => fd.append('files', f, f.name));
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      const data = xhr.responseText ? JSON.parse(xhr.responseText) : null;
      if (xhr.status < 300) resolve(data);
      else reject(new Error(data?.error ?? 'Yükleme başarısız'));
    };
    xhr.onerror = () => reject(new Error('Bağlantı hatası'));
    xhr.send(fd);
  });

export const fileHref = (rel: string | null) => (rel ? `/files/${rel.split('/').map(encodeURIComponent).join('/')}` : '');
