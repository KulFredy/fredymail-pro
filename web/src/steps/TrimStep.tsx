import React, { useEffect, useRef, useState } from 'react';
import { Trash2, Play, Copy, ArrowLeft, ArrowRight, Pencil } from 'lucide-react';
import { layoutClips, toFrames, totalDuration } from '../../../src/core/timeline';
import { fileHref } from '../api';
import { useApp, useProject } from '../state';
import { Section, Slider, fmtSec, useContextMenu } from '../ui';

const useWaveform = (rel: string | null) => {
  const [peaks, setPeaks] = useState<number[] | null>(null);
  useEffect(() => {
    if (!rel) return setPeaks(null);
    fetch(fileHref(rel))
      .then((r) => r.json())
      .then((j) => setPeaks(j.peaks))
      .catch(() => setPeaks(null));
  }, [rel]);
  return peaks;
};

/** Kaynak süresi üzerinde iki tutamaçlı kesme çubuğu */
export const RangeBar: React.FC<{
  duration: number;
  value: [number, number];
  onChange: (v: [number, number], final: boolean) => void;
  peaks?: number[] | null;
  poster?: string | null;
  marks?: { t0: number; t1: number }[];
}> = ({ duration, value, onChange, peaks, poster, marks }) => {
  const bar = useRef<HTMLDivElement>(null);
  const drag = useRef<'in' | 'out' | null>(null);
  const toT = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((clientX - r.left) / r.width) * duration));
  };
  const move = (e: React.PointerEvent, final: boolean) => {
    if (!drag.current) return;
    const t = toT(e.clientX);
    const v: [number, number] = drag.current === 'in' ? [Math.min(t, value[1] - 0.2), value[1]] : [value[0], Math.max(t, value[0] + 0.2)];
    onChange(v, final);
    if (final) drag.current = null;
  };
  const pct = (t: number) => `${(t / duration) * 100}%`;
  return (
    <div
      className="rangebar"
      ref={bar}
      style={{ backgroundImage: poster ? `url(${fileHref(poster)})` : undefined }}
      onPointerMove={(e) => move(e, false)}
      onPointerUp={(e) => move(e, true)}
    >
      {peaks ? (
        <svg className="wave" viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none">
          {peaks.map((p, i) => (
            <rect key={i} x={i} y={50 - p * 48} width={1} height={Math.max(1, p * 96)} />
          ))}
        </svg>
      ) : null}
      {marks?.map((m, i) => <span key={i} className="speech-mark" style={{ left: pct(m.t0), width: pct(m.t1 - m.t0) }} />)}
      <div className="dim" style={{ left: 0, width: pct(value[0]) }} />
      <div className="dim" style={{ left: pct(value[1]), right: 0 }} />
      <div className="sel-range" style={{ left: pct(value[0]), width: pct(value[1] - value[0]) }} />
      {(['in', 'out'] as const).map((h) => (
        <div
          key={h}
          className={`handle ${h}`}
          style={{ left: pct(h === 'in' ? value[0] : value[1]) }}
          onPointerDown={(e) => {
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
            drag.current = h;
          }}
        />
      ))}
    </div>
  );
};

