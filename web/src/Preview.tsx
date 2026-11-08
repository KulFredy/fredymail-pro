import React, { useEffect, useMemo, useRef, useState } from 'react';
import { outputTitle } from '../../src/core/channels';
import { Player, type PlayerRef } from '@remotion/player';
import { Eye, EyeOff, Move, Plus } from 'lucide-react';
import { FORMATS, RESOLUTION_LABELS, outputLabel, renderSize } from '../../src/core/formats';
import { FPS, RESOLUTIONS, type CompProps, type FormatId, type Framing } from '../../src/core/schema';
import { computeBox, framingFor, layoutClips, moveFraming, outputFrames, outputSize, scaleFraming, toFrames } from '../../src/core/timeline';
import { Main } from '../../src/remotion/Main';
import { useProject } from './state';
import { Transport } from './Transport';
import { Segmented } from './ui';

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

const FORMAT_MENU: { format: FormatId; kind: 'video' | 'image'; label: string }[] = [
  { format: 'story', kind: 'video', label: 'Story · 9:16 video' },
  { format: 'reel', kind: 'video', label: 'Reel · 9:16 video' },
  { format: 'landscape', kind: 'video', label: 'Yatay · 16:9 video (YouTube)' },
  { format: 'post', kind: 'video', label: 'Post · 4:5 video' },
  { format: 'post', kind: 'image', label: 'Post · 4:5 fotoğraf (JPEG)' },
  { format: 'square', kind: 'video', label: 'Kare · 1:1 video' },
  { format: 'square', kind: 'image', label: 'Kare · 1:1 fotoğraf (JPEG)' },
];

