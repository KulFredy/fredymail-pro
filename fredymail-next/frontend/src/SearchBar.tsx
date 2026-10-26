import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { EMPTY_SEARCH, hasFilters, navigate, type SearchState } from "./route";
import { useStore } from "./store";
import { folderLabel } from "./util";
import { Icon } from "./ui";

const SORTS: Record<string, string> = { "": "Varsayılan", relevance: "Alaka", date_desc: "Yeni → eski", date_asc: "Eski → yeni" };
const VIEW_LABEL: Record<string, string> = {
  inbox: "Gelen Kutusu", all: "Tümü", unread: "Okunmamış", important: "Önemli", sent: "Gönderilen", snoozed: "Ertelenenler",
};

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

export function SearchBar({ search, onMenu }: { search: SearchState | null; onMenu: () => void }) {
  const cur = search ?? EMPTY_SEARCH;
  const [q, setQ] = useState(cur.q);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<SearchState>(cur);
  const inputRef = useRef<HTMLInputElement>(null);
  const { meta, tags, folders, refreshSaved, toast } = useStore();
  const senders = useContacts(draft.sender);
  const rcpts = useContacts(draft.recipient);

  useEffect(() => {
    setQ(cur.q);
    setDraft(cur);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search && JSON.stringify(search)]);

  useEffect(() => {
    const focus = () => inputRef.current?.focus();
    window.addEventListener("fm-focus-search", focus);
    return () => window.removeEventListener("fm-focus-search", focus);
  }, []);

  function apply(next: SearchState) {
    const view = next.view === "inbox" && (next.q || hasFilters(next)) ? "all" : next.view;
    navigate({ page: "mail", search: { ...next, view, smart: "" }, msg: null });
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    apply({ ...(open ? draft : cur), q });
    setOpen(false);
    inputRef.current?.blur();
  }

  async function saveSmart() {
    const name = window.prompt("Akıllı klasör adı:", cur.q || "Yeni akıllı klasör");
    if (!name) return;
    const filters: Record<string, string> = {};
    for (const k of ["view", "folder_id", "sender", "recipient", "date_from", "date_to", "has_attachment", "file_kind", "doc_kind", "tag_id", "unread", "important", "sort"] as const) {
      if (cur[k] && !(k === "view" && (cur[k] === "all" || cur[k] === "folder"))) filters[k] = cur[k];
    }
    try {
      await api.post("/api/saved-searches", { name, query: cur.q, filters });
      refreshSaved();
      toast("Akıllı klasör kaydedildi. Sunucudaki klasörleriniz değişmedi.", "ok");
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }

  const chips: { key: keyof SearchState; label: string }[] = [];
  const add = (key: keyof SearchState, label: string) => cur[key] && chips.push({ key, label });
  if (search) {
    if (cur.view && !["inbox", "all", "folder"].includes(cur.view)) chips.push({ key: "view", label: VIEW_LABEL[cur.view] ?? cur.view });
    if (cur.folder_id) {
      const f = folders.find((x) => String(x.id) === cur.folder_id);
      chips.push({ key: "folder_id", label: `Klasör: ${f ? folderLabel(f) : cur.folder_id}` });
    }
    add("sender", `Gönderen: ${cur.sender}`);
    add("recipient", `Alıcı: ${cur.recipient}`);
    add("date_from", `Başlangıç: ${cur.date_from}`);
    add("date_to", `Bitiş: ${cur.date_to}`);
    if (cur.has_attachment) chips.push({ key: "has_attachment", label: cur.has_attachment === "true" ? "Ekli" : "Eksiz" });
    add("file_kind", `Dosya: ${meta?.file_kinds[cur.file_kind] ?? cur.file_kind}`);
    add("doc_kind", meta?.doc_kinds[cur.doc_kind] ?? cur.doc_kind);
    if (cur.tag_id) chips.push({ key: "tag_id", label: `Etiket: ${tags.find((t) => String(t.id) === cur.tag_id)?.name ?? cur.tag_id}` });
    if (cur.unread) chips.push({ key: "unread", label: "Okunmamış" });
    if (cur.important) chips.push({ key: "important", label: "Önemli" });
    if (cur.sort) chips.push({ key: "sort", label: `Sıralama: ${SORTS[cur.sort]}` });
  }

  const set = (k: keyof SearchState) => (e: { target: { value: string } }) => setDraft((d) => ({ ...d, [k]: e.target.value }));

  return (
    <div className="searchbar-wrap">
      <form className="searchbar" role="search" onSubmit={submit}>
        <button type="button" className="icon-btn only-mobile" onClick={onMenu} aria-label="Menüyü aç">
          <Icon name="menu" />
        </button>
        <div className="search-input">
          <Icon name="search" size={17} />
          <input
            ref={inputRef}
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Mail, kişi, fatura, fiyat listesi ara…  ( / )"
            aria-label="Postalarda ara"
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {q && (
            <button type="button" className="icon-btn sm" aria-label="Aramayı temizle" onClick={() => { setQ(""); apply({ ...cur, q: "" }); }}>
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
        <button type="button" className={`btn ghost ${open ? "on" : ""}`} onClick={() => { setDraft({ ...cur, q }); setOpen((o) => !o); }} aria-expanded={open} aria-controls="filters">
          <Icon name="filter" size={16} />
          <span className="hide-sm">Filtreler</span>
        </button>
        <button className="btn primary hide-sm">Ara</button>
      </form>

      {chips.length > 0 && (
        <div className="chips" aria-label="Etkin filtreler">
          {chips.map((c) => (
            <button key={c.key} className="chip" onClick={() => apply({ ...cur, [c.key]: c.key === "view" ? "all" : "" })} aria-label={`${c.label} filtresini kaldır`}>
              {c.label}
              <Icon name="close" size={12} />
            </button>
          ))}
          <button className="chip ghost" onClick={() => apply({ ...EMPTY_SEARCH, view: "all", q: cur.q })}>Hepsini temizle</button>
          {(cur.q || chips.length > 0) && (
            <button className="chip ghost" onClick={saveSmart}>
              <Icon name="plus" size={12} /> Akıllı klasör olarak kaydet
            </button>
          )}
        </div>
      )}

      {open && (
        <form id="filters" className="filters" onSubmit={submit}>
          <label className="field">
            <span>Gönderen</span>
            <input list="dl-senders" value={draft.sender} onChange={set("sender")} placeholder="ad, e-posta veya @firma.com" />
            <datalist id="dl-senders">
              {senders.map((c) => (
                <option key={c.email} value={c.email}>{c.name}</option>
              ))}
            </datalist>
          </label>
          <label className="field">
            <span>Alıcı</span>
            <input list="dl-rcpts" value={draft.recipient} onChange={set("recipient")} placeholder="ad veya e-posta" />
            <datalist id="dl-rcpts">
              {rcpts.map((c) => (
                <option key={c.email} value={c.email}>{c.name}</option>
              ))}
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
              {Object.entries(meta?.doc_kinds ?? {}).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
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
            <span>Dosya türü</span>
            <select value={draft.file_kind} onChange={set("file_kind")}>
              <option value="">Hepsi</option>
              {Object.entries(meta?.file_kinds ?? {}).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Klasör</span>
            <select value={draft.folder_id} onChange={set("folder_id")}>
              <option value="">Hepsi</option>
              {folders.filter((f) => f.count > 0).map((f) => (
                <option key={f.id} value={f.id}>{f.origin === "import" ? `Outlook / ${f.display_name}` : f.name === "INBOX" ? "Gelen Kutusu" : f.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Etiket</span>
            <select value={draft.tag_id} onChange={set("tag_id")}>
              <option value="">Hepsi</option>
              {tags.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Sıralama</span>
            <select value={draft.sort} onChange={set("sort")}>
              {Object.entries(SORTS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </label>
          <div className="field checks">
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
    </div>
  );
}
