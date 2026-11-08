import React, { useState } from 'react';
import { outputNameRatio } from '../../src/core/channels';
import { ShieldCheck, Trash2 } from 'lucide-react';
import { FORMATS } from '../../src/core/formats';
import { ANCHOR_LABELS, fixPlacement, logoBox, placementFor, safeAreaIssues, textBox } from '../../src/core/graphics';
import type { OpInput } from '../../src/core/ops';
import { ANCHORS, ANIMS, type Anchor, type Logo, type Output, type Placement, type TextOverlay } from '../../src/core/schema';
import { totalDuration } from '../../src/core/timeline';
import { useApp, useProject } from './state';
import { Segmented, Slider, fmtPct, fmtSec } from './ui';

const ANIM_LABELS: Record<(typeof ANIMS)[number], string> = { yok: 'Yok', solma: 'Solma', yukari: 'Yukarı', buyume: 'Büyüme' };
const outLabel = (o: Output) => outputNameRatio(o);

type Kind = 'text' | 'logo';
type El = (TextOverlay | Logo) & { placements: Record<string, Placement> };

/**
 * Yerleşim: 9 noktalı ızgara (her oranın güvenli alanı içinde) veya serbest; bütün oranlar ya da yalnız aktif oran.
 * “Yalnız bu oran” seçiliyken değişiklik element.place ile o çıktıya yazılır.
 */
const PlacementEditor: React.FC<{ kind: Kind; el: El; update: (patch: Record<string, unknown>, key?: string) => void; sizeRange: [number, number, number]; sizeFormat: (v: number) => string; sizeValue: number }> = ({
  kind,
  el,
  update,
  sizeRange,
  sizeFormat,
  sizeValue,
}) => {
  const { project, apply } = useProject();
  const output = project.outputs.find((o) => o.id === project.ui.activeOutputId) ?? project.outputs[0];
  const own = output ? el.placements[output.id] : undefined;
  const [scope, setScope] = useState<'tum' | 'oran'>(own ? 'oran' : 'tum');
  const general: Placement = { anchor: el.anchor, x: el.x, y: el.y, scale: 1 };
  const resolved = output ? placementFor(el, output) : general;
  // “Bütün oranlar”da genel ayar, “yalnız bu oran”da o orandaki geçerli ayar gösterilir
  const pl = scope === 'oran' ? resolved : general;
  const overridden = project.outputs.filter((o) => el.placements[o.id]);
  const place = (next: Partial<Placement>, key?: string) => {
    if (!output) return;
    apply([{ type: 'element.place', kind, id: el.id, outputId: output.id, place: { ...resolved, ...next } } as OpInput], key ? { key } : undefined);
  };
  const setAnchor = (a: Anchor | null) => (scope === 'oran' ? place({ anchor: a }) : update({ anchor: a }));
  const multi = project.outputs.length > 1;
  return (
    <div className="placement">
      {multi && output ? (
        <Segmented
          size="sm"
          value={scope}
          onChange={setScope}
          options={[
            { value: 'tum', label: 'Bütün oranlar', hint: 'Konum her oranın kendi güvenli alanına göre hesaplanır' },
            { value: 'oran', label: `Yalnız ${outLabel(output)}`, hint: 'Yalnız bu oranda farklı konum/boyut' },
          ]}
        />
      ) : null}
      <div className="anchor-grid" role="group" aria-label="Konum">
        {ANCHORS.map((a) => (
          <button key={a} className={pl.anchor === a ? 'on' : ''} title={ANCHOR_LABELS[a]} aria-label={ANCHOR_LABELS[a]} onClick={() => setAnchor(a)}>
            <i />
          </button>
        ))}
      </div>
      <button className={`chip ${pl.anchor === null ? 'on' : ''}`} onClick={() => setAnchor(null)} title="Kaydırıcılarla serbest konum">
        Serbest konum
      </button>
      {pl.anchor === null ? (
        <>
          <Slider label="Yatay" value={pl.x} min={0} max={1} step={0.01} format={fmtPct} onChange={(v) => (scope === 'oran' ? place({ x: v }, `px:${el.id}`) : update({ x: v }, `x:${el.id}`))} />
          <Slider label="Dikey" value={pl.y} min={0} max={1} step={0.01} format={fmtPct} onChange={(v) => (scope === 'oran' ? place({ y: v }, `py:${el.id}`) : update({ y: v }, `y:${el.id}`))} />
        </>
      ) : null}
      {scope === 'oran' ? (
        <Slider label="Boyut (bu oranda)" value={pl.scale} min={0.3} max={2.5} step={0.05} format={(v) => `×${v.toFixed(2)}`} onChange={(v) => place({ scale: v }, `ps:${el.id}`)} />
      ) : (
        <Slider label="Boyut" value={sizeValue} min={sizeRange[0]} max={sizeRange[1]} step={sizeRange[2]} format={sizeFormat} onChange={(v) => update({ size: v }, `s:${el.id}`)} />
      )}
      {scope === 'tum' && overridden.length ? (
        <small className="muted">Özel yerleşimi olan oran: {overridden.map(outLabel).join(', ')} (bu ayar orada geçerli değil)</small>
      ) : null}
      {own && output ? (
        <button className="link small" onClick={() => (apply([{ type: 'element.place', kind, id: el.id, outputId: output.id, place: null } as OpInput]), setScope('tum'))}>
          {outLabel(output)} için özel yerleşimi kaldır
        </button>
      ) : null}
    </div>
  );
};

