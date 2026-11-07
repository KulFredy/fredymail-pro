import React, { useRef, useState } from 'react';
import {
  ArrowLeft, Mic, Square, Send, Undo2, Redo2, Zap, Download, Play, Check, X, Scissors, Trash2, Plus, Music2, Layers, Loader2, Wand2, Video, Image as ImageIcon,
} from 'lucide-react';
import { COMMAND_EXAMPLES, planCommand, type Plan, type PlanCandidate } from '../../src/core/commands';
import { FPS } from '../../src/core/schema';
import { formatTime, layoutClips, toFrames } from '../../src/core/timeline';
import { api, fileHref, upload } from './api';
import { Preview } from './Preview';
import { FramingControls } from './FramingControls';
import { useApp, useProject } from './state';
import { ExportStep } from './steps/ExportStep';
import { Timeline, type Selection } from './Timeline';
import { Modal, Segmented, Slider, fmtDb, fmtSec } from './ui';

type HistoryItem = { text: string; summary: string; ok: boolean };

/** Mikrofon kaydı (tarayıcı); Safari mp4, Chrome webm üretir — sunucu ffmpeg ile çözer */
const useRecorder = () => {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const start = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const r = new MediaRecorder(stream);
    chunks.current = [];
    r.ondataavailable = (e) => e.data.size && chunks.current.push(e.data);
    r.start();
    setRec(r);
  };
  const stop = () =>
    new Promise<File>((resolve) => {
      if (!rec) return;
      rec.onstop = () => {
        rec.stream.getTracks().forEach((t) => t.stop());
        const type = rec.mimeType || 'audio/webm';
        const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
        resolve(new File(chunks.current, `kayit-${Date.now()}.${ext}`, { type }));
        setRec(null);
      };
      rec.stop();
    });
  return { recording: !!rec, start, stop };
};

