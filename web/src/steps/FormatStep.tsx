import React from 'react';
import { Trash2 } from 'lucide-react';
import { FORMATS } from '../../../src/core/formats';
import type { FormatId } from '../../../src/core/schema';
import { useApp, useProject } from '../state';
import { Section, Segmented } from '../ui';

const CHOICES: { format: FormatId; kind: 'video' | 'image'; label: string; desc: string }[] = [
  { format: 'story', kind: 'video', label: 'Story', desc: '1080×1920 · MP4' },
  { format: 'reel', kind: 'video', label: 'Reel', desc: '1080×1920 · MP4' },
  { format: 'post', kind: 'image', label: 'Fotoğraf postu', desc: '1080×1350 · JPEG' },
  { format: 'post', kind: 'video', label: 'Video postu', desc: '1080×1350 · MP4' },
  { format: 'landscape', kind: 'video', label: 'Yatay video', desc: '1920×1080 · MP4' },
];

export const FormatStep: React.FC = () => {
  const { project, apply, setUi } = useProject();
  const { library } = useApp();
  const has = (f: FormatId, k: string) => project.outputs.find((o) => o.format === f && o.kind === k);
  return (
    <div className="stack">
      <Section title="Çıktılar" hint="Aynı dosyalardan birden çok çıktı alırsınız; galeriden ikinci kez seçmeniz gerekmez. Kadraj her çıktı için ayrı saklanır.">
        <div className="format-grid wide">
          {CHOICES.map((c) => {
            const o = has(c.format, c.kind);
            return (
              <button
                key={`${c.format}-${c.kind}`}
                className={`format-card ${o ? 'on' : ''}`}
                onClick={() => (o ? apply([{ type: 'output.remove', outputId: o.id }]) : apply([{ type: 'output.add', format: c.format, kind: c.kind }]))}
              >
                <span className="ratio" style={{ aspectRatio: `${FORMATS[c.format].width}/${FORMATS[c.format].height}` }} />
                <b>{c.label}</b>
                <small>{c.desc}</small>
              </button>
            );
          })}
        </div>
      </Section>
      {project.outputs
        .filter((o) => o.kind === 'image')
        .map((o) => (
          <Section key={o.id} title={`${FORMATS[o.format].label} karesi`} hint="Görsel çıktı hangi klipten alınsın? Videodan seçerseniz o anki kare kullanılır.">
            <div className="row-wrap">
              {project.clips.map((c, i) => {
                const a = library.get(c.assetId);
                return (
                  <button
                    key={c.id}
                    className={`chip ${o.still?.clipId === c.id ? 'on' : ''}`}
                    onClick={() => {
                      apply([{ type: 'output.setStill', outputId: o.id, clipId: c.id, at: 0 }]);
                      setUi({ activeOutputId: o.id });
                    }}
                  >
                    {i + 1}. {a?.kind === 'image' ? 'Fotoğraf' : 'Video'} · {a?.name}
                  </button>
                );
              })}
            </div>
            {(() => {
              const c = project.clips.find((x) => x.id === o.still?.clipId);
              const a = c ? library.get(c.assetId) : undefined;
              if (!c || a?.kind !== 'video') return null;
              return (
                <label className="slider">
                  <span className="slider-head">
                    <span>Videodaki kare</span>
                    <span className="muted mono">{(o.still?.at ?? 0).toFixed(1)} sn</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={Math.max(0.1, c.out - c.in - 0.05)}
                    step={0.05}
                    value={o.still?.at ?? 0}
                    onChange={(e) => apply([{ type: 'output.setStill', outputId: o.id, clipId: c.id, at: Number(e.target.value) }], { key: `still:${o.id}`, label: 'Post karesi' })}
                  />
                </label>
              );
            })()}
          </Section>
        ))}
      <Section title="Önizlemede gösterilen">
        <Segmented
          value={project.ui.activeOutputId ?? project.outputs[0]?.id ?? ''}
          onChange={(v) => setUi({ activeOutputId: v })}
          options={project.outputs.map((o) => ({ value: o.id, label: `${FORMATS[o.format].label} ${o.kind === 'image' ? '(JPEG)' : ''}` }))}
        />
        {project.outputs.length > 1 ? (
          <p className="hint">
            <Trash2 size={12} /> Bir çıktıyı kaldırmak için yukarıdaki kartına tekrar tıklayın.
          </p>
        ) : null}
      </Section>
    </div>
  );
};
