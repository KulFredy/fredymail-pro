import React, { useRef, useState } from 'react';
import {
  ArrowLeft, Mic, Square, Send, Undo2, Redo2, Zap, Download, Play, Check, X, Scissors, Trash2, Plus, Music2, Layers, Loader2, Wand2, Video, Image as ImageIcon,
  PanelRightClose, PanelRightOpen, MessageSquareText, SlidersHorizontal, Settings, Package, Tag, FolderOpen, FileText, Palette, Pipette, Sparkles, Workflow,
} from 'lucide-react';
import type { OpInput } from '../../src/core/ops';
import { COMMAND_EXAMPLES, planCommand, type Plan, type PlanCandidate } from '../../src/core/commands';
import { describeImpact } from '../../src/core/impact';
import { FPS } from '../../src/core/schema';
import { clipIndexAt, formatTime, layoutClips, toFrames, voiceFreeAt, voiceOverlaps } from '../../src/core/timeline';
import { api, fileHref, upload } from './api';
import { Preview } from './Preview';
import { FramingControls } from './FramingControls';
import { useApp, useProject } from './state';
import { ExportStep } from './steps/ExportStep';
import { Timeline, type Marks, type Selection, dragAsset } from './Timeline';
import { TranscriptPanel } from './TranscriptPanel';
import { LutPanel } from './LutPanel';
import { LogoInspector, TextInspector } from './ElementInspector';
import { ReferencePanel } from './ReferencePanel';
import { ConnectionsModal } from './Connections';
import { BrandApplyForm, BrandsModal } from './Brands';
import { DeliveryModal } from './DeliveryPanel';
import { PipelineModal } from './Pipeline';
import { GeneratePanel, type RegenRequest } from './GeneratePanel';
import { Modal, RowSplitter, Segmented, Slider, fmtDb, fmtSec, modalOpen, useContextMenu, useRowHeight, type CtxItem } from './ui';

type HistoryItem = { text: string; summary: string; ok: boolean };

/** Kişisel arayüz tercihi (yalnız bu tarayıcı); okunamazsa varsayılan */
const readPref = <T extends string>(k: string, d: T): T => {
  try {
    return (localStorage.getItem(k) as T) || d;
  } catch {
    return d;
  }
};
const writePref = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* yok say */
  }
};

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

/** “altyazıyı Türkçeye çevir”, “translate subtitles” … */
const isTranslateAsk = (t: string) => /(çevir|tercüme|translat)/i.test(t) && /(altyaz|subtit|caption|dil)/i.test(t);

