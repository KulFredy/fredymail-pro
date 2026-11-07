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

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; width?: number }> = ({ title, onClose, children, width = 440 }) => {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={onClose}>
      <div className="modal" style={{ width }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Kapat">
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

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
