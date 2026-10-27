import { useEffect, useRef, useState } from "react";
import { api, ApiError, qs } from "./api";
import { keyMenuEvent, openContextMenu, SEP, type MenuEvent, type MenuItem } from "./contextmenu";
import { FilesModal } from "./Files";
import { SearchSummary } from "./Intel";
import { mailMenu } from "./mailmenu";
import { EMPTY_SEARCH, hasFilters, navigate, searchParams, type SearchState } from "./route";
import { useStore } from "./store";
import type { Facets, MessageItem } from "./types";
import { avatarColor, fmtListDate, fmtSize, folderLabel, initials } from "./util";
import { Banner, Empty, Highlight, Icon, Modal, ScrollRow, Skeleton } from "./ui";

export const SORTS: [string, string][] = [
  ["relevance", "Alaka"],
  ["date_desc", "En yeni"],
  ["date_asc", "En eski"],
  ["size_desc", "Boyut ↓ (büyükten)"],
  ["size_asc", "Boyut ↑ (küçükten)"],
  ["subject_asc", "Konu A→Z"],
  ["sender_asc", "Gönderen A→Z"],
];

interface Props {
  title: string;
  subtitle?: string;
  items: MessageItem[];
  total: number;
  loading: boolean;
  error: string | null;
  notice?: string | null;
  selectedId: number | null;
  search: SearchState;
  facets?: Facets;
  onSelect: (id: number) => void;
  onUpdated: (m: MessageItem) => void;
  onLoadMore?: () => void;
  onRetry: () => void;
  emptyTitle?: string;
  emptyText?: string;
}

