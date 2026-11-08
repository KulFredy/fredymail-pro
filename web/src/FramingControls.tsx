import React from 'react';
import { outputNameRatio } from '../../src/core/channels';
import { Crosshair, Maximize2 } from 'lucide-react';
import { FORMATS } from '../../src/core/formats';
import type { Framing, Output } from '../../src/core/schema';
import { DEFAULT_FRAMING, computeBox, outputSize, scaleFraming } from '../../src/core/timeline';
import { useProject } from './state';
import { Segmented, Slider } from './ui';

/** Kadraj denetimi: mod, boyut (%10–%400), konum, hızlı köşeler. Klip ve üst iz için ortak. */
export const FramingControls: React.FC<{ output: Output; itemId: string; assetId: string }> = ({ output, itemId, assetId }) => {
  const { project, apply, refs } = useProject();
  const a = refs[assetId];
  const f: Framing = output.framing[itemId] ?? DEFAULT_FRAMING;
  const { width: W, height: H } = outputSize(output);
  const set = (framing: Partial<Framing>, key?: string) =>
    apply([{ type: 'output.setFraming', outputId: output.id, clipId: itemId, framing }], key ? { key: `${key}:${output.id}:${itemId}`, label: 'Kadraj' } : undefined);
  if (!a) return null;
  // Görünen boyut: karenin kısa kenarına göre yüzde (kullanıcıya en anlaşılır ölçü)
  const box = computeBox(a.width, a.height, W, H, f);
  const visible = Math.round((Math.max(box.width / W, box.height / H)) * 100);
  void project;
  return (
    <div className="stack framing">
      <small className="muted">
        {outputNameRatio(output)} için · diğer oranları etkilemez
      </small>
      <Segmented
        size="sm"
        value={f.mode}
        onChange={(mode) => set({ mode, zoom: 1, x: 0.5, y: 0.5 })}
        options={[
          { value: 'fill', label: 'Doldur', hint: 'Ekranı kapla (kırpar)' },
          { value: 'fit-blur', label: 'Sığdır', hint: 'Tamamı görünür, bulanık arka plan' },
          { value: 'fit', label: 'Siyah', hint: 'Tamamı görünür, siyah arka plan' },
        ]}
      />
      <Slider
        label="Boyut"
        value={f.zoom}
        min={0.1}
        max={3}
        step={0.01}
        format={() => `%${visible}`}
        onChange={(zoom) => {
          // Doldur modunda kareden küçülünce bulanık arka plana geç
          if (f.mode === 'fill' && zoom < 1) {
            const next = scaleFraming(f, a.width, a.height, W, H, zoom / f.zoom);
            set({ mode: next.mode, zoom: next.zoom }, 'zoom');
          } else set({ zoom }, 'zoom');
        }}
        onReset={() => set({ zoom: 1 })}
      />
      <Slider label="Yatay konum" value={f.x} min={0} max={1} format={(v) => (v < 0.4 ? 'sol' : v > 0.6 ? 'sağ' : 'orta')} onChange={(x) => set({ x }, 'x')} onReset={() => set({ x: 0.5 })} />
      <Slider label="Dikey konum" value={f.y} min={0} max={1} format={(v) => (v < 0.4 ? 'üst' : v > 0.6 ? 'alt' : 'orta')} onChange={(y) => set({ y }, 'y')} onReset={() => set({ y: 0.5 })} />
      <div className="row-wrap">
        <button className="btn tiny" onClick={() => set({ ...DEFAULT_FRAMING })}>
          <Maximize2 size={12} /> Ekranı doldur
        </button>
        <button className="btn tiny" onClick={() => set({ x: 0.5, y: 0.5 })}>
          <Crosshair size={12} /> Ortala
        </button>
        <button
          className="btn tiny"
          title="Küçük görüntü (resim içinde resim) sağ alt köşede"
          onClick={() => {
            const small = scaleFraming({ ...f, mode: f.mode === 'fill' ? 'fit' : f.mode }, a.width, a.height, W, H, 1);
            set({ mode: small.mode === 'fill' ? 'fit' : small.mode, zoom: Math.min(0.4, small.zoom), x: 0.94, y: 0.92 });
          }}
        >
          ⧉ Köşeye küçült
        </button>
      </div>
      <p className="hint small">Önizlemede görüntüyü sürükleyerek de yerleştirebilirsiniz; tekerlek boyutu değiştirir.</p>
    </div>
  );
};
