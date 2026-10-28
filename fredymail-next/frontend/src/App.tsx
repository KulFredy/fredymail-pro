import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, onUnauthorized, qs } from "./api";
import { AskPage } from "./Ask";
import { Composer } from "./Composer";
import { ContextMenuHost } from "./contextmenu";
import { Dashboard } from "./Dashboard";
import { DraftsPage } from "./Drafts";
import { FollowupsPage } from "./Followups";
import { Login } from "./Login";
import { MessageList } from "./MessageList";
import { Reader, ReaderEmpty } from "./Reader";
import { goMail, navigate, searchParams, useRoute, type Route } from "./route";
import { SettingsPage } from "./Settings";
import { Sidebar } from "./Sidebar";
import { StoreProvider, useStore } from "./store";
import { TasksPage } from "./Tasks";
import { Topbar } from "./Topbar";
import type { Facets, MessageItem, SearchResult } from "./types";
import { folderLabel, isTypingTarget } from "./util";
import { Banner, Icon, Modal, Spinner, Splitter, Toasts } from "./ui";
import { brandName } from "./brand";

type Auth = { state: "checking" } | { state: "out"; totp: boolean } | { state: "in" };

export function App() {
  const [auth, setAuth] = useState<Auth>({ state: "checking" });

  const check = useCallback(() => {
    fetch("/api/auth/me", { credentials: "same-origin" })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        setAuth(r.ok && d.authenticated ? { state: "in" } : { state: "out", totp: !!d.totp_required });
      })
      .catch(() => setAuth({ state: "out", totp: false }));
  }, []);

  useEffect(() => {
    check();
    onUnauthorized(() => setAuth((a) => (a.state === "in" ? { state: "out", totp: false } : a)));
  }, [check]);

  if (auth.state === "checking") return <div className="center-screen"><Spinner label={`${brandName()} açılıyor…`} /></div>;
  if (auth.state === "out") return <Login totpRequired={auth.totp} onDone={check} />;
  return (
    <StoreProvider>
      <Shell onLogout={() => setAuth({ state: "out", totp: false })} />
    </StoreProvider>
  );
}

function Shell({ onLogout }: { onLogout: () => void }) {
  const route = useRoute();
  const [drawer, setDrawer] = useState(false);
  const [help, setHelp] = useState(false);
  const { toasts, sync, composer, closeComposer, counts } = useStore();
  const gPending = useRef(0);

  // genel kısayollar
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector(".modal-backdrop")) return;
      const k = e.key;
      if (gPending.current) {
        window.clearTimeout(gPending.current);
        gPending.current = 0;
        const dest: Record<string, () => void> = {
          p: () => navigate({ page: "dashboard", period: "this_month" }),
          i: () => goMail({ view: "inbox" }),
          b: () => navigate({ page: "followups", kind: "needs_reply", msg: null }),
          t: () => navigate({ page: "tasks" }),
          s: () => navigate({ page: "ask", q: "" }),
        };
        if (dest[k]) {
          e.preventDefault();
          dest[k]();
          return;
        }
      }
      if (k === "/") {
        e.preventDefault();
        window.dispatchEvent(new Event("fm-focus-search"));
      } else if (k === "?") {
        setHelp(true);
      } else if (["u", "s", "z", "l", "n", "a", "r"].includes(k)) {
        const map: Record<string, string> = { u: "unread", s: "important", z: "snooze", l: "tag", n: "note", a: "ai", r: "reply" };
        window.dispatchEvent(new CustomEvent("fm-action", { detail: map[k] }));
      } else if (["j", "k", "Enter", "o", "Escape"].includes(k)) {
        window.dispatchEvent(new CustomEvent("fm-nav", { detail: k }));
      } else if (k === "g") {
        // "g" tek başına gelen kutusu; ardından p/i/b/t/s ile diğer sayfalar
        gPending.current = window.setTimeout(() => {
          gPending.current = 0;
          goMail({ view: "inbox" });
        }, 700);
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);

  useEffect(() => setDrawer(false), [route]);

  const workerDown = sync && sync.source !== "demo" && sync.sync_enabled && !sync.worker.healthy;
  const tab = route.page === "mail" ? "mail" : route.page === "followups" ? "followups" : route.page === "ask" || route.page === "dashboard" ? "ask" : "";

  return (
    <div className={`app ${drawer ? "drawer-open" : ""}`}>
      <a className="skip" href="#main">İçeriğe geç</a>
      <div className="drawer-backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />
      <Sidebar route={route} onNavigated={() => setDrawer(false)} onLogout={onLogout} />
      <Splitter target=".sidebar" cssVar="--side-w" min={200} max={380} label="Menü genişliği" />
      <div className="content">
        <Topbar route={route} onMenu={() => setDrawer(true)} />
        {workerDown && (
          <div style={{ padding: "0 16px" }}>
            <Banner kind="warn">Senkron servisi yanıt vermiyor; yeni mailler gelmeyebilir. Ayrıntı: Ayarlar & Senkron.</Banner>
          </div>
        )}
        <div className="main" id="main">
          {route.page === "mail" && <MailPage route={route} />}
          {route.page === "dashboard" && <Dashboard period={route.period} />}
          {route.page === "ask" && <AskPage q={route.q} />}
          {route.page === "followups" && <FollowupsPage kind={route.kind} msg={route.msg} />}
          {route.page === "tasks" && <TasksPage />}
          {route.page === "drafts" && <DraftsPage draftId={route.draft} />}
          {route.page === "settings" && <SettingsPage />}
        </div>
      </div>
      <nav className="bottom-tabs" aria-label="Alt gezinti">
        <button className={tab === "mail" ? "on" : ""} onClick={() => goMail({ view: "inbox" })}>
          <span className="icon-wrap"><Icon name="inbox" size={22} /></span> Posta
        </button>
        <button onClick={() => { if (route.page !== "mail") goMail({ view: "all" }); window.setTimeout(() => window.dispatchEvent(new Event("fm-focus-search")), 30); }}>
          <span className="icon-wrap"><Icon name="search" size={22} /></span> Ara
        </button>
        <button className={tab === "followups" ? "on" : ""} onClick={() => navigate({ page: "followups", kind: "needs_reply", msg: null })}>
          <span className="icon-wrap"><Icon name="reply" size={22} />{counts.needs_reply + counts.awaiting > 0 && <span className="dotn" />}</span> Bekleyenler
        </button>
        <button className={tab === "ask" ? "on" : ""} onClick={() => navigate({ page: "ask", q: "" })}>
          <span className="icon-wrap"><Icon name="sparkle" size={22} /></span> Asistan
        </button>
      </nav>
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      {composer && <Composer init={composer} onClose={closeComposer} />}
      <Toasts items={toasts} />
      <ContextMenuHost />
    </div>
  );
}

