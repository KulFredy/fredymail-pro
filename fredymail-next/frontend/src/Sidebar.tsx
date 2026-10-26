import { useMemo, useState } from "react";
import { api, ApiError } from "./api";
import { goMail, navigate, type Route, type SearchState } from "./route";
import { useStore } from "./store";
import type { Folder } from "./types";
import { folderLabel } from "./util";
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
  const { folders, tags, saved, counts, meta, refreshTags, toast, openComposer } = useStore();
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

  const nav = (label: string, icon: string, active: boolean, onClick: () => void, count?: number, hot = false) => (
    <li key={label}>
      <button className={`nav-item ${active ? "active" : ""}`} onClick={go(onClick)} aria-current={active ? "page" : undefined}>
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
          <b>FredyMail</b>
          <small>Intelligence</small>
        </span>
      </a>
      <button className="btn new-btn" onClick={go(() => openComposer({ to: [], subject: "", body: "" }))}>
        <Icon name="plus" size={18} /> Yeni taslak
      </button>
      <div className="sidebar-scroll">
        <ul className="nav-list">
          {nav("Pano", "grid", route.page === "dashboard", () => navigate({ page: "dashboard", period: "this_month" }))}
          {nav("Gelen Kutusu", "inbox", isView("inbox"), () => goMail({ view: "inbox" }), inbox?.unread, true)}
          {nav("Yanıt Bekleyenler", "reply", route.page === "followups",
            () => navigate({ page: "followups", kind: "needs_reply", msg: null }), waiting)}
          {nav("Yapılacaklar", "tasks", route.page === "tasks", () => navigate({ page: "tasks" }), counts.tasks)}
          {nav("Asistana sor", "sparkle", route.page === "ask", () => navigate({ page: "ask", q: "" }))}
          {nav("Taslaklar", "draft", route.page === "drafts", () => navigate({ page: "drafts", draft: null }), counts.drafts)}
        </ul>
        <div className="nav-sep" />
        <ul className="nav-list">
          {nav("Tüm mailler", "all", isView("all"), () => goMail({ view: "all" }))}
          {nav("Önemli", "star", isView("important"), () => goMail({ view: "important" }))}
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
                  goMail({ view: "all", q: sv.query, ...stringify(sv.filters), smart: String(sv.id) }),
                ),
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
                onClick={go(() => goMail({ view: "all", tag_id: String(t.id) }))}>
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