export function MessageList(p: Props) {
  const { meta, folders, tags, toast, refreshSaved, ai, openComposer, refreshFolders, refreshTags, refreshCounts } = useStore();
  const menuFor = (m: MessageItem) => mailMenu(m, {
    open: () => p.onSelect(m.id), onUpdated: p.onUpdated, toast, tags, me: meta?.account ? [meta.account] : [],
    aiEnabled: !!ai?.enabled, openComposer, refreshFolders, refreshTags, refreshCounts,
  });
  const [sortOpen, setSortOpen] = useState(false);
  const [summary, setSummary] = useState(false);
  const [files, setFiles] = useState<{ search: SearchState; title: string } | null>(null);
  const roleOf = new Map(folders.map((f) => [f.id, f]));
  const pillName = (id: number, name: string) => {
    const f = roleOf.get(id);
    if (!f) return name;
    if (f.role === "inbox") return "Gelen";
    return f.origin === "import" ? `Outlook/${f.display_name}` : folderLabel(f);
  };
  const listRef = useRef<HTMLDivElement>(null);
  const s = p.search;
  const sortLabel = SORTS.find(([k]) => k === s.sort)?.[1] ?? (s.q ? "Alaka" : "En yeni");
  const set = (patch: Partial<SearchState>) => {
    const next = { ...s, ...patch, smart: "" };
    if (next.view === "inbox" && (next.q || hasFilters(next))) next.view = "all";
    navigate({ page: "mail", search: next, msg: null });
  };
  const toggle = (k: keyof SearchState, v: string) => set({ [k]: s[k] === v ? "" : v });

  // ---- liste başlığı ve çiplerde sağ tık
  const markAll = (patch: Partial<SearchState>, label: string): MenuItem => ({
    label, icon: "check", onClick: async () => {
      const { facets: _f, page: _p, per_page: _pp, ...params } = searchParams({ ...s, ...patch }, 1);
      void _f; void _p; void _pp;
      try {
        const r = await api.post<{ updated: number }>(`/api/messages/mark-all-read${qs(params)}`);
        toast(r.updated ? `${r.updated.toLocaleString("tr-TR")} mail okundu olarak işaretlendi` : "Okunmamış mail yok", "ok");
        refreshFolders();
        window.dispatchEvent(new Event("fm-refresh-list"));
      } catch (e) {
        toast((e as ApiError).message, "error");
      }
    },
  });
  const showFiles = (patch: Partial<SearchState>, title: string): MenuItem =>
    ({ label: "Dosyaları göster", icon: "clip", onClick: () => setFiles({ search: { ...s, ...patch }, title }) });
  const listMenu = (): MenuItem[] => [
    markAll({}, "Bu listedekilerin tümünü okundu işaretle"),
    showFiles({}, p.title),
    ...(ai?.enabled ? [{ label: "Listeyi yapay zekâ ile özetle", icon: "sparkle", onClick: () => setSummary(true) }] : []),
    SEP,
    { label: "Sırala", icon: "sort", sub: SORTS.map(([k, label]) => ({ label, checked: sortLabel === label, onClick: () => set({ sort: k === (s.q ? "relevance" : "date_desc") ? "" : k }) })) },
    ...((s.q || hasFilters(s)) && !s.smart ? [{ label: "Akıllı klasör olarak kaydet", icon: "smart", onClick: saveSmart }] : []),
    ...(hasFilters(s) ? [{ label: "Filtreleri temizle", icon: "close", onClick: () => navigate({ page: "mail", search: { ...EMPTY_SEARCH, view: s.view, folder_id: s.folder_id, q: s.q }, msg: null }) }] : []),
    { label: "Listeyi yenile", icon: "refresh", onClick: () => window.dispatchEvent(new Event("fm-refresh-list")) },
  ];
  const chipMenu = (patch: Partial<SearchState>, name: string, files = true): MenuItem[] => [
    { label: `Yalnız “${name}” göster`, icon: "filter", onClick: () => set(patch) },
    markAll(patch, `“${name}” maillerini okundu işaretle`),
    ...(files ? [{ ...showFiles(patch, name), label: `“${name}” dosyalarını göster` }] : []),
    SEP,
    ...listMenu(),
  ];

  useEffect(() => {
    if (!p.selectedId) return;
    listRef.current?.querySelector<HTMLElement>(`[data-id="${p.selectedId}"]`)?.scrollIntoView({ block: "nearest" });
  }, [p.selectedId]);

  useEffect(() => {
    if (!sortOpen) return;
    const on = (e: MouseEvent) => !(e.target as HTMLElement).closest(".menu-anchor") && setSortOpen(false);
    window.addEventListener("mousedown", on);
    return () => window.removeEventListener("mousedown", on);
  }, [sortOpen]);

  async function star(m: MessageItem) {
    p.onUpdated({ ...m, is_important: !m.is_important });  // anında göster
    try {
      p.onUpdated(await api.patch<MessageItem>(`/api/messages/${m.id}`, { is_important: !m.is_important }));
    } catch (e) {
      p.onUpdated(m);
      toast((e as ApiError).message, "error");
    }
  }

  async function saveSmart() {
    const name = window.prompt("Akıllı klasör adı:", s.q || "Yeni akıllı klasör");
    if (!name) return;
    const filters: Record<string, string> = {};
    for (const k of ["view", "folder_id", "sender", "recipient", "participant", "direction", "date_from", "date_to", "year", "has_attachment",
      "file_kind", "doc_kind", "tag_id", "unread", "important", "sort"] as const) {
      if (s[k] && !(k === "view" && (s[k] === "all" || s[k] === "folder"))) filters[k] = s[k];
    }
    try {
      await api.post("/api/saved-searches", { name, query: s.q, filters });
      refreshSaved();
      toast("Akıllı klasör kaydedildi. Sunucudaki klasörleriniz değişmedi.", "ok");
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }

  const quickAll = !s.unread && !s.important && !s.has_attachment;

  // yıl ve tür çipleri: sunucudan gelen sayımlar + seçili olan (sonuçta görünmese bile)
  const f = p.facets;
  const years = Object.entries(f?.years ?? {}).sort((a, b) => Number(b[0]) - Number(a[0]));
  if (s.year && !years.some(([y]) => y === s.year)) years.unshift([s.year, 0]);
  const fileKinds = Object.entries(f?.file_kinds ?? {}).sort((a, b) => b[1] - a[1]);
  if (s.file_kind && !fileKinds.some(([k]) => k === s.file_kind)) fileKinds.unshift([s.file_kind, 0]);
  const docKinds = Object.entries(f?.doc_kinds ?? {}).sort((a, b) => b[1] - a[1]);
  if (s.doc_kind && !docKinds.some(([k]) => k === s.doc_kind)) docKinds.unshift([s.doc_kind, 0]);

  const active: { key: keyof SearchState; label: string }[] = [];
  const add = (key: keyof SearchState, label: string) => s[key] && active.push({ key, label });
  add("sender", `Gönderen: ${s.sender}`);
  add("recipient", `Alıcı: ${s.recipient}`);
  add("participant", `Yazışılan: ${s.participant}`);
  add("direction", s.direction === "out" ? "Yalnız gönderdiklerim" : "Yalnız gelenler");
  add("date_from", `${s.date_from} →`);
  add("date_to", `→ ${s.date_to}`);
  if (s.folder_id && s.view !== "folder") {
    const fo = folders.find((x) => String(x.id) === s.folder_id);
    active.push({ key: "folder_id", label: `Klasör: ${fo ? folderLabel(fo) : s.folder_id}` });
  }
  if (s.tag_id) active.push({ key: "tag_id", label: `Etiket: ${tags.find((t) => String(t.id) === s.tag_id)?.name ?? s.tag_id}` });
  if (s.has_attachment === "false") active.push({ key: "has_attachment", label: "Eksiz" });

  return (
    <section className="list-pane" aria-label="Mail listesi">
      <header className="list-head" onContextMenu={(e) => openContextMenu(e, listMenu())}>
        <div className="list-title">
          <div className="grow">
            <h1 className="ellipsis">{p.title}</h1>
            <div className="sub ellipsis">
              {p.loading && !p.items.length ? "Yükleniyor…" : `${p.total.toLocaleString("tr-TR")} mail`}
              {p.subtitle ? ` · ${p.subtitle}` : ""}
            </div>
          </div>
          <div className="list-tools">
            {s.q && ai?.enabled && (
              <button className="icon-btn" onClick={() => setSummary(true)} title="Sonuçları AI ile özetle" aria-label="Sonuçları AI ile özetle">
                <Icon name="sparkle" />
              </button>
            )}
            {(s.q || hasFilters(s)) && !s.smart && (
              <button className="icon-btn" onClick={saveSmart} title="Akıllı klasör olarak kaydet" aria-label="Akıllı klasör olarak kaydet">
                <Icon name="smart" />
              </button>
            )}
            <div className="menu-anchor">
              <button className={`btn sm ghost ${s.sort ? "on" : ""}`} onClick={() => setSortOpen(!sortOpen)} aria-haspopup="menu" aria-expanded={sortOpen} title="Sıralama">
                <Icon name="sort" size={16} /> <span className="hide-mobile">{sortLabel}</span>
              </button>
              {sortOpen && (
                <div className="menu" role="menu" aria-label="Sıralama">
                  <div className="menu-title">Sırala</div>
                  {SORTS.map(([k, label]) => (
                    <button key={k} role="menuitemradio" aria-checked={sortLabel === label} className={`menu-item ${sortLabel === label ? "on" : ""}`}
                      onClick={() => { setSortOpen(false); set({ sort: k === (s.q ? "relevance" : "date_desc") ? "" : k }); }}>
                      {label}
                      {sortLabel === label && <Icon name="check" size={15} />}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="chip-row" role="group" aria-label="Hızlı filtreler">
          <button className={`chip solid ${quickAll ? "on" : ""}`} onClick={() => set({ unread: "", important: "", has_attachment: "" })}>
            Tümü {quickAll && <span className="count">{p.total.toLocaleString("tr-TR")}</span>}
          </button>
          <button className={`chip solid ${s.unread ? "on" : ""}`} onClick={() => toggle("unread", "true")}>Okunmamış</button>
          <button className={`chip solid ${s.important ? "on" : ""}`} onClick={() => toggle("important", "true")}><Icon name="star" size={14} /> Önemli</button>
          <button className={`chip solid ${s.has_attachment === "true" ? "on" : ""}`} onClick={() => toggle("has_attachment", "true")}><Icon name="clip" size={14} /> Ekli</button>
        </div>

        {years.length > 0 && (
          <ScrollRow className="facet-row" label="Yıllar">
            <span className="facet-label">Yıl</span>
            <button className={`chip sm ${!s.year ? "on" : ""}`} onClick={() => set({ year: "" })}>Tüm zamanlar</button>
            {years.map(([y, c]) => (
              <button key={y} className={`chip sm ${s.year === y ? "on" : ""}`} onClick={() => toggle("year", y)} aria-pressed={s.year === y}
                title={`${y}: ${c.toLocaleString("tr-TR")} ${s.unread ? "okunmamış " : ""}mail${s.unread ? "" : " (toplam; okunmamışlar için “Okunmamış”a basın)"}`}
                onContextMenu={(e) => openContextMenu(e, chipMenu({ year: y }, y))}>
                {y} {c > 0 && <span className="count">{c}</span>}
              </button>
            ))}
          </ScrollRow>
        )}
        {(fileKinds.length > 0 || docKinds.length > 0) && (
          <ScrollRow className="facet-row" label="Dosya ve belge türleri">
            <span className="facet-label">Tür</span>
            {fileKinds.map(([k, c]) => (
              <button key={`f-${k}`} className={`chip sm ${s.file_kind === k ? "on" : ""}`} onClick={() => toggle("file_kind", k)} aria-pressed={s.file_kind === k}
                title={`${c.toLocaleString("tr-TR")} ${s.unread ? "okunmamış " : ""}mail bu türde ek içeriyor`}
                onContextMenu={(e) => openContextMenu(e, chipMenu({ file_kind: k }, k.split(",").map((x) => meta?.file_kinds[x] ?? x).join(" veya ")))}>
                <Icon name="clip" size={13} /> {k.split(",").map((x) => meta?.file_kinds[x] ?? x).join(" veya ")} {c > 0 && <span className="count">{c}</span>}
              </button>
            ))}
            {fileKinds.length > 0 && docKinds.length > 0 && <span className="chip-sep" />}
            {docKinds.map(([k, c]) => (
              <button key={`d-${k}`} className={`chip sm ${s.doc_kind === k ? "on" : ""}`} onClick={() => toggle("doc_kind", k)} aria-pressed={s.doc_kind === k}
                title={`${c.toLocaleString("tr-TR")} ${s.unread ? "okunmamış " : ""}mail`}
                onContextMenu={(e) => openContextMenu(e, chipMenu({ doc_kind: k }, meta?.doc_kinds[k] ?? k))}>
                {meta?.doc_kinds[k] ?? k} {c > 0 && <span className="count">{c}</span>}
              </button>
            ))}
          </ScrollRow>
        )}

        {active.length > 0 && (
          <div className="active-filters" aria-label="Etkin filtreler">
            {active.map((c) => (
              <button key={c.key} className="chip on" onClick={() => set({ [c.key]: "" })} aria-label={`${c.label} filtresini kaldır`}>
                {c.label} <Icon name="close" size={12} />
              </button>
            ))}
          </div>
        )}
      </header>

      {p.notice && <div style={{ padding: "0 14px" }}><Banner kind="warn">{p.notice}</Banner></div>}
      {p.error && (
        <div style={{ padding: "0 14px" }}>
          <Banner kind="error">{p.error} <button className="link" onClick={p.onRetry}>Tekrar dene</button></Banner>
        </div>
      )}

      <div className="list-scroll" ref={listRef} role="listbox" aria-label="Mailler" aria-busy={p.loading}>
        {p.loading && !p.items.length && <Skeleton rows={8} />}
        {!p.loading && !p.error && !p.items.length && (
          <Empty art={s.q ? "search" : "inbox"} title={p.emptyTitle ?? "Burada mail yok"}>{p.emptyText}</Empty>
        )}
        {p.items.map((m) => (
          <Row key={m.id} m={m} selected={m.id === p.selectedId} onSelect={p.onSelect} onStar={star}
            onMenu={(e) => openContextMenu(e, menuFor(m))}
            showFolders={s.view !== "folder"} pillName={pillName} docLabel={(k) => meta?.doc_kinds[k] ?? k} />
        ))}
        {p.onLoadMore && p.items.length > 0 && p.items.length < p.total && (
          <div className="list-foot">
            <button className="btn" onClick={p.onLoadMore} disabled={p.loading}>
              {p.loading ? "Yükleniyor…" : `Daha fazla göster (${(p.total - p.items.length).toLocaleString("tr-TR")} kaldı)`}
            </button>
          </div>
        )}
      </div>
      {files && <FilesModal search={files.search} title={files.title} onClose={() => setFiles(null)} onOpen={(id) => { setFiles(null); p.onSelect(id); }} />}
      {summary && (
        <Modal title="✦ Sonuçların özeti" onClose={() => setSummary(false)} wide>
          <SearchSummary search={s} onOpen={(id) => { setSummary(false); p.onSelect(id); }} />
        </Modal>
      )}
    </section>
  );
}

function Row({ m, selected, onSelect, onStar, onMenu, showFolders, pillName, docLabel }: {
  m: MessageItem;
  onMenu: (e: MenuEvent) => void;
  selected: boolean;
  onSelect: (id: number) => void;
  onStar: (m: MessageItem) => void;
  showFolders: boolean;
  pillName: (id: number, name: string) => string;
  docLabel: (k: string) => string;
}) {
  const who = m.is_from_me ? `Kime: ${m.to.map((a) => a.name || a.email).join(", ") || "—"}` : m.from_name || m.from_email;
  const seed = m.is_from_me ? m.to[0]?.email ?? m.from_email : m.from_email;
  const folderPills = showFolders ? m.folders.filter((f) => roleless(f.path)).slice(0, 1) : [];
  return (
    <div
      data-id={m.id}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      className={`mrow ${selected ? "selected" : ""} ${m.is_read ? "" : "unread"}`}
      onClick={() => onSelect(m.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onSelect(m.id);
        const k = keyMenuEvent(e);
        if (k) onMenu(k);
      }}
      onContextMenu={onMenu}
    >
      <span className="avatar" style={{ background: avatarColor(seed) }} aria-hidden="true">
        {initials(m.is_from_me ? m.to[0]?.name ?? "" : m.from_name, seed)}
      </span>
      <div className="r-main">
        <div className="row gap-sm">
          <span className="r-from ellipsis"><Highlight text={m.highlight.from_name} fallback={who} /></span>
          {m.thread_count > 1 && <span className="thread-count">{m.thread_count}</span>}
          {m.answered && <Icon name="reply" size={13} className="faint" title="Yanıtlandı" />}
        </div>
        <div className="r-subject ellipsis"><Highlight text={m.highlight.subject} fallback={m.subject || "(konu yok)"} /></div>
        <div className="r-snip"><Highlight text={m.highlight.body} fallback={m.snippet} /></div>
        {(m.doc_kinds.length > 0 || m.tags.length > 0 || folderPills.length > 0 || m.snoozed_until) && (
          <div className="r-meta">
            {m.doc_kinds.slice(0, 2).map((k) => <span key={k} className={`pill k-${k}`}>{docLabel(k)}</span>)}
            {m.tags.slice(0, 2).map((t) => (
              <span key={t.id} className="pill" style={{ background: `color-mix(in srgb, ${t.color} 14%, transparent)`, color: t.color }}>{t.name}</span>
            ))}
            {folderPills.map((f) => <span key={f.id} className="pill folder"><Icon name="folder" size={11} /> {pillName(f.id, f.path)}</span>)}
            {m.snoozed_until && <span className="pill warn"><Icon name="clock" size={11} /> Ertelendi</span>}
          </div>
        )}
      </div>
      <div className="r-side">
        <span className="r-date">{fmtListDate(m.date)}</span>
        <span className="r-icons">
          {m.has_attachments && <Icon name="clip" size={15} title="Ekli" />}
          {m.has_note && <Icon name="note" size={15} title="Not var" />}
          <button className={`star-btn ${m.is_important ? "on" : ""}`} onClick={(e) => { e.stopPropagation(); onStar(m); }}
            aria-label={m.is_important ? "Önemli işaretini kaldır" : "Önemli olarak işaretle"} aria-pressed={m.is_important}>
            <Icon name="star" size={16} />
          </button>
        </span>
        {m.size ? <span className="r-size">{fmtSize(m.size)}</span> : null}
      </div>
    </div>
  );
}

/** Gelen kutusu her mailde var; liste kalabalığı yapmasın. */
function roleless(path: string): boolean {
  return path !== "INBOX";
}
