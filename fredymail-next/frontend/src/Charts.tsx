import { useEffect, useRef, useState } from "react";
import type { Volume } from "./types";

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
const MONTHS_LONG = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

function bucketLabel(b: string, unit: string, long = false): string {
  const [y, m, d] = b.split("-").map(Number);
  if (unit === "day") return `${d} ${long ? MONTHS_LONG[m - 1] : MONTHS[m - 1]}`;
  return long ? `${MONTHS_LONG[m - 1]} ${y}` : `${MONTHS[m - 1]} ${String(y).slice(2)}`;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(240, Math.floor(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

/** Bar üstü yuvarlatılmış, tabanı düz dikdörtgen. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Gelen / gönderilen mail sayısı — gruplu sütun grafiği, üzerine gelince ayrıntı. */
export function VolumeChart({ volume, height = 230 }: { volume: Volume; height?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const s = volume.series;
  if (!s.length) return <p className="muted small">Bu dönemde mail yok.</p>;
  const padL = 34, padR = 8, padT = 10, padB = 26;
  const iw = width - padL - padR, ih = height - padT - padB;
  const max = niceMax(Math.max(...s.map((p) => Math.max(p.received, p.sent))));
  const step = iw / s.length;
  const bw = Math.max(2, Math.min(18, (step - 6) / 2));
  const y = (v: number) => padT + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const every = Math.max(1, Math.ceil(s.length / Math.max(1, Math.floor(iw / 56))));
  const hp = hover !== null ? s[hover] : null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <svg className="chart" width={width} height={height} role="img" aria-label="Gelen ve gönderilen mail grafiği" onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} />
            <text className="axis" x={padL - 6} y={y(t) + 3.5} textAnchor="end">{Math.round(t).toLocaleString("tr-TR")}</text>
          </g>
        ))}
        {s.map((p, i) => {
          const cx = padL + step * i + step / 2;
          return (
            <g key={p.bucket}>
              {hover === i && <rect x={padL + step * i + 1} y={padT} width={step - 2} height={ih} rx={6} fill="var(--hover)" />}
              <path className="b-in" d={barPath(cx - bw - 1, y(p.received), bw, padT + ih - y(p.received))} />
              <path className="b-out" d={barPath(cx + 1, y(p.sent), bw, padT + ih - y(p.sent))} />
              {i % every === 0 && <text className="axis" x={cx} y={height - 8} textAnchor="middle">{bucketLabel(p.bucket, volume.unit)}</text>}
              <rect x={padL + step * i} y={padT} width={step} height={ih} fill="transparent" onMouseEnter={() => setHover(i)}>
                <title>{`${bucketLabel(p.bucket, volume.unit, true)}: ${p.received} gelen, ${p.sent} gönderilen`}</title>
              </rect>
            </g>
          );
        })}
      </svg>
      {hp && hover !== null && (
        <div className="chart-tip" style={{ left: Math.min(Math.max(padL + step * hover + step / 2, 70), width - 70), top: 0 }}>
          <b>{bucketLabel(hp.bucket, volume.unit, true)}</b>
          <span><i className="sw in" /> Gelen <b>{hp.received.toLocaleString("tr-TR")}</b></span>
          <span><i className="sw out" /> Gönderilen <b>{hp.sent.toLocaleString("tr-TR")}</b></span>
        </div>
      )}
    </div>
  );
}

export function Legend() {
  return (
    <div className="legend" aria-hidden="true">
      <span><i className="sw in" />Gelen</span>
      <span><i className="sw out" />Gönderilen</span>
    </div>
  );
}

export interface BarItem {
  key: string;
  label: string;
  sub?: string;
  value: number;
  onClick?: () => void;
}

/** Yatay çubuklu sıralama listesi (tek renk: büyüklük). */
export function BarList({ items, empty = "Veri yok", testId }: { items: BarItem[]; empty?: string; testId?: string }) {
  if (!items.length) return <p className="muted small">{empty}</p>;
  const max = Math.max(...items.map((i) => i.value), 1);
  return (
    <div className="bars-list" data-testid={testId}>
      {items.map((it, i) => (
        <button key={it.key} className="bar-row" onClick={it.onClick} disabled={!it.onClick} title={it.onClick ? "Bu maillere git" : undefined}>
          <span className="rank">{i + 1}</span>
          <span style={{ minWidth: 0 }}>
            <span className="lbl" style={{ display: "block" }}>{it.label}</span>
            {it.sub && <span className="sub" style={{ display: "block" }}>{it.sub}</span>}
            <span className="bar-track"><span className="bar-fill" style={{ width: `${(it.value / max) * 100}%`, display: "block" }} /></span>
          </span>
          <span className="val">{it.value.toLocaleString("tr-TR")}</span>
        </button>
      ))}
    </div>
  );
}
