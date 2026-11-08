import React, { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Palette, Plus, Trash2, X } from 'lucide-react';
import { effectiveCamera } from '../../src/core/looks';
import { lutUrls } from '../../src/core/refs';
import { FPS } from '../../src/core/schema';
import { formatTime } from '../../src/core/timeline';
import { api, upload } from './api';
import { LutCanvas, loadFrame, lutOps, targetItem } from './LutPanel';
import { useApp, useProject } from './state';
import type { Selection } from './Timeline';
import { Segmented, Slider, fmtPct } from './ui';

type Match = { refId: string; target: string; lutId: string; name: string; summary: string[]; swatches: { reference: string; target: string } };

/**
 * Referanslar (Faz 4.2): beğendiğiniz bir fotoğraf/videoyu ekleyin, kurgunun rengini ona yaklaştırın.
 * Referans kurguya ve çıktıya girmez. Eşleme yaklaşık bir LUT üretir (LUT'larım'da #referans); önizleyip onaylarsınız.
 */
export const ReferencePanel: React.FC<{ selection: Selection }> = ({ selection }) => {
  const { project, frame, apply, preview, reload, seekRef } = useProject();
  const { library, luts, refreshLuts, toast } = useApp();
  const [selId, setSelId] = useState<string | null>(project.references[0]?.id ?? null);
  const [target, setTarget] = useState<'klip' | 'tum'>('klip');
  const [busy, setBusy] = useState<string | null>(null);
  const [match, setMatch] = useState<Match | null>(null);
  const [amount, setAmount] = useState(0.8);
  const [previewing, setPreviewing] = useState(false);
  const [split, setSplit] = useState(50);
  const input = useRef<HTMLInputElement>(null);
  const t = frame / FPS;
  const { item, index } = targetItem(project, selection, t);
  const clip = item?.clip ?? null;
  const ref = project.references.find((r) => r.id === selId) ?? null;
  const refAsset = ref ? library.get(ref.assetId) : undefined;
  const targetKey = `${target}:${target === 'klip' ? clip?.id : ''}`;
  const urls = lutUrls(luts, '');

  // Hedef klibin orta karesi (önce/sonra için)
  const tAsset = clip ? library.get(clip.assetId) : undefined;
  const cam = clip && tAsset ? effectiveCamera(clip, tAsset.camera.detected ?? null) : null;
  const [base, setBase] = useState<ImageData | null>(null);
  useEffect(() => {
    if (!clip || !tAsset || tAsset.kind === 'audio' || tAsset.status !== 'ready') return setBase(null);
    const mid = tAsset.kind === 'video' ? Math.round(((clip.in + clip.out) / 2) * 2) / 2 : 0;
    loadFrame(tAsset.id, mid, 320).then(setBase, () => setBase(null));
  }, [clip?.id, clip?.in, clip?.out, tAsset?.status]);

  // Referans ya da hedef değişince eski eşleme geçersiz
  useEffect(() => {
    if (match && (match.refId !== selId || match.target !== targetKey)) {
      if (previewing) void reload();
      setPreviewing(false);
      setMatch(null);
    }
  }, [selId, targetKey]);

  const add = async (files: File[]) => {
    if (!files.length) return;
    setBusy('Referans ekleniyor…');
    try {
      const r = await upload(`/api/import?projectId=${project.id}&role=reference`, files, () => undefined);
      await reload();
      const last = r.state?.project?.references?.at(-1);
      if (last) setSelId(last.id);
      toast(`${files.length} referans eklendi`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const doMatch = async () => {
    if (!ref) return;
    setBusy('Renkler karşılaştırılıyor…');
    try {
      if (previewing) await reload();
      const r = await api.colorMatch(project.id, ref.id, target === 'klip' ? (clip?.id ?? null) : null);
      await refreshLuts();
      setMatch({ refId: ref.id, target: targetKey, lutId: r.lutId, name: r.name, summary: r.summary, swatches: r.swatches });
      if (target === 'klip' && item && (t < item.start || t >= item.end)) seekRef.current?.(Math.round((item.start + item.duration / 2) * FPS));
      preview(lutOps(project, target === 'klip' ? clip : null, r.lutId, amount));
      setPreviewing(true);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const setAmt = (v: number) => {
    setAmount(v);
    if (match) {
      preview(lutOps(project, target === 'klip' ? clip : null, match.lutId, v));
      setPreviewing(true);
    }
  };

  const doApply = async () => {
    if (!match) return;
    if (previewing) await reload();
    apply(lutOps(project, target === 'klip' ? clip : null, match.lutId, amount), { label: `Renk eşleme: ${match.name}` });
    setPreviewing(false);
    toast(`Renk eşlendi. LUT'larım'da “${match.name}” olarak duruyor.`);
    setMatch(null);
  };
  const cancel = async () => {
    if (previewing) await reload();
    setPreviewing(false);
    setMatch(null);
  };

  return (
    <div className="refp">
      <div className="row-between">
        <h4>Referanslar</h4>
        <button className="btn tiny" onClick={() => input.current?.click()} title="Beğendiğiniz bir fotoğraf veya video">
          <Plus size={13} /> Ekle
        </button>
        <input ref={input} type="file" multiple hidden accept="image/*,video/*" onChange={(e) => (void add([...(e.target.files ?? [])]), (e.target.value = ''))} />
      </div>
      {busy ? (
        <p className="hint small">
          <Loader2 size={12} className="spin" /> {busy}
        </p>
      ) : null}
      {!project.references.length ? (
        <div className="lut-empty">
          <p className="small">Rengini beğendiğiniz bir fotoğraf veya video ekleyin; kurgunun rengini ona yaklaştıralım.</p>
          <p className="muted small">Referans videoya girmez. Sonuç yaklaşıktır; önizleyip onaylarsınız.</p>
        </div>
      ) : (
        <div className="ref-list">
          {project.references.map((r) => {
            const a = library.get(r.assetId);
            return (
              <div key={r.id} className={`ref-card ${selId === r.id ? 'sel' : ''}`} onClick={() => setSelId(r.id)} data-ref={a?.name}>
                {a?.status === 'ready' ? <img src={`/api/assets/${encodeURIComponent(r.assetId)}/frame?t=${r.at.toFixed(2)}&w=320`} alt="" /> : <div className="ref-wait"><Loader2 size={14} className="spin" /></div>}
                <div className="row-between small">
                  <span className="ellipsis" title={a?.name}>{a?.name ?? '…'}</span>
                  <button
                    className="icon-btn sm"
                    title="Referansı kaldır (dosya kütüphanede kalır)"
                    onClick={(e) => {
                      e.stopPropagation();
                      apply([{ type: 'reference.remove', id: r.id }]);
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {a?.kind === 'video' && selId === r.id ? (
                  <div onClick={(e) => e.stopPropagation()}>
                    <Slider
                      label={`Kare · ${formatTime(r.at)}`}
                      value={r.at}
                      min={0}
                      max={Math.max(0.1, a.duration - 0.1)}
                      step={0.1}
                      format={() => ''}
                      onChange={(v) => apply([{ type: 'reference.update', id: r.id, patch: { at: Math.round(v * 10) / 10 } }], { key: `refat:${r.id}` })}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      {ref && refAsset ? (
        <div className="ref-match">
          <b className="small">Rengini al</b>
          <Segmented
            size="sm"
            value={target}
            onChange={setTarget}
            options={[
              { value: 'klip', label: clip ? `${index}. klip` : 'Seçili klip', hint: 'Yalnız bu klibin rengini eşle' },
              { value: 'tum', label: 'Tüm kurgu', hint: 'Bütün kliplerin ortak rengini eşle' },
            ]}
          />
          {!match ? (
            <button className="btn primary tiny" disabled={!!busy || refAsset.status !== 'ready' || !clip} onClick={doMatch}>
              <Palette size={13} /> Rengi eşle
            </button>
          ) : (
            <>
              <div className="swatches small">
                <span>
                  <i style={{ background: match.swatches.reference }} /> Referans
                </span>
                <span>
                  <i style={{ background: match.swatches.target }} /> {target === 'klip' ? 'Klip' : 'Kurgu'}
                </span>
              </div>
              <ul className="ref-summary">
                {match.summary.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
              {target === 'klip' ? (
                <div className="cmp-split ref-split" style={{ ['--split' as string]: `${split}%` }}>
                  <LutCanvas base={base} lutUrl={urls[match.lutId] ?? null} camUrl={cam ? (urls[cam] ?? null) : null} amount={amount} className="cmp-after" />
                  <LutCanvas base={base} lutUrl={null} camUrl={cam ? (urls[cam] ?? null) : null} className="cmp-before" />
                  <span className="cmp-label left">Önce</span>
                  <span className="cmp-label right">Sonra</span>
                  <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Önce / sonra" className="cmp-range" />
                </div>
              ) : null}
              <Slider label="Yoğunluk" value={amount} min={0} max={1} format={fmtPct} onChange={setAmt} />
              <div className="row lut-actions">
                <button className="btn primary tiny" onClick={() => void doApply()}>
                  <Check size={13} /> Uygula
                </button>
                <button className="btn tiny" onClick={() => void cancel()}>
                  <X size={13} /> Vazgeç
                </button>
              </div>
              <p className="muted tiny-note">Büyük önizlemede kaydedilmeden gösteriliyor. Sonuç yaklaşıktır; referanstaki LUT birebir çıkarılmaz.</p>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
};
