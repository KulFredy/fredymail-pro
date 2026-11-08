import React, { useEffect, useState } from 'react';
import { X } from 'lucide-react';

export const Slider: React.FC<{
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  center?: boolean;
  onReset?: () => void;
}> = ({ label, value, min, max, step = 0.01, onChange, format, center, onReset }) => {
  const pct = ((value - min) / (max - min)) * 100;
  const zero = center ? ((0 - min) / (max - min)) * 100 : 0;
  const fill = center
    ? `linear-gradient(to right, var(--track) ${Math.min(zero, pct)}%, var(--accent) ${Math.min(zero, pct)}%, var(--accent) ${Math.max(zero, pct)}%, var(--track) ${Math.max(zero, pct)}%)`
    : `linear-gradient(to right, var(--accent) ${pct}%, var(--track) ${pct}%)`;
  return (
    <label className="slider" onDoubleClick={onReset}>
      <span className="slider-head">
        <span>{label}</span>
        <span className="muted mono">{format ? format(value) : value.toFixed(2)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} style={{ background: fill }} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
};

export const Segmented = <T extends string>({
  value,
  options,
  onChange,
  size = 'md',
}: {
  value: T;
  options: { value: T; label: React.ReactNode; hint?: string }[];
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) => (
  <div className={`segmented ${size}`}>
    {options.map((o) => (
      <button key={o.value} type="button" className={o.value === value ? 'on' : ''} title={o.hint} onClick={() => onChange(o.value)}>
        {o.label}
      </button>
    ))}
  </div>
);

export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label: React.ReactNode }> = ({ checked, onChange, label }) => (
  <label className="toggle">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className="track">
      <span className="knob" />
    </span>
    <span>{label}</span>
  </label>
);

/** Açık pencereler yığını: Esc yalnız en üsttekini kapatır */
const modalStack: number[] = [];
let modalSeq = 0;

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; width?: number; testid?: string }> = ({ title, onClose, children, width = 440, testid }) => {
  const ref = React.useRef<HTMLDivElement>(null);
  const closeRef = React.useRef(onClose);
  closeRef.current = onClose;
  const titleId = React.useId();
  useEffect(() => {
    const id = ++modalSeq;
    modalStack.push(id);
    // Açan öğe: kapanınca odak ona döner
    const opener = document.activeElement as HTMLElement | null;
    const el = ref.current;
    const first = el?.querySelector<HTMLElement>('[autofocus], input:not([type=hidden]), select, textarea, button:not(.modal-x), a[href]');
    (first ?? el)?.focus({ preventScroll: true });
    const k = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== id) return;
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      } else if (e.key === 'Tab' && el) {
        // Odak pencerenin içinde kalsın
        const items = [...el.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')].filter((x) => x.offsetParent !== null);
        if (!items.length) return;
        const a = items[0];
        const z = items[items.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    window.addEventListener('keydown', k, true);
    return () => {
      window.removeEventListener('keydown', k, true);
      const i = modalStack.indexOf(id);
      if (i >= 0) modalStack.splice(i, 1);
      if (opener && document.contains(opener) && opener !== document.body) opener.focus({ preventScroll: true });
    };
  }, []);
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal" style={{ width }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref} data-testid={testid}>
        <div className="modal-head">
          <h3 id={titleId}>{title}</h3>
          <button className="icon-btn modal-x" onClick={onClose} aria-label="Kapat">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

/** Açık pencere var mı (sayfa kısayolları pencere açıkken çalışmasın) */
export const modalOpen = () => modalStack.length > 0;

export const Section: React.FC<{ title: React.ReactNode; aside?: React.ReactNode; children: React.ReactNode; hint?: React.ReactNode }> = ({ title, aside, children, hint }) => (
  <section className="section">
    <div className="section-head">
      <h4>{title}</h4>
      {aside}
    </div>
    {hint ? <p className="hint">{hint}</p> : null}
    {children}
  </section>
);

export const Progress: React.FC<{ value: number }> = ({ value }) => (
  <div className="progress">
    <i style={{ width: `${Math.round(value * 100)}%` }} />
  </div>
);

/** Kaydırıcı için yerel değer (sürüklerken akıcı) */
export const useLocal = <T,>(value: T) => {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return [v, setV] as const;
};

export const fmtSec = (s: number) => `${s.toFixed(1).replace('.', ',')} sn`;
export const fmtDb = (d: number) => `${d > 0 ? '+' : ''}${d.toFixed(0)} dB`;
export const fmtPct = (v: number) => `%${Math.round(v * 100)}`;
export const fmtBytes = (b: number) => (b > 1048576 ? `${(b / 1048576).toFixed(1).replace('.', ',')} MB` : `${Math.round(b / 1024)} KB`);

// ---------- Zaman çizelgesi yüksekliği: üst kenardan fareyle sürüklenir ----------
const readNum = (k: string): number | null => {
  try {
    const v = Number(localStorage.getItem(k));
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
};
/** Kullanıcının sürüklediği yükseklik (bu tarayıcıda hatırlanır); null = varsayılan */
export const useRowHeight = (key: string): [number | null, (h: number | null) => void] => {
  const [h, setH] = React.useState<number | null>(() => readNum(key));
  const set = React.useCallback(
    (v: number | null) => {
      setH(v);
      try {
        if (v === null) localStorage.removeItem(key);
        else localStorage.setItem(key, String(Math.round(v)));
      } catch {
        /* yok say */
      }
    },
    [key],
  );
  return [h, set];
};

/** Alt paneli büyütüp küçülten tutamak (üst kenar). Çift tık: varsayılan yükseklik. */
export const RowSplitter: React.FC<{ onChange: (h: number | null) => void; min?: number; reserve?: number; testid?: string }> = ({ onChange, min = 90, reserve = 260, testid }) => {
  const [on, setOn] = React.useState(false);
  const start = React.useRef<{ y: number; h: number } | null>(null);
  const clamp = (v: number) => Math.max(min, Math.min(window.innerHeight - reserve, v));
  return (
    <div
      className={`row-splitter ${on ? 'on' : ''}`}
      role="separator"
      aria-orientation="horizontal"
      aria-label="Zaman çizelgesi yüksekliği (sürükleyin; çift tık: varsayılan)"
      title="Sürükleyerek büyütün / küçültün · çift tık: varsayılan"
      data-testid={testid}
      tabIndex={0}
      onPointerDown={(e) => {
        const panel = (e.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect();
        start.current = { y: e.clientY, h: panel?.height ?? 120 };
        e.currentTarget.setPointerCapture(e.pointerId);
        setOn(true);
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        if (!start.current) return;
        onChange(clamp(start.current.h + (start.current.y - e.clientY)));
      }}
      onPointerUp={() => {
        start.current = null;
        setOn(false);
      }}
      onPointerCancel={() => {
        start.current = null;
        setOn(false);
      }}
      onDoubleClick={() => onChange(null)}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        const cur = (e.currentTarget.parentElement as HTMLElement | null)?.getBoundingClientRect().height ?? 120;
        onChange(clamp(cur + (e.key === 'ArrowUp' ? 20 : -20)));
      }}
    />
  );
};