/** Aynı projeye başka bir oran ekler; kadraj her oran için ayrı tutulur */
const AddFormat: React.FC = () => {
  const { project, apply, setUi } = useProject();
  const [open, setOpen] = useState(false);
  const has = (f: string, k: string) => project.outputs.some((o) => o.format === f && o.kind === k);
  const items = FORMAT_MENU.filter((m) => !has(m.format, m.kind));
  if (!items.length) return null;
  return (
    <div className="add-format">
      <button className="add" onClick={() => setOpen((o) => !o)} title="Aynı videodan başka bir oranda çıktı al">
        <Plus size={13} /> Oran ekle
      </button>
      {open ? (
        <div className="menu" onMouseLeave={() => setOpen(false)}>
          {items.map((m) => (
            <button
              key={`${m.format}-${m.kind}`}
              onClick={() => {
                apply([{ type: 'output.add', format: m.format, kind: m.kind }]);
                setOpen(false);
                setTimeout(() => {
                  const o = project.outputs.find((x) => x.format === m.format && x.kind === m.kind);
                  if (o) setUi({ activeOutputId: o.id });
                }, 600);
              }}
            >
              <span className="ratio-ico" style={{ aspectRatio: `${FORMATS[m.format].width}/${FORMATS[m.format].height}` }} />
              {m.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const Preview: React.FC<{ framingToggle?: boolean }> = ({ framingToggle }) => {
  const [editFrame, setEditFrame] = useState(false);
  const { project, refs, lutMap, setUi, apply, preview, frame, setFrame, seekRef, playRef, setPlaying } = useProject();
  const player = useRef<PlayerRef>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 360, h: 640 });
  const output = project.outputs.find((o) => o.id === project.ui.activeOutputId) ?? project.outputs[0];
  const size = output ? outputSize(output) : { width: 1080, height: 1920 };
  const duration = output ? outputFrames(project, output) : 1;
  const inFrame = framingToggle ? editFrame : project.ui.step === 'kadraj';

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

  // Görsel (tek kare) çıktıdayken “Oynat”: video çıktısına geçip istenen yerden oynat
  const videoOut = project.outputs.find((o) => o.kind === 'video');
  const pendingSeek = useRef<number | null>(null);
  const pendingPlay = useRef<number | null>(null);

  // Oynatma konumu: arayüze ve projeye (yeniden açınca aynı yer)
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    if (output?.kind === 'image') {
      seekRef.current = (f) => {
        pendingSeek.current = f;
        setFrame(f);
      };
      playRef.current = {
        play: () => {
          if (!videoOut) return;
          pendingPlay.current = pendingSeek.current ?? project.ui.frame;
          pendingSeek.current = null;
          setUi({ activeOutputId: videoOut.id });
        },
        pause: () => undefined,
        fullscreen: () => p.requestFullscreen(),
      };
      setPlaying(false);
      return;
    }
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
    playRef.current = { play: () => p.play(), pause: () => p.pause(), fullscreen: () => p.requestFullscreen() };
    if (pendingPlay.current !== null) {
      const f = Math.max(0, Math.min(duration - 1, pendingPlay.current));
      pendingPlay.current = null;
      p.seekTo(f);
      setFrame(f);
      p.play();
    }
    return () => {
      p.removeEventListener('frameupdate', onFrame);
      p.removeEventListener('seeked', onFrame);
      p.removeEventListener('play', onPlay);
      p.removeEventListener('pause', onPause);
      p.removeEventListener('ended', onPause);
      clearTimeout(saveTimer);
    };
  }, [duration, seekRef, playRef, setFrame, setUi, output?.id, output?.kind, videoOut?.id, readyKey, retry, setPlaying]);

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
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, f };
  };
  const nextFraming = (e: React.PointerEvent) => {
    const d = drag.current!;
    const b = computeBox(dragAsset!.width, dragAsset!.height, size.width, size.height, d.f);
    return moveFraming(d.f, b, size.width, size.height, (e.clientX - d.x) / scale, (e.clientY - d.y) / scale);
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
    const a = refs[dragClip.assetId];
    if (!a) return;
    const next = scaleFraming(f, a.width, a.height, size.width, size.height, e.deltaY < 0 ? 1.06 : 1 / 1.06);
    apply([{ type: 'output.setFraming', outputId: output.id, clipId: dragClip.id, framing: { mode: next.mode, zoom: next.zoom } }], {
      key: `zoom:${dragClip.id}`,
      label: 'Boyut',
    });
  };

  if (!output) return <div className="preview-empty">Önce bir biçim seçin</div>;

  return (
    <div className="preview">
      <div className="preview-tabs">
        {project.outputs.map((o) => (
          <button key={o.id} className={o.id === output.id ? 'on' : ''} onClick={() => setUi({ activeOutputId: o.id })}>
            {outputTitle(o)}
          </button>
        ))}
        <AddFormat />
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
              className="drag-layer can"
              style={{ width: box.w, height: box.h }}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onWheel={onWheel}
              title="Sürükleyerek yerleştirin, tekerlekle boyutlandırın"
            >
              <span className="drag-hint">
                <Move size={14} /> Sürükle · tekerlek: boyut
              </span>
            </div>
          ) : null}
        </div>
      </div>
      <Transport duration={duration} isImage={output.kind === 'image'} videoLabel={videoOut ? outputTitle(videoOut) : null} />
      <div className="preview-foot">
        {framingToggle ? (
          <button className={`chip ${editFrame ? 'on' : ''}`} onClick={() => setEditFrame((v) => !v)} title="Önizlemede görüntüyü sürükleyerek yerleştir, tekerlekle boyutlandır">
            <Move size={14} /> Kadrajı düzenle
          </button>
        ) : null}
        <button className="chip" onClick={() => setUi({ safeZones: !project.ui.safeZones })}>
          {project.ui.safeZones ? <Eye size={14} /> : <EyeOff size={14} />} Instagram alanları
        </button>
        <span className="res-pick">
          <span className="muted small">Render:</span>
          <Segmented
            size="sm"
            value={output.resolution ?? '1080'}
            onChange={(r) => apply([{ type: 'output.update', outputId: output.id, patch: { resolution: r } }])}
            options={RESOLUTIONS.map((r) => ({ value: r, label: RESOLUTION_LABELS[r], hint: `${renderSize(output.format, r).width}×${renderSize(output.format, r).height}` }))}
          />
          <span className="muted mono small">
            {renderSize(output.format, output.resolution ?? '1080').width}×{renderSize(output.format, output.resolution ?? '1080').height}
          </span>
        </span>
      </div>
    </div>
  );
};