export const TrimStep: React.FC = () => {
  const { project, apply, preview, setUi, seekRef, playRef } = useProject();
  const { library, toast } = useApp();
  const [ctxMenu, openCtx] = useContextMenu();
  const chipMenu = (e: React.MouseEvent, id: string, i: number) => {
    setUi({ selectedClipId: id });
    const order = project.clips.map((c) => c.id);
    const swap = (d: -1 | 1) => {
      const o = [...order];
      [o[i], o[i + d]] = [o[i + d], o[i]];
      apply([{ type: 'clips.reorder', order: o }]);
    };
    const it = layoutClips(project).find((l) => l.clip.id === id);
    openCtx(
      e,
      [
        { label: 'Oynat', icon: <Play size={14} />, onSelect: () => (seekRef.current?.(toFrames(it?.start ?? 0)), playRef.current?.play()) },
        'sep',
        { label: 'Çoğalt', icon: <Copy size={14} />, onSelect: () => apply([{ type: 'clip.duplicate', clipId: id }]) },
        { label: 'Sola taşı', icon: <ArrowLeft size={14} />, disabled: i === 0, onSelect: () => swap(-1) },
        { label: 'Sağa taşı', icon: <ArrowRight size={14} />, disabled: i === order.length - 1, onSelect: () => swap(1) },
        { label: 'Kırp', icon: <Pencil size={14} />, onSelect: () => setUi({ selectedClipId: id }) },
        'sep',
        { label: 'Sil', icon: <Trash2 size={14} />, kbd: '⌫', danger: true, onSelect: () => (apply([{ type: 'clips.remove', clipId: id }]), toast('Klip silindi (geri almak için ⌘Z)')) },
      ],
      `${i + 1}. klip · ${library.get(project.clips[i].assetId)?.name ?? ''}`,
    );
  };
  const clip = project.clips.find((c) => c.id === project.ui.selectedClipId) ?? project.clips[0];
  const asset = clip ? library.get(clip.assetId) : undefined;
  const peaks = useWaveform(asset?.kind === 'video' ? asset.waveform : null);
  const total = totalDuration(project);
  if (!clip || !asset) return <p className="muted">Önce klip ekleyin.</p>;
  const item = layoutClips(project).find((l) => l.clip.id === clip.id)!;
  const words = asset.transcript.words;
  const speech = words.length ? [{ t0: words[0].t0, t1: words[words.length - 1].t1 }] : [];

  return (
    <div className="stack">
      <div className="target">
        <span>Toplam süre</span>
        <b className="mono">{fmtSec(total)}</b>
        <div className="target-bar">
          <i style={{ width: `${Math.min(100, (total / 15) * 100)}%` }} className={total > 60 ? 'over' : ''} />
        </div>
        <small className="muted">Story hedefi ≈15 sn · tek Story en çok 60 sn</small>
      </div>

      <Section
        title={`Klip ${project.clips.indexOf(clip) + 1}: ${asset.name}`}
        aside={
          <div className="row">
            <button
              className="btn tiny"
              onClick={() => {
                seekRef.current?.(toFrames(item.start));
                playRef.current?.play();
              }}
            >
              <Play size={13} /> Oynat
            </button>
            <button className="btn tiny danger" onClick={() => apply([{ type: 'clips.remove', clipId: clip.id }])}>
              <Trash2 size={13} /> Çıkar
            </button>
          </div>
        }
        hint={asset.kind === 'video' ? 'Tutamaçları sürükleyerek başı ve sonu seçin. Turuncu şerit konuşmanın olduğu bölüm.' : 'Fotoğrafın ekranda kalma süresi.'}
      >
        {asset.kind === 'video' ? (
          <>
            <RangeBar
              duration={asset.duration}
              value={[clip.in, clip.out]}
              peaks={peaks}
              poster={asset.poster}
              marks={speech}
              onChange={([a, b], final) => {
                const op = { type: 'clip.trim' as const, clipId: clip.id, in: a, out: b };
                if (final) apply([op]);
                else preview([op]);
              }}
            />
            <div className="row-between mono small">
              <span>Başlangıç {clip.in.toFixed(2)} sn</span>
              <span>Süre {(clip.out - clip.in).toFixed(2)} sn</span>
              <span>Bitiş {clip.out.toFixed(2)} sn</span>
            </div>
            {words.length ? (
              <button
                className="btn soft"
                onClick={() => apply([{ type: 'clip.trim', clipId: clip.id, in: Math.max(0, words[0].t0 - 0.35), out: Math.min(asset.duration, words[words.length - 1].t1 + 0.5) }], { label: 'Konuşmaya göre kısaltıldı' })}
              >
                Konuşmaya göre kısalt
              </button>
            ) : null}
          </>
        ) : (
          <Slider
            label="Süre"
            value={clip.out - clip.in}
            min={0.5}
            max={10}
            step={0.1}
            format={fmtSec}
            onChange={(v) => apply([{ type: 'clip.trim', clipId: clip.id, in: 0, out: v }], { key: `trim:${clip.id}`, label: 'Fotoğraf süresi' })}
          />
        )}
      </Section>
      <Section title="Sıralama" hint="Alttaki şeritte klipleri sürükleyip bırakarak sıralayın. Bir klibi seçmek için üzerine tıklayın.">
        <div className="row-wrap">
          {ctxMenu}
          {project.clips.map((c, i) => (
            <button key={c.id} className={`chip ${c.id === clip.id ? 'on' : ''}`} onClick={() => setUi({ selectedClipId: c.id })} onContextMenu={(e) => chipMenu(e, c.id, i)} title="Sağ tık: seçenekler">
              {i + 1}. {library.get(c.assetId)?.name}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
};
