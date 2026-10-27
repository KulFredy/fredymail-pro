/** Sağ tık menüsü: tek bir host (App içinde) + her yerden openContextMenu(e, items). */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon } from "./ui";

export interface MenuItem {
  label?: string;
  icon?: string;
  onClick?: () => void;
  sub?: MenuItem[];
  danger?: boolean;
  disabled?: boolean;
  checked?: boolean;
  sep?: boolean;
}

interface MenuState { x: number; y: number; items: MenuItem[] }

let show: ((s: MenuState | null) => void) | null = null;

/** Fare olayı ya da klavyeden (Menü tuşu / Shift+F10) üretilmiş konum. */
export interface MenuEvent { clientX: number; clientY: number; preventDefault(): void; stopPropagation(): void }

/** Klavye ile açılan menü için öğenin sol üstüne yakın bir konum üretir. */
export function keyMenuEvent(e: React.KeyboardEvent): MenuEvent | null {
  if (e.key !== "ContextMenu" && !(e.shiftKey && e.key === "F10")) return null;
  const r = e.currentTarget.getBoundingClientRect();
  return { clientX: r.left + 40, clientY: r.top + 20, preventDefault: () => e.preventDefault(), stopPropagation: () => e.stopPropagation() };
}

export function openContextMenu(e: MenuEvent, items: MenuItem[]) {
  if (!show) return;
  e.preventDefault();
  e.stopPropagation();
  show({ x: e.clientX, y: e.clientY, items: items.filter(Boolean) });
}

export const SEP: MenuItem = { sep: true };

export function ContextMenuHost() {
  const [st, setSt] = useState<MenuState | null>(null);
  useEffect(() => {
    show = setSt;
    return () => {
      show = null;
    };
  }, []);
  useEffect(() => {
    if (!st) return;
    const close = () => setSt(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(".ctx-menu")) close();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    window.addEventListener("hashchange", close);
    document.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("hashchange", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [st]);
  if (!st) return null;
  return <Panel x={st.x} y={st.y} items={st.items} onDone={() => setSt(null)} autoFocus />;
}

function Panel({ x, y, items, onDone, autoFocus, flipFrom }: {
  x: number; y: number; items: MenuItem[]; onDone: () => void; autoFocus?: boolean; flipFrom?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y, ready: false });
  const [open, setOpen] = useState<number | null>(null);
  const rows = useRef<(HTMLButtonElement | null)[]>([]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = x;
    if (left + r.width > innerWidth - 8) left = flipFrom !== undefined ? flipFrom - r.width : innerWidth - r.width - 8;
    const top = Math.max(8, Math.min(y, innerHeight - r.height - 8));
    setPos({ left: Math.max(8, left), top, ready: true });
    if (autoFocus) rows.current.find((b) => b && !b.disabled)?.focus();
  }, [x, y, autoFocus, flipFrom]);

  const focusable = () => rows.current.filter((b): b is HTMLButtonElement => !!b && !b.disabled);
  function onKey(e: React.KeyboardEvent) {
    const list = focusable();
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      e.stopPropagation();
      const n = list.length;
      list[(i + (e.key === "ArrowDown" ? 1 : -1) + n) % n]?.focus();
    }
  }

  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
      onKeyDown={onKey} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => it.sep ? <div key={i} className="ctx-sep" role="separator" /> : (
        <div key={i} className="ctx-row" onMouseEnter={() => setOpen(it.sub ? i : null)}>
          <button
            ref={(b) => { rows.current[i] = b; }}
            role="menuitem"
            className={`ctx-item ${it.danger ? "danger" : ""} ${open === i ? "open" : ""}`}
            disabled={it.disabled}
            aria-haspopup={it.sub ? "menu" : undefined}
            aria-expanded={it.sub ? open === i : undefined}
            onKeyDown={(e) => {
              if (it.sub && (e.key === "ArrowRight" || e.key === "Enter")) {
                e.preventDefault();
                setOpen(i);
              } else if (e.key === "ArrowLeft" && flipFrom !== undefined) {
                e.preventDefault();
                onDone();
              }
            }}
            onClick={() => {
              if (it.sub) return setOpen(open === i ? null : i);
              onDone();
              it.onClick?.();
            }}
          >
            <span className="ctx-ico">{it.checked ? <Icon name="check" size={15} /> : it.icon ? <Icon name={it.icon} size={15} /> : null}</span>
            <span className="ctx-label">{it.label}</span>
            {it.sub && <Icon name="chevron" size={14} className="ctx-chev" />}
          </button>
          {it.sub && open === i && (
            <SubPanel anchor={rows.current[i]} items={it.sub} onDone={onDone} onBack={() => { setOpen(null); rows.current[i]?.focus(); }} />
          )}
        </div>
      ))}
    </div>
  );
}

function SubPanel({ anchor, items, onDone, onBack }: { anchor: HTMLButtonElement | null; items: MenuItem[]; onDone: () => void; onBack: () => void }) {
  const r = anchor?.getBoundingClientRect();
  if (!r) return null;
  return (
    <div onKeyDown={(e) => { if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); onBack(); } }}>
      <Panel x={r.right + 2} y={r.top - 6} flipFrom={r.left - 2} items={items} onDone={onDone} autoFocus={document.activeElement === anchor} />
    </div>
  );
}

// ---------------------------------------------------------------- "AI ile analiz et" isteği

type IntelKind = "analyze" | "draft";
let pending: { id: number; kind: IntelKind } | null = null;

/** Maili açıp AI panelinde analiz/taslak başlatır. Mail zaten açıksa doğrudan tetikler. */
export function requestIntel(id: number, kind: IntelKind) {
  pending = { id, kind };
  window.dispatchEvent(new CustomEvent("fm-intel", { detail: { id } }));
}

export function takeIntel(id: number): IntelKind | null {
  if (pending?.id !== id) return null;
  const k = pending.kind;
  pending = null;
  return k;
}
