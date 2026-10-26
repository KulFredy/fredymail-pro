import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "./api";
import type { AiStatus, Folder, Meta, SavedSearch, SyncStatus, Tag } from "./types";

/** Uygulama genelinde paylaşılan, nadiren değişen veriler + bildirimler. */

export interface Toast {
  id: number;
  text: string;
  kind: "info" | "error" | "ok";
}

interface Store {
  meta: Meta | null;
  folders: Folder[];
  tags: Tag[];
  saved: SavedSearch[];
  ai: AiStatus | null;
  sync: SyncStatus | null;
  counts: { needs_reply: number; awaiting: number; drafts: number };
  refreshFolders: () => void;
  refreshTags: () => void;
  refreshSaved: () => void;
  refreshAi: () => void;
  refreshSync: () => void;
  refreshCounts: () => void;
  toast: (text: string, kind?: Toast["kind"]) => void;
  toasts: Toast[];
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("Store yok");
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [meta, setMeta] = useState<Meta | null>(null);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [saved, setSaved] = useState<SavedSearch[]>([]);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [sync, setSync] = useState<SyncStatus | null>(null);
  const [counts, setCounts] = useState({ needs_reply: 0, awaiting: 0, drafts: 0 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const toast = useCallback((text: string, kind: Toast["kind"] = "info") => {
    const id = nextId.current++;
    setToasts((t) => [...t.slice(-3), { id, text, kind }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === "error" ? 6000 : 3500);
  }, []);

  const quiet = <T,>(p: Promise<T>, set: (v: T) => void) => p.then(set).catch(() => undefined);
  const refreshFolders = useCallback(() => quiet(api.get<Folder[]>("/api/folders"), setFolders), []);
  const refreshTags = useCallback(() => quiet(api.get<Tag[]>("/api/tags"), setTags), []);
  const refreshSaved = useCallback(() => quiet(api.get<SavedSearch[]>("/api/saved-searches"), setSaved), []);
  const refreshAi = useCallback(() => quiet(api.get<AiStatus>("/api/ai/status"), setAi), []);
  const refreshSync = useCallback(() => quiet(api.get<SyncStatus>("/api/sync/status"), setSync), []);
  const refreshCounts = useCallback(() => {
    Promise.all([
      api.get<{ items: unknown[] }>("/api/followups?kind=needs_reply"),
      api.get<{ items: unknown[] }>("/api/followups?kind=awaiting"),
      api.get<unknown[]>("/api/drafts"),
    ])
      .then(([a, b, c]) => setCounts({ needs_reply: a.items.length, awaiting: b.items.length, drafts: c.length }))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    quiet(api.get<Meta>("/api/meta"), setMeta);
    refreshFolders();
    refreshTags();
    refreshSaved();
    refreshAi();
    refreshSync();
    refreshCounts();
    const t = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        refreshSync();
        refreshFolders();
      }
    }, 60_000);
    return () => window.clearInterval(t);
  }, [refreshFolders, refreshTags, refreshSaved, refreshAi, refreshSync, refreshCounts]);

  const value = useMemo<Store>(
    () => ({ meta, folders, tags, saved, ai, sync, counts, refreshFolders, refreshTags, refreshSaved, refreshAi,
      refreshSync, refreshCounts, toast, toasts }),
    [meta, folders, tags, saved, ai, sync, counts, refreshFolders, refreshTags, refreshSaved, refreshAi, refreshSync,
      refreshCounts, toast, toasts],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
