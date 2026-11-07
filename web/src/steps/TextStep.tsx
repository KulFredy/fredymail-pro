import React, { useEffect, useRef, useState } from 'react';
import { Plus, Trash2, Loader2, MicOff, RefreshCw, Star } from 'lucide-react';
import { FPS } from '../../../src/core/schema';
import { timelineWords, totalDuration, toFrames } from '../../../src/core/timeline';
import { api } from '../api';
import { useApp, useProject } from '../state';
import { Section, Segmented, Slider, Toggle, fmtSec } from '../ui';

const WordChip: React.FC<{ text: string; original: string; edited: boolean; active: boolean; onSeek: () => void; onSave: (v: string | null) => void }> = ({
  text,
  original,
  edited,
  active,
  onSeek,
  onSave,
}) => {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(text);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => setV(text), [text]);
  useEffect(() => {
    if (editing) ref.current?.select();
  }, [editing]);
  if (editing)
    return (
      <input
        ref={ref}
        className="word-input"
        value={v}
        size={Math.max(3, v.length)}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          setEditing(false);
          if (v !== text) onSave(v === original ? null : v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            setV(text);
            setEditing(false);
          }
        }}
      />
    );
  return (
    <button
      className={`word ${active ? 'active' : ''} ${edited ? 'edited' : ''}`}
      title={edited ? `Düzeltildi (aslı: ${original})` : 'Tıkla: oynat · çift tıkla: düzelt'}
      onClick={onSeek}
      onDoubleClick={() => setEditing(true)}
    >
      {text}
    </button>
  );
};

