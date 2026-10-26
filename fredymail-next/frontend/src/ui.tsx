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
  grid: "M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z",
  tasks: "M9 6h11M9 12h11M9 18h11M4 5.5l1 1 2-2M4 11.5l1 1 2-2M4 17.5l1 1 2-2",
  more: "M12 5h.01M12 12h.01M12 19h.01",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  sort: "M7 4v16M3 16l4 4 4-4M17 20V4M13 8l4-4 4 4",
  calendar: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  building: "M4 21V4h11v17M15 9h5v12M8 8h3M8 12h3M8 16h3M2 21h20",
  user: "M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0",
  receipt: "M6 3h12v18l-3-2-3 2-3-2-3 2zM9 8h6M9 12h6M9 16h3",
  edit: "M4 20h4L19 9l-4-4L4 16zM14 6l4 4",
  external: "M14 4h6v6M20 4l-9 9M18 14v6H4V6h6",
  bulb: "M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z",
  ask: "M12 21a9 9 0 10-8-4.8L3 21l4.8-1A9 9 0 0012 21zM9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1-1.5 2M12 16.5h.01",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5",
  bell: "M6 16V11a6 6 0 0112 0v5l2 2H4zM10 21h4",
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
      strokeWidth={1.75}
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

/** Marka işareti: yeşil yaprak + kıvılcım. */
export function Logo({ size = 38 }: { size?: number }) {
  return (
    <svg className="brand-logo" width={size} height={size} viewBox="0 0 40 40" aria-hidden="true">
      <defs>
        <linearGradient id="fm-leaf" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3ddc97" />
          <stop offset="1" stopColor="#0f7a4f" />
        </linearGradient>
      </defs>
      <path d="M6 30C6 15 16 6 33 6c0 17-9 27-24 27-1.2 0-2.2-.1-3-.3z" fill="url(#fm-leaf)" />
      <path d="M9.5 30.5C15 23 20 18 27 12.5" stroke="#eafff4" strokeWidth="2" strokeLinecap="round" fill="none" opacity=".9" />
      <path d="M31 22l1.1 3 3 1.1-3 1.1-1.1 3-1.1-3-3-1.1 3-1.1z" fill="#c8f7de" />
    </svg>
  );
}

const ART: Record<string, ReactNode> = {
  inbox: (
    <>
      <rect x="22" y="30" width="76" height="46" rx="10" fill="var(--brand-soft)" />
      <path d="M22 52h20l5 9h26l5-9h20" fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" />
      <rect x="36" y="14" width="48" height="30" rx="6" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="2" />
      <path d="M44 24h32M44 32h20" stroke="var(--faint)" strokeWidth="2.5" strokeLinecap="round" />
    </>
  ),
  done: (
    <>
      <circle cx="60" cy="46" r="32" fill="var(--brand-soft)" />
      <path d="M45 46l10 10 20-22" fill="none" stroke="var(--brand)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M96 18l2 5 5 2-5 2-2 5-2-5-5-2 5-2zM22 66l1.5 3.5 3.5 1.5-3.5 1.5L22 76l-1.5-3.5L17 71l3.5-1.5z" fill="var(--brand)" opacity=".6" />
    </>
  ),
  search: (
    <>
      <circle cx="54" cy="42" r="24" fill="var(--brand-soft)" stroke="var(--brand)" strokeWidth="3" />
      <path d="M72 60l16 16" stroke="var(--brand)" strokeWidth="5" strokeLinecap="round" />
      <path d="M44 42h20" stroke="var(--brand)" strokeWidth="3" strokeLinecap="round" opacity=".5" />
    </>
  ),
  draft: (
    <>
      <rect x="30" y="12" width="56" height="68" rx="8" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="2" />
      <path d="M40 28h36M40 38h36M40 48h22" stroke="var(--faint)" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M70 66l18-18 6 6-18 18h-6z" fill="var(--brand-soft)" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" />
    </>
  ),
  read: (
    <>
      <rect x="18" y="20" width="84" height="56" rx="10" fill="var(--brand-soft)" />
      <path d="M18 28l42 28 42-28" fill="none" stroke="var(--brand)" strokeWidth="3" strokeLinejoin="round" />
      <path d="M92 8l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="var(--brand)" />
    </>
  ),
};

export function Empty({ icon = "inbox", art, title, children }: { icon?: string; art?: keyof typeof ART | string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      {art && ART[art] ? (
        <svg className="empty-art" viewBox="0 0 120 92" aria-hidden="true">{ART[art]}</svg>
      ) : (
        <Icon name={icon} size={36} />
      )}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
    </div>
  );
}

const FILE_COLORS: Record<string, string> = {
  pdf: "#d64545", spreadsheet: "#1f8a55", document: "#2c5fb4", presentation: "#d0782a", image: "#8a4fb0",
  archive: "#6b7b88", einvoice: "#12707b", email: "#4d6b7d", other: "#6b7b88",
};
const FILE_TEXT: Record<string, string> = {
  pdf: "PDF", spreadsheet: "XLS", document: "DOC", presentation: "PPT", image: "IMG", archive: "ZIP", einvoice: "XML",
  email: "EML", other: "DOS",
};

/** Dosya türü simgesi (kâğıt + renkli etiket). */
export function FileIcon({ kind }: { kind: string }) {
  const c = FILE_COLORS[kind] ?? FILE_COLORS.other;
  return (
    <svg className="ficon" viewBox="0 0 36 40" aria-hidden="true">
      <path d="M6 2h17l9 9v25a2 2 0 01-2 2H6a2 2 0 01-2-2V4a2 2 0 012-2z" fill="var(--surface)" stroke="var(--border-strong)" strokeWidth="1.5" />
      <path d="M23 2v7a2 2 0 002 2h7" fill="none" stroke="var(--border-strong)" strokeWidth="1.5" />
      <rect x="1" y="20" width="26" height="12" rx="3" fill={c} />
      <text x="14" y="29" textAnchor="middle" fontSize="8" fontWeight="800" fill="#fff" fontFamily="system-ui, sans-serif">{FILE_TEXT[kind] ?? "DOS"}</text>
    </svg>
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
          {t.kind === "ok" && <Icon name="check" size={16} />}
          {t.kind === "error" && <Icon name="warn" size={16} />}
          {t.text}
        </div>
      ))}
    </div>
  );
}