/** Bu öğenin güvenli alan uyarıları ve tek tıkla düzeltme */
const SafeWarnings: React.FC<{ kind: Kind; el: El }> = ({ kind, el }) => {
  const { project, refs, apply } = useProject();
  const issues = safeAreaIssues(project, refs).filter((i) => i.kind === kind && i.id === el.id);
  if (!issues.length)
    return (
      <small className="safe-ok">
        <ShieldCheck size={12} /> Bütün oranlarda güvenli alanda
      </small>
    );
  return (
    <div className="stack">
      {issues.map((i) => {
        const o = project.outputs.find((x) => x.id === i.outputId)!;
        const box = kind === 'text' ? textBox(el as TextOverlay, o) : logoBox(el as Logo, refs[(el as Logo).assetId], o);
        return (
          <div key={i.outputId} className="impact-warn">
            ⚠ {i.text}{' '}
            <button className="link small" onClick={() => apply([{ type: 'element.place', kind, id: el.id, outputId: o.id, place: fixPlacement(el, box, o) } as OpInput], { label: `${outLabel(o)}: güvenli alana alındı` })}>
              Güvenli alana al
            </button>
          </div>
        );
      })}
    </div>
  );
};

export const TextInspector: React.FC<{ tx: TextOverlay; onClear: () => void }> = ({ tx, onClear }) => {
  const { project, apply } = useProject();
  const update = (patch: Record<string, unknown>, key?: string) => apply([{ type: 'text.update', id: tx.id, patch } as OpInput], key ? { key } : undefined);
  const end = Math.max(tx.start + 0.4, totalDuration(project) || 1);
  return (
    <div className="stack">
      <b>Yazı / başlık</b>
      <textarea rows={2} value={tx.text} onChange={(e) => update({ text: e.target.value }, `tt:${tx.id}`)} aria-label="Yazı metni" />
      <Slider label="Başlangıç" value={tx.start} min={0} max={Math.max(0.1, tx.end - 0.3)} step={0.1} format={fmtSec} onChange={(v) => update({ start: v }, `ts:${tx.id}`)} />
      <Slider label="Bitiş" value={tx.end} min={tx.start + 0.3} max={end} step={0.1} format={fmtSec} onChange={(v) => update({ end: v }, `te:${tx.id}`)} />
      <details className="insp-group" open>
        <summary>Konum ve boyut</summary>
        <PlacementEditor kind="text" el={tx} update={update} sizeRange={[20, 220, 1]} sizeFormat={(v) => `${Math.round(v)} px`} sizeValue={tx.size} />
      </details>
      <div className="field">
        <span>Görünüm</span>
        <Segmented size="sm" value={tx.style} onChange={(v) => update({ style: v })} options={[{ value: 'shadow', label: 'Gölge' }, { value: 'box', label: 'Kutu' }, { value: 'outline', label: 'Kontur' }]} />
      </div>
      <div className="row">
        <label className="field color-field">
          <span>Renk</span>
          <input type="color" value={tx.color} onChange={(e) => update({ color: e.target.value.toUpperCase() }, `tc:${tx.id}`)} />
        </label>
        <div className="field">
          <span>Yazı tipi</span>
          <Segmented size="sm" value={tx.font} onChange={(v) => update({ font: v })} options={[{ value: 'Montserrat', label: 'Montserrat' }, { value: 'Inter', label: 'Inter' }]} />
        </div>
      </div>
      <div className="field">
        <span>Giriş / çıkış</span>
        <Segmented size="sm" value={tx.anim} onChange={(v) => update({ anim: v })} options={ANIMS.map((a) => ({ value: a, label: ANIM_LABELS[a] }))} />
      </div>
      <SafeWarnings kind="text" el={tx} />
      <button className="btn tiny danger" onClick={() => (apply([{ type: 'text.remove', id: tx.id }]), onClear())}>
        <Trash2 size={13} /> Sil
      </button>
    </div>
  );
};

