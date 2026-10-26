import { useEffect, useRef, useState, type FormEvent } from "react";
import { api } from "./api";
import { EMPTY_SEARCH, hasFilters, navigate, type Route, type SearchState } from "./route";
import { useStore } from "./store";
import { folderLabel, fmtRelative, initials, isQuestion } from "./util";
import { Icon, Logo } from "./ui";

function useContacts(q: string) {
  const [list, setList] = useState<{ email: string; name: string }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) {
      setList([]);
      return;
    }
    const t = window.setTimeout(() => {
      api.get<{ email: string; name: string }[]>(`/api/contacts?q=${encodeURIComponent(q.trim())}`).then(setList).catch(() => setList([]));
    }, 200);
    return () => window.clearTimeout(t);
  }, [q]);
  return list;
}

export function Topbar({ route, onMenu }: { route: Route; onMenu: () => void }) {
  const cur = route.page === "mail" ? route.search : route.page === "ask" ? { ...EMPTY_SEARCH, q: route.q } : EMPTY_SEARCH;
  const [q, setQ] = useState(cur.q);
  const [open, setOpen] = useState(false);
  const [searchMode, setSearchMode] = useState(false);
  const [draft, setDraft] = useState<SearchState>(cur);
  const inputRef = useRef<HTMLInputElement>(null);
  const { meta, tags, folders, sync } = useStore();
  const senders = useContacts(open ? draft.sender : "");
  const rcpts = useContacts(open ? draft.recipient : "");
  const curKey = JSON.stringify(cur);

  useEffect(() => {
    setQ(cur.q);
    setDraft(cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curKey]);

  useEffect(() => {
    const focus = () => {
      setSearchMode(true);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    };
    window.addEventListener("fm-focus-search", focus);
    return () => window.removeEventListener("fm-focus-search", focus);
  }, []);

  function apply(next: SearchState) {
    const view = next.view === "inbox" && (next.q || hasFilters(next)) ? "all" : next.view;
    navigate({ page: "mail", search: { ...next, view, smart: "" }, msg: null });
  }

  function go(mode?: "search" | "ask") {
    const text = q.trim();
    setOpen(false);
    inputRef.current?.blur();
    if (mode === "ask" || (!mode && isQuestion(text))) {
      if (text) navigate({ page: "ask", q: text });
      else navigate({ page: "ask", q: "" });
      return;
    }
    // yeni arama temiz başlar; gelişmiş filtre paneli açıksa oradaki seçimler kullanılır
    apply({ ...(open ? draft : { ...EMPTY_SEARCH, view: "all" }), q: text });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    go();
  }

  const looksAsk = isQuestion(q);
  const set = (k: keyof SearchState) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  const running = sync?.runs.find((r) => r.status === "running");
  const last = sync?.runs.find((r) => r.finished_at)?.finished_at ?? sync?.worker.at ?? null;
  const bad = !!sync && sync.source !== "demo" && sync.sync_enabled && !sync.worker.healthy;
  const me = meta?.account ?? "";

  return (
    <header className={`topbar ${searchMode ? "search-mode" : ""}`}>
      <button type="button" className="icon-btn only-mobile" onClick={onMenu} aria-label="Menüyü aç">
        <Icon name="menu" />
      </button>
      <a className="mobile-brand" href="#/pano"><Logo size={30} /> FredyMail</a>
      <form className="omni" role="search" onSubmit={submit}>
        <Icon name={looksAsk ? "sparkle" : "search"} size={19} />
        <input
          ref={inputRef}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Mail ara veya soru sor… (ör. bu ay en çok kimden mail aldım?)"
          aria-label="Postalarda ara veya asistana sor"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              (e.target as HTMLInputElement).blur();
              setSearchMode(false);
            }
          }}
          onBlur={() => window.setTimeout(() => !q && setSearchMode(false), 150)}
        />
        {looksAsk && <span className="ask-hint hide-mobile"><Icon name="sparkle" size={12} /> Soru · Enter ile sor</span>}
        {q && (
          <button type="button" className="icon-btn sm" aria-label="Temizle" onClick={() => { setQ(""); if (route.page === "mail" && cur.q) apply({ ...cur, q: "" }); inputRef.current?.focus(); }}>
            <Icon name="close" size={14} />
          </button>
        )}
        <button type="button" className={`icon-btn sm ${open ? "on" : ""}`} onClick={() => { setDraft({ ...(route.page === "mail" ? cur : { ...EMPTY_SEARCH, view: "all" }), q }); setOpen((o) => !o); }}
          aria-expanded={open} aria-controls="filters" title="Gelişmiş filtreler" aria-label="Gelişmiş filtreler">
          <Icon name="filter" size={16} />
        </button>
        <button type="button" className="btn sm ghost hide-mobile" onClick={() => go("search")}>Ara</button>
        <button type="button" className="btn sm soft" onClick={() => go("ask")}><Icon name="sparkle" size={14} /> Sor</button>
      </form>

      <div className="topbar-right">
        <button className="icon-btn only-mobile" onClick={() => { setSearchMode(true); window.setTimeout(() => inputRef.current?.focus(), 0); }} aria-label="Ara">
          <Icon name="search" />
        </button>
        {sync && (
          <button className="sync-ind link" onClick={() => navigate({ page: "settings" })} title="Senkron ayrıntıları" style={{ color: "inherit", fontWeight: 400 }}>
            <span className={`dot ${running ? "busy" : bad ? "bad" : ""}`} />
            <span className="txt" style={{ textAlign: "left" }}>
              <b>{bad ? "Senkron gecikiyor" : running ? "Senkronize ediliyor…" : sync.source === "demo" ? "Demo verisi" : "Senkronize"}</b>
              <span>{last ? fmtRelative(last) : "henüz yok"}</span>
            </span>
          </button>
        )}
        <button className="icon-btn hide-mobile" onClick={() => navigate({ page: "settings" })} aria-label="Ayarlar" title="Ayarlar">
          <Icon name="settings" size={20} />
        </button>
        <button className="me" title={me} aria-label={`Hesap: ${me}`} onClick={() => navigate({ page: "settings" })}>
          {initials("", me.split("@")[0] || "?")}
        </button>
      </div>

      {open && (
        <form id="filters" className="filters-pop" onSubmit={submit} aria-label="Gelişmiş filtreler">
          <label className="field">
            <span>Gönderen</span>
            <input list="dl-senders" value={draft.sender} onChange={set("sender")} placeholder="ad, e-posta veya @firma.com" />
            <datalist id="dl-senders">
              {senders.map((c) => <option key={c.email} value={c.email}>{c.name}</option>)}
            </datalist>
          </label>
          <label className="field">
            <span>Alıcı</span>
            <input list="dl-rcpts" value={draft.recipient} onChange={set("recipient")} placeholder="ad veya e-posta" />
            <datalist id="dl-rcpts">
              {rcpts.map((c) => <option key={c.email} value={c.email}>{c.name}</option>)}
            </datalist>
          </label>
          <label className="field">
            <span>Başlangıç tarihi</span>
            <input type="date" value={draft.date_from} onChange={set("date_from")} />
          </label>
          <label className="field">
            <span>Bitiş tarihi</span>
            <input type="date" value={draft.date_to} onChange={set("date_to")} />
          </label>
          <label className="field">
            <span>Belge türü</span>
            <select value={draft.doc_kind} onChange={set("doc_kind")}>
              <option value="">Hepsi</option>
              {Object.entries(meta?.doc_kinds ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Dosya türü</span>
            <select value={draft.file_kind} onChange={set("file_kind")}>
              <option value="">Hepsi</option>
              {Object.entries(meta?.file_kinds ?? {}).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Ek</span>
            <select value={draft.has_attachment} onChange={set("has_attachment")}>
              <option value="">Fark etmez</option>
              <option value="true">Ekli</option>
              <option value="false">Eksiz</option>
            </select>
          </label>
          <label className="field">
            <span>Klasör</span>
            <select value={draft.folder_id} onChange={set("folder_id")}>
              <option value="">Hepsi</option>
              {folders.filter((f) => f.count > 0).map((f) => (
                <option key={f.id} value={f.id}>{f.origin === "import" ? `Outlook / ${f.display_name}` : folderLabel(f)}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Etiket</span>
            <select value={draft.tag_id} onChange={set("tag_id")}>
              <option value="">Hepsi</option>
              {tags.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          <div className="field">
            <span>Durum</span>
            <label className="check">
              <input type="checkbox" checked={draft.unread === "true"} onChange={(e) => setDraft((d) => ({ ...d, unread: e.target.checked ? "true" : "" }))} />
              Yalnızca okunmamış
            </label>
            <label className="check">
              <input type="checkbox" checked={draft.important === "true"} onChange={(e) => setDraft((d) => ({ ...d, important: e.target.checked ? "true" : "" }))} />
              Yalnızca önemli
            </label>
          </div>
          <div className="filters-actions">
            <button type="button" className="btn ghost" onClick={() => setDraft({ ...EMPTY_SEARCH, view: "all", q })}>Sıfırla</button>
            <button type="button" className="btn ghost" onClick={() => setOpen(false)}>Kapat</button>
            <button className="btn primary">Uygula</button>
          </div>
        </form>
      )}
    </header>
  );
}
