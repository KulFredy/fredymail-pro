import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Sequence, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';
import { FORMATS } from '../core/formats';
import { effectiveCamera, effectiveLook } from '../core/looks';
import { FPS, type CompProps, type Output, type TextOverlay } from '../core/schema';
import {
  captionPages,
  computeBox,
  dbToGain,
  framingFor,
  layoutClips,
  musicGainAt,
  speechIntervals,
  timelineWords,
  toFrames,
  totalDuration,
  type LayoutItem,
} from '../core/timeline';
import { GradedMedia } from './GradedMedia';
import { useFonts } from './fonts';

const ClipLayer: React.FC<{ item: LayoutItem; output: Output; props: CompProps }> = ({ item, output, props }) => {
  const { width: W, height: H } = useVideoConfig();
  const { clip } = item;
  const asset = props.assets[clip.assetId];
  if (!asset || !asset.url) {
    // Önizleme kopyası henüz hazır değil (telefondan yeni geldi) veya kaynak yok: çökmeden bilgi ver
    return (
      <AbsoluteFill
        style={{ background: '#111318', color: '#9aa1ad', alignItems: 'center', justifyContent: 'center', fontSize: 44, fontFamily: 'Inter', fontWeight: 600, textAlign: 'center', padding: 60, whiteSpace: 'pre-line' }}
      >
        {asset ? `${asset.name}\nhazırlanıyor…` : 'Kaynak bulunamadı'}
      </AbsoluteFill>
    );
  }
  const framing = props.framingOverride?.[clip.id] ?? framingFor(output, clip);
  const box = computeBox(asset.width, asset.height, W, H, framing);
  const bgBox = framing.mode === 'fit-blur' ? computeBox(asset.width, asset.height, W, H, { mode: 'fill', x: 0.5, y: 0.5, zoom: 1 }) : null;
  const look = effectiveLook(props.project, clip);
  const cam = effectiveCamera(clip, asset.cameraDetected);
  const gain = dbToGain(clip.gainDb);
  const lenF = toFrames(item.duration);
  const edge = 3; // klik sesini önlemek için kısa ses geçişi
  return (
    <AbsoluteFill style={{ background: '#000', overflow: 'hidden' }}>
      <GradedMedia
        kind={asset.kind === 'image' ? 'image' : 'video'}
        src={asset.url}
        srcW={asset.width}
        srcH={asset.height}
        box={box}
        bgBox={bgBox}
        look={look}
        camLutUrl={cam ? (props.luts[cam] ?? null) : null}
        lutUrl={look.lut ? (props.luts[look.lut] ?? null) : null}
        trimBefore={toFrames(clip.in)}
        muted={clip.muted || !asset.hasAudio}
        volume={(f: number) => gain * Math.min(1, f / edge, (lenF - f) / edge)}
      />
      {look.adjust.vignette > 0 ? (
        <AbsoluteFill
          style={{
            background: `radial-gradient(ellipse at center, rgba(0,0,0,0) 42%, rgba(0,0,0,${(0.8 * look.adjust.vignette).toFixed(3)}) 100%)`,
          }}
        />
      ) : null}
    </AbsoluteFill>
  );
};