const CommandPanel: React.FC<{ mode: 'talimat' | 'disses'; setMode: (m: 'talimat' | 'disses') => void }> = ({ mode, setMode }) => {
  const { project, refs, frame, apply, preview, reload, setHighlights, seekRef, playRef, undo, redo } = useProject();
  const { toast } = useApp();
  const [aiReady, setAiReady] = useState(false);
  const [aiAlways, setAiAlways] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showExamples, setShowExamples] = useState(false);
  React.useEffect(() => {
    api
      .settings()
      .then((st) => {
        setAiReady(st.aiConfigured);
        setAiAlways(st.aiMode === 'always');
      })
      .catch(() => undefined);
  }, [settingsOpen]);
  const [text, setText] = useState('');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [chosen, setChosen] = useState<PlanCandidate | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const recorder = useRecorder();
  const playhead = frame / FPS;

  const clear = async () => {
    if (previewing) await reload();
    setPreviewing(false);
    setPlan(null);
    setChosen(null);
    setHighlights([]);
  };

  const run = async (input: string) => {
    if (previewing) await reload();
    setPreviewing(false);
    const local: Plan = {
      ...planCommand(input, { project, assets: refs, playhead, selectedClipId: project.ui.selectedClipId, outputId: project.ui.activeOutputId }),
      source: 'kural',
    };
    let p = local;
    // Her komut Claude'a: yalnız anlık "geri al / yinele" yerelde kalır
    if (aiReady && aiAlways && !local.action) {
      setBusy('Claude komutu yorumluyor…');
      try {
        const c = await api.aiCommand(project.id, input, playhead, project.ui.selectedClipId);
        // Claude'a ulaşılamadıysa (internet, kredi) yerel anlayıcıyla devam
        p = c.understood || c.action || !local.understood ? c : { ...local, hint: `Claude kullanılamadı (${c.summary}); yerel anlayıcıyla yapıldı.` };
      } catch (e) {
        p = local.understood ? { ...local, hint: `Claude'a ulaşılamadı; yerel anlayıcıyla yapıldı.` } : { ...local, hint: (e as Error).message };
      } finally {
        setBusy(null);
      }
    }
    if (p.action) {
      if (p.action === 'undo') undo();
      else redo();
      setHistory((h) => [{ text: input, summary: p.summary, ok: true }, ...h].slice(0, 12));
      setPlan(null);
      setText('');
      toast(p.summary);
      return;
    }
    if (!p.understood && aiReady && !aiAlways) {
      setBusy('Claude komutu yorumluyor…');
      try {
        p = await api.aiCommand(project.id, input, playhead, project.ui.selectedClipId);
      } catch (e) {
        p = { ...p, hint: (e as Error).message };
      } finally {
        setBusy(null);
      }
    }
    setPlan(p);
    setChosen(null);
    setHighlights(p.ranges);
    if (p.ranges[0]) seekRef.current?.(toFrames(Math.max(0, p.ranges[0].start - 0.5)));
  };

  const active = chosen ?? (plan && !plan.candidates.length && plan.ops.length ? { ops: plan.ops, ranges: plan.ranges, summary: plan.summary, label: '' } : null);

  const doPreview = () => {
    if (!active) return;
    preview(active.ops);
    setPreviewing(true);
    const first = active.ranges[0];
    seekRef.current?.(toFrames(Math.max(0, (first?.start ?? playhead) - 1.5)));
    setTimeout(() => playRef.current?.play(), 150);
  };

  const doApply = async () => {
    if (!active || !plan) return;
    if (previewing) await reload();
    const ops = [...active.ops];
    if (plan.note) ops.push({ type: 'project.addNote', text: plan.note });
    apply(ops, { label: `Komut: ${text.slice(0, 40)}` });
    if (plan.personal?.captionStyle) {
      const st = await api.state();
      await api.saveStyle({ captionStyle: { ...(st.style?.captionStyle ?? {}), ...plan.personal.captionStyle } });
      toast('Kişisel altyazı stilinize kaydedildi');
    }
    setHistory((h) => [{ text, summary: active.summary, ok: true }, ...h].slice(0, 12));
    setPreviewing(false);
    setPlan(null);
    setChosen(null);
    setHighlights([]);
    setText('');
  };

  const mic = async () => {
    if (!recorder.recording) {
      try {
        await recorder.start();
      } catch {
        toast('Mikrofona erişilemedi. Tarayıcıda mikrofon iznini verin.', 'error');
      }
      return;
    }
    const file = await recorder.stop();
    if (mode === 'talimat') {
      setBusy('Söyledikleriniz yazıya çevriliyor…');
      try {
        const r = await upload('/api/stt', [file], () => undefined);
        if (!r.text) toast(r.message || 'Konuşma anlaşılamadı', 'error');
        else {
          setText(r.text);
          await run(r.text);
        }
      } catch (e) {
        toast((e as Error).message, 'error');
      } finally {
        setBusy(null);
      }
    } else {
      setBusy('Dış ses kaydı ekleniyor…');
      try {
        await upload(`/api/import?projectId=${project.id}&role=voiceover&at=${playhead.toFixed(2)}`, [file], () => undefined);
        await reload();
        toast(`Dış ses ${formatTime(playhead)}'a eklendi`);
      } catch (e) {
        toast((e as Error).message, 'error');
      } finally {
        setBusy(null);
      }
    }
  };

  return (
    <div className="cmd">
      <div className="row-between">
        <Segmented
          size="sm"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'talimat', label: 'Talimat', hint: 'Söyledikleriniz kurgu komutu olur, videoya girmez' },
            { value: 'disses', label: 'Dış ses', hint: 'Kayıt videoya ses olarak eklenir' },
          ]}
        />
        <button className={`chip ${aiReady ? 'on' : ''}`} onClick={() => setSettingsOpen(true)} title="Serbest Türkçe komutları Claude ile anla (isteğe bağlı)">
          <Wand2 size={13} /> Claude {aiReady ? (aiAlways ? 'her komutta' : 'yedek') : 'kapalı'}
        </button>
      </div>
      <div className="cmd-input">
        <button className={`mic ${recorder.recording ? 'rec' : ''} ${mode}`} onClick={mic} disabled={!!busy} title={recorder.recording ? 'Bitir' : 'Konuşmaya başla'}>
          {recorder.recording ? <Square size={18} /> : <Mic size={20} />}
        </button>
        <textarea
          rows={2}
          value={text}
          placeholder={mode === 'talimat' ? 'Yazın veya mikrofona söyleyin: “Buradan sonraki üç saniyeyi kes”' : 'Dış ses: mikrofona basın, konuşun, bitince tekrar basın'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              if (text.trim()) void run(text);
            }
          }}
        />
        <button className="icon-btn" disabled={!text.trim()} onClick={() => run(text)} title="Anla (Enter)">
          <Send size={17} />
        </button>
      </div>
      {recorder.recording ? <p className="rec-hint">● Kaydediliyor{mode === 'disses' ? ` · ${formatTime(playhead)}'dan itibaren videoya eklenecek` : ' · talimat (videoya girmez)'}</p> : null}
      {busy ? (
        <p className="hint">
          <Loader2 size={13} className="spin" /> {busy}
        </p>
      ) : null}

      {plan ? (
        <div className={`plan ${plan.understood ? '' : 'bad'}`}>
          <p>
            {plan.summary} {plan.source === 'claude' ? <span className="badge">Claude</span> : null}
          </p>
          {plan.usage ? (
            <small className="muted">
              {plan.usage.input + plan.usage.output} token · ≈ {(plan.usage.usd * 100).toFixed(2).replace('.', ',')} sent
            </small>
          ) : null}
          {plan.hint ? <p className="hint">{plan.hint}</p> : null}
          {plan.candidates.length ? (
            <div className="cands">
              {plan.candidates.map((c, i) => (
                <button
                  key={i}
                  className={`chip ${chosen === c ? 'on' : ''}`}
                  onClick={() => {
                    setChosen(c);
                    setHighlights(c.ranges);
                    seekRef.current?.(toFrames(Math.max(0, c.ranges[0].start - 0.5)));
                  }}
                >
                  {String.fromCharCode(65 + i)}) {c.label}
                </button>
              ))}
            </div>
          ) : null}
          {chosen ? <p className="small">{chosen.summary}</p> : null}
          {!plan.understood ? (
            <div className="row-wrap">
              {!aiReady ? (
                <button className="btn tiny soft" onClick={() => setSettingsOpen(true)}>
                  <Wand2 size={13} /> Serbest komutlar için Claude'u aç
                </button>
              ) : null}
              <button className="btn tiny" onClick={clear}>
                <X size={13} /> Kapat
              </button>
            </div>
          ) : (
          <div className="row-wrap">
            <button className="btn soft tiny" disabled={!active} onClick={doPreview}>
              <Play size={13} /> {previewing ? 'Tekrar önizle' : 'Önizle'}
            </button>
            <button className="btn primary tiny" disabled={!active} onClick={doApply}>
              <Check size={13} /> Uygula
            </button>
            <button className="btn tiny" onClick={clear}>
              <X size={13} /> Vazgeç
            </button>
          </div>
          )}
          {previewing ? <p className="hint small">Önizleme: değişiklik henüz kaydedilmedi. Beğenirseniz “Uygula”.</p> : null}
        </div>
      ) : (
        <div className="examples">
          <button className="link small" onClick={() => setShowExamples((v) => !v)}>
            {showExamples ? 'Örnekleri gizle ▴' : 'Örnek komutlar ▾'}
          </button>
          {(showExamples ? COMMAND_EXAMPLES : []).map((ex) => (
            <button key={ex} className="example" onClick={() => setText(ex)}>
              {ex}
            </button>
          ))}
        </div>
      )}

      {history.length ? (
        <div className="cmd-history">
          <small className="muted">Bu oturumdaki komutlar (geri almak için ⌘Z)</small>
          {history.map((h, i) => (
            <div key={i} className="hist">
              <Check size={12} /> <span className="ellipsis" title={h.summary}>{h.text}</span>
            </div>
          ))}
        </div>
      ) : null}
      {settingsOpen ? <AiSettings onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
};

