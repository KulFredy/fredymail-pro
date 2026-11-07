import type { OpInput } from '../../src/core/ops';
import type { LutInfo } from '../../src/core/refs';
import type { Asset, Project } from '../../src/core/schema';

export type ProjectState = { project: Project; canUndo: boolean; canRedo: boolean; undoLabel: string | null; redoLabel: string | null };
export type ProjectSummary = { id: string; name: string; updatedAt: string; clipCount: number; outputs: string[]; poster: string | null; duration: number };
export type Health = {
  ok: boolean;
  home: string;
  whisper: { mode: string; available: boolean; bin: string | null; model: string | null };
  encoder: string;
  hdrToneMap: boolean;
  lanUrl: string | null;
};
export type Job = {
  id: string;
  type: 'ingest' | 'transcribe' | 'render';
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
  luts: () => req<LutInfo[]>('GET', '/api/luts'),
  jobs: () => req<Job[]>('GET', '/api/jobs'),
  createProject: (name: string, formats: { format: string; kind?: string }[]) => req<ProjectState>('POST', '/api/projects', { name, formats }),
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
