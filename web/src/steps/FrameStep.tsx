import React, { useEffect, useMemo } from 'react';
import { Thumbnail } from '@remotion/player';
import { Maximize, Minimize2, Crosshair } from 'lucide-react';
import { FORMATS } from '../../../src/core/formats';
import { FPS, type CompProps, type Framing } from '../../../src/core/schema';
import { DEFAULT_FRAMING, framingFor, layoutClips, outputFrames, outputSize, toFrames } from '../../../src/core/timeline';
import { Main } from '../../../src/remotion/Main';
import { useApp, useProject } from '../state';
import { Section } from '../ui';
import { FramingControls } from '../FramingControls';

const Compare: React.FC<{ label: string; desc: string; framing: Framing; on: boolean; onClick: () => void; frame: number; clipId: string }> = ({
  label,
  desc,
  framing,
  on,
  onClick,
  frame,
  clipId,
}) => {
  const { project, refs, lutMap } = useProject();
  const output = project.outputs.find((o) => o.id === project.ui.activeOutputId) ?? project.outputs[0];
  const size = outputSize(output);
  const props: CompProps = useMemo(
    () => ({ project, assets: refs, outputId: output.id, variant: 'nomusic', target: 'preview', luts: lutMap, framingOverride: { [clipId]: framing } }),
    [project, refs, output.id, lutMap, clipId, framing],
  );
  const w = 150;
  return (
    <button className={`compare ${on ? 'on' : ''}`} onClick={onClick}>
      <Thumbnail
        component={Main}
        compositionWidth={size.width}
        compositionHeight={size.height}
        frameToDisplay={frame}
        durationInFrames={outputFrames(project, output)}
        fps={FPS}
        inputProps={props}
        style={{ width: w, height: (w * size.height) / size.width }}
      />
      <b>{label}</b>
      <small>{desc}</small>
    </button>
  );
};

export const FrameStep: React.FC = () => {
  const { project, apply, setUi, seekRef } = useProject();
  const { library } = useApp();
  const output = project.outputs.find((o) => o.id === project.ui.activeOutputId) ?? project.outputs[0];
  const isImage = output?.kind === 'image';
  const clip = isImage
    ? project.clips.find((c) => c.id === output.still?.clipId)
    : (project.clips.find((c) => c.id === project.ui.selectedClipId) ?? project.clips[0]);
  const item = clip ? layoutClips(project).find((l) => l.clip.id === clip.id) : undefined;
  const midFrame = isImage ? 0 : item ? toFrames(item.start + Math.min(item.duration / 2, 1.5)) : 0;

  // Seçili klibi önizlemede göster
  useEffect(() => {
    if (!isImage && item) seekRef.current?.(midFrame);
  }, [clip?.id, output?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!output || !clip) return <p className="muted">Önce klip ve biçim seçin.</p>;
  const asset = library.get(clip.assetId);
  const f = framingFor(output, clip);
  const set = (framing: Partial<Framing>, key?: string) => apply([{ type: 'output.setFraming', outputId: output.id, clipId: clip.id, framing }], key ? { key, label: 'Kadraj' } : undefined);
  const others = project.outputs.filter((o) => o.id !== output.id);

  return (
    <div className="stack">
      <p className="hint">
        <b>{FORMATS[output.format].label}</b> için kadraj. {others.length ? `Bu ayar ${others.map((o) => FORMATS[o.format].label).join(', ')} kadrajını değiştirmez.` : ''} Çıktıyı önizlemenin üstündeki sekmelerden değiştirin.
      </p>
      {!isImage ? (
        <div className="row-wrap">
          {project.clips.map((c, i) => (
            <button key={c.id} className={`chip ${c.id === clip.id ? 'on' : ''}`} onClick={() => setUi({ selectedClipId: c.id })}>
              {i + 1}. {library.get(c.assetId)?.name}
            </button>
          ))}
        </div>
      ) : null}
      <Section
        title="Sığdır mı, doldur mu?"
        hint={
          asset && asset.width > asset.height && output.format !== 'landscape'
            ? 'Yatay klip dikey çıktıda: tamamını görmek için Sığdır, ekranı doldurmak için Doldur.'
            : 'Görüntünün çıktıya nasıl yerleşeceğini seçin.'
        }
      >
        <div className="compare-row">
          <Compare
            label="Doldur"
            desc="Kırp, ekranı kapla"
            framing={{ ...f, mode: 'fill' }}
            on={f.mode === 'fill'}
            onClick={() => set({ mode: 'fill' })}
            frame={midFrame}
            clipId={clip.id}
          />
          <Compare
            label="Sığdır"
            desc="Tamamı görünür, bulanık arka plan"
            framing={{ ...f, mode: 'fit-blur', zoom: 1 }}
            on={f.mode === 'fit-blur'}
            onClick={() => set({ mode: 'fit-blur', zoom: 1 })}
            frame={midFrame}
            clipId={clip.id}
          />
          <Compare
            label="Sığdır (siyah)"
            desc="Tamamı görünür, düz arka plan"
            framing={{ ...f, mode: 'fit', zoom: 1 }}
            on={f.mode === 'fit'}
            onClick={() => set({ mode: 'fit', zoom: 1 })}
            frame={midFrame}
            clipId={clip.id}
          />
        </div>
      </Section>
      <Section title="Boyut ve konum" hint="Görüntüyü küçültebilir (%10'a kadar), büyütebilir ve karede istediğiniz yere yerleştirebilirsiniz.">
        <FramingControls output={output} itemId={clip.id} assetId={clip.assetId} />
      </Section>
    </div>
  );
};
