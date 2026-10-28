import { useMemo, useState } from "react";
import { api, ApiError, qs } from "./api";
import { goMail, navigate, type Route, type SearchState } from "./route";
import { useStore } from "./store";
import type { Folder } from "./types";
import { folderLabel } from "./util";
import { openContextMenu, SEP, type MenuItem } from "./contextmenu";
import { BrandMark, brandTagline } from "./brand";
import { Icon, Logo } from "./ui";

interface Props {
  route: Route;
  onNavigated: () => void;
  onLogout: () => void;
}

function remember(key: string, fallback: boolean): [boolean, (v: boolean) => void] {
  let initial = fallback;
  try {
    const v = localStorage.getItem(key);
    if (v !== null) initial = v === "1";
  } catch {
    /* depolama kapalı olabilir */
  }
  return [initial, (v: boolean) => {
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch {
      /* yok say */
    }
  }];
}

export function Sidebar({ route, onNavigated, onLogout }: Props) {
  const { folders, tags, saved, counts, meta, refreshTags, refreshFolders, refreshSaved, toast, openComposer } = useStore();

  async function act<T>(p: Promise<T>, ok: (r: T) => string, after?: () => void) {
    try {
      const r = await p;
      toast(ok(r), "ok");
      after?.();
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }
  const markAll = (body: { view: string; folder_id?: number; tag_id?: number }): MenuItem => ({
    label: "Tümünü okundu olarak işaretle", icon: "check",
    onClick: () => act(api.post<{ updated: number }>(`/api/messages/mark-all-read${qs(body)}`),
      (r) => (r.updated ? `${r.updated.toLocaleString("tr-TR")} mail okundu olarak işaretlendi` : "Okunmamış mail yok"),
      () => { refreshFolders(); window.dispatchEvent(new Event("fm-refresh-list")); }),
  });
  const openItem = (fn: () => void): MenuItem => ({ label: "Aç", icon: "chevron", onClick: go(fn) });
  const s = route.page === "mail" ? route.search : null;
  const isView = (v: string) => s !== null && s.view === v && !s.folder_id && !s.tag_id && !s.smart && !s.q && !s.doc_kind
    && !s.file_kind && !s.sender && !s.year && !s.participant && !s.direction;
  const [foldersInit, saveFolders] = useMemo(() => remember("fm.sidebar.folders", true), []);
  const [foldersOpen, setFoldersOpen] = useState(foldersInit);
  const [filter, setFilter] = useState("");

  const tree = useMemo(() => buildTree(folders, filter), [folders, filter]);
  const go = (fn: () => void) => () => {
    fn();
    onNavigated();
  };

  const nav = (label: string, icon: string, active: boolean, onClick: () => void, count?: number, hot = false, menu?: MenuItem[]) => (
    <li key={label}>
      <button className={`nav-item ${active ? "active" : ""}`} onClick={go(onClick)} aria-current={active ? "page" : undefined}
        onContextMenu={(e) => openContextMenu(e, menu ?? [openItem(onClick)])}>
        <Icon name={icon} size={19} />
        <span className="nav-label">{label}</span>
        {count ? <span className={`nav-count ${hot ? "hot" : ""}`}>{count.toLocaleString("tr-TR")}</span> : null}
      </button>
    </li>
  );

  const inbox = folders.find((f) => f.role === "inbox");
  const waiting = counts.needs_reply + counts.awaiting;

  async function addTag() {
    const name = window.prompt("Yeni etiket adı:");
    if (!name?.trim()) return;
    const palette = ["#0f7a4f", "#2c5fb4", "#a63369", "#b5630b", "#6a43c2", "#12707b"];
    try {
      await api.post("/api/tags", { name: name.trim(), color: palette[tags.length % palette.length] });
      refreshTags();
      toast("Etiket oluşturuldu", "ok");
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }

  return (
    <nav className="sidebar" aria-label="Posta gezintisi">
      <a className="brand" href="#/pano" onClick={onNavigated}>
        <Logo />
        <span className="brand-name">
          <b><BrandMark /></b>
          <small>{brandTagline()}</small>
        </span>
      </a>
      <button className="btn new-btn" onClick={go(() => openComposer({ to: [], subject: "", body: "" }))}>
        <Icon name="plus" size={18} /> Yeni taslak
      </button>
      <div className="sidebar-scroll">
        <ul className="nav-list">
          {nav("Pano", "grid", route.page === "dashboard", () => navigate({ page: "dashboard", period: "this_month" }))}
          {nav("Gelen Kutusu", "inbox", isView("inbox"), () => goMail({ view: "inbox" }), inbox?.unread, true, [
            openItem(() => goMail({ view: "inbox" })), markAll({ view: "inbox" }), SEP,
            { label: "Şimdi senkronize et", icon: "refresh", onClick: () => act(api.post("/api/sync/request"), () => "Senkron isteği alındı; birkaç dakika içinde yeni mailler gelir") },
          ])}
          {nav("Yanıt Bekleyenler", "reply", route.page === "followups",
            () => navigate({ page: "followups", kind: "needs_reply", msg: null }), waiting, false, [
              { label: "Yanıtlamam gereken", icon: "reply", onClick: go(() => navigate({ page: "followups", kind: "needs_reply", msg: null })) },
              { label: "Yanıt beklediğim", icon: "hourglass", onClick: go(() => navigate({ page: "followups", kind: "awaiting", msg: null })) },
            ])}
          {nav("Yapılacaklar", "tasks", route.page === "tasks", () => navigate({ page: "tasks" }), counts.tasks)}
          {nav("Asistana sor", "sparkle", route.page === "ask", () => navigate({ page: "ask", q: "" }))}
          {nav("Taslaklar", "draft", route.page === "drafts", () => navigate({ page: "drafts", draft: null }), counts.drafts, false, [
            openItem(() => navigate({ page: "drafts", draft: null })),
            { label: "Yeni taslak", icon: "plus", onClick: go(() => openComposer({ to: [], subject: "", body: "" })) },
          ])}
        </ul>
        <div className="nav-sep" />
        <ul className="nav-list">
          {nav("Tüm mailler", "all", isView("all"), () => goMail({ view: "all" }), undefined, false,
            [openItem(() => goMail({ view: "all" })), markAll({ view: "all" })])}
          {nav("Önemli", "star", isView("important"), () => goMail({ view: "important" }), undefined, false,
            [openItem(() => goMail({ view: "important" })), markAll({ view: "important" })])}
          {nav("Gönderilen", "sent", isView("sent"), () => goMail({ view: "sent" }))}
          {nav("Ertelenenler", "clock", isView("snoozed"), () => goMail({ view: "snoozed" }))}
        </ul>

        {saved.length > 0 && (
          <>
            <div className="nav-sep" />
            <div className="nav-section"><span>Akıllı klasörler</span></div>
            <ul className="nav-list">
              {saved.map((sv) =>
                nav(sv.name, "smart", s?.smart === String(sv.id), () =>
                  goMail({ view: "all", q: sv.query, ...stringify(sv.filters), smart: String(sv.id) }), undefined, false, [
                  openItem(() => goMail({ view: "all", q: sv.query, ...stringify(sv.filters), smart: String(sv.id) })), SEP,
                  {
                    label: "Akıllı klasörü sil", icon: "trash", danger: true,
                    onClick: () => window.confirm(`“${sv.name}” akıllı klasörü silinsin mi? (Mailler etkilenmez.)`)
                      && act(api.del(`/api/saved-searches/${sv.id}`), () => "Akıllı klasör silindi", refreshSaved),
                  },
                ]),
              )}
            </ul>
          </>
        )}

        <div className="nav-sep" />
        <div className="nav-section">
          <span>Etiketler</span>
          <button onClick={addTag} aria-label="Etiket ekle" title="Etiket ekle"><Icon name="plus" size={16} /></button>
        </div>
        <ul className="nav-list">
          {tags.map((t) => (
            <li key={t.id}>
              <button className={`nav-item ${s?.tag_id === String(t.id) ? "active" : ""}`}
                onClick={go(() => goMail({ view: "all", tag_id: String(t.id) }))}
                onContextMenu={(e) => openContextMenu(e, [
                  openItem(() => goMail({ view: "all", tag_id: String(t.id) })),
                  markAll({ view: "all", tag_id: t.id }), SEP,
                  {
                    label: "Yeniden adlandır…", icon: "edit", onClick: () => {
                      const name = window.prompt("Etiketin yeni adı:", t.name)?.trim();
                      if (name && name !== t.name) act(api.patch(`/api/tags/${t.id}`, { name, color: t.color }), () => "Etiket güncellendi", refreshTags);
                    },
                  },
                  {
                    label: "Etiketi sil", icon: "trash", danger: true,
                    onClick: () => window.confirm(`“${t.name}” etiketi silinsin mi? Maillerden kaldırılır, mailler silinmez.`)
                      && act(api.del(`/api/tags/${t.id}`), () => "Etiket silindi", refreshTags),
                  },
                ])}>
                <span className="tag-dot" style={{ background: t.color }} />
                <span className="nav-label">{t.name}</span>
                {t.count ? <span className="nav-count">{t.count}</span> : null}
              </button>
            </li>
          ))}
          {!tags.length && <li className="account-line">Henüz etiket yok — (+) ile ekleyin</li>}
        </ul>

        {(tree.server.length > 0 || tree.imported.length > 0 || filter) && (
          <>
            <div className="nav-sep" />
            <div className="nav-section">
              <button className="toggle" onClick={() => { setFoldersOpen(!foldersOpen); saveFolders(!foldersOpen); }} aria-expanded={foldersOpen}>
                <Icon name={foldersOpen ? "down" : "chevron"} size={15} /> Klasörler
              </button>
            </div>
            {foldersOpen && (
              <>
                {folders.length > 12 && (
                  <div className="folder-filter">
                    <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Klasör ara…" aria-label="Klasör ara" />
                  </div>
                )}
                <ul className="nav-list">{tree.server.map((n) => folderItem(n))}</ul>
                {tree.imported.length > 0 && (
                  <>
                    <div className="nav-section"><span className="faint small">Outlook arşivi</span></div>
                    <ul className="nav-list">{tree.imported.map((n) => folderItem(n))}</ul>
                  </>
                )}
              </>
            )}
          </>
        )}
      </div>
      <div className="sidebar-foot">
        <ul className="nav-list">
          {nav("Ayarlar & Senkron", "settings", route.page === "settings", () => navigate({ page: "settings" }))}
          <li>
            <button className="nav-item" onClick={async () => {
              await api.post("/api/auth/logout").catch(() => undefined);
              onLogout();
            }}>
              <Icon name="logout" size={19} />
              <span className="nav-label">Çıkış</span>
            </button>
          </li>
        </ul>
        {meta && <div className="account-line" title={meta.account}>{meta.account}</div>}
      </div>
    </nav>
  );

  function folderItem(n: TreeNode) {
    const f = n.folder;
    const active = s?.folder_id === String(f.id);
    return (
      <li key={f.id}>
        <button
          className={`nav-item ${active ? "active" : ""} ${!f.sync_enabled && !f.count ? "dim" : ""}`}
          style={{ paddingLeft: 12 + n.depth * 14, minHeight: 36, fontSize: 13.5 }}
          onClick={go(() => goMail({ view: "folder", folder_id: String(f.id) }))}
          onContextMenu={(e) => openContextMenu(e, [
            openItem(() => goMail({ view: "folder", folder_id: String(f.id) })),
            markAll({ view: "folder", folder_id: f.id }),
            ...(f.origin !== "server" || ["trash", "junk", "drafts"].includes(f.role ?? "") ? [] : [SEP, f.sync_enabled
              ? { label: "Bu klasörü senkronlama", icon: "close", onClick: () => act(api.patch(`/api/folders/${f.id}`, { sync_enabled: false }), () => "Klasör senkrondan çıkarıldı; mevcut mailler kalır", refreshFolders) }
              : { label: "Senkronlamaya başla", icon: "refresh", onClick: () => act(api.patch(`/api/folders/${f.id}`, { sync_enabled: true }), () => "Klasör senkrona eklendi", refreshFolders) }]),
          ])}
          title={f.name}
        >
          <Icon name={f.role === "archive" ? "archive" : f.role === "sent" ? "sent" : f.role === "inbox" ? "inbox" : "folder"} size={16} />
          <span className="nav-label">{folderLabel(f)}</span>
          {f.status === "error" && <Icon name="warn" size={14} title="Senkron hatası" />}
          {f.unread ? <span className="nav-count">{f.unread}</span> : null}
        </button>
      </li>
    );
  }
}

function stringify(f: Record<string, string | number | boolean>): Partial<SearchState> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(f)) out[k] = String(v);
  return out as Partial<SearchState>;
}

