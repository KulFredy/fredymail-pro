import { Component, useEffect, useRef, type ReactNode } from "react";
import { splitHighlight } from "./util";

const PATHS: Record<string, string> = {
  inbox: "M3 13h5l1.5 3h5L16 13h5M3 13l2.5-7h13L21 13v6H3z",
  all: "M4 6h16M4 12h16M4 18h16",
  unread: "M4 6h16v12H4zM4 7l8 6 8-6",
  star: "M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.8L12 16.9l-5.25 2.7 1-5.8L3.5 9.7l5.9-.9z",
  sent: "M4 12l16-8-6 16-2.5-6.5z",
  clock: "M12 7v5l3 2M12 21a9 9 0 110-18 9 9 0 010 18z",
  reply: "M10 8V4L3 11l7 7v-4c5 0 8 1.5 10 5-1-5-4-10-10-11z",
  hourglass: "M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9",
  draft: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  folder: "M3 7h6l2 2h10v10H3z",
  tag: "M3 12V4h8l9 9-8 8zM7.5 8.5h.01",
  smart: "M4 6h16M7 12h10M10 18h4",
  settings: "M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z",
  logout: "M15 4h4v16h-4M10 8l-4 4 4 4M6 12h11",
  search: "M11 18a7 7 0 110-14 7 7 0 010 14zM21 21l-5-5",
  filter: "M4 5h16l-6 7v6l-4 2v-8z",
  close: "M6 6l12 12M18 6L6 18",
  back: "M15 5l-7 7 7 7",
  menu: "M4 6h16M4 12h16M4 18h16",
  clip: "M21 11l-8.5 8.5a5 5 0 01-7-7L14 4a3.5 3.5 0 015 5l-8.5 8.5a2 2 0 01-3-3L15 7",
  note: "M5 4h10l4 4v12H5zM15 4v4h4M8 12h8M8 16h5",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14",
  check: "M5 12l5 5 9-10",
  warn: "M12 3l10 18H2zM12 10v5M12 18h.01",
  refresh: "M20 11a8 8 0 10-2.3 5.7M20 4v7h-7",
  copy: "M8 8h12v12H8zM4 16V4h12",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z",
  chevron: "M9 6l6 6-6 6",
  plus: "M12 5v14M5 12h14",
  trash: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  keyboard: "M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10",
  archive: "M3 4h18v4H3zM5 8v12h14V8M10 12h4",
};

export function Icon({ name, size = 18, className = "", title }: { name: string; size?: number; className?: string; title?: string }) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      <path d={PATHS[name] ?? PATHS.all} />
    </svg>
  );
}

export function Highlight({ text, fallback }: { text?: string | null; fallback?: string }) {
  const parts = splitHighlight(text);
  if (!parts.length) return <>{fallback ?? ""}</>;
  return (
    <>
      {parts.map((p, i) => (p.hit ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))}
    </>
  );
}

export function Spinner({ label = "Yükleniyor…" }: { label?: string }) {
  return (
    <div className="spinner" role="status" aria-live="polite">
      <span className="spinner-dot" />
      <span>{label}</span>
    </div>
  );
}

export function Skeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="skeleton" aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="sk-row">
          <div className="sk-avatar" />
          <div className="sk-lines">
            <div className="sk-line w60" />
            <div className="sk-line w90" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function Banner({ kind = "info", children, onClose }: { kind?: "info" | "warn" | "error" | "ok"; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`banner banner-${kind}`} role={kind === "error" ? "alert" : "status"}>
      <Icon name={kind === "ok" ? "check" : kind === "info" ? "eye" : "warn"} size={16} />
      <div className="banner-body">{children}</div>
      {onClose && (
        <button className="icon-btn sm" onClick={onClose} aria-label="Kapat">
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  );
}

export function Empty({ icon = "inbox", title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={36} />
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>("input,textarea,select,button:not(.modal-close)");
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key === "Tab" && el) {
        const f = Array.from(el.querySelectorAll<HTMLElement>("button,input,textarea,select,a[href],[tabindex]:not([tabindex='-1'])")).filter(
          (x) => !x.hasAttribute("disabled"),
        );
        if (!f.length) return;
        const a = f[0];
        const b = f[f.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          b.focus();
        } else if (!e.shiftKey && document.activeElement === b) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? "wide" : ""}`} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn modal-close" onClick={onClose} aria-label="Kapat">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      return (
        <div className="fatal">
          <Icon name="warn" size={40} />
          <h1>Beklenmeyen bir hata oluştu</h1>
          <p>Arayüz bu ekranı gösterirken bir sorunla karşılaştı. Verileriniz etkilenmedi.</p>
          <code>{this.state.error.message}</code>
          <div className="row gap">
            <button className="btn primary" onClick={() => window.location.reload()}>
              Sayfayı yenile
            </button>
            <button
              className="btn"
              onClick={() => {
                window.location.hash = "#/mail";
                this.setState({ error: null });
              }}
            >
              Gelen kutusuna dön
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function Toasts({ items }: { items: { id: number; text: string; kind: string }[] }) {
  return (
    <div className="toasts" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