export const TextStep: React.FC = () => {
  const { project, apply, refs, frame, seekRef } = useProject();
  const { library, health, toast } = useApp();
  const { captions } = project;
  const t = frame / FPS;
  const total = totalDuration(project);

  // Tüm kelimeler (gizlenenler dahil) düzenleme için
  const words = timelineWords({ ...project, captions: { ...captions, edits: {} } }, refs).map((w) => {
    const edit = captions.edits[w.key];
    return { ...w, original: w.text, text: edit ?? w.text, edited: edit !== undefined };
  });
  const videoClips = project.clips.map((c) => library.get(c.assetId)).filter((a) => a?.kind === 'video');

  return (
    <div className="stack">
      <Section
        title="Altyazı"
        aside={<Toggle checked={captions.enabled} onChange={(v) => apply([{ type: 'captions.set', enabled: v }])} label="Videoya göm" />}
        hint="Kelimeye tıklayınca önizleme o ana gider; çift tıklayıp düzeltin. Silmek için kelimeyi boşaltın."
      >
        <div className="transcripts">
          {videoClips.map((a) => {
            if (!a) return null;
            const s = a.transcript.status;
            return (
              <div key={a.id} className="tstatus">
                {s === 'running' || s === 'pending' ? <Loader2 size={13} className="spin" /> : s === 'done' && a.transcript.words.length ? '✓' : <MicOff size={13} />}
                <span className="ellipsis">{a.name}</span>
                <small className="muted">
                  {s === 'done'
                    ? a.transcript.words.length
                      ? `${a.transcript.words.length} kelime`
                      : 'konuşma yok'
                    : s === 'silent'
                      ? 'sessiz · altyazı atlandı'
                      : s === 'unavailable'
                        ? a.transcript.message
                        : s === 'error'
                          ? `hata: ${a.transcript.message}`
                          : s === 'none'
                            ? 'ses yok'
                            : 'çözülüyor…'}
                </small>
                {s === 'unavailable' || s === 'error' ? (
                  <button className="icon-btn" title="Yeniden dene" onClick={() => api.transcribe(a.id).then(() => toast('Çözümleme sıraya alındı'))}>
                    <RefreshCw size={13} />
                  </button>
                ) : null}
              </div>
            );
          })}
          {!health?.whisper.available ? <p className="warn small">Türkçe konuşma çözümleyici kurulu değil. Kurulum: scripts/setup-mac.sh</p> : null}
        </div>
        {words.length ? (
          <div className="words">
            {words.map((w) => (
              <WordChip
                key={w.key}
                text={w.text}
                original={w.original}
                edited={w.edited}
                active={t >= w.t0 && t < w.t1}
                onSeek={() => seekRef.current?.(toFrames(w.t0) + 1)}
                onSave={(v) => apply([{ type: 'captions.editWord', key: w.key, text: v }])}
              />
            ))}
          </div>
        ) : (
          <p className="muted">Konuşma bulunan bölüm yok; altyazı eklenmeyecek. Aşağıdan elle yazı ekleyebilirsiniz.</p>
        )}
      </Section>

      {words.length ? (
        <Section
          title="Altyazı stili"
          aside={
            <button
              className="btn tiny"
              title="Bundan sonraki projelerde de bu stil kullanılsın"
              onClick={async () => {
                await api.saveStyle({ captionStyle: captions.style });
                toast('Kişisel altyazı stiliniz kaydedildi');
              }}
            >
              <Star size={13} /> Varsayılanım yap
            </button>
          }
        >
          <div className="row-wrap">
            <Segmented
              size="sm"
              value={captions.style.font}
              onChange={(font) => apply([{ type: 'captions.set', style: { font } }])}
              options={[
                { value: 'Inter', label: 'Inter' },
                { value: 'Montserrat', label: 'Montserrat' },
              ]}
            />
            <Segmented
              size="sm"
              value={captions.style.position}
              onChange={(position) => apply([{ type: 'captions.set', style: { position } }])}
              options={[
                { value: 'bottom', label: 'Alt' },
                { value: 'middle', label: 'Orta' },
                { value: 'top', label: 'Üst' },
              ]}
            />
            <Segmented
              size="sm"
              value={String(captions.style.maxLines) as '1' | '2' | '3'}
              onChange={(v) => apply([{ type: 'captions.set', style: { maxLines: Number(v) } }])}
              options={[
                { value: '1', label: '1 satır' },
                { value: '2', label: '2 satır' },
                { value: '3', label: '3 satır' },
              ]}
            />
          </div>
          <Slider label="Boyut" value={captions.style.size} min={36} max={110} step={1} format={(v) => `${v}px`} onChange={(size) => apply([{ type: 'captions.set', style: { size } }], { key: 'capsize', label: 'Altyazı boyutu' })} />
          <div className="row-wrap">
            <label className="color">
              Yazı <input type="color" value={captions.style.color} onChange={(e) => apply([{ type: 'captions.set', style: { color: e.target.value } }], { key: 'capcolor' })} />
            </label>
            <label className="color">
              Vurgu <input type="color" value={captions.style.highlight} onChange={(e) => apply([{ type: 'captions.set', style: { highlight: e.target.value } }], { key: 'caphl' })} />
            </label>
            <Toggle checked={captions.style.uppercase} onChange={(uppercase) => apply([{ type: 'captions.set', style: { uppercase } }])} label="BÜYÜK HARF" />
            <Toggle checked={captions.style.box} onChange={(box) => apply([{ type: 'captions.set', style: { box } }])} label="Kutu" />
            <Toggle checked={captions.style.outline} onChange={(outline) => apply([{ type: 'captions.set', style: { outline } }])} label="Gölge" />
          </div>
        </Section>
      ) : null}

      <Section
        title="Yazılar"
        aside={
          <button
            className="btn tiny primary"
            onClick={() => apply([{ type: 'text.add', text: { text: 'Yeni yazı', start: Math.min(t, Math.max(0, total - 1)), end: Math.min(total, t + 3) } }])}
          >
            <Plus size={13} /> Yazı ekle
          </button>
        }
        hint="Konuşmasız videolar için başlık veya açıklama (ör. “Papağanla tanışın 🦜”). Oynatma imlecinin olduğu yerden başlar."
      >
        {project.texts.map((x) => (
          <div key={x.id} className="text-item">
            <div className="row">
              <input className="grow" value={x.text} onChange={(e) => apply([{ type: 'text.update', id: x.id, patch: { text: e.target.value } }], { key: `txt:${x.id}`, label: 'Yazı' })} />
              <button className="icon-btn danger" onClick={() => apply([{ type: 'text.remove', id: x.id }])}>
                <Trash2 size={15} />
              </button>
            </div>
            <Slider label="Başlangıç" value={x.start} min={0} max={Math.max(0.1, total)} step={0.1} format={fmtSec} onChange={(v) => apply([{ type: 'text.update', id: x.id, patch: { start: Math.min(v, x.end - 0.3) } }], { key: `ts:${x.id}` })} />
            <Slider label="Bitiş" value={x.end} min={0.3} max={Math.max(0.4, total)} step={0.1} format={fmtSec} onChange={(v) => apply([{ type: 'text.update', id: x.id, patch: { end: Math.max(v, x.start + 0.3) } }], { key: `te:${x.id}` })} />
            <Slider label="Dikey konum" value={x.y} min={0.08} max={0.92} format={(v) => `%${Math.round(v * 100)}`} onChange={(v) => apply([{ type: 'text.update', id: x.id, patch: { y: v } }], { key: `ty:${x.id}` })} />
            <Slider label="Boyut" value={x.size} min={30} max={180} step={1} format={(v) => `${v}px`} onChange={(v) => apply([{ type: 'text.update', id: x.id, patch: { size: v } }], { key: `tz:${x.id}` })} />
            <div className="row-wrap">
              <Segmented
                size="sm"
                value={x.style}
                onChange={(style) => apply([{ type: 'text.update', id: x.id, patch: { style } }])}
                options={[
                  { value: 'shadow', label: 'Gölgeli' },
                  { value: 'outline', label: 'Kenarlı' },
                  { value: 'box', label: 'Kutulu' },
                ]}
              />
              <label className="color">
                Renk <input type="color" value={x.color} onChange={(e) => apply([{ type: 'text.update', id: x.id, patch: { color: e.target.value } }], { key: `tc:${x.id}` })} />
              </label>
            </div>
          </div>
        ))}
      </Section>
    </div>
  );
};
