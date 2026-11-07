import React, { useState } from 'react';
import {
  ArrowLeft, Clapperboard, Plus, RectangleVertical, Scissors, Crop, Palette, Music2, Captions, Send, Undo2, Redo2, Smartphone, Loader2, Check, AlertTriangle,
} from 'lucide-react';
import { useApp, useProject } from './state';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { MobileModal } from './MobileModal';
import { AddStep } from './steps/AddStep';
import { FormatStep } from './steps/FormatStep';
import { TrimStep } from './steps/TrimStep';
import { FrameStep } from './steps/FrameStep';
import { ColorStep } from './steps/ColorStep';
import { AudioStep } from './steps/AudioStep';
import { TextStep } from './steps/TextStep';
import { ExportStep } from './steps/ExportStep';

export const STEPS = [
  { id: 'ekle', label: 'Ekle', icon: Plus, Comp: AddStep },
  { id: 'bicim', label: 'Biçim', icon: RectangleVertical, Comp: FormatStep },
  { id: 'sirala', label: 'Sırala & kısalt', icon: Scissors, Comp: TrimStep },
  { id: 'kadraj', label: 'Kadraj', icon: Crop, Comp: FrameStep },
  { id: 'renk', label: 'Renk & ışık', icon: Palette, Comp: ColorStep },
  { id: 'ses', label: 'Ses & müzik', icon: Music2, Comp: AudioStep, videoOnly: true },
  { id: 'altyazi', label: 'Yazı & altyazı', icon: Captions, Comp: TextStep, videoOnly: true },
  { id: 'teslim', label: 'Teslim', icon: Send, Comp: ExportStep },
] as const;

const JobsIndicator: React.FC = () => {
  const { jobs } = useApp();
  const [open, setOpen] = useState(false);
  const active = jobs.filter((j) => j.status === 'running' || j.status === 'queued');
  const recentErr = jobs.find((j) => j.status === 'error' && Date.now() - new Date(j.createdAt).getTime() < 120_000);
  return (
    <div className="jobs">
      <button className={`chip ${active.length ? 'busy' : ''}`} onClick={() => setOpen((o) => !o)}>
        {active.length ? <Loader2 size={14} className="spin" /> : recentErr ? <AlertTriangle size={14} /> : <Check size={14} />}
        {active.length ? `${active.length} iş sürüyor` : 'İşler'}
      </button>
      {open ? (
        <div className="jobs-pop" onMouseLeave={() => setOpen(false)}>
          {jobs.length === 0 ? <p className="muted">İş yok</p> : null}
          {jobs.slice(0, 12).map((j) => (
            <div key={j.id} className={`job ${j.status}`}>
              <div className="row">
                <span className="ellipsis">{j.title}</span>
                <small className="muted">{j.status === 'running' ? `%${Math.round(j.progress * 100)}` : j.status === 'queued' ? 'sırada' : j.status === 'done' ? '✓' : 'hata'}</small>
              </div>
              <small className="muted ellipsis">{j.error ?? j.message}</small>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const QuickEdit: React.FC = () => {
  const { project, apply, setUi, undo, redo, canUndo, canRedo, undoLabel, redoLabel, saving } = useProject();
  const [mobile, setMobile] = useState(false);
  const [name, setName] = useState(project.name);
  const hasVideo = project.outputs.some((o) => o.kind === 'video');
  const steps = STEPS.filter((s) => !('videoOnly' in s && s.videoOnly) || hasVideo);
  const step = steps.find((s) => s.id === project.ui.step) ?? steps[0];
  const idx = steps.indexOf(step);
  const Comp = step.Comp;

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
    <div className="editor">
      <header className="topbar">
        <a className="icon-btn" href="#/" title="Ana ekran">
          <ArrowLeft size={18} />
        </a>
        <input
          className="title-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== project.name && apply([{ type: 'project.rename', name: name.trim() }])}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
        <span className="muted save-state">{saving ? 'Kaydediliyor…' : 'Kaydedildi'}</span>
        <div className="spacer" />
        <button className="icon-btn" disabled={!canUndo} onClick={undo} title={`Geri al${undoLabel ? ': ' + undoLabel : ''} (⌘Z)`}>
          <Undo2 size={18} />
        </button>
        <button className="icon-btn" disabled={!canRedo} onClick={redo} title={`Yinele${redoLabel ? ': ' + redoLabel : ''} (⇧⌘Z)`}>
          <Redo2 size={18} />
        </button>
        <JobsIndicator />
        <a className="btn ghost" href={`#/studyo/${project.id}`} title="Aynı projeyi çok izli Stüdyo'da aç: kesmeler, ses ve altyazı ayrı izlerde">
          <Clapperboard size={16} /> Stüdyoda aç
        </a>
        <button className="btn soft" onClick={() => setMobile(true)}>
          <Smartphone size={16} /> Telefondan ekle
        </button>
      </header>

      <nav className="steps">
        {steps.map((s, i) => {
          const Icon = s.icon;
          return (
            <button key={s.id} className={`step ${s.id === step.id ? 'on' : ''}`} onClick={() => setUi({ step: s.id })}>
              <span className="num">{i + 1}</span>
              <Icon size={17} />
              <span>{s.label}</span>
            </button>
          );
        })}
        {!hasVideo ? <p className="hint small">Fotoğraf postunda ses ve altyazı adımları gizlenir.</p> : null}
      </nav>

      <main className="panel">
        <div className="panel-head">
          <h2>{step.label}</h2>
          <div className="panel-nav">
            {idx > 0 ? (
              <button className="btn ghost" onClick={() => setUi({ step: steps[idx - 1].id })}>
                Geri
              </button>
            ) : null}
            {idx < steps.length - 1 ? (
              <button className="btn primary" onClick={() => setUi({ step: steps[idx + 1].id })}>
                İleri: {steps[idx + 1].label}
              </button>
            ) : null}
          </div>
        </div>
        <div className="panel-body">
          <Comp />
        </div>
      </main>

      <aside className="preview-col">
        <Preview />
      </aside>

      <footer className="strip-row">
        <Timeline
          compact
          onLaneAction={(k) => setUi({ step: k === 'a1' || k === 'a2' ? 'ses' : k === 'c' || k === 't' ? 'altyazi' : k === 'v1' ? 'ekle' : 'sirala' })}
        />
      </footer>

      {mobile ? <MobileModal page="upload" onClose={() => setMobile(false)} /> : null}
    </div>
  );
};
