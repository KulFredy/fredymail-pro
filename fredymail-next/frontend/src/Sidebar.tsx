import { useMemo } from "react";
import { api } from "./api";
import { EMPTY_SEARCH, navigate, type Route, type SearchState } from "./route";
import { useStore } from "./store";
import type { Folder } from "./types";
import { folderLabel } from "./util";
import { Icon } from "./ui";

interface Props {
  route: Route;
  onNavigated: () => void;
  onLogout: () => void;
}

function goMail(patch: Partial<SearchState>) {
  navigate({ page: "mail", search: { ...EMPTY_SEARCH, ...patch }, msg: null });
}

export function Sidebar({ route, onNavigated, onLogout }: Props) {
  const { folders, tags, saved, counts, meta } = useStore();
  const s = route.page === "mail" ? route.search : null;
  const isView = (v: string) => s !== null && s.view === v && !s.folder_id && !s.tag_id && !s.smart && !s.q && !s.doc_kind && !s.file_kind;

  const tree = useMemo(() => buildTree(folders), [folders]);
  const go = (fn: () => void) => () => {
    fn();
    onNavigated();
  };

  const nav = (label: string, icon: string, active: boolean, onClick: () => void, badge?: number, badgeKind = "") => (
    <li>
      <button className={`nav-item ${active ? "active" : ""}`} onClick={go(onClick)} aria-current={active ? "page" : undefined}>
        <Icon name={icon} size={17} />
        <span className="nav-label">{label}</span>
        {badge ? <span className={`badge ${badgeKind}`}>{badge}</span> : null}
      </button>
    </li>
  );

  const inboxUnread = folders.find((f) => f.role === "inbox")?.unread ?? 0;

  return (
    <nav className="sidebar" aria-label="Posta gezintisi">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="unread" size={18} />
        </span>
        <span>FredyMail</span>
      </div>
      <div className="sidebar-scroll">
        <ul className="nav-list">
          {nav("Gelen Kutusu", "inbox", isView("inbox"), () => goMail({ view: "inbox" }), inboxUnread)}
          {nav("Tümü", "all", isView("all"), () => goMail({ view: "all" }))}
          {nav("Okunmamış", "unread", isView("unread"), () => goMail({ view: "unread" }))}
          {nav("Önemli", "star", isView("important"), () => goMail({ view: "important" }))}
          {nav("Gönderilen", "sent", isView("sent"), () => goMail({ view: "sent" }))}
          {nav("Ertelenenler", "clock", isView("snoozed"), () => goMail({ view: "snoozed" }))}
        </ul>
        <div className="nav-section">Takip</div>
        <ul className="nav-list">
          {nav("Yanıtlamam gerekenler", "reply", route.page === "followups" && route.kind === "needs_reply",
            () => navigate({ page: "followups", kind: "needs_reply", msg: null }), counts.needs_reply, "warn")}
          {nav("Yanıt bekliyorum", "hourglass", route.page === "followups" && route.kind === "awaiting",
            () => navigate({ page: "followups", kind: "awaiting", msg: null }), counts.awaiting)}
          {nav("Taslaklar", "draft", route.page === "drafts", () => navigate({ page: "drafts", draft: null }), counts.drafts)}
        </ul>

        {saved.length > 0 && (
          <>
            <div className="nav-section">Akıllı klasörler</div>
            <ul className="nav-list">
              {saved.map((sv) =>
                nav(sv.name, "smart", s?.smart === String(sv.id), () =>
                  goMail({ view: "all", q: sv.query, ...stringify(sv.filters), smart: String(sv.id) }),
                ),
              )}
            </ul>
          </>
        )}

        {tree.server.length > 0 && (
          <>
            <div className="nav-section">Klasörler</div>
            <ul className="nav-list">{tree.server.map((n) => folderItem(n))}</ul>
          </>
        )}
        {tree.imported.length > 0 && (
          <>
            <div className="nav-section">Outlook arşivi</div>
            <ul className="nav-list">{tree.imported.map((n) => folderItem(n))}</ul>
          </>
        )}

        {tags.length > 0 && (
          <>
            <div className="nav-section">Etiketler</div>
            <ul className="nav-list">
              {tags.map((t) => (
                <li key={t.id}>
                  <button
                    className={`nav-item ${s?.tag_id === String(t.id) ? "active" : ""}`}
                    onClick={go(() => goMail({ view: "all", tag_id: String(t.id) }))}
                  >
                    <span className="tag-dot" style={{ background: t.color }} />
                    <span className="nav-label">{t.name}</span>
                    {t.count ? <span className="badge subtle">{t.count}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="sidebar-foot">
        <button className={`nav-item ${route.page === "settings" ? "active" : ""}`} onClick={go(() => navigate({ page: "settings" }))}>
          <Icon name="settings" size={17} />
          <span className="nav-label">Ayarlar & Senkron</span>
        </button>
        <button
          className="nav-item"
          onClick={async () => {
            await api.post("/api/auth/logout").catch(() => undefined);
            onLogout();
          }}
        >
          <Icon name="logout" size={17} />
          <span className="nav-label">Çıkış</span>
        </button>
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
          style={{ paddingLeft: 12 + n.depth * 14 }}
          onClick={go(() => goMail({ view: "folder", folder_id: String(f.id) }))}
          title={f.name}
        >
          <Icon name={f.role === "archive" ? "archive" : f.role === "sent" ? "sent" : f.role === "inbox" ? "inbox" : "folder"} size={16} />
          <span className="nav-label">{folderLabel(f)}</span>
          {f.status === "error" && <Icon name="warn" size={14} className="text-danger" title="Senkron hatası" />}
          {f.unread ? <span className="badge subtle">{f.unread}</span> : null}
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

function buildTree(folders: Folder[]): { server: TreeNode[]; imported: TreeNode[] } {
  const visible = folders.filter((f) => f.sync_enabled || f.count > 0);
  const byName = new Map(visible.map((f) => [f.name, f]));
  const depthOf = (f: Folder): number => {
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
