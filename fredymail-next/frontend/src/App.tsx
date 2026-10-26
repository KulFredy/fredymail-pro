import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, onUnauthorized, qs } from "./api";
import { DraftsPage } from "./Drafts";
import { Login } from "./Login";
import { MessageList, type ListRow } from "./MessageList";
import { Reader, ReaderEmpty } from "./Reader";
import { navigate, searchParams, useRoute, type Route, type SearchState } from "./route";
import { SearchBar } from "./SearchBar";
import { SettingsPage } from "./Settings";
import { Sidebar } from "./Sidebar";
import { StoreProvider, useStore } from "./store";
import type { FollowupItem, MessageItem, SearchResult } from "./types";
import { folderLabel, isTypingTarget } from "./util";
import { Banner, Modal, Spinner, Toasts } from "./ui";

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

  if (auth.state === "checking") return <div className="center-screen"><Spinner label="FredyMail açılıyor…" /></div>;
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
  const { toasts, sync } = useStore();

  // genel kısayollar
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      if (document.querySelector(".modal-backdrop")) return;
      const k = e.key;
      if (k === "/") {
        e.preventDefault();
        if (route.page !== "mail") navigate({ page: "mail", search: { ...emptyAll() }, msg: null });
        window.setTimeout(() => window.dispatchEvent(new Event("fm-focus-search")), 0);
      } else if (k === "?") {
        setHelp(true);
      } else if (["u", "s", "z", "l", "n", "a"].includes(k)) {
        const map: Record<string, string> = { u: "unread", s: "important", z: "snooze", l: "tag", n: "note", a: "ai" };
        window.dispatchEvent(new CustomEvent("fm-action", { detail: map[k] }));
      } else if (["j", "k", "Enter", "o", "Escape"].includes(k)) {
        window.dispatchEvent(new CustomEvent("fm-nav", { detail: k }));
      } else if (k === "g") {
        navigate({ page: "mail", search: { ...emptyAll(), view: "inbox" }, msg: null });
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [route.page]);

  const workerDown = sync && sync.source !== "demo" && sync.sync_enabled && !sync.worker.healthy;
  const onMenu = () => setDrawer(true);

  return (
    <div className={`app ${drawer ? "drawer-open" : ""}`}>
      <a className="skip" href="#main">İçeriğe geç</a>
      <div className="drawer-backdrop" onClick={() => setDrawer(false)} aria-hidden="true" />
      <Sidebar route={route} onNavigated={() => setDrawer(false)} onLogout={onLogout} />
      <div className="content" id="main">
        {workerDown && (
          <Banner kind="warn">Senkron servisi yanıt vermiyor; yeni mailler gelmeyebilir. Ayrıntı: Ayarlar & Senkron.</Banner>
        )}
        {route.page === "mail" && <MailPage route={route} onMenu={onMenu} />}
        {route.page === "followups" && <FollowupsPage route={route} onMenu={onMenu} />}
        {route.page === "drafts" && <DraftsPage draftId={route.draft} onMenu={onMenu} />}
        {route.page === "settings" && <SettingsPage onMenu={onMenu} />}
      </div>
      {help && <ShortcutHelp onClose={() => setHelp(false)} />}
      <Toasts items={toasts} />
    </div>
  );
}

function emptyAll(): SearchState {
  return { q: "", view: "all", folder_id: "", sender: "", recipient: "", date_from: "", date_to: "", has_attachment: "",
    file_kind: "", doc_kind: "", tag_id: "", unread: "", important: "", sort: "", smart: "" };
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

function MailPage({ route, onMenu }: { route: Extract<Route, { page: "mail" }>; onMenu: () => void }) {
  const { folders, saved, tags, meta, refreshFolders } = useStore();
  const [res, setRes] = useState<SearchResult | null>(null);
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
  }, [load]);

  const open = (id: number | null) => navigate({ ...route, msg: id }, true);
  useListNav(items.map((i) => i.id), route.msg, open);

  const s = route.search;
  let title = VIEW_TITLES[s.view] ?? "Mailler";
  let subtitle: string | undefined;
  if (s.smart) title = saved.find((x) => String(x.id) === s.smart)?.name ?? "Akıllı klasör";
  else if (s.folder_id) {
    const f = folders.find((x) => String(x.id) === s.folder_id);
    title = f ? folderLabel(f) : "Klasör";
    subtitle = f && f.name !== title ? f.name : undefined;
  } else if (s.tag_id) title = `Etiket: ${tags.find((t) => String(t.id) === s.tag_id)?.name ?? ""}`;
  else if (s.doc_kind && !s.q) title = meta?.doc_kinds[s.doc_kind] ?? "Belgeler";
  if (s.q) {
    subtitle = `“${s.q}” için sonuçlar${res?.engine === "meilisearch" && res.processing_ms != null ? ` · ${res.processing_ms} ms` : ""}`;
    if (!s.smart) title = "Arama";
  }
  if (s.smart) subtitle = "Akıllı klasör · sunucudaki klasörlere dokunmaz";

  const notice = res?.degraded ? res.notice ?? "Arama motoru kullanılamıyor; basit arama sonuçları gösteriliyor." : null;

  return (
    <div className={`mail-page ${route.msg ? "has-detail" : ""}`}>
      <SearchBar search={s} onMenu={onMenu} />
      <div className="panes">
        <MessageList
          title={title}
          subtitle={subtitle}
          items={items}
          total={res?.total ?? 0}
          loading={loading}
          error={error}
          notice={notice}
          selectedId={route.msg}
          onSelect={(id) => navigate({ ...route, msg: id }, !!route.msg)}
          onLoadMore={() => load(page + 1)}
          onRetry={() => load(1)}
          emptyTitle={s.q ? "Sonuç bulunamadı" : "Burada mail yok"}
          emptyText={s.q ? "Farklı kelimeler deneyin veya filtreleri gevşetin. Türkçe/İngilizce eş anlamlılar (fatura ↔ invoice) otomatik aranır." : undefined}
        />
        {route.msg ? (
          <Reader
            key={route.msg}
            msgId={route.msg}
            search={s.q || s.doc_kind || s.sender ? s : null}
            onBack={() => navigate({ ...route, msg: null })}
            onChanged={(u) => {
              setItems((list) => list.map((x) => (x.id === u.id ? u : x)));
              if ((s.view === "unread" && u.is_read) || (s.view === "inbox" && u.snoozed_until)) refreshFolders();
            }}
            onOpenMessage={(id) => navigate({ ...route, msg: id })}
          />
        ) : (
          <ReaderEmpty />
        )}
      </div>
    </div>
  );
}