const AiSettings: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { toast } = useApp();
  const [st, setSt] = useState<Awaited<ReturnType<typeof api.settings>> | null>(null);
  const [key, setKey] = useState('');
  const [model, setModel] = useState('');
  const [mode, setModeSetting] = useState<'always' | 'fallback'>('always');
  React.useEffect(() => {
    api
      .settings()
      .then((x) => {
        setSt(x);
        setModel(x.aiModel);
        setModeSetting(x.aiMode);
      })
      .catch(() => undefined);
  }, []);
  const save = async () => {
    await api.saveSettings({ ...(key.trim() ? { anthropicApiKey: key.trim() } : {}), aiModel: model, aiMode: mode });
    toast('Claude ayarları kaydedildi');
    onClose();
  };
  const removeKey = async () => {
    await api.saveSettings({ anthropicApiKey: null });
    toast('Claude anahtarı silindi');
    onClose();
  };
  return (
    <Modal title="Komutları Claude ile anla" onClose={onClose} width={560}>
      <p className="hint">
        Claude açıkken söylediğiniz veya yazdığınız her komutu Claude yorumlar; kayıtlı kalıplara bağlı kalmazsınız. Claude önerir, uygulama her değişikliği kendi kurallarıyla
        doğrular; önizleyip “Uygula” ile onaylarsınız. İnternet veya kredi sorunu olursa yerel anlayıcı devreye girer.
      </p>
      <div className="field">
        <span>Ne zaman kullanılsın?</span>
        <Segmented
          value={mode}
          onChange={setModeSetting}
          options={[
            { value: 'always', label: 'Her komutta' },
            { value: 'fallback', label: 'Yalnız kayıtlı kalıplar anlamazsa' },
          ]}
        />
      </div>
      <div className="field">
        <span>Model</span>
        <div className="model-list">
          {(st?.models ?? []).map((m) => (
            <label key={m.id} className={`model ${model === m.id ? 'on' : ''}`}>
              <input type="radio" name="model" checked={model === m.id} onChange={() => setModel(m.id)} />
              <span>
                <b>{m.label}</b>
                <small className="muted">{m.approx}</small>
              </span>
            </label>
          ))}
        </div>
        <small className="muted">Maliyet videonun uzunluğuna (konuşma metni) göre değişir; her komutun gerçek maliyeti komutun altında gösterilir.</small>
      </div>
      <label className="field">
        <span>
          API anahtarı {st ? (st.aiConfigured ? `· kayıtlı (${st.keySource === 'ortam' ? 'ortam değişkeni' : 'bu Mac'})` : '· yok') : ''}
        </span>
        <input type="password" placeholder={st?.aiConfigured ? 'Değiştirmek için yeni anahtar yapıştırın' : 'sk-ant-…'} value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        <small className="muted">console.anthropic.com → API Keys. Anahtar yalnız bu Mac'te saklanır. Hesapta kredi olmalı (Billing).</small>
      </label>
      <div className="modal-actions">
        {st?.keySource === 'uygulama' ? (
          <button className="btn ghost danger" onClick={removeKey}>
            Anahtarı sil
          </button>
        ) : null}
        <button className="btn ghost" onClick={onClose}>
          Vazgeç
        </button>
        <button className="btn primary" disabled={!st?.aiConfigured && !key.trim()} onClick={save}>
          Kaydet
        </button>
      </div>
    </Modal>
  );
};

