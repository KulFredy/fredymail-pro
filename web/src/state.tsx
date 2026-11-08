import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { applyOps, type OpContext, type OpInput } from '../../src/core/ops';
import { buildRefs, lutUrls, type LutInfo } from '../../src/core/refs';
import type { Asset, AssetRef, Project } from '../../src/core/schema';
import { api, type Health, type Job, type ProjectState } from './api';

// ---------------- Uygulama geneli: kütüphane, işler, LUT'lar ----------------

type AppCtx = {
  library: Map<string, Asset>;
  jobs: Job[];
  luts: LutInfo[];
  health: Health | null;
  refreshLuts: () => Promise<void>;
  refreshLibrary: () => Promise<void>;
  toast: (msg: string, kind?: 'ok' | 'error') => void;
  toasts: { id: number; msg: string; kind: 'ok' | 'error' }[];
  onProjectEvent: (fn: (e: { id: string; source: string }) => void) => () => void;
  onExportEvent: (fn: (e: any) => void) => () => void;
};

const Ctx = createContext<AppCtx | null>(null);
export const useApp = () => useContext(Ctx)!;

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [library, setLibrary] = useState<Map<string, Asset>>(new Map());
  const [jobs, setJobs] = useState<Job[]>([]);
  const [luts, setLuts] = useState<LutInfo[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [toasts, setToasts] = useState<AppCtx['toasts']>([]);
  const projectListeners = useRef(new Set<(e: any) => void>());
  const exportListeners = useRef(new Set<(e: any) => void>());

  const refreshLibrary = useCallback(async () => {
    const lib = await api.library();
    setLibrary(new Map(lib.map((a) => [a.id, a])));
  }, []);
  const refreshLuts = useCallback(async () => setLuts(await api.luts()), []);
  const toast = useCallback((msg: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 7000 : 3500);
  }, []);

  useEffect(() => {
    void refreshLibrary();
    void refreshLuts();
    api.health().then(setHealth).catch(() => undefined);
    api.jobs().then(setJobs).catch(() => undefined);
    const es = new EventSource('/api/events');
    es.addEventListener('job', (e) => {
      const job = JSON.parse((e as MessageEvent).data) as Job;
      setJobs((list) => [job, ...list.filter((j) => j.id !== job.id)].slice(0, 100));
    });
    es.addEventListener('asset', (e) => {
      const a = JSON.parse((e as MessageEvent).data) as Asset;
      setLibrary((m) => new Map(m).set(a.id, a));
    });
    es.addEventListener('project', (e) => projectListeners.current.forEach((fn) => fn(JSON.parse((e as MessageEvent).data))));
    es.addEventListener('export', (e) => exportListeners.current.forEach((fn) => fn(JSON.parse((e as MessageEvent).data))));
    return () => es.close();
  }, [refreshLibrary, refreshLuts]);

  const value = useMemo<AppCtx>(
    () => ({
      library,
      jobs,
      luts,
      health,
      refreshLuts,
      refreshLibrary,
      toast,
      toasts,
      onProjectEvent: (fn) => {
        projectListeners.current.add(fn);
        return () => projectListeners.current.delete(fn);
      },
      onExportEvent: (fn) => {
        exportListeners.current.add(fn);
        return () => exportListeners.current.delete(fn);
      },
    }),
    [library, jobs, luts, health, refreshLuts, refreshLibrary, toast, toasts],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

// ---------------- Proje durumu: anında yerel uygula, sunucuya gönder ----------------

type ProjectCtx = {
  project: Project;
  refs: Record<string, AssetRef>;
  lutMap: Record<string, string>;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  redoLabel: string | null;
  saving: boolean;
  /** İşlemi uygular. key verilirse (kaydırıcılar) son değer kısa bekleme sonrası tek geçmiş adımı olarak gönderilir. */
  apply: (ops: OpInput[], opts?: { key?: string; label?: string }) => void;
  /** Yalnız yerel önizleme (sürükleme sırasında) */
  preview: (ops: OpInput[]) => void;
  setUi: (ui: Partial<Project['ui']>) => void;
  undo: () => void;
  redo: () => void;
  reload: () => Promise<void>;
  frame: number;
  setFrame: (f: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  /** Komut önizlemesinde vurgulanan aralıklar */
  highlights: { start: number; end: number; kind: 'delete' | 'overlay' | 'change' }[];
  setHighlights: (h: { start: number; end: number; kind: 'delete' | 'overlay' | 'change' }[]) => void;
  seekRef: React.MutableRefObject<((f: number) => void) | null>;
  playRef: React.MutableRefObject<{ play: () => void; pause: () => void; fullscreen?: () => void } | null>;
};

const PCtx = createContext<ProjectCtx | null>(null);
export const useProject = () => useContext(PCtx)!;

export const opContextFrom = (library: Map<string, Asset>): OpContext => {
  const assets: OpContext['assets'] = {};
  for (const a of library.values()) assets[a.id] = { kind: a.kind, duration: a.duration, width: a.width, height: a.height };
  return { assets, newId: (p) => `${p}_${Math.random().toString(36).slice(2, 12)}`, now: () => new Date().toISOString(), photoDuration: 3 };
};

export const ProjectProvider: React.FC<{ id: string; children: React.ReactNode }> = ({ id, children }) => {
  const { library, luts, toast, onProjectEvent } = useApp();
  const [state, setState] = useState<ProjectState | null>(null);
  const [draft, setDraft] = useState<Project | null>(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [highlights, setHighlights] = useState<ProjectCtx['highlights']>([]);
  const [saving, setSaving] = useState(false);
  const pending = useRef(0);
  const debounced = useRef(new Map<string, { ops: OpInput[]; label?: string; timer: number }>());
  const seekRef = useRef<((f: number) => void) | null>(null);
  const playRef = useRef<{ play: () => void; pause: () => void; fullscreen?: () => void } | null>(null);
  const libRef = useRef(library);
  libRef.current = library;

  const reload = useCallback(async () => {
    const st = await api.project(id);
    setState(st);
    setDraft(null);
  }, [id]);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setState(null);
    setLoadError(null);
    setSlow(false);
    const t = setTimeout(() => setSlow(true), 12000);
    reload()
      .catch((e) => setLoadError((e as Error).message || 'Sunucuya ulaşılamadı'))
      .finally(() => clearTimeout(t));
    return () => clearTimeout(t);
  }, [reload, toast, attempt]);

  // Başka kaynaktan (MCP, telefon) gelen değişiklikleri al
  useEffect(
    () =>
      onProjectEvent((e) => {
        if (e.id === id && e.source !== 'ui' && pending.current === 0) void reload();
      }),
    [id, onProjectEvent, reload],
  );

  const send = useCallback(
    async (ops: OpInput[], label?: string) => {
      pending.current++;
      setSaving(true);
      try {
        const st = await api.ops(id, ops, label);
        pending.current--;
        if (pending.current === 0) {
          setState(st);
          setDraft(null);
        }
      } catch (e) {
        pending.current--;
        toast((e as Error).message, 'error');
        if (pending.current === 0) await reload();
      } finally {
        if (pending.current === 0) setSaving(false);
      }
    },
    [id, reload, toast],
  );

  const current = draft ?? state?.project ?? null;
  const currentRef = useRef(current);
  currentRef.current = current;

  const localApply = useCallback((ops: OpInput[]) => {
    const p = currentRef.current;
    if (!p) return;
    try {
      const next = applyOps(p, ops, opContextFrom(libRef.current));
      currentRef.current = next;
      setDraft(next);
    } catch (e) {
      toast((e as Error).message, 'error');
      throw e;
    }
  }, [toast]);

  const apply = useCallback<ProjectCtx['apply']>(
    (ops, opts) => {
      try {
        localApply(ops);
      } catch {
        return;
      }
      if (!opts?.key) return void send(ops, opts?.label);
      const d = debounced.current;
      const prev = d.get(opts.key);
      if (prev) clearTimeout(prev.timer);
      const timer = window.setTimeout(() => {
        d.delete(opts.key!);
        void send(ops, opts.label);
      }, 450);
      d.set(opts.key, { ops, label: opts.label, timer });
    },
    [localApply, send],
  );

  const preview = useCallback((ops: OpInput[]) => {
    try {
      localApply(ops);
    } catch {
      /* yoksay */
    }
  }, [localApply]);

  const setUi = useCallback(
    (ui: Partial<Project['ui']>) => {
      const p = currentRef.current;
      if (!p) return;
      const next = { ...p, ui: { ...p.ui, ...ui } };
      currentRef.current = next;
      setDraft(next);
      api.ui(id, ui).catch(() => undefined);
    },
    [id],
  );

  const undoRedo = useCallback(
    async (redo: boolean) => {
      // Bekleyen kaydırıcı değişikliklerini önce gönder
      for (const [k, v] of debounced.current) {
        clearTimeout(v.timer);
        debounced.current.delete(k);
        await send(v.ops, v.label);
      }
      const st = redo ? await api.redo(id) : await api.undo(id);
      setState(st);
      setDraft(null);
    },
    [id, send],
  );

  const refs = useMemo(() => buildRefs(library.values(), '', 'preview'), [library]);
  const lutMap = useMemo(() => lutUrls(luts, ''), [luts]);

  if (!state || !current)
    return (
      <div className="loading proj-loading" data-testid="project-loading">
        {loadError || slow ? (
          <div className="proj-load-err" role="alert">
            <b>{loadError ? 'Proje açılamadı' : 'Proje açılması uzun sürüyor'}</b>
            {loadError ? <code>{loadError}</code> : <span className="muted">Sunucu yanıt vermiyor olabilir.</span>}
            <span className="muted small">Ayrıntı için Terminal: tail -30 ~/Library/Logs/IcerikFabrikasi.log</span>
            <div className="row-wrap">
              <button className="btn primary" onClick={() => setAttempt((a) => a + 1)}>
                Yeniden dene
              </button>
              <a className="btn ghost" href="#/">
                Ana sayfa
              </a>
            </div>
          </div>
        ) : (
          'Proje açılıyor…'
        )}
      </div>
    );

  const value: ProjectCtx = {
    project: current,
    refs,
    lutMap,
    canUndo: state.canUndo || !!draft,
    canRedo: state.canRedo,
    undoLabel: state.undoLabel,
    redoLabel: state.redoLabel,
    saving,
    apply,
    preview,
    setUi,
    undo: () => void undoRedo(false),
    redo: () => void undoRedo(true),
    reload,
    frame,
    setFrame,
    playing,
    setPlaying,
    highlights,
    setHighlights,
    seekRef,
    playRef,
  };
  return <PCtx.Provider value={value}>{children}</PCtx.Provider>;
};
