import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, Plus, ZoomIn, ZoomOut } from 'lucide-react';
import { FPS } from '../../src/core/schema';
import { captionPages, formatTime, layoutClips, timelineWords, toFrames, totalDuration } from '../../src/core/timeline';
import { fileHref } from './api';
import { useApp, useProject } from './state';

export type Selection = { kind: 'clip' | 'overlay' | 'voice' | 'text'; id: string } | null;

const LABEL_W = 92;

/**
 * Çok izli zaman çizelgesi: cetvel, oynatma imleci, görüntü / üst iz / dış ses / müzik / altyazı / yazı izleri.
 * Hızlı Edit'te sade (compact), Stüdyo'da tam görünüm.
 */
const LANE_ACTION: Record<string, string> = {
  v1: 'Görüntü ekle',
  v2: 'Üst ize görüntü ekle (B-roll)',
  a2: 'Dış ses kaydet',
  a1: 'Müzik ekle',
  c: 'Altyazıyı aç/kapat',
  t: 'Oynatma imlecine yazı ekle',
};

export const Timeline: React.FC<{ compact?: boolean; selection?: Selection; onSelect?: (s: Selection) => void; onLaneAction?: (key: string) => void }> = ({
  compact,
  selection,
  onSelect,
  onLaneAction,
}) => {
  const { project, refs, frame, seekRef, setUi, apply, highlights } = useProject();
  const { library } = useApp();
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [zoom, setZoom] = useState(1);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const total = Math.max(1, totalDuration(project));
  const layout = layoutClips(project);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth - LABEL_W - 12));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pps = (width / total) * zoom; // saniye başına piksel
  const x = (t: number) => t * pps;
  const contentW = Math.max(width, total * pps);
  const t = frame / FPS;

  const pages = useMemo(() => captionPages(timelineWords(project, refs), { maxChars: 26, maxLines: 2 }), [project, refs]);
  const tickStep = pps > 120 ? 0.5 : pps > 50 ? 1 : pps > 20 ? 2 : pps > 8 ? 5 : 10;
  const ticks = Array.from({ length: Math.floor(total / tickStep) + 1 }, (_, i) => i * tickStep);

  const seekToX = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const sec = Math.max(0, Math.min(total, (clientX - r.left) / pps));
    seekRef.current?.(toFrames(sec));
  };
  const scrub = useRef(false);

  const select = (s: Selection) => {
    onSelect?.(s);
    if (s?.kind === 'clip') setUi({ selectedClipId: s.id });
  };

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const order = project.clips.map((c) => c.id).filter((id) => id !== dragId);
    const after = layout.findIndex((l) => l.clip.id === targetId) > layout.findIndex((l) => l.clip.id === dragId);
    order.splice(order.indexOf(targetId) + (after ? 1 : 0), 0, dragId);
    apply([{ type: 'clips.reorder', order }]);
  };

  const music = project.music ? library.get(project.music.assetId) : undefined;
  const lanes: { key: string; label: string; show: boolean }[] = [
    { key: 'v1', label: 'Görüntü', show: true },
    { key: 'v2', label: 'Üst iz', show: !compact || project.overlays.length > 0 },
    { key: 'a2', label: 'Dış ses', show: !compact || project.voice.length > 0 },
    { key: 'a1', label: 'Müzik', show: true },
    { key: 'c', label: 'Altyazı', show: project.captions.enabled && (!compact || pages.length > 0) },
    { key: 't', label: 'Yazı', show: !compact || project.texts.length > 0 },
  ];

  if (!project.clips.length) return <div className="strip-empty">Klipler burada görünecek. Eklemek için “Ekle” adımını veya Telefondan ekle'yi kullanın.</div>;

  return (
    <div className={`timeline ${compact ? 'compact' : ''}`} ref={wrap}>
      <div className="tl-head">
        <b className="mono">{formatTime(t)}</b>
        <span className="muted mono">/ {formatTime(total)}</span>
        <div className="spacer" />
        <button className="icon-btn" title="Uzaklaş" onClick={() => setZoom((z) => Math.max(1, z / 1.5))} disabled={zoom <= 1}>
          <ZoomOut size={15} />
        </button>
        <button className="icon-btn" title="Yakınlaş" onClick={() => setZoom((z) => Math.min(30, z * 1.5))}>
          <ZoomIn size={15} />
        </button>
      </div>
      <div className="tl-body">
        <div className="tl-labels" style={{ width: LABEL_W }}>
          <div className="tl-ruler-label" />
          {lanes.filter((l) => l.show).map((l) =>
            onLaneAction ? (
              <button key={l.key} className={`tl-label lane-${l.key} action`} title={LANE_ACTION[l.key]} onClick={() => onLaneAction(l.key)}>
                <span>{l.label}</span>
                <Plus size={12} />
              </button>
            ) : (
              <div key={l.key} className={`tl-label lane-${l.key}`}>
                {l.label}
              </div>
            ),
          )}
        </div>
        <div className="tl-scroll">
          <div className="tl-content" style={{ width: contentW }}>
            <div
              className="tl-ruler"
              onPointerDown={(e) => {
                scrub.current = true;
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                seekToX(e.clientX, e.currentTarget);
              }}
              onPointerMove={(e) => scrub.current && seekToX(e.clientX, e.currentTarget)}
              onPointerUp={() => (scrub.current = false)}
            >
              {ticks.map((s) => (
                <span key={s} className="tick" style={{ left: x(s) }}>
                  {Number.isInteger(s) ? formatTime(s).replace(/\.\d$/, '') : ''}
                </span>
              ))}
            </div>

            {lanes.filter((l) => l.show).map((l) => (
              <div key={l.key} className={`tl-lane lane-${l.key}`} onPointerDown={(e) => e.target === e.currentTarget && seekToX(e.clientX, e.currentTarget)}>
                {l.key === 'v1'
                  ? layout.map((item, i) => {
                      const a = library.get(item.clip.assetId);
                      const sel = selection ? selection.kind === 'clip' && selection.id === item.clip.id : project.ui.selectedClipId === item.clip.id;
                      return (
                        <div
                          key={item.clip.id}
                          data-clip-id={item.clip.id}
                          data-asset-id={item.clip.assetId}
                          data-start={item.start.toFixed(3)}
                          className={`tl-item clip ${sel ? 'sel' : ''} ${overId === item.clip.id ? 'over' : ''}`}
                          style={{ left: x(item.start), width: Math.max(2, x(item.duration) - 2), backgroundImage: a?.poster ? `url(${fileHref(a.poster)})` : undefined }}
                          draggable
                          onDragStart={() => setDragId(item.clip.id)}
                          onDragOver={(e) => {
                            e.preventDefault();
                            setOverId(item.clip.id);
                          }}
                          onDragLeave={() => setOverId(null)}
                          onDrop={() => {
                            drop(item.clip.id);
                            setDragId(null);
                            setOverId(null);
                          }}
                          onClick={() => {
                            select({ kind: 'clip', id: item.clip.id });
                            if (t < item.start || t >= item.end) seekRef.current?.(toFrames(item.start) + 1);
                          }}
                          title={`${a?.name ?? ''} · ${item.duration.toFixed(1)} sn`}
                        >
                          <span className="tl-tag">
                            {i + 1}
                            {a?.status === 'importing' ? <Loader2 size={10} className="spin" /> : null}
                          </span>
                          {x(item.duration) > 70 ? <span className="tl-name">{a?.name}</span> : null}
                        </div>
                      );
                    })
                  : l.key === 'v2'
                    ? project.overlays.map((o) => {
                        const a = library.get(o.assetId);
                        return (
                          <div
                            key={o.id}
                            className={`tl-item overlay ${selection?.kind === 'overlay' && selection.id === o.id ? 'sel' : ''}`}
                            style={{ left: x(o.at), width: Math.max(2, x(o.out - o.in) - 1), backgroundImage: a?.poster ? `url(${fileHref(a.poster)})` : undefined }}
                            onClick={() => select({ kind: 'overlay', id: o.id })}
                            title={`${a?.name ?? ''} · ${(o.out - o.in).toFixed(1)} sn · ana ses devam eder`}
                          >
                            <span className="tl-name">{a?.name}</span>
                          </div>
                        );
                      })
                    : l.key === 'a2'
                      ? project.voice.map((v) => (
                          <div
                            key={v.id}
                            className={`tl-item voice ${selection?.kind === 'voice' && selection.id === v.id ? 'sel' : ''}`}
                            style={{ left: x(v.at), width: Math.max(2, x(v.out - v.in) - 1) }}
                            onClick={() => select({ kind: 'voice', id: v.id })}
                          >
                            <span className="tl-name">🎙 {library.get(v.assetId)?.name}</span>
                          </div>
                        ))
                      : l.key === 'a1'
                        ? music
                          ? (
                              <div className="tl-item music" style={{ left: 0, width: x(total) }}>
                                <span className="tl-name">
                                  ♪ {music.name} · {project.music?.mode === 'bed' ? 'arka planda kısık' : project.music?.mode === 'duck' ? 'konuşmada kısılır' : 'sabit'}
                                </span>
                              </div>
                            )
                          : <span className="tl-empty">Müzik yok</span>
                        : l.key === 'c'
                          ? pages.map((p, i) => (
                              <div key={i} className="tl-item caption" style={{ left: x(p.start), width: Math.max(2, x(p.end - p.start) - 1) }} title={p.lines.flat().map((w) => w.text).join(' ')}>
                                <span className="tl-name">{p.lines.flat().map((w) => w.text).join(' ')}</span>
                              </div>
                            ))
                          : project.texts.map((tx) => (
                              <div
                                key={tx.id}
                                className={`tl-item text ${selection?.kind === 'text' && selection.id === tx.id ? 'sel' : ''}`}
                                style={{ left: x(tx.start), width: Math.max(2, x(tx.end - tx.start) - 1) }}
                                onClick={() => select({ kind: 'text', id: tx.id })}
                              >
                                <span className="tl-name">T {tx.text}</span>
                              </div>
                            ))}
              </div>
            ))}

            {highlights.map((h, i) => (
              <div key={i} className={`tl-highlight ${h.kind}`} style={{ left: x(h.start), width: Math.max(3, x(h.end - h.start)) }}>
                <span>{formatTime(h.start)}</span>
              </div>
            ))}
            <div className="tl-playhead" data-t={t.toFixed(3)} style={{ left: x(t) }} />
          </div>
        </div>
      </div>
    </div>
  );
};