function FollowupsPage({ route, onMenu }: { route: Extract<Route, { page: "followups" }>; onMenu: () => void }) {
  const [items, setItems] = useState<(ListRow & { _thread: number })[]>([]);
  const [days, setDays] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { refreshCounts } = useStore();

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    api.get<{ days: number; items: FollowupItem[] }>(`/api/followups?kind=${route.kind}`)
      .then((r) => {
        setDays(r.days);
        setItems(r.items.map((f) => ({ ...f.last_message, days_waiting: f.days_waiting, thread_count: f.message_count, _thread: f.thread_id })));
      })
      .catch((e: ApiError) => setError(e.message))
      .finally(() => setLoading(false));
  }, [route.kind]);
  useEffect(load, [load]);

  const open = (id: number | null) => navigate({ ...route, msg: id }, true);
  useListNav(items.map((i) => i.id), route.msg, open);
  const sel = items.find((i) => i.id === route.msg);
  const needs = route.kind === "needs_reply";

  return (
    <div className={`mail-page ${route.msg ? "has-detail" : ""}`}>
      <SearchBar search={null} onMenu={onMenu} />
      <div className="panes">
        <MessageList
          title={needs ? "Yanıtlamam gerekenler" : "Yanıt bekliyorum"}
          subtitle={needs
            ? `Bir kişinin yazdığı, ${days}+ gündür yanıtlamadığınız yazışmalar (bültenler ve Outlook'ta yanıtlananlar hariç)`
            : `Sizin yazdığınız, ${days}+ gündür karşı tarafın yanıt vermediği yazışmalar`}
          items={items}
          total={items.length}
          loading={loading}
          error={error}
          selectedId={route.msg}
          onSelect={(id) => navigate({ ...route, msg: id }, !!route.msg)}
          onRetry={load}
          emptyTitle={needs ? "Bekleyen yanıt yok 🎉" : "Yanıt beklenen yazışma yok"}
          waitingLabel={needs ? "yanıt bekliyor" : "yanıt gelmedi"}
        />
        {route.msg ? (
          <Reader
            key={route.msg}
            msgId={route.msg}
            search={null}
            followupThreadId={sel?._thread ?? null}
            onBack={() => navigate({ ...route, msg: null })}
            onChanged={(u) => setItems((list) => list.map((x) => (x.id === u.id ? { ...x, ...u } : x)))}
            onOpenMessage={(id) => navigate({ page: "mail", search: emptyAll(), msg: id })}
            onDismissed={() => {
              setItems((l) => l.filter((x) => x.id !== route.msg));
              refreshCounts();
              navigate({ ...route, msg: null });
            }}
          />
        ) : (
          <ReaderEmpty />
        )}
      </div>
    </div>
  );
}

function ShortcutHelp({ onClose }: { onClose: () => void }) {
  const rows: [string, string][] = [
    ["/", "Aramaya odaklan"],
    ["j / k", "Sonraki / önceki mail"],
    ["Enter / o", "Seçili maili aç"],
    ["Esc", "Menüyü kapat / listeye dön"],
    ["u", "Okundu ↔ okunmadı"],
    ["s", "Önemli olarak işaretle"],
    ["z", "Ertele menüsü"],
    ["l", "Etiket menüsü"],
    ["n", "Not ekle"],
    ["a", "AI ile özetle"],
    ["g", "Gelen kutusuna git"],
    ["?", "Bu yardım"],
  ];
  return (
    <Modal title="Klavye kısayolları" onClose={onClose}>
      <table className="table shortcuts">
        <tbody>
          {rows.map(([k, d]) => (
            <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Bir metin kutusuna yazarken kısayollar devre dışıdır.</p>
    </Modal>
  );
}
