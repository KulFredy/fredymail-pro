import React, { useMemo } from 'react';
import { AbsoluteFill, Audio, Img, Sequence, useCurrentFrame, useVideoConfig } from 'remotion';
import { FORMATS } from '../core/formats';
import { effectiveCamera, effectiveLook } from '../core/looks';
import { animAt, logoBox, logoSpan, placementFor, textBox } from '../core/graphics';
import { FPS, type CompProps, type Logo, type Output, type TextOverlay } from '../core/schema';
import {
  edgeGain,
  captionPages,
  computeBox,
  dbToGain,
  framingFor,
  layoutClips,
  motionFraming,
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
  const frame = useCurrentFrame(); // kancalar koşullu dönüşten önce
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
  const baseFraming = props.framingOverride?.[clip.id] ?? framingFor(output, clip);
  const framing = motionFraming(baseFraming, clip.motion, frame / FPS, item.duration);
  const box = computeBox(asset.width, asset.height, W, H, framing);
  const bgBox = framing.mode === 'fit-blur' ? computeBox(asset.width, asset.height, W, H, { mode: 'fill', x: 0.5, y: 0.5, zoom: 1 }) : null;
  const look = effectiveLook(props.project, clip);
  const cam = effectiveCamera(clip, asset.cameraDetected);
  const gain = dbToGain(clip.gainDb);
  const lenF = toFrames(item.duration);
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
        volume={(f: number) => gain * edgeGain(f, lenF, clip.audioFadeIn, clip.audioFadeOut)}
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

const TextItem: React.FC<{ text: TextOverlay; output: Output }> = ({ text, output }) => {
  const frame = useCurrentFrame();
  const { width: W } = useVideoConfig();
  const len = toFrames(text.end - text.start);
  const { opacity, dy, scale } = animAt(text.anim, frame, len, FPS);
  const box = textBox(text, output);
  const size = text.size * placementFor(text, output).scale;
  const shadow =
    text.style === 'outline'
      ? `0 0 ${size * 0.1}px rgba(0,0,0,0.9)`
      : text.style === 'shadow'
        ? `0 ${size * 0.05}px ${size * 0.2}px rgba(0,0,0,0.55)`
        : 'none';
  return (
    <div
      style={{
        position: 'absolute',
        left: box.cx,
        top: box.cy,
        transform: `translate(-50%, -50%) translateY(${dy}px) scale(${scale})`,
        width: 'max-content',
        maxWidth: W * 0.86,
        opacity,
        fontFamily: text.font,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1.1,
        color: text.color,
        textAlign: 'center',
        whiteSpace: 'pre-wrap',
        textShadow: shadow,
        background: text.style === 'box' ? 'rgba(0,0,0,0.6)' : 'transparent',
        padding: text.style === 'box' ? `${size * 0.12}px ${size * 0.3}px` : 0,
        borderRadius: size * 0.2,
      }}
    >
      {text.text}
    </div>
  );
};

/** Logo: saydam görsel, güvenli alan ızgarasına göre; çıktıya özel yerleşim ve animasyon */
const LogoItem: React.FC<{ logo: Logo; output: Output; props: CompProps; len: number; still?: boolean }> = ({ logo, output, props, len, still }) => {
  const frame = useCurrentFrame();
  const asset = props.assets[logo.assetId];
  if (!asset?.url) return null;
  const b = logoBox(logo, asset, output);
  const a = still ? { opacity: 1, dy: 0, scale: 1 } : animAt(logo.anim, frame, len, FPS);
  return (
    <Img
      src={asset.url}
      style={{
        position: 'absolute',
        left: b.cx - b.w / 2,
        top: b.cy - b.h / 2,
        width: b.w,
        height: b.h,
        objectFit: 'contain',
        opacity: a.opacity * logo.opacity,
        transform: `translateY(${a.dy}px) scale(${a.scale})`,
      }}
    />
  );
};

const Logos: React.FC<{ props: CompProps; output: Output }> = ({ props, output }) => (
  <>
    {props.project.logos.map((l) => {
      const span = logoSpan(l, props.project);
      const len = Math.max(1, toFrames(span.end - span.start));
      return (
        <Sequence key={l.id} from={toFrames(span.start)} durationInFrames={len} name="Logo">
          <LogoItem logo={l} output={output} props={props} len={len} />
        </Sequence>
      );
    })}
  </>
);

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
              clip: { id: o.id, assetId: o.assetId, in: o.in, out: o.out, camera: o.camera, look: null, gainDb: 0, muted: true, musicMuted: false, audioFadeIn: 0, audioFadeOut: 0, motion: null },
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
        const lenF = Math.max(1, toFrames(v.out - v.in));
        return (
          <Sequence key={v.id} from={toFrames(v.at)} durationInFrames={lenF} name="Dış ses">
            <Audio src={a.url} trimBefore={toFrames(v.in)} volume={(f: number) => g * edgeGain(f, lenF, v.fadeIn, v.fadeOut)} />
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
          <TextItem text={t} output={output} />
        </Sequence>
      ))}
      {project.captions.enabled ? <Captions props={props} output={output} /> : null}
      <Logos props={props} output={output} />
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
      {/* Post görselinde logolar sabit (animasyonsuz) görünür */}
      {props.project.logos
        .filter((l) => l.full)
        .map((l) => (
          <LogoItem key={l.id} logo={l} output={output} props={props} len={1} still />
        ))}
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
