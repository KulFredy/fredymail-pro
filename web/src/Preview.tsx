import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import { Eye, EyeOff, Move } from 'lucide-react';
import { FORMATS, outputLabel } from '../../src/core/formats';
import { FPS, type CompProps, type Framing } from '../../src/core/schema';
import { computeBox, framingFor, layoutClips, outputFrames, outputSize, panFraming, toFrames } from '../../src/core/timeline';
import { Main } from '../../src/remotion/Main';
import { useProject } from './state';
import { Transport } from './Transport';

const SafeZones: React.FC<{ format: keyof typeof FORMATS; scale: number }> = ({ format, scale }) => {
  const f = FORMATS[format];
  if (format === 'post' && f.gridGuide) {
    const side = ((f.width - f.gridGuide.width) / 2) * scale;
    return (
      <div className="safe">
        <div className="safe-grid" style={{ left: side, right: side }} title="Profil ızgarasında görünen alan (3:4)" />
      </div>
    );
  }
  if (format === 'landscape') return null;
  return (
    <div className="safe">
      <div className="safe-top" style={{ height: f.safe.top * scale }}>
        <span>Instagram üst bilgisi</span>
      </div>
      <div className="safe-bottom" style={{ height: f.safe.bottom * scale }}>
        <span>{format === 'story' ? 'Yanıt alanı' : 'Açıklama ve müzik'}</span>
      </div>
      {f.safe.right > 100 ? <div className="safe-right" style={{ width: f.safe.right * scale, bottom: f.safe.bottom * scale }} /> : null}
    </div>
  );
};

