import React, { useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight, Expand } from 'lucide-react';
import { FPS } from '../../src/core/schema';
import { formatTime } from '../../src/core/timeline';
import { useProject } from './state';

/** Her zaman görünen oynatma çubuğu: oynat/durdur, kare adımı, başa/sona; boşluk ve ok tuşları */
export const Transport: React.FC<{ duration: number; isImage: boolean }> = ({ duration, isImage }) => {
  const { frame, playing, seekRef, playRef } = useProject();
  const toggle = () => (playing ? playRef.current?.pause() : playRef.current?.play());
  const seek = (f: number) => seekRef.current?.(Math.max(0, Math.min(duration - 1, f)));

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target as HTMLElement).isContentEditable) return;
      if (e.code === 'Space') {
        e.preventDefault();
        toggle();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        seek(frame - (e.shiftKey ? FPS : 1));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        seek(frame + (e.shiftKey ? FPS : 1));
      } else if (e.key === 'Home') seek(0);
      else if (e.key === 'End') seek(duration - 1);
      else if (e.key.toLowerCase() === 'f' && !e.metaKey && !e.ctrlKey) playRef.current?.fullscreen?.();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  if (isImage) return <div className="transport muted small">Görsel çıktı · tek kare</div>;
  return (
    <div className="transport">
      <button className="icon-btn" title="Başa (Home)" onClick={() => seek(0)}>
        <SkipBack size={16} />
      </button>
      <button className="icon-btn" title="Bir kare geri (←)" onClick={() => seek(frame - 1)}>
        <ChevronLeft size={18} />
      </button>
      <button className="play-btn" title={playing ? 'Durdur (boşluk)' : 'Oynat (boşluk)'} onClick={toggle}>
        {playing ? <Pause size={20} /> : <Play size={20} />}
      </button>
      <button className="icon-btn" title="Bir kare ileri (→)" onClick={() => seek(frame + 1)}>
        <ChevronRight size={18} />
      </button>
      <button className="icon-btn" title="Sona (End)" onClick={() => seek(duration - 1)}>
        <SkipForward size={16} />
      </button>
      <button className="icon-btn" title="Tam ekran (F)" onClick={() => playRef.current?.fullscreen?.()}>
        <Expand size={16} />
      </button>
      <span className="mono time">
        {formatTime(frame / FPS)} <span className="muted">/ {formatTime(duration / FPS)}</span>
      </span>
    </div>
  );
};