interface TreeNode {
  folder: Folder;
  depth: number;
}

function buildTree(folders: Folder[], filter: string): { server: TreeNode[]; imported: TreeNode[] } {
  const needle = filter.trim().toLocaleLowerCase("tr-TR");
  const visible = folders.filter((f) => (f.sync_enabled || f.count > 0)
    && (!needle || f.name.toLocaleLowerCase("tr-TR").includes(needle) || folderLabel(f).toLocaleLowerCase("tr-TR").includes(needle)));
  const byName = new Map(folders.map((f) => [f.name, f]));
  const depthOf = (f: Folder): number => {
    if (needle) return 0;
    let d = 0;
    let p = f.parent;
    while (p) {
      d++;
      p = byName.get(p)?.parent ?? null;
    }
    return d;
  };
  const order = (a: Folder, b: Folder) => {
    const rank = (f: Folder) => (f.role === "inbox" ? 0 : f.role === "sent" ? 1 : f.role === "archive" ? 2 : 3);
    // aynı üst klasörün çocukları üstün hemen altında kalsın
    const ka = rank(a) < 3 ? `0${rank(a)}` : `1${a.name.toLocaleLowerCase("tr-TR")}`;
    const kb = rank(b) < 3 ? `0${rank(b)}` : `1${b.name.toLocaleLowerCase("tr-TR")}`;
    return ka.localeCompare(kb, "tr");
  };
  const server = visible.filter((f) => f.origin !== "import").sort(order).map((f) => ({ folder: f, depth: depthOf(f) }));
  const imported = visible.filter((f) => f.origin === "import").sort(order).map((f) => ({ folder: f, depth: Math.max(depthOf(f) - 1, 0) }));
  return { server, imported };
}
