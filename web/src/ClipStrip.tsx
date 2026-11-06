import React, { useState } from 'react';
import { Image as ImageIcon, Video, Loader2, Mic, MicOff, AlertTriangle, Music2 } from 'lucide-react';
import { formatTime, layoutClips, toFrames, totalDuration } from '../../src/core/timeline';
import { fileHref } from './api';
import { useApp, useProject } from './state';

export const ClipStrip: React.FC = () => {
  const { project, apply, setUi, frame, seekRef } = useProject();
  const { library } = useApp();
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const layout = layoutClips(project);
  const total = totalDuration(project);
  const t = frame / 30;
  const music = project.music ? library.get(project.music.assetId) : undefined;
  const hasImageOutput = project.outputs.find((o) => o.id === project.ui.activeOutputId)?.kind === 'image';

  const drop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const order = project.clips.map((c) => c.id).filter((id) => id !== dragId);
    order.splice(order.indexOf(targetId) + (layout.findIndex((l) => l.clip.id === targetId) > layout.findIndex((l) => l.clip.id === dragId) ? 1 : 0), 0, dragId);
    apply([{ type: 'clips.reorder', order }]);
  };

  if (!project.clips.length) return <div className="strip-empty">Klipler burada görünecek. Sürükleyerek sıralayabilirsiniz.</div>;

  return (
    <div className="strip">
      <div className="strip-meta">
        <b className="mono">{formatTime(total)}</b>
        <small className="muted">toplam</small>
        {music ? (
          <small className="muted ellipsis" title={music.name}>
            <Music2 size={12} /> {music.name}
          </small>
        ) : null}
      </div>
      <div className="strip-clips">
        {layout.map((item, i) => {
          const a = library.get(item.clip.assetId);
          const sel = project.ui.selectedClipId === item.clip.id;
          const playing = !hasImageOutput && t >= item.start && t < item.end;
          const tr = a?.transcript.status;
          return (
            <div
              key={item.clip.id}
              className={`clip ${sel ? 'sel' : ''} ${playing ? 'playing' : ''} ${overId === item.clip.id ? 'over' : ''}`}
              style={{ flexGrow: Math.max(0.6, item.duration), backgroundImage: a?.poster ? `url(${fileHref(a.poster)})` : undefined }}
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
                setUi({ selectedClipId: item.clip.id });
                seekRef.current?.(toFrames(item.start) + 1);
              }}
              title={a?.name}
            >
              <span className="clip-num">{i + 1}</span>
              <span className="clip-kind">{a?.kind === 'image' ? <ImageIcon size={13} /> : <Video size={13} />}</span>
              <span className="clip-dur mono">{item.duration.toFixed(1).replace('.', ',')} sn</span>
              {a?.status === 'importing' ? (
                <span className="clip-badge">
                  <Loader2 size={12} className="spin" /> hazırlanıyor
                </span>
              ) : a?.status === 'error' ? (
                <span className="clip-badge err">
                  <AlertTriangle size={12} /> hata
                </span>
              ) : a?.kind === 'video' ? (
                <span className="clip-badge" title={a.transcript.message}>
                  {tr === 'running' || tr === 'pending' ? <Loader2 size={12} className="spin" /> : tr === 'done' && a.transcript.words.length ? <Mic size={12} /> : <MicOff size={12} />}
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
