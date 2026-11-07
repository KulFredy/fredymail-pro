import React, { useRef, useState } from 'react';
import { Copy, ClipboardPaste, RotateCcw, Upload, Layers } from 'lucide-react';
import { ADJUST_FIELDS, PRESETS, effectiveLook } from '../../../src/core/looks';
import { DEFAULT_ADJUST, type Look } from '../../../src/core/schema';
import type { OpInput } from '../../../src/core/ops';
import { upload } from '../api';
import { useApp, useProject } from '../state';
import { Section, Segmented, Slider, fmtPct } from '../ui';

export const ColorStep: React.FC = () => {
  const { project, apply } = useProject();
  const { library, luts, refreshLuts, toast } = useApp();
  const [scope, setScope] = useState<'all' | 'clip'>('all');
  const [copied, setCopied] = useState<Look | null>(null);
  const [showAdjust, setShowAdjust] = useState(true);
  const lutInput = useRef<HTMLInputElement>(null);
  const clip = project.clips.find((c) => c.id === project.ui.selectedClipId) ?? project.clips[0];
  const asset = clip ? library.get(clip.assetId) : undefined;
  const look: Look = scope === 'clip' && clip ? effectiveLook(project, clip) : project.look;
  const clipOverrides = project.clips.filter((c) => c.look).length;

  const setLook = (patch: Partial<Omit<Look, 'adjust'>> & { adjust?: Partial<Look['adjust']> }, key?: string) => {
    const op: OpInput = scope === 'clip' && clip ? { type: 'clip.setLook', clipId: clip.id, look: patch } : { type: 'look.set', look: patch };
    apply([op], key ? { key: `${scope}:${clip?.id}:${key}`, label: 'Renk ayarı' } : undefined);
  };

  const camLuts = luts.filter((l) => l.group === 'kamera');
  const userLuts = luts.filter((l) => l.group === 'kullanici');
  const detected = asset?.camera.detected ? camLuts.find((l) => l.id === asset.camera.detected)?.title : null;

  return (
    <div className="stack">
      <div className="row-between">
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: 'Tüm proje' },
            { value: 'clip', label: `Bu klip${clip ? ` (${project.clips.indexOf(clip) + 1})` : ''}` },
          ]}
        />
        <div className="row">
          <button className="icon-btn" title="Ayarı kopyala" onClick={() => (setCopied(look), toast('Renk ayarı kopyalandı'))}>
            <Copy size={16} />
          </button>
          <button
            className="icon-btn"
            title="Yapıştır"
            disabled={!copied}
            onClick={() => copied && setLook({ ...copied })}
          >
            <ClipboardPaste size={16} />
          </button>
          <button className="icon-btn" title="Sıfırla" onClick={() => setLook({ preset: 'dogal', intensity: 1, adjust: { ...DEFAULT_ADJUST }, lut: null, lutIntensity: 1 })}>
            <RotateCcw size={16} />
          </button>
        </div>
      </div>
      {scope === 'all' && clipOverrides ? (
        <p className="hint">
          {clipOverrides} klibin kendi renk ayarı var.{' '}
          <button className="link" onClick={() => apply([{ type: 'look.applyToAll' }])}>
            Hepsini proje ayarına bağla
          </button>
        </p>
      ) : null}
      {scope === 'clip' && clip?.look ? (
        <p className="hint">
          Bu klibin kendi ayarı var.{' '}
          <button className="link" onClick={() => apply([{ type: 'look.applyToAll', fromClipId: clip.id }])}>
            Bu ayarı tümüne uygula
          </button>{' '}
          ·{' '}
          <button className="link" onClick={() => apply([{ type: 'clip.setLook', clipId: clip.id, look: null }])}>
            Proje ayarına dön
          </button>
        </p>
      ) : null}

      {clip && asset?.kind === 'video' ? (
        <Section
          title="Kamera dönüşümü"
          hint={
            detected
              ? `Algılandı: ${detected}. ${asset.camera.reason}`
              : asset.camera.reason || 'Log profiliyle (S-Log, V-Log, C-Log…) çektiyseniz seçin; normal çekimde “Yok” kalsın.'
          }
        >
          <select
            value={clip.camera}
            onChange={(e) => apply([{ type: 'clip.update', clipId: clip.id, patch: { camera: e.target.value } }])}
          >
            <option value="auto">Otomatik{detected ? ` (${detected})` : ' (log algılanmadı)'}</option>
            <option value="none">Yok · normal renk</option>
            {camLuts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
            {userLuts.map((l) => (
              <option key={l.id} value={l.id}>
                Kendi LUT'um: {l.title}
              </option>
            ))}
          </select>
          <small className="muted">Bu ayar klibe özeldir; farklı gövde ve lenslerle çekilmiş klipler aynı projede karışabilir.</small>
        </Section>
      ) : null}

      <Section title="Görünüm" aside={<span className="muted">{fmtPct(look.intensity)}</span>}>
        <div className="preset-grid">
          {PRESETS.map((p) => (
            <button key={p.id} className={`preset ${look.preset === p.id ? 'on' : ''}`} onClick={() => setLook({ preset: p.id })}>
              <span className="swatch" style={{ background: p.swatch }} />
              {p.label}
            </button>
          ))}
        </div>
        {look.preset !== 'dogal' ? (
          <Slider label="Yoğunluk" value={look.intensity} min={0} max={1} format={fmtPct} onChange={(v) => setLook({ intensity: v }, 'intensity')} />
        ) : null}
      </Section>

      <Section
        title="LUT"
        aside={
          <button className="btn tiny" onClick={() => lutInput.current?.click()}>
            <Upload size={13} /> LUT yükle
          </button>
        }
        hint="Premiere/Resolve/Photoshop'ta kullandığınız .cube veya .3dl LUT'larını (ya da zip paketini) yükleyin; tüm projelerde kullanılabilir. Toplu düzenleme için Stüdyo'da “LUT'larım”."
      >
        <input
          ref={lutInput}
          type="file"
          accept=".cube,.3dl,.zip,.CUBE,.3DL"
          hidden
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            if (!files.length) return;
            try {
              const r = await upload('/api/luts', files, () => undefined);
              await refreshLuts();
              if (r.added?.[0]) setLook({ lut: r.added[0].id, lutIntensity: 1 });
              const bad = (r.report ?? []).filter((x: { status: string }) => x.status === 'hata');
              toast(bad.length ? `${r.added.length} LUT eklendi · okunamadı: ${bad.map((x: { file: string; reason: string }) => `${x.file} (${x.reason})`).join(', ')}` : `${r.added.length} LUT eklendi`, bad.length && !r.added.length ? 'error' : 'ok');
            } catch (err) {
              toast((err as Error).message, 'error');
            }
            e.target.value = '';
          }}
        />
        <select value={look.lut ?? ''} onChange={(e) => setLook({ lut: e.target.value || null })}>
          <option value="">LUT yok</option>
          {userLuts.map((l) => (
            <option key={l.id} value={l.id}>
              {l.title}
            </option>
          ))}
        </select>
        {look.lut ? <Slider label="LUT yoğunluğu" value={look.lutIntensity} min={0} max={1} format={fmtPct} onChange={(v) => setLook({ lutIntensity: v }, 'lut')} /> : null}
      </Section>

      <Section
        title={
          <button className="link strong" onClick={() => setShowAdjust((s) => !s)}>
            <Layers size={14} /> Ayarlar {showAdjust ? '▾' : '▸'}
          </button>
        }
        hint={showAdjust ? 'Çift tıklayarak sıfırlayın.' : undefined}
      >
        {showAdjust
          ? ADJUST_FIELDS.map((f) => (
              <Slider
                key={f.key}
                label={f.label}
                value={look.adjust[f.key]}
                min={f.min}
                max={f.max}
                step={f.step}
                center={f.min < 0}
                format={(v) => (f.key === 'exposure' ? `${v > 0 ? '+' : ''}${v.toFixed(2)} EV` : `${v > 0 && f.min < 0 ? '+' : ''}${Math.round(v * 100)}`)}
                onChange={(v) => setLook({ adjust: { [f.key]: v } }, f.key)}
                onReset={() => setLook({ adjust: { [f.key]: 0 } })}
              />
            ))
          : null}
      </Section>
    </div>
  );
};