const MediaBin: React.FC = () => {
  const { project, apply, frame, reload } = useProject();
  const { library, toast } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const playhead = frame / FPS;
  const items = [...library.values()].filter((a) => a.role !== 'voiceover').sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  return (
    <div className="bin">
      <div className="row-between">
        <h4>Medya</h4>
        <button className="btn tiny" onClick={() => input.current?.click()}>
          <Plus size={13} /> Yükle
        </button>
        <input
          ref={input}
          type="file"
          multiple
          hidden
          accept="image/*,video/*,audio/*"
          onChange={async (e) => {
            const files = [...(e.target.files ?? [])];
            if (!files.length) return;
            try {
              await upload('/api/import', files, () => undefined);
              toast(`${files.length} dosya kütüphaneye eklendi`);
            } catch (err) {
              toast((err as Error).message, 'error');
            }
            e.target.value = '';
            await reload();
          }}
        />
      </div>
      <div className="bin-list">
        {items.map((a) => (
          <div key={a.id} className="bin-item">
            <div className="bin-thumb" style={{ backgroundImage: a.poster ? `url(${fileHref(a.poster)})` : undefined }}>
              {a.kind === 'audio' ? <Music2 size={16} /> : a.kind === 'image' ? null : null}
              {a.status === 'importing' ? <Loader2 size={14} className="spin" /> : null}
            </div>
            <div className="bin-meta">
              <span className="ellipsis" title={a.name}>
                {a.kind === 'video' ? <Video size={11} /> : a.kind === 'image' ? <ImageIcon size={11} /> : <Music2 size={11} />} {a.name}
              </span>
              <div className="row">
                {a.kind === 'audio' ? (
                  <button className="link small" onClick={() => apply([{ type: 'music.set', music: { assetId: a.id } }])}>
                    Müzik yap
                  </button>
                ) : (
                  <>
                    <button className="link small" title="Ana izin sonuna ekle" onClick={() => apply([{ type: 'clips.add', assetIds: [a.id] }])}>
                      Ana ize
                    </button>
                    <button
                      className="link small"
                      title="Oynatma imlecine üst iz olarak ekle (ana ses devam eder)"
                      onClick={() => apply([{ type: 'overlay.add', assetId: a.id, at: playhead, duration: 2 }])}
                    >
                      <Layers size={11} /> Üst ize
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
        {!items.length ? <p className="muted small">Kütüphane boş.</p> : null}
      </div>
      {project.notes.length ? (
        <div className="notes">
          <small className="muted">Bu projeye özel talimatlar</small>
          {project.notes.map((n, i) => (
            <div key={i} className="small">
              • {n}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const Inspector: React.FC<{ selection: Selection; onClear: () => void }> = ({ selection, onClear }) => {
  const { project, apply, frame } = useProject();
  const output = project.outputs.find((o) => o.id === project.ui.activeOutputId) ?? project.outputs[0];
  const { library } = useApp();
  const t = frame / FPS;
  if (!selection) return <p className="muted small">Zaman çizelgesinde bir öğe seçin.</p>;
  if (selection.kind === 'clip') {
    const item = layoutClips(project).find((l) => l.clip.id === selection.id);
    if (!item) return null;
    const c = item.clip;
    const a = library.get(c.assetId);
    return (
      <div className="stack">
        <b className="ellipsis">{a?.name}</b>
        <small className="muted">
          Kaynak {c.in.toFixed(2)}–{c.out.toFixed(2)} sn · zaman çizelgesi {formatTime(item.start)}–{formatTime(item.end)}
        </small>
        {a?.kind === 'video' ? (
          <>
            <Slider label="Başlangıç" value={c.in} min={0} max={Math.max(0.1, c.out - 0.2)} step={0.05} format={fmtSec} onChange={(v) => apply([{ type: 'clip.trim', clipId: c.id, in: v, out: c.out }], { key: `in:${c.id}` })} />
            <Slider label="Bitiş" value={c.out} min={c.in + 0.2} max={a.duration} step={0.05} format={fmtSec} onChange={(v) => apply([{ type: 'clip.trim', clipId: c.id, in: c.in, out: v }], { key: `out:${c.id}` })} />
            <Slider label="Ses" value={c.gainDb} min={-40} max={6} step={1} format={fmtDb} onChange={(v) => apply([{ type: 'clip.update', clipId: c.id, patch: { gainDb: v } }], { key: `g:${c.id}` })} />
          </>
        ) : (
          <Slider label="Süre" value={c.out - c.in} min={0.5} max={15} step={0.1} format={fmtSec} onChange={(v) => apply([{ type: 'clip.trim', clipId: c.id, in: 0, out: v }], { key: `d:${c.id}` })} />
        )}
        {output ? (
          <details className="insp-group" open>
            <summary>Kadraj ve boyut</summary>
            <FramingControls output={output} itemId={c.id} assetId={c.assetId} />
          </details>
        ) : null}
        <div className="row-wrap">
          <button className="btn tiny" disabled={!(t > item.start + 0.1 && t < item.end - 0.1)} onClick={() => apply([{ type: 'clip.split', clipId: c.id, at: t }])} title="Oynatma imlecinde ikiye böl">
            <Scissors size={13} /> İmleçte böl
          </button>
          <button
            className="btn tiny danger"
            onClick={() => {
              apply([{ type: 'timeline.deleteRange', start: item.start, end: item.end }]);
              onClear();
            }}
          >
            <Trash2 size={13} /> Sil (boşluğu kapat)
          </button>
        </div>
      </div>
    );
  }
  if (selection.kind === 'overlay') {
    const o = project.overlays.find((x) => x.id === selection.id);
    if (!o) return null;
    const a = library.get(o.assetId);
    return (
      <div className="stack">
        <b className="ellipsis">Üst iz · {a?.name}</b>
        <small className="muted">Ana görüntünün üstünde gösterilir; ana ses devam eder.</small>
        <Slider label="Başlangıç" value={o.at} min={0} max={Math.max(0.1, layoutClips(project).at(-1)?.end ?? 1)} step={0.05} format={fmtSec} onChange={(v) => apply([{ type: 'overlay.update', id: o.id, patch: { at: v } }], { key: `oat:${o.id}` })} />
        <Slider
          label="Süre"
          value={o.out - o.in}
          min={0.3}
          max={a?.kind === 'video' ? Math.max(0.4, a.duration - o.in) : 15}
          step={0.05}
          format={fmtSec}
          onChange={(v) => apply([{ type: 'overlay.update', id: o.id, patch: { out: o.in + v } }], { key: `odur:${o.id}` })}
        />
        {output ? (
          <details className="insp-group" open>
            <summary>Kadraj ve boyut (resim içinde resim için “Köşeye küçült”)</summary>
            <FramingControls output={output} itemId={o.id} assetId={o.assetId} />
          </details>
        ) : null}
        <button className="btn tiny danger" onClick={() => (apply([{ type: 'overlay.remove', id: o.id }]), onClear())}>
          <Trash2 size={13} /> Kaldır
        </button>
      </div>
    );
  }
  if (selection.kind === 'voice') {
    const v = project.voice.find((x) => x.id === selection.id);
    if (!v) return null;
    return (
      <div className="stack">
        <b>Dış ses kaydı</b>
        <small className="muted">Videoda duyulur; kurgu talimatlarından ayrı tutulur.</small>
        <audio controls src={fileHref(library.get(v.assetId)?.preview ?? null)} style={{ width: '100%' }} />
        <Slider label="Başlangıç" value={v.at} min={0} max={Math.max(0.1, layoutClips(project).at(-1)?.end ?? 1)} step={0.05} format={fmtSec} onChange={(x) => apply([{ type: 'voice.update', id: v.id, patch: { at: x } }], { key: `vat:${v.id}` })} />
        <Slider label="Ses" value={v.gainDb} min={-30} max={6} step={1} format={fmtDb} onChange={(x) => apply([{ type: 'voice.update', id: v.id, patch: { gainDb: x } }], { key: `vg:${v.id}` })} />
        <button className="btn tiny danger" onClick={() => (apply([{ type: 'voice.remove', id: v.id }]), onClear())}>
          <Trash2 size={13} /> Kaldır
        </button>
      </div>
    );
  }
  const tx = project.texts.find((x) => x.id === selection.id);
  if (!tx) return null;
  return (
    <div className="stack">
      <b>Yazı</b>
      <input value={tx.text} onChange={(e) => apply([{ type: 'text.update', id: tx.id, patch: { text: e.target.value } }], { key: `tt:${tx.id}` })} />
      <Slider label="Başlangıç" value={tx.start} min={0} max={Math.max(0.1, tx.end - 0.3)} step={0.1} format={fmtSec} onChange={(v) => apply([{ type: 'text.update', id: tx.id, patch: { start: v } }], { key: `ts:${tx.id}` })} />
      <Slider label="Bitiş" value={tx.end} min={tx.start + 0.3} max={Math.max(tx.start + 0.4, layoutClips(project).at(-1)?.end ?? 1)} step={0.1} format={fmtSec} onChange={(v) => apply([{ type: 'text.update', id: tx.id, patch: { end: v } }], { key: `te:${tx.id}` })} />
      <button className="btn tiny danger" onClick={() => (apply([{ type: 'text.remove', id: tx.id }]), onClear())}>
        <Trash2 size={13} /> Sil
      </button>
    </div>
  );
};

export const Studio: React.FC = () => {
  const { project, apply, undo, redo, canUndo, canRedo, undoLabel, redoLabel, saving, reload, frame } = useProject();
  const [selection, setSelection] = useState<Selection>(project.ui.selectedClipId ? { kind: 'clip', id: project.ui.selectedClipId } : null);
  const [exporting, setExporting] = useState(false);
  const [name, setName] = useState(project.name);
  const [tab, setTab] = useState<'komut' | 'medya' | 'secili'>('komut');
  const [cmdMode, setCmdMode] = useState<'talimat' | 'disses'>('talimat');
  const musicInput = useRef<HTMLInputElement>(null);
  const { toast } = useApp();
  const addMusic = async (files: File[]) => {
    if (!files.length) return;
    try {
      await upload(`/api/import?projectId=${project.id}`, files, () => undefined);
      await reload();
      toast('Müzik eklendi');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  /** Zaman çizelgesindeki iz adlarının “+” eylemleri */
  const laneAction = (key: string) => {
    if (key === 'v1' || key === 'v2') {
      setTab('medya');
      toast(key === 'v1' ? 'Medyada “Ana ize” ile ekleyin' : 'Medyada “Üst ize” ile oynatma imlecine ekleyin');
    } else if (key === 'a2') {
      setTab('komut');
      setCmdMode('disses');
      toast('Dış ses modu: mikrofona basıp konuşun');
    } else if (key === 'a1') musicInput.current?.click();
    else if (key === 'c') apply([{ type: 'captions.set', enabled: !project.captions.enabled }]);
    else if (key === 't') {
      const t = frame / FPS;
      apply([{ type: 'text.add', text: { text: 'Yeni yazı', start: t, end: t + 3 } }]);
      toast('Yazı eklendi; seçip düzenleyin');
    }
  };

  React.useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [undo, redo]);

  return (
    <div className="studio">
      <header className="topbar">
        <a className="icon-btn" href="#/" title="Ana ekran">
          <ArrowLeft size={18} />
        </a>
        <span className="badge">Stüdyo</span>
        <input
          className="title-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== project.name && apply([{ type: 'project.rename', name: name.trim() }])}
        />
        <span className="muted save-state">{saving ? 'Kaydediliyor…' : 'Kaydedildi'}</span>
        <div className="spacer" />
        <button className="icon-btn" disabled={!canUndo} onClick={undo} title={`Geri al${undoLabel ? ': ' + undoLabel : ''} (⌘Z)`}>
          <Undo2 size={18} />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={redo} title={`Yinele${redoLabel ? ': ' + redoLabel : ''} (⇧⌘Z)`}>
          <Redo2 size={18} />
        </button>
        <a className="btn ghost" href={`#/proje/${project.id}`}>
          <Zap size={15} /> Hızlı Edit
        </a>
        <button className="btn primary" onClick={() => setExporting(true)}>
          <Download size={15} /> Dışa aktar
        </button>
      </header>
      <aside className="studio-left">
        <div className="tabs">
          {(
            [
              ['komut', 'Komut'],
              ['medya', 'Medya'],
              ['secili', 'Seçili öğe'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="tab-body">
          {tab === 'komut' ? <CommandPanel mode={cmdMode} setMode={setCmdMode} /> : null}
          {tab === 'medya' ? <MediaBin /> : null}
          {tab === 'secili' ? <Inspector selection={selection} onClear={() => setSelection(null)} /> : null}
        </div>
      </aside>
      <main className="studio-center">
        <Preview framingToggle />
      </main>
      <footer className="studio-timeline">
        <Timeline
          selection={selection}
          onSelect={(sel) => {
            setSelection(sel);
            if (sel) setTab('secili');
          }}
          onLaneAction={laneAction}
        />
      </footer>
      <input ref={musicInput} type="file" accept="audio/*" hidden onChange={(e) => void addMusic([...(e.target.files ?? [])])} />
      {exporting ? (
        <Modal title="Dışa aktar" onClose={() => setExporting(false)} width={640}>
          <ExportStep />
        </Modal>
      ) : null}
    </div>
  );
};
