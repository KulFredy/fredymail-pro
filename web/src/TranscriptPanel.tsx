import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Loader2, Pencil, Scissors, Search, X } from 'lucide-react';
import { FPS } from '../../src/core/schema';
import { formatTime, toFrames } from '../../src/core/timeline';
import { buildTranscript, cutSentenceOps, editSentenceOps, sentenceAt, type TranscriptSection, type TranscriptSentence } from '../../src/core/transcript';
import { useApp, useProject } from './state';
import type { Selection } from './Timeline';

const lower = (s: string) => s.toLocaleLowerCase('tr');

/**
 * Aranabilir Türkçe transkript (Faz 3).
 * Cümleye tıkla → oynatma imleci o ana gider, klip seçilir. Kelimeye tıkla → tam o kelimeye gider.
 * "Cümleyi kes" kurgudan çıkarır; "Altyazıyı düzelt" yalnız metni değiştirir (kesimlere dokunmaz).
 * Zamanlar kurgu zamanıdır; kaynak zamanı ipucunda gösterilir.
 */
export const TranscriptPanel: React.FC<{ onSelect: (s: Selection) => void }> = ({ onSelect }) => {
  const { project, refs, frame, seekRef, apply, setHighlights, setUi } = useProject();
  const { library } = useApp();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [showCut, setShowCut] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);
  const sections = useMemo(() => buildTranscript(project, refs), [project, refs]);
  const t = frame / FPS;
  const active = sentenceAt(sections, t);

  // Oynatırken etkin cümleyi görünür tut
  useEffect(() => {
    if (!active || editing) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-sid="${CSS.escape(active.id)}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active?.id, editing]);

  const pending = project.clips
    .map((c) => library.get(c.assetId))
    .filter((a) => a && a.kind === 'video' && ['pending', 'running'].includes(a.transcript.status));

  const q = lower(query.trim());
  const match = (s: TranscriptSentence) => !q || lower(s.words.map((w) => w.text || w.original).join(' ')).includes(q);
  const visible = sections
    .map((sec) => ({ ...sec, sentences: sec.sentences.filter((s) => match(s) && (showCut || s.cut !== 'all')) }))
    .filter((sec) => sec.sentences.length);
  const hits = q ? visible.reduce((n, s) => n + s.sentences.length, 0) : 0;

  const select = (sec: TranscriptSection, s: TranscriptSentence, seekTo?: number) => {
    setSelectedId(s.id);
    const first = s.words.find((w) => w.at);
    if (!first || s.start === null || s.end === null) return;
    seekRef.current?.(toFrames(seekTo ?? s.start));
    setHighlights([{ start: s.start, end: s.end, kind: 'change' }]);
    if (sec.source === 'clip') {
      onSelect({ kind: 'clip', id: first.at!.clipId });
      setUi({ selectedClipId: first.at!.clipId });
    }
    else onSelect({ kind: 'voice', id: first.at!.clipId });
  };

  const cut = (sec: TranscriptSection, s: TranscriptSentence) => {
    const ops = cutSentenceOps(project, sec, s);
    if (!ops) return;
    apply(ops, { label: `Transkript: “${s.text.slice(0, 30)}” kesildi` });
    setHighlights([]);
    if (s.start !== null) seekRef.current?.(toFrames(Math.max(0, s.start - 0.05)));
  };

  const saveEdit = (s: TranscriptSentence) => {
    const ops = editSentenceOps(s, draft);
    if (ops.length) apply(ops, { label: 'Altyazı düzeltildi' });
    setEditing(null);
  };

  const mark = (text: string) => {
    if (!q || !text) return text;
    const i = lower(text).indexOf(q);
    if (i < 0) return text;
    return (
      <>
        {text.slice(0, i)}
        <mark>{text.slice(i, i + q.length)}</mark>
        {text.slice(i + q.length)}
      </>
    );
  };

  if (!sections.length)
    return (
      <div className="tr-empty">
        {pending.length ? (
          <p className="hint">
            <Loader2 size={13} className="spin" /> Konuşma yazıya çevriliyor ({pending.length} klip)…
          </p>
        ) : (
          <p className="muted small">Kurguda konuşmalı klip yok. Konuşmalı bir video veya dış ses ekleyin; Türkçe transkript burada çıkar.</p>
        )}
      </div>
    );

  return (
    <div className="tr">
      <div className="tr-search">
        <Search size={14} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Transkriptte ara" aria-label="Transkriptte ara" />
        {query ? (
          <button className="icon-btn sm" onClick={() => setQuery('')} title="Temizle">
            <X size={13} />
          </button>
        ) : null}
      </div>
      <div className="row-between small muted">
        <span>{q ? `${hits} cümle bulundu` : 'Zamana tıklayın: cümle başına gider · kelimeye tıklayın: o kelimeye gider'}</span>
        <label className="tr-toggle" title="Kurgudan kesilmiş cümleleri soluk olarak göster">
          <input type="checkbox" checked={showCut} onChange={(e) => setShowCut(e.target.checked)} /> Kesilenler
        </label>
      </div>
      {pending.length ? (
        <p className="hint small">
          <Loader2 size={12} className="spin" /> {pending.length} klip daha yazıya çevriliyor…
        </p>
      ) : null}
      <div className="tr-list" ref={listRef}>
        {visible.map((sec) => (
          <section key={`${sec.source}:${sec.assetId}`} className="tr-sec">
            <h5 className="ellipsis" title={sec.name}>
              {sec.source === 'voice' ? <span className="badge voice">Dış ses</span> : null} {sec.name}
            </h5>
            {sec.sentences.map((s) => {
              const isSel = selectedId === s.id;
              const isActive = active?.id === s.id;
              const canCut = sec.source === 'clip' && s.cut !== 'all';
              return (
                <div
                  key={s.id}
                  data-sid={s.id}
                  data-start={s.start ?? ''}
                  className={`tr-sen ${isSel ? 'sel' : ''} ${isActive ? 'active' : ''} cut-${s.cut}`}
                  onClick={() => editing !== s.id && select(sec, s)}
                >
                  <span className="tr-time" title={s.start !== null ? `Cümle başına git · kurgu ${formatTime(s.start)} · kaynak ${formatTime(s.words[0].src0)}` : `Kurgudan kesildi · kaynak ${formatTime(s.words[0].src0)}`}>
                    {s.start !== null ? formatTime(s.start) : 'kesildi'}
                  </span>
                  {editing === s.id ? (
                    <div className="tr-edit" onClick={(e) => e.stopPropagation()}>
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveEdit(s);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                        aria-label="Altyazı metni"
                      />
                      <small className="muted">Yalnız altyazı metni değişir; kurgu ve zamanlar aynı kalır.</small>
                      <div className="row-wrap">
                        <button className="btn primary tiny" onClick={() => saveEdit(s)}>
                          <Check size={13} /> Kaydet
                        </button>
                        <button className="btn tiny" onClick={() => setEditing(null)}>
                          Vazgeç
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="tr-text">
                      {s.words.map((w) => (
                        <span
                          key={w.key}
                          className={`tr-w ${w.at ? '' : 'gone'} ${w.edited ? 'edited' : ''} ${w.at && t >= w.at.t0 && t < w.at.t1 ? 'now' : ''}`}
                          title={w.edited ? `Düzeltildi (aslı: ${w.original})` : undefined}
                          onClick={(e) => {
                            if (!w.at) return;
                            e.stopPropagation();
                            select(sec, s, w.at.t0);
                          }}
                        >
                          {mark(w.text)}{' '}
                        </span>
                      ))}
                    </p>
                  )}
                  {isSel && editing !== s.id ? (
                    <div className="tr-actions" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="btn tiny danger"
                        disabled={!canCut}
                        title={sec.source === 'voice' ? 'Dış seste kesme için zaman çizelgesinde kırpın' : s.cut === 'all' ? 'Zaten kesildi (geri almak için ⌘Z)' : 'Bu cümleyi kurgudan çıkar (boşluk kapanır)'}
                        onClick={() => cut(sec, s)}
                      >
                        <Scissors size={13} /> Cümleyi kes
                      </button>
                      <button
                        className="btn tiny"
                        title="Yalnız altyazı metnini düzelt (kurgu değişmez)"
                        onClick={() => {
                          setDraft(s.text);
                          setEditing(s.id);
                        }}
                      >
                        <Pencil size={13} /> Altyazıyı düzelt
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </section>
        ))}
        {!visible.length ? <p className="muted small">“{query}” bulunamadı.</p> : null}
      </div>
    </div>
  );
};
