import { useEffect, useRef } from "react";
import { useStore } from "./store";
import type { MessageItem } from "./types";
import { avatarColor, fmtListDate, folderLabel, initials } from "./util";
import { Banner, Empty, Highlight, Icon, Skeleton } from "./ui";

export interface ListRow extends MessageItem {
  days_waiting?: number | null;
}

interface Props {
  title: string;
  subtitle?: string;
  items: ListRow[];
  total: number;
  loading: boolean;
  error: string | null;
  notice?: string | null;
  selectedId: number | null;
  onSelect: (id: number) => void;
  onLoadMore?: () => void;
  onRetry: () => void;
  emptyTitle?: string;
  emptyText?: string;
  waitingLabel?: string;
}

export function MessageList(p: Props) {
  const { meta, folders } = useStore();
  const roleOf = new Map(folders.map((f) => [f.id, f]));
  const pillName = (id: number, name: string) => {
    const f = roleOf.get(id);
    if (!f) return name;
    if (f.role === "inbox") return "Gelen";
    return f.origin === "import" ? `Outlook/${f.display_name}` : folderLabel(f);
  };
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!p.selectedId) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-id="${p.selectedId}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [p.selectedId]);

  return (
    <section className="list-pane" aria-label={p.title}>
      <header className="list-head">
        <div>
          <h1>{p.title}</h1>
          {p.subtitle && <div className="muted small">{p.subtitle}</div>}
        </div>
        {!p.loading && !p.error && <span className="muted small">{p.total.toLocaleString("tr-TR")} mail</span>}
      </header>
      {p.notice && <Banner kind="warn">{p.notice}</Banner>}
      {p.error && (
        <Banner kind="error">
          {p.error}{" "}
          <button className="link" onClick={p.onRetry}>Tekrar dene</button>
        </Banner>
      )}
      <div className="list-scroll" ref={listRef} role="listbox" aria-label="Mailler" tabIndex={-1}>
        {p.loading && !p.items.length && <Skeleton rows={8} />}
        {!p.loading && !p.error && !p.items.length && (
          <Empty icon="inbox" title={p.emptyTitle ?? "Burada mail yok"}>{p.emptyText}</Empty>
        )}
        {p.items.map((m) => (
          <div
            key={m.id}
            data-id={m.id}
            role="option"
            aria-selected={p.selectedId === m.id}
            tabIndex={0}
            className={`mrow ${m.is_read ? "" : "unread"} ${p.selectedId === m.id ? "selected" : ""}`}
            onClick={() => p.onSelect(m.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                p.onSelect(m.id);
              }
            }}
          >
            <div className="avatar" style={{ background: avatarColor(m.from_email) }} aria-hidden="true">
              {initials(m.from_name, m.from_email)}
            </div>
            <div className="row-main">
              <div className="row-top">
                <span className="row-from">
                  {m.is_from_me ? <span className="muted">Kime: {m.to[0]?.name || m.to[0]?.email || "—"}</span> : <Highlight text={m.highlight?.from_name} fallback={m.from_name || m.from_email} />}
                </span>
                {m.thread_count > 1 && <span className="count-pill" title={`${m.thread_count} mesajlık yazışma`}>{m.thread_count}</span>}
                <span className="row-date" title={m.date ?? ""}>{fmtListDate(m.date)}</span>
              </div>
              <div className="row-subject">
                {m.is_important && <Icon name="star" size={14} className="star on" title="Önemli" />}
                <Highlight text={m.highlight?.subject} fallback={m.subject} />
              </div>
              <div className="row-snippet">
                {m.highlight?.body ? <Highlight text={m.highlight.body} /> : m.snippet}
              </div>
              <div className="row-meta">
                {p.waitingLabel && m.days_waiting != null && (
                  <span className="pill warn">{m.days_waiting} gündür {p.waitingLabel}</span>
                )}
                {m.doc_kinds.map((k) => (
                  <span key={k} className={`pill kind-${k}`}>{meta?.doc_kinds[k] ?? k}</span>
                ))}
                {m.folders.slice(0, 3).map((f) => (
                  <span key={f.id} className="pill folder" title={f.path}>{pillName(f.id, f.name)}</span>
                ))}
                {m.attachments.slice(0, 2).map((a) => (
                  <span key={a.id} className="pill att" title={a.filename}>
                    <Icon name="clip" size={12} />
                    <span className="ellipsis">{a.filename}</span>
                  </span>
                ))}
                {m.attachments.length > 2 && <span className="pill att">+{m.attachments.length - 2}</span>}
                {m.tags.map((t) => (
                  <span key={t.id} className="pill tag" style={{ borderColor: t.color, color: t.color }}>
                    {t.name}
                  </span>
                ))}
                {m.has_note && <Icon name="note" size={14} className="muted" title="Not var" />}
                {m.snoozed_until && <Icon name="clock" size={14} className="muted" title={`Ertelendi: ${new Date(m.snoozed_until).toLocaleString("tr-TR")}`} />}
                {m.answered && <Icon name="reply" size={14} className="muted" title="Yanıtlandı (sunucu bayrağı)" />}
              </div>
            </div>
          </div>
        ))}
        {p.onLoadMore && p.items.length < p.total && !p.error && (
          <div className="load-more">
            <button className="btn" onClick={p.onLoadMore} disabled={p.loading}>
              {p.loading ? "Yükleniyor…" : `Daha fazla yükle (${p.items.length}/${p.total.toLocaleString("tr-TR")})`}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