const CommandPanel: React.FC<{ mode: 'talimat' | 'disses'; setMode: (m: 'talimat' | 'disses') => void; onTranslate?: () => void }> = ({ mode, setMode, onTranslate }) => {
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
  const [asked, setAsked] = useState('');
  const [lastApplied, setLastApplied] = useState<string | null>(null);
  const recorder = useRecorder();
  const playhead = frame / FPS;
  const { luts } = useApp();
  const lutNames = React.useMemo(() => Object.fromEntries(luts.map((l) => [l.id, l.meta?.name ?? l.title])), [luts]);

  const clear = async () => {
    if (previewing) await reload();
    setPreviewing(false);
    setPlan(null);
    setChosen(null);
    setHighlights([]);
  };

  const run = async (input: string) => {
    // Altyazı çevirisi ayrı bir iş: Transcript panelinde satır sayısı ve maliyet gösterilip onayla yapılır
    if (onTranslate && isTranslateAsk(input)) {
      onTranslate();
      toast('Altyazı çevirisi Transcript panelinde: maliyeti görüp “Onayla ve çevir”e basın');
      return;
    }
    if (previewing) await reload();
    setPreviewing(false);
    setAsked(input.trim());
    setLastApplied(null);
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
        // Claude gerçekten yanıt verdiyse (yapamam dese bile) onun cevabı geçerli; yerel tahmin yalnız ulaşılamadığında
        p = c.understood || c.action || !local.understood || (c as { usage?: unknown }).usage ? c : { ...local, hint: `Claude kullanılamadı (${c.summary}); yerel anlayıcıyla yapıldı.` };
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
    setLastApplied(active.summary);
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
          {asked ? (
            <p className="small muted asked">
              Algılanan talep: <q>{asked}</q>
            </p>
          ) : null}
          {active && active.ops.length ? (
            <ul className="impact" aria-label="Önerilen işlemler">
              {describeImpact(project, refs, active.ops, lutNames).map((im, i) => (
                <li key={i}>
                  <span className="impact-op">{im.label}</span>
                  <span className="impact-meta">
                    {im.clips.length ? (
                      <span title={im.clips.map((c) => c.name).join(', ')}>
                        {im.clips.length === 1 ? `Klip ${im.clips[0].index} · ${im.clips[0].name}` : `Klip ${im.clips.map((c) => c.index).join(', ')}`}
                      </span>
                    ) : null}
                    {im.range ? (
                      <button className="link small mono" onClick={() => seekRef.current?.(toFrames(im.range!.start))} title="Bu ana git">
                        {im.range.start === im.range.end ? formatTime(im.range.start) : `${formatTime(im.range.start)}–${formatTime(im.range.end)}`}
                      </button>
                    ) : null}
                    <span className={`scope ${im.scope}`}>{im.scopeLabel}</span>
                  </span>
                  {im.warnings?.map((w) => (
                    <span key={w} className="impact-warn">
                      ⚠ {w}
                    </span>
                  ))}
                </li>
              ))}
              {plan.note ? (
                <li>
                  <span className="impact-op">Proje notu: {plan.note}</span>
                </li>
              ) : null}
            </ul>
          ) : null}
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
      ) : lastApplied ? (
        <div className="plan applied">
          <p className="small">
            <Check size={13} /> Uygulandı: {lastApplied}
          </p>
          <div className="row-wrap">
            <button
              className="btn tiny"
              onClick={() => {
                undo();
                setLastApplied(null);
              }}
              title="Bu komutu geri al (⌘Z)"
            >
              <Undo2 size={13} /> Geri al
            </button>
            <button className="btn tiny ghost" onClick={() => setLastApplied(null)}>
              Tamam
            </button>
          </div>
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

const MediaBin: React.FC<{ onSelect?: (s: Selection) => void }> = ({ onSelect }) => {
  const { project, apply, frame, reload } = useProject();
  const { library, toast } = useApp();
  const noClips = project.clips.length === 0;
  const projectRef = useRef(project);
  projectRef.current = project;
  /** Ekleme + geri bildirim: ne nereye gitti; görünmesi için ne gerekli */
  const addTo = (ops: OpInput[], msg: string, needsClip = true) => {
    apply(ops);
    toast(needsClip && noClips ? `${msg}. Önizlemede görünmesi için önce V1'e bir klip ekleyin.` : msg);
  };
  const input = useRef<HTMLInputElement>(null);
  const playhead = frame / FPS;
  const [ctxMenu, openCtx] = useContextMenu();
  const binMenu = (e: React.MouseEvent, a: (typeof items)[number]) => {
    const list: CtxItem[] =
      a.kind === 'audio'
        ? [
            { label: 'Müzik yap (A2)', icon: <Music2 size={14} />, onSelect: () => addTo([{ type: 'music.set', music: { assetId: a.id } }], `${a.name} müzik izine (A2) kondu`) },
            { label: `Dış ses olarak imlece ekle (A1) · ${formatTime(playhead)}`, icon: <Mic size={14} />, onSelect: () => addTo([{ type: 'voice.add', assetId: a.id, at: voiceFreeAt(project.voice, playhead) }], `${a.name} dış ses izine (A1) eklendi`) },
          ]
        : [
            { label: 'V1 sonuna ekle', icon: <Plus size={14} />, onSelect: () => addTo([{ type: 'clips.add', assetIds: [a.id] }], `${a.name} V1'in sonuna eklendi`, false) },
            { label: `V1'de imlece ekle · ${formatTime(playhead)}`, icon: <Plus size={14} />, onSelect: () => addTo([{ type: 'clips.add', assetIds: [a.id], index: clipIndexAt(project, playhead) }], `${a.name} V1'de imlece eklendi`, false) },
            { label: 'V2 üst ize ekle (imleçte, 2 sn)', icon: <Layers size={14} />, onSelect: () => addTo([{ type: 'overlay.add', assetId: a.id, at: playhead, duration: 2 }], `${a.name} V2'ye (imleçte, 2 sn) eklendi`) },
            { label: 'Gallery referansı yap', icon: <Palette size={14} />, onSelect: () => addTo([{ type: 'reference.add', assetId: a.id }], `${a.name} Gallery'ye referans olarak eklendi (videoya girmez)`, false) },
            ...(a.kind === 'image' ? [{ label: 'Logo yap (G1)', icon: <Tag size={14} />, onSelect: () => addTo([{ type: 'logo.add', assetId: a.id }], `Logo G1'e eklendi (sağ üst)`) } as CtxItem] : []),
          ];
    openCtx(e, list, a.name);
  };
  const items = [...library.values()].filter((a) => a.role === 'media').sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  return (
    <div className="bin">
      {ctxMenu}
      <div className="row-between">
        <h4 lang="en">Media Pool</h4>
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
          <div key={a.id} className="bin-item" data-asset={a.id} draggable={a.status !== 'importing'} onDragStart={(e) => dragAsset(e, a.id)} onContextMenu={(e) => binMenu(e, a)} title="Zaman çizelgesine sürükleyin · sağ tık: seçenekler">
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
                  <button className="trk-btn a" title="Müzik izine (A2) koy" aria-label="A2 müzik yap" onClick={() => addTo([{ type: 'music.set', music: { assetId: a.id } }], `${a.name} müzik izine (A2) kondu`)}>
                    A2 · Music
                  </button>
                ) : (
                  <>
                    <button className="trk-btn v" title="Ana izin (V1) sonuna ekle" aria-label="V1 ana ize ekle" onClick={() => addTo([{ type: 'clips.add', assetIds: [a.id] }], `${a.name} V1'in sonuna eklendi`, false)}>
                      V1
                    </button>
                    <button
                      className="trk-btn v"
                      title="Oynatma imlecine üst iz (V2) olarak ekle; ana ses devam eder"
                      aria-label="V2 üst ize ekle"
                      onClick={() => addTo([{ type: 'overlay.add', assetId: a.id, at: playhead, duration: 2 }], `${a.name} V2'ye (imleçte, 2 sn) eklendi`)}
                    >
                      <Layers size={11} /> V2
                    </button>
                    <button className="trk-btn" title="Gallery: rengini/havasını örnek almak için referans (videoya girmez)" aria-label="Gallery referans yap" onClick={() => addTo([{ type: 'reference.add', assetId: a.id }], `${a.name} Gallery'ye referans olarak eklendi (videoya girmez)`, false)}>
                      Gallery
                    </button>
                    {a.kind === 'image' ? (
                      <button className="trk-btn g" title="Logo izine (G1) ekle; saydam PNG/SVG önerilir" aria-label="G1 logo ekle" onClick={() => {
                          const before = new Set(project.logos.map((l) => l.id));
                          addTo([{ type: 'logo.add', assetId: a.id }], `Logo G1'e eklendi (sağ üst)${a.alpha ? '' : '; saydam PNG/SVG daha temiz görünür'}`);
                          // Yeni logoyu seç: Inspector'da konum/boyut hemen ayarlanabilsin
                          setTimeout(() => {
                            const added = projectRef.current.logos.find((l) => !before.has(l.id));
                            if (added) onSelect?.({ kind: 'logo', id: added.id });
                          }, 400);
                        }}>
                        Logo
                      </button>
                    ) : null}
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

const Inspector: React.FC<{ selection: Selection; onClear: () => void; onRegen?: (r: RegenRequest) => void }> = ({ selection, onClear, onRegen }) => {
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
            <Slider label="Ses girişi (yumuşak)" value={c.audioFadeIn ?? 0} min={0} max={Math.min(5, item.duration / 2)} step={0.05} format={fmtSec} onChange={(v) => apply([{ type: 'clip.update', clipId: c.id, patch: { audioFadeIn: v } }], { key: `fi:${c.id}` })} />
            <Slider label="Ses çıkışı (yumuşak)" value={c.audioFadeOut ?? 0} min={0} max={Math.min(5, item.duration / 2)} step={0.05} format={fmtSec} onChange={(v) => apply([{ type: 'clip.update', clipId: c.id, patch: { audioFadeOut: v } }], { key: `fo:${c.id}` })} />
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
        <details className="insp-group" open={!!c.motion}>
          <summary>Hareket (yavaş yakınlaşma / kaydırma)</summary>
          <label className="field">
            <span>Hareket</span>
            <select
              value={c.motion?.kind ?? ''}
              onChange={(e) =>
                apply([{ type: 'clip.update', clipId: c.id, patch: { motion: e.target.value ? { kind: e.target.value as NonNullable<typeof c.motion>['kind'], amount: c.motion?.amount ?? 0.15, duration: c.motion?.duration ?? null } : null } }], {
                  label: e.target.value ? 'Hareket eklendi' : 'Hareket kaldırıldı',
                })
              }
              aria-label="Hareket"
            >
              <option value="">Yok (sabit)</option>
              <option value="yakinlas">Yavaşça yakınlaş</option>
              <option value="uzaklas">Yavaşça uzaklaş</option>
              <option value="sola">Sola kay</option>
              <option value="saga">Sağa kay</option>
              <option value="yukari">Yukarı kay</option>
              <option value="asagi">Aşağı kay</option>
            </select>
          </label>
          {c.motion ? (
            <>
              <Slider label="Miktar" value={c.motion.amount} min={0.03} max={0.6} step={0.01} format={(v) => `%${Math.round(v * 100)}`} onChange={(v) => apply([{ type: 'clip.update', clipId: c.id, patch: { motion: { ...c.motion!, amount: v } } }], { key: `ma:${c.id}` })} />
              <label className="row small">
                <input type="checkbox" checked={c.motion.duration !== null} onChange={(e) => apply([{ type: 'clip.update', clipId: c.id, patch: { motion: { ...c.motion!, duration: e.target.checked ? Math.min(1.5, item.duration) : null } } }])} /> Yalnız girişte
              </label>
              {c.motion.duration !== null ? (
                <Slider label="Giriş süresi" value={c.motion.duration} min={0.3} max={Math.max(0.4, item.duration)} step={0.1} format={fmtSec} onChange={(v) => apply([{ type: 'clip.update', clipId: c.id, patch: { motion: { ...c.motion!, duration: v } } }], { key: `md:${c.id}` })} />
              ) : null}
            </>
          ) : null}
        </details>
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
        <b>Dış ses {v.tts ? `· ${v.tts.voiceName || 'ElevenLabs'}` : 'kaydı'}</b>
        <small className="muted">Videoda duyulur; kurgu talimatlarından ayrı tutulur.</small>
        {v.tts ? (
          <div className="tts-box">
            <small className="muted">Metin: “{v.tts.text.length > 140 ? v.tts.text.slice(0, 140) + '…' : v.tts.text}”</small>
            <button className="btn tiny" onClick={() => onRegen?.({ voiceItemId: v.id, text: v.tts!.text, voiceId: v.tts!.voiceId, modelId: v.tts!.modelId })}>
              Metni düzenle ve yeniden üret
            </button>
          </div>
        ) : null}
        {(() => {
          const over = voiceOverlaps(project.voice, v.id);
          if (!over.length) return null;
          const others = project.voice.filter((x) => x.id !== v.id);
          const free = voiceFreeAt(others, v.at);
          return (
            <div className="impact-warn" data-testid="voice-overlap">
              Bu ses {over.length === 1 ? 'başka bir dış sesle' : `${over.length} dış sesle`} üst üste çalıyor ({over.map((o) => formatTime(o.at)).join(', ')}).
              <div className="row-wrap">
                <button className="btn tiny" onClick={() => apply([{ type: 'voice.update', id: v.id, patch: { at: free } }])}>
                  Boş yere taşı · {formatTime(free)}
                </button>
              </div>
            </div>
          );
        })()}
        <audio controls src={fileHref(library.get(v.assetId)?.preview ?? null)} style={{ width: '100%' }} />
        <Slider label="Başlangıç" value={v.at} min={0} max={Math.max(0.1, layoutClips(project).at(-1)?.end ?? 1)} step={0.05} format={fmtSec} onChange={(x) => apply([{ type: 'voice.update', id: v.id, patch: { at: x } }], { key: `vat:${v.id}` })} />
        <Slider label="Ses" value={v.gainDb} min={-30} max={6} step={1} format={fmtDb} onChange={(x) => apply([{ type: 'voice.update', id: v.id, patch: { gainDb: x } }], { key: `vg:${v.id}` })} />
        <Slider label="Yumuşak giriş" value={v.fadeIn ?? 0} min={0} max={Math.min(5, (v.out - v.in) / 2)} step={0.05} format={fmtSec} onChange={(x) => apply([{ type: 'voice.update', id: v.id, patch: { fadeIn: x } }], { key: `vfi:${v.id}` })} />
        <Slider label="Yumuşak çıkış" value={v.fadeOut ?? 0} min={0} max={Math.min(5, (v.out - v.in) / 2)} step={0.05} format={fmtSec} onChange={(x) => apply([{ type: 'voice.update', id: v.id, patch: { fadeOut: x } }], { key: `vfo:${v.id}` })} />
        <button className="btn tiny danger" onClick={() => (apply([{ type: 'voice.remove', id: v.id }]), onClear())} title="Zaman çizelgesinden kaldır (⌫)">
          <Trash2 size={13} /> Kaldır
        </button>
      </div>
    );
  }
  if (selection.kind === 'logo') {
    const lg = project.logos.find((x) => x.id === selection.id);
    return lg ? <LogoInspector logo={lg} onClear={onClear} /> : null;
  }
  const tx = project.texts.find((x) => x.id === selection.id);
  if (!tx) return null;
  return <TextInspector tx={tx} onClear={onClear} />;
};

export const Studio: React.FC = () => {
  const { project, apply, undo, redo, canUndo, canRedo, undoLabel, redoLabel, saving, reload, frame, setHighlights, setUi } = useProject();
  const [selection, setSelection] = useState<Selection>(project.ui.selectedClipId ? { kind: 'clip', id: project.ui.selectedClipId } : null);
  const [exporting, setExporting] = useState(false);
  const [name, setName] = useState(project.name);
  const [leftTab, setLeftTab] = useState<'medya' | 'transkript' | 'luts' | 'referans' | 'uret'>(() => readPref('fabrika.studyo.sol', 'transkript'));
  const [rightTab, setRightTab] = useState<'komut' | 'secili'>('komut');
  const [rightOpen, setRightOpen] = useState<boolean>(() => readPref('fabrika.studyo.sag', '1') === '1');
  const [tlH, setTlH] = useRowHeight('fabrika.studyo.zaman');
  React.useEffect(() => writePref('fabrika.studyo.sol', leftTab), [leftTab]);
  React.useEffect(() => writePref('fabrika.studyo.sag', rightOpen ? '1' : '0'), [rightOpen]);
  const openRight = (t: 'komut' | 'secili') => {
    setRightTab(t);
    setRightOpen(true);
  };
  const [cmdMode, setCmdMode] = useState<'talimat' | 'disses'>('talimat');
  const [translateNonce, setTranslateNonce] = useState(0);
  const [connOpen, setConnOpen] = useState(false);
  const [deliveryOpen, setDeliveryOpen] = useState(false);
  const [pipelineOpen, setPipelineOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState<'uygula' | 'markalar' | null>(null);
  const [regen, setRegen] = useState<RegenRequest | null>(null);
  const [marks, setMarks] = useState<Marks>({ in: null, out: null });
  const deleteMarks = () => {
    if (marks.in === null || marks.out === null) return;
    const [a, b] = [Math.min(marks.in, marks.out), Math.max(marks.in, marks.out)];
    if (b - a < 1 / FPS) return;
    apply([{ type: 'timeline.deleteRange', start: a, end: b }], { label: `${(b - a).toFixed(2)} sn aralık silindi` });
    setMarks({ in: null, out: null });
  };
  /** İmleçte böl: seçili klip imleci kapsıyorsa o, değilse imlecin altındaki klip */
  const splitAtPlayhead = () => {
    const t = frame / FPS;
    const items = layoutClips(project);
    const sel = selection?.kind === 'clip' ? items.find((l) => l.clip.id === selection.id && t > l.start && t < l.end) : undefined;
    const item = sel ?? items.find((l) => t > l.start && t < l.end);
    if (!item || t - item.start < 0.1 || item.end - t < 0.1) {
      toast('Bölmek için imleci bir klibin içine getirin', 'error');
      return;
    }
    apply([{ type: 'clip.split', clipId: item.clip.id, at: t }], { label: 'İmleçte bölündü' });
  };
  const musicInput = useRef<HTMLInputElement>(null);
  const logoInput = useRef<HTMLInputElement>(null);
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
      setLeftTab('medya');
      toast(key === 'v1' ? 'Media Pool’da “V1” ile ekleyin' : 'Media Pool’da “V2” ile oynatma imlecine ekleyin');
    } else if (key === 'a2') {
      openRight('komut');
      setCmdMode('disses');
      toast('Dış ses modu: mikrofona basıp konuşun');
    } else if (key === 'g') logoInput.current?.click();
    else if (key === 'a1') musicInput.current?.click();
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
      if (modalOpen()) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      const t = frame / FPS;
      const key = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && key === 'b') {
        e.preventDefault();
        splitAtPlayhead();
      } else if (e.metaKey || e.ctrlKey || e.altKey) {
        return;
      } else if (key === 'i' || key === 'o') {
        setMarks((m) => ({ ...m, [key === 'i' ? 'in' : 'out']: t }));
        setHighlights([]);
      }
      else if (key === 's') splitAtPlayhead();
      else if (key === 'escape') setMarks({ in: null, out: null });
      else if ((key === 'backspace' || key === 'delete') && marks.in !== null && marks.out !== null) {
        e.preventDefault();
        deleteMarks();
      } else if ((key === 'backspace' || key === 'delete') && selection) {
        // Seçili klip / dış ses / üst iz / yazı / logo kaldırılır (⌘Z geri alır; orijinal dosya silinmez)
        e.preventDefault();
        const op =
          selection.kind === 'clip'
            ? ({ type: 'clips.remove', clipId: selection.id } as const)
            : selection.kind === 'voice'
            ? ({ type: 'voice.remove', id: selection.id } as const)
            : selection.kind === 'overlay'
              ? ({ type: 'overlay.remove', id: selection.id } as const)
              : selection.kind === 'logo'
                ? ({ type: 'logo.remove', id: selection.id } as const)
                : ({ type: 'text.remove', id: selection.id } as const);
        apply([op]);
        setSelection(null);
        toast(selection.kind === 'voice' ? 'Dış ses kaldırıldı (geri almak için ⌘Z)' : selection.kind === 'clip' ? 'Klip kurgudan çıkarıldı (geri almak için ⌘Z)' : 'Kaldırıldı (geri almak için ⌘Z)');
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  });

  return (
    <div className={`studio ${rightOpen ? '' : 'right-closed'}`} style={tlH ? ({ '--tl-h': `${tlH}px` } as React.CSSProperties) : undefined}>
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
        <button className={`brand-chip ${project.brand ? 'on' : ''}`} onClick={() => setBrandOpen('uygula')} title="Marka → ürün → kampanya" data-testid="brand-chip">
          <Tag size={13} /> {project.brand ? [project.brand.brandName, project.brand.productName, project.brand.campaign].filter(Boolean).join(' · ') : 'Marka seç'}
        </button>
        <span className="muted save-state">{saving ? 'Kaydediliyor…' : 'Kaydedildi'}</span>
        <div className="spacer" />
        <button className="icon-btn" onClick={() => setPipelineOpen(true)} title="Üretim hattı: üretim → Claude → kurgu → teslim; Premiere/Resolve XML" aria-label="Üretim hattı">
          <Workflow size={18} />
        </button>
        <button className="icon-btn" onClick={() => setConnOpen(true)} title="Ayarlar → Bağlantılar (Claude, ElevenLabs, Google Gemini…)" aria-label="Bağlantılar">
          <Settings size={18} />
        </button>
        <button className="icon-btn" disabled={!canUndo} onClick={undo} title={`Geri al${undoLabel ? ': ' + undoLabel : ''} (⌘Z)`}>
          <Undo2 size={18} />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={redo} title={`Yinele${redoLabel ? ': ' + redoLabel : ''} (⇧⌘Z)`}>
          <Redo2 size={18} />
        </button>
        <a className="btn ghost" href={`#/proje/${project.id}`}>
          <Zap size={15} /> Hızlı Edit
        </a>
        <button className="btn ghost" onClick={() => setDeliveryOpen(true)} title="YouTube, Shorts, Reels, Story, 4:5 reklam: kapak, altyazı dosyası, metinler, kontrol, zip">
          <Package size={15} /> Deliver
        </button>
        <button className="btn primary" onClick={() => setExporting(true)}>
          <Download size={15} /> Export
        </button>
      </header>
      <aside className="studio-left">
        <div className="tabs rail" role="tablist" aria-orientation="vertical" aria-label="Paneller">
          {(
            [
              ['medya', 'Media', FolderOpen],
              ['transkript', 'Transcript', FileText],
              ['luts', 'Color', Palette],
              ['referans', 'Gallery', Pipette],
              ['uret', 'AI Tools', Sparkles],
            ] as const
          ).map(([k, l, Icon]) => (
            <button key={k} role="tab" aria-selected={leftTab === k} className={leftTab === k ? 'on' : ''} onClick={() => setLeftTab(k)} title={l}>
              <Icon size={18} aria-hidden />
              <span>{l}</span>
            </button>
          ))}
        </div>
        <div className="tab-body">
          {leftTab === 'medya' ? <MediaBin onSelect={(sel) => (setSelection(sel), openRight('secili'))} /> : null}
          {leftTab === 'transkript' ? <TranscriptPanel onSelect={setSelection} openConnections={() => setConnOpen(true)} translateNonce={translateNonce} /> : null}
          {leftTab === 'luts' ? <LutPanel selection={selection} /> : null}
          {leftTab === 'referans' ? <ReferencePanel selection={selection} /> : null}
          {leftTab === 'uret' ? <GeneratePanel regen={regen} onRegenDone={() => setRegen(null)} openConnections={() => setConnOpen(true)} /> : null}
        </div>
      </aside>
      <main className="studio-center">
        <Preview framingToggle />
      </main>
      {rightOpen ? (
        <aside className="studio-right">
          <div className="tabs" role="tablist">
            {(
              [
                ['komut', 'Command'],
                ['secili', 'Inspector'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} role="tab" aria-selected={rightTab === k} className={rightTab === k ? 'on' : ''} onClick={() => setRightTab(k)}>
                <span lang="en">{l}</span>
              </button>
            ))}
            <button className="tab-icon" onClick={() => setRightOpen(false)} title="Paneli kapat (önizleme genişler)" aria-label="Sağ paneli kapat">
              <PanelRightClose size={16} />
            </button>
          </div>
          <div className="tab-body">
            {/* Komut paneli kapalı sekmede de yaşasın: plan ve önizleme kaybolmasın */}
            <div hidden={rightTab !== 'komut'}>
              <CommandPanel
                mode={cmdMode}
                setMode={setCmdMode}
                onTranslate={() => {
                  setLeftTab('transkript');
                  setTranslateNonce((n) => n + 1);
                }}
              />
            </div>
            {rightTab === 'secili' ? <Inspector selection={selection} onClear={() => setSelection(null)} onRegen={(r) => (setRegen(r), setLeftTab('uret'))} /> : null}
          </div>
        </aside>
      ) : (
        <aside className="studio-rail">
          <button className="icon-btn" onClick={() => setRightOpen(true)} title="Paneli aç" aria-label="Sağ paneli aç">
            <PanelRightOpen size={17} />
          </button>
          <button className="icon-btn" onClick={() => openRight('komut')} title="Komut">
            <MessageSquareText size={17} />
          </button>
          <button className="icon-btn" onClick={() => openRight('secili')} title="Inspector">
            <SlidersHorizontal size={17} />
          </button>
        </aside>
      )}
      <footer className="studio-timeline">
        <RowSplitter onChange={setTlH} min={150} testid="tl-splitter" />
        <Timeline
          selection={selection}
          onSelect={(sel) => {
            setSelection(sel);
            if (sel) openRight('secili');
          }}
          onLaneAction={laneAction}
          onEdit={(kind) => {
            if (kind === 'caption') setLeftTab('transkript');
            else if (kind === 'music') {
              setUi({ step: 'ses' });
              location.hash = `#/proje/${project.id}`;
            } else openRight('secili');
          }}
          marks={marks}
          onDeleteMarks={deleteMarks}
          onClearMarks={() => setMarks({ in: null, out: null })}
        />
      </footer>
      <input ref={musicInput} type="file" accept="audio/*" hidden onChange={(e) => void addMusic([...(e.target.files ?? [])])} />
      <input
        ref={logoInput}
        type="file"
        accept="image/png,image/svg+xml,image/webp,image/*"
        hidden
        data-testid="logo-input"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          try {
            const r = await upload('/api/import', files, () => undefined);
            const imgs = (r.assets as { id: string; kind: string }[]).filter((a) => a.kind === 'image');
            if (!imgs.length) return toast('Logo için bir görsel seçin (PNG, SVG)', 'error');
            apply(imgs.map((a) => ({ type: 'logo.add' as const, assetId: a.id })), { label: 'Logo eklendi' });
            toast('Logo sağ üste eklendi; Inspector panelinden konumunu değiştirebilirsiniz');
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        }}
      />
      {connOpen ? <ConnectionsModal onClose={() => setConnOpen(false)} /> : null}
      {pipelineOpen ? <PipelineModal onClose={() => setPipelineOpen(false)} projectId={project.id} openConnections={() => (setPipelineOpen(false), setConnOpen(true))} openDeliver={() => (setPipelineOpen(false), setDeliveryOpen(true))} /> : null}
      {deliveryOpen ? <DeliveryModal onClose={() => setDeliveryOpen(false)} openConnections={() => (setDeliveryOpen(false), setConnOpen(true))} /> : null}
      {brandOpen === 'markalar' ? <BrandsModal onClose={() => setBrandOpen(null)} /> : null}
      {brandOpen === 'uygula' ? (
        <Modal title="Marka, ürün ve kampanya" onClose={() => setBrandOpen(null)} width={720}>
          <BrandApplyForm
            projectId={project.id}
            initial={project.brand}
            onApply={(ops, label) => {
              apply(ops, { label });
              setBrandOpen(null);
              toast('Marka uygulandı; ⌘Z ile geri alınır');
            }}
            onCancel={() => setBrandOpen(null)}
            openBrands={() => setBrandOpen('markalar')}
          />
        </Modal>
      ) : null}
      {exporting ? (
        <Modal title="Export" onClose={() => setExporting(false)} width={640}>
          <ExportStep />
        </Modal>
      ) : null}
    </div>
  );
};