const VIEW_TITLES: Record<string, string> = {
  inbox: "Gelen Kutusu", all: "Tüm mailler", unread: "Okunmamış", important: "Önemli", sent: "Gönderilen", snoozed: "Ertelenenler",
};

/** j/k/Enter/Esc ile liste gezintisi */
function useListNav(ids: number[], selected: number | null, open: (id: number | null) => void) {
  const ref = useRef({ ids, selected, open });
  ref.current = { ids, selected, open };
  useEffect(() => {
    const on = (e: Event) => {
      const k = (e as CustomEvent<string>).detail;
      const { ids, selected, open } = ref.current;
      if (!ids.length) return;
      const i = selected ? ids.indexOf(selected) : -1;
      if (k === "j") open(ids[Math.min(i + 1, ids.length - 1)]);
      if (k === "k") open(ids[Math.max(i - 1, 0)]);
      if ((k === "Enter" || k === "o") && i < 0) open(ids[0]);
      if (k === "Escape") {
        if (document.querySelector(".menu")) window.dispatchEvent(new CustomEvent("fm-action", { detail: "close-menu" }));
        else if (selected) open(null);
      }
    };
    window.addEventListener("fm-nav", on);
    return () => window.removeEventListener("fm-nav", on);
  }, []);
}

function MailPage({ route }: { route: Extract<Route, { page: "mail" }> }) {
  const { folders, saved, tags, meta, refreshFolders } = useStore();
  const [res, setRes] = useState<SearchResult | null>(null);
  const [facets, setFacets] = useState<Facets | undefined>(undefined);
  const [items, setItems] = useState<MessageItem[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const key = JSON.stringify(route.search);
  const reqId = useRef(0);

  const load = useCallback(async (pg: number) => {
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    try {
      const r = await api.get<SearchResult>(`/api/search${qs(searchParams(route.search, pg))}`);
      if (id !== reqId.current) return;
      setRes(r);
      if (pg === 1) setFacets(r.facets);
      setItems((prev) => (pg === 1 ? r.items : [...prev, ...r.items.filter((x) => !prev.some((p) => p.id === x.id))]));
      setPage(pg);
    } catch (e) {
      if (id === reqId.current) setError((e as ApiError).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    load(1);
    const again = () => load(1);  // sağ tık menüsünden "tümünü okundu işaretle" sonrası liste tazelenir
    window.addEventListener("fm-refresh-list", again);
    return () => window.removeEventListener("fm-refresh-list", again);
  }, [load]);

  const open = (id: number | null) => navigate({ ...route, msg: id }, true);
  const ids = items.map((i) => i.id);
  useListNav(ids, route.msg, open);
  const idx = route.msg ? ids.indexOf(route.msg) : -1;

  const s = route.search;
  let title = VIEW_TITLES[s.view] ?? "Mailler";
  let subtitle: string | undefined;
  if (s.smart) title = saved.find((x) => String(x.id) === s.smart)?.name ?? "Akıllı klasör";
  else if (s.folder_id) {
    const f = folders.find((x) => String(x.id) === s.folder_id);
    title = f ? folderLabel(f) : "Klasör";
    subtitle = f && f.name !== title ? f.name : undefined;
  } else if (s.tag_id) title = tags.find((t) => String(t.id) === s.tag_id)?.name ?? "Etiket";
  else if (s.doc_kind && !s.q) title = meta?.doc_kinds[s.doc_kind] ?? "Belgeler";
  else if (s.sender && !s.q) title = s.sender;
  if (s.q) {
    subtitle = `“${s.q}”${res?.engine === "meilisearch" && res.processing_ms != null ? ` · ${res.processing_ms} ms` : ""}`;
    if (!s.smart) title = "Arama sonuçları";
  }
  if (s.smart) subtitle = "Akıllı klasör · sunucudaki klasörlere dokunmaz";

  const notice = res?.degraded ? res.notice ?? "Arama motoru kullanılamıyor; basit arama sonuçları gösteriliyor." : null;
  const update = (u: MessageItem) => {
    setItems((list) => list.map((x) => (x.id === u.id ? { ...x, ...u } : x)));
    if ((s.view === "unread" && u.is_read) || (s.view === "inbox" && u.snoozed_until)) refreshFolders();
  };

  return (
    <div className={`mail-page ${route.msg ? "has-detail" : ""}`}>
      <Splitter target=".list-pane" cssVar="--list-w" min={300} max={900} label="Liste genişliği" />
      <MessageList
        title={title}
        subtitle={subtitle}
        items={items}
        total={res?.total ?? 0}
        loading={loading}
        error={error}
        notice={notice}
        selectedId={route.msg}
        search={s}
        facets={facets}
        onSelect={(id) => navigate({ ...route, msg: id }, !!route.msg)}
        onUpdated={update}
        onLoadMore={() => load(page + 1)}
        onRetry={() => load(1)}
        emptyTitle={s.q ? "Sonuç bulunamadı" : "Burada mail yok"}
        emptyText={s.q ? "Farklı kelimeler deneyin veya filtreleri gevşetin. Türkçe/İngilizce eş anlamlılar (fatura ↔ invoice) otomatik aranır." : undefined}
      />
      {route.msg ? (
        <Reader
          key={route.msg}
          msgId={route.msg}
          onBack={() => navigate({ ...route, msg: null })}
          onChanged={update}
          onOpenMessage={(id) => navigate({ ...route, msg: id })}
          onPrev={idx > 0 ? () => open(ids[idx - 1]) : null}
          onNext={idx >= 0 && idx < ids.length - 1 ? () => open(ids[idx + 1]) : null}
        />
      ) : (
        <ReaderEmpty />
      )}
    </div>
  );
}

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["/", "Aramaya / soruya odaklan"],
    ["j / k", "Sonraki / önceki mail"],
    ["Enter / o", "Seçili maili aç"],
    ["Esc", "Menüyü kapat / listeye dön"],
    ["r", "Yanıt taslağı (AI kapalıysa boş yanıt)"],
    ["a", "Yapay zekâ ile analiz et"],
    ["u", "Okundu ↔ okunmadı"],
    ["s", "Önemli olarak işaretle"],
    ["z", "Ertele menüsü"],
    ["l", "Etiket menüsü"],
    ["n", "Not ekle"],
    ["g", "Gelen kutusu"],
    ["g p · g b · g t · g s", "Pano · Bekleyenler · Yapılacaklar · Sor"],
    ["?", "Bu yardım"],
  ];
  return (
    <Modal title="Klavye kısayolları" onClose={onClose}>
      <table className="table shortcuts">
        <tbody>
          {rows.map(([k, d]) => (
            <tr key={k}><td>{k.split(" · ").map((x) => <kbd key={x} style={{ marginRight: 4 }}>{x}</kbd>)}</td><td>{d}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Bir metin kutusuna yazarken kısayollar devre dışıdır.</p>
    </Modal>
  );
}