const Captions: React.FC<{ props: CompProps; output: Output }> = ({ props, output }) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const { style } = props.project.captions;
  const safe = FORMATS[output.format].safe;
  const words = useMemo(() => timelineWords(props.project, props.assets), [props.project, props.assets]);
  const maxChars = Math.max(10, Math.floor((W - safe.left - safe.right - 60) / (style.size * 0.56)));
  const pages = useMemo(() => captionPages(words, { maxChars, maxLines: style.maxLines }), [words, maxChars, style.maxLines]);
  const t = frame / FPS;
  const page = pages.find((p) => t >= p.start && t < p.end);
  if (!page) return null;
  const fmt = (s: string) => (style.uppercase ? s.toLocaleUpperCase('tr-TR') : s);
  const outline = style.outline
    ? `0 0 ${style.size * 0.09}px rgba(0,0,0,0.85), 0 ${style.size * 0.04}px ${style.size * 0.12}px rgba(0,0,0,0.6)`
    : 'none';
  const off = style.offset ?? 0;
  const pos: React.CSSProperties =
    style.position === 'bottom'
      ? { bottom: safe.bottom + 30 + off }
      : style.position === 'top'
        ? { top: safe.top + 30 - off }
        : { top: H / 2 - off, transform: 'translateY(-50%)' };
  return (
    <div
      style={{
        position: 'absolute',
        left: safe.left,
        right: safe.right,
        ...pos,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: style.size * 0.12,
        fontFamily: style.font,
        fontWeight: 800,
        fontSize: style.size,
        lineHeight: 1.12,
        textAlign: 'center',
      }}
    >
      {page.lines.map((line, i) => (
        <div
          key={i}
          style={{
            color: style.color,
            textShadow: outline,
            background: style.box ? 'rgba(0,0,0,0.62)' : 'transparent',
            padding: style.box ? `${style.size * 0.08}px ${style.size * 0.22}px` : 0,
            borderRadius: style.size * 0.18,
          }}
        >
          {line.map((w, j) => (
            <span key={w.key} style={{ color: t >= w.t0 && t < w.t1 ? style.highlight : style.color }}>
              {fmt(w.text)}
              {j < line.length - 1 ? ' ' : ''}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
};

const TextItem: React.FC<{ text: TextOverlay }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { width: W, height: H } = useVideoConfig();
  const len = toFrames(text.end - text.start);
  const opacity = interpolate(frame, [0, 8, Math.max(9, len - 8), len], [0, 1, 1, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const shadow =
    text.style === 'outline'
      ? `0 0 ${text.size * 0.1}px rgba(0,0,0,0.9)`
      : text.style === 'shadow'
        ? `0 ${text.size * 0.05}px ${text.size * 0.2}px rgba(0,0,0,0.55)`
        : 'none';
  return (
    <div
      style={{
        position: 'absolute',
        left: text.x * W,
        top: text.y * H,
        transform: `translate(-50%, -50%) translateY(${(1 - opacity) * 20}px)`,
        maxWidth: W * 0.86,
        opacity,
        fontFamily: text.font,
        fontWeight: 800,
        fontSize: text.size,
        lineHeight: 1.1,
        color: text.color,
        textAlign: 'center',
        whiteSpace: 'pre-wrap',
        textShadow: shadow,
        background: text.style === 'box' ? 'rgba(0,0,0,0.6)' : 'transparent',
        padding: text.style === 'box' ? `${text.size * 0.12}px ${text.size * 0.3}px` : 0,
        borderRadius: text.size * 0.2,
      }}
    >
      {text.text}
    </div>
  );
};

const VideoView: React.FC<{ props: CompProps; output: Output }> = ({ props, output }) => {
  const { project } = props;
  const layout = useMemo(() => layoutClips(project), [project]);
  const total = totalDuration(project);
  const music = project.music;
  const musicAsset = music ? props.assets[music.assetId] : undefined;
  const speech = useMemo(() => speechIntervals(timelineWords(project, props.assets)), [project, props.assets]);
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      {layout.map((item) => (
        <Sequence key={item.clip.id} from={toFrames(item.start)} durationInFrames={Math.max(1, toFrames(item.duration))} name={item.clip.id}>
          <ClipLayer item={item} output={output} props={props} />
        </Sequence>
      ))}
      {project.overlays.map((o) => (
        <Sequence key={o.id} from={toFrames(o.at)} durationInFrames={Math.max(1, toFrames(o.out - o.in))} name="Üst iz">
          <ClipLayer
            item={{
              clip: { id: o.id, assetId: o.assetId, in: o.in, out: o.out, camera: o.camera, look: null, gainDb: 0, muted: true, musicMuted: false },
              start: o.at,
              end: o.at + (o.out - o.in),
              duration: o.out - o.in,
            }}
            output={output}
            props={props}
          />
        </Sequence>
      ))}
      {project.voice.map((v) => {
        const a = props.assets[v.assetId];
        if (!a?.url) return null;
        const g = dbToGain(v.gainDb);
        return (
          <Sequence key={v.id} from={toFrames(v.at)} durationInFrames={Math.max(1, toFrames(v.out - v.in))} name="Dış ses">
            <Audio src={a.url} trimBefore={toFrames(v.in)} volume={g} />
          </Sequence>
        );
      })}
      {music && musicAsset?.url && props.variant === 'full' && total > 0 ? (
        <Sequence durationInFrames={Math.max(1, toFrames(total))} name="Müzik">
          <Audio
            src={musicAsset.url}
            trimBefore={toFrames(music.start)}
            volume={(f) => musicGainAt(f / FPS, project, speech, total, layout)}
          />
        </Sequence>
      ) : null}
      {project.texts.map((t) => (
        <Sequence key={t.id} from={toFrames(t.start)} durationInFrames={Math.max(1, toFrames(t.end - t.start))} name="Yazı">
          <TextItem text={t} />
        </Sequence>
      ))}
      {project.captions.enabled ? <Captions props={props} output={output} /> : null}
    </AbsoluteFill>
  );
};

const StillView: React.FC<{ props: CompProps; output: Output }> = ({ props, output }) => {
  const layout = layoutClips(props.project);
  const item = layout.find((l) => l.clip.id === output.still?.clipId) ?? layout[0];
  if (!item) return <AbsoluteFill style={{ background: '#000' }} />;
  const at = output.still?.clipId === item.clip.id ? output.still.at : 0;
  // Negatif başlangıç: klibin `at` saniyesindeki kare gösterilir
  return (
    <AbsoluteFill style={{ background: '#000' }}>
      <Sequence from={-toFrames(at)} durationInFrames={toFrames(at) + 2}>
        <ClipLayer item={{ ...item, start: 0, end: item.duration }} output={output} props={props} />
      </Sequence>
    </AbsoluteFill>
  );
};

export const Main: React.FC<CompProps> = (props) => {
  useFonts();
  const output = props.project.outputs.find((o) => o.id === props.outputId) ?? props.project.outputs[0];
  if (!output || !props.project.clips.length) {
    return (
      <AbsoluteFill style={{ background: '#0b0b0f', color: '#6b7280', alignItems: 'center', justifyContent: 'center', fontSize: 44, fontFamily: 'Inter' }}>
        Klip ekleyin
      </AbsoluteFill>
    );
  }
  return output.kind === 'image' ? <StillView props={props} output={output} /> : <VideoView props={props} output={output} />;
};