export const LogoInspector: React.FC<{ logo: Logo; onClear: () => void }> = ({ logo, onClear }) => {
  const { project, apply } = useProject();
  const { library } = useApp();
  const a = library.get(logo.assetId);
  const update = (patch: Record<string, unknown>, key?: string) => apply([{ type: 'logo.update', id: logo.id, patch } as OpInput], key ? { key } : undefined);
  const total = Math.max(0.5, totalDuration(project));
  return (
    <div className="stack">
      <b className="ellipsis">Logo · {a?.name}</b>
      {a && !a.alpha ? <small className="impact-warn">⚠ Bu görselde saydam arka plan yok; logo dikdörtgen kutu olarak görünür. Saydam PNG veya SVG önerilir.</small> : null}
      <details className="insp-group" open>
        <summary>Konum ve boyut</summary>
        <PlacementEditor kind="logo" el={logo} update={update} sizeRange={[0.04, 0.6, 0.01]} sizeFormat={fmtPct} sizeValue={logo.size} />
      </details>
      <Slider label="Saydamlık" value={logo.opacity} min={0.1} max={1} step={0.05} format={fmtPct} onChange={(v) => update({ opacity: v }, `lo:${logo.id}`)} />
      <div className="field">
        <span>Giriş / çıkış</span>
        <Segmented size="sm" value={logo.anim} onChange={(v) => update({ anim: v })} options={ANIMS.map((x) => ({ value: x, label: ANIM_LABELS[x] }))} />
      </div>
      <label className="row small">
        <input type="checkbox" checked={logo.full} onChange={(e) => update(e.target.checked ? { full: true } : { full: false, start: 0, end: Math.min(total, 5) })} /> Videonun tamamı boyunca
      </label>
      {!logo.full ? (
        <>
          <Slider label="Başlangıç" value={logo.start} min={0} max={Math.max(0.1, logo.end - 0.3)} step={0.1} format={fmtSec} onChange={(v) => update({ start: v }, `ls:${logo.id}`)} />
          <Slider label="Bitiş" value={logo.end} min={logo.start + 0.3} max={Math.max(logo.start + 0.4, total)} step={0.1} format={fmtSec} onChange={(v) => update({ end: v }, `le:${logo.id}`)} />
        </>
      ) : null}
      <SafeWarnings kind="logo" el={logo} />
      <button className="btn tiny danger" onClick={() => (apply([{ type: 'logo.remove', id: logo.id }]), onClear())}>
        <Trash2 size={13} /> Kaldır
      </button>
    </div>
  );
};