export const Preview: React.FC = () => {
  const { project, refs, lutMap, setUi, apply, preview, frame, setFrame, seekRef, playRef, setPlaying } = useProject();
  const player = useRef<PlayerRef>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 360, h: 640 });
  const output = project.outputs.find((o) => o.id === project.ui.activeOutputId) ?? project.outputs[0];
  const size = output ? outputSize(output) : { width: 1080, height: 1920 };
  const duration = output ? outputFrames(project, output) : 1;
  const inFrame = project.ui.step === 'kadraj';

  // Önizleme kutusunu sütuna sığdır
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const maxW = el.clientWidth;
      const maxH = el.clientHeight;
      const s = Math.min(maxW / size.width, maxH / size.height);
      setBox({ w: Math.floor(size.width * s), h: Math.floor(size.height * s) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [size.width, size.height]);

  // Hata ekranı kalıcı olmasın: kaynaklar hazır oldukça veya "Yeniden dene" ile oynatıcı yenilenir
  const [retry, setRetry] = useState(0);
  const readyKey = project.clips.map((c) => (refs[c.assetId]?.url ? '1' : '0')).join('') + (project.music && refs[project.music.assetId]?.url ? 'm' : '');
  const props: CompProps = useMemo(
    () => ({ project, assets: refs, outputId: output?.id ?? '', variant: 'full', target: 'preview', luts: lutMap }),
    [project, refs, output?.id, lutMap],
  );

  // Oynatma konumu: arayüze ve projeye (yeniden açınca aynı yer)
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    let last = 0;
    let saveTimer = 0;
    const onFrame = (e: { detail: { frame: number } }) => {
      const now = performance.now();
      if (now - last > 90) {
        last = now;
        setFrame(e.detail.frame);
      }
      clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => setUi({ frame: e.detail.frame }), 1200);
    };
    p.addEventListener('frameupdate', onFrame);
    p.addEventListener('seeked', onFrame);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    p.addEventListener('play', onPlay);
    p.addEventListener('pause', onPause);
    p.addEventListener('ended', onPause);
    seekRef.current = (f) => {
      p.seekTo(Math.max(0, Math.min(duration - 1, f)));
      setFrame(f);
    };
    playRef.current = { play: () => p.play(), pause: () => p.pause() };
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('seeked', onFrame);
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
      p.removeEventListener('ended', onPause);
      clearTimeout(saveTimer);
    };
  }, [duration, seekRef, playRef, setFrame, setUi, output?.id, readyKey, retry, setPlaying]);

  // Kadrajda seçili klibi sürükleyerek kaydır
  const scale = box.w / size.width;
  const layout = layoutClips(project);
  const selected = project.clips.find((c) => c.id === project.ui.selectedClipId) ?? project.clips[0];
  const visibleClip =
    output?.kind === 'image'
      ? project.clips.find((c) => c.id === output.still?.clipId)
      : layout.find((l) => frame >= toFrames(l.start) && frame < toFrames(l.end))?.clip;
  const dragClip = output?.kind === 'image' ? visibleClip : selected && visibleClip?.id === selected.id ? selected : visibleClip;
  const dragAsset = dragClip ? refs[dragClip.assetId] : undefined;
  const drag = useRef<{ x: number; y: number; f: Framing } | null>(null);

  const onDown = (e: React.PointerEvent) => {
    if (!output || !dragClip || !dragAsset) return;
    const f = framingFor(output, dragClip);
    if (f.mode !== 'fill') return;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, f };
  };
  const nextFraming = (e: React.PointerEvent) => {
    const d = drag.current!;
    const b = computeBox(dragAsset!.width, dragAsset!.height, size.width, size.height, d.f);
    return panFraming(d.f, b, (e.clientX - d.x) / scale, (e.clientY - d.y) / scale);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !output || !dragClip) return;
    const f = nextFraming(e);
    preview([{ type: 'output.setFraming', outputId: output.id, clipId: dragClip.id, framing: { x: f.x, y: f.y } }]);
  };
  const onUp = (e: React.PointerEvent) => {
    if (!drag.current || !output || !dragClip) return;
    const f = nextFraming(e);
    drag.current = null;
    apply([{ type: 'output.setFraming', outputId: output.id, clipId: dragClip.id, framing: { x: f.x, y: f.y } }]);
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!output || !dragClip) return;
    const f = framingFor(output, dragClip);
    if (f.mode !== 'fill') return;
    const zoom = Math.min(4, Math.max(1, f.zoom * (e.deltaY < 0 ? 1.06 : 1 / 1.06)));
    apply([{ type: 'output.setFraming', outputId: output.id, clipId: dragClip.id, framing: { zoom } }], { key: `zoom:${dragClip.id}`, label: 'Yakınlaştırma' });
  };

  if (!output) return <div className="preview-empty">Önce bir biçim seçin</div>;
  const dragMode = dragClip ? framingFor(output, dragClip).mode : 'fill';

  return (
    <div className="preview">
      <div className="preview-tabs">
        {project.outputs.map((o) => (
          <button key={o.id} className={o.id === output.id ? 'on' : ''} onClick={() => setUi({ activeOutputId: o.id })}>
            {outputLabel(o.format, o.kind)}
          </button>
        ))}
      </div>
      <div className="player-wrap" ref={wrap}>
        <div className="phone" style={{ width: box.w }}>
          <Player
            key={`${readyKey}:${retry}:${output?.id}`}
            ref={player}
            component={Main}
            inputProps={props}
            durationInFrames={Math.max(1, duration)}
            fps={FPS}
            compositionWidth={size.width}
            compositionHeight={size.height}
            style={{ width: box.w, height: box.h }}
            controls={false}
            loop
            initialFrame={Math.min(project.ui.frame, Math.max(0, duration - 1))}
            clickToPlay={!inFrame}
            spaceKeyToPlayOrPause={false}
            acknowledgeRemotionLicense
            errorFallback={({ error }) => (
              <div className="player-error">
                <b>Önizleme açılamadı</b>
                <small>{error.message}</small>
                <button className="btn tiny" onClick={() => setRetry((r) => r + 1)}>
                  Yeniden dene
                </button>
              </div>
            )}
          />
          {project.ui.safeZones ? (
            <div className="overlay" style={{ width: box.w, height: box.h }}>
              <SafeZones format={output.format} scale={scale} />
            </div>
          ) : null}
          {inFrame && dragClip ? (
            <div
              className={`drag-layer ${dragMode === 'fill' ? 'can' : ''}`}
              style={{ width: box.w, height: box.h }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onWheel={onWheel}
              title={dragMode === 'fill' ? 'Sürükleyerek kaydırın, tekerlekle yakınlaştırın' : 'Sığdır modunda kadraj ortalanır'}
            >
              {dragMode === 'fill' ? (
                <span className="drag-hint">
                  <Move size={14} /> Sürükle · kaydır
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
      <Transport duration={duration} isImage={output.kind === 'image'} />
      <div className="preview-foot">
        <button className="chip" onClick={() => setUi({ safeZones: !project.ui.safeZones })}>
          {project.ui.safeZones ? <Eye size={14} /> : <EyeOff size={14} />} Instagram alanları
        </button>
        <span className="muted mono">
          {size.width}×{size.height}
        </span>
      </div>
    </div>
  );
};
