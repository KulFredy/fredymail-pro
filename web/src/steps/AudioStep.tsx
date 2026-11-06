import React, { useRef, useState } from 'react';
import { Music2, Upload, Trash2, Volume2, VolumeX, Lightbulb } from 'lucide-react';
import type { MusicMode } from '../../../src/core/schema';
import { hasSpeech, musicGainAt, speechIntervals, timelineWords, totalDuration } from '../../../src/core/timeline';
import { upload } from '../api';
import { useApp, useProject } from '../state';
import { Progress, Section, Slider, Toggle, fmtDb, fmtSec } from '../ui';

const MODES: { value: MusicMode; title: string; desc: string }[] = [
  { value: 'bed', title: 'Arka planda kısık', desc: 'Müzik baştan sona sabit ve düşük seviyede akar. Konuşunca ayrıca kısılmaz.' },
  { value: 'duck', title: 'Konuşmada kıs', desc: 'Müzik normal çalar; yalnız konuştuğunuz anlarda iner, sonra yumuşakça geri gelir.' },
  { value: 'fixed', title: 'Sabit', desc: 'Otomatik değişiklik yok; seviyeyi siz belirlersiniz.' },
];

/** Müzik seviyesinin zaman içindeki eğrisi (önizleme) */
const Envelope: React.FC = () => {
  const { project, refs } = useProject();
  const total = totalDuration(project);
  if (!project.music || total <= 0) return null;
  const speech = speechIntervals(timelineWords(project, refs));
  const N = 160;
  const pts = Array.from({ length: N + 1 }, (_, i) => {
    const t = (i / N) * total;
    const g = musicGainAt(t, project, speech, total);
    const db = g > 0 ? Math.max(-40, 20 * Math.log10(g)) : -40;
    return `${(i / N) * 300},${60 - ((db + 40) / 40) * 56}`;
  });
  return (
    <svg className="envelope" viewBox="0 0 300 62" preserveAspectRatio="none">
      {speech.map(([s, e], i) => (
        <rect key={i} x={(s / total) * 300} width={((e - s) / total) * 300} y={0} height={62} className="env-speech" />
      ))}
      <polyline points={pts.join(' ')} className="env-line" />
    </svg>
  );
};

export const AudioStep: React.FC = () => {
  const { project, apply, refs, reload } = useProject();
  const { library, toast } = useApp();
  const [prog, setProg] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const music = project.music;
  const musicAsset = music ? library.get(music.assetId) : undefined;
  const speechPresent = hasSpeech(project, refs);
  const audioAssets = [...library.values()].filter((a) => a.kind === 'audio');
  const set = (patch: object, key?: string) => apply([{ type: 'music.set', music: patch }], key ? { key, label: 'Müzik ayarı' } : undefined);

  const addMusic = async (files: File[]) => {
    if (!files.length) return;
    setProg(0);
    try {
      await upload(`/api/import?projectId=${project.id}`, files, setProg);
      await reload();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setProg(null);
    }
  };

  return (
    <div className="stack">
      <Section
        title="Müzik"
        hint="Kendi dosyanızı veya kullanım hakkınız olan bir parçayı ekleyin. Instagram'ın müzik kütüphanesini kullanacaksanız Teslim adımında müziksiz sürümü alın."
        aside={
          music ? (
            <button className="btn tiny danger" onClick={() => apply([{ type: 'music.set', music: null }])}>
              <Trash2 size={13} /> Kaldır
            </button>
          ) : null
        }
      >
        {music && musicAsset ? (
          <div className="music-card">
            <Music2 size={18} />
            <div>
              <b>{musicAsset.name}</b>
              <small className="muted">{fmtSec(musicAsset.duration)}</small>
            </div>
          </div>
        ) : (
          <div className="row-wrap">
            <button className="btn primary" onClick={() => input.current?.click()}>
              <Upload size={15} /> Müzik dosyası seç
            </button>
            {audioAssets.map((a) => (
              <button key={a.id} className="chip" onClick={() => apply([{ type: 'music.set', music: { assetId: a.id, mode: speechPresent ? 'duck' : 'fixed' } }])}>
                <Music2 size={12} /> {a.name}
              </button>
            ))}
          </div>
        )}
        {prog !== null ? <Progress value={prog} /> : null}
        <input ref={input} type="file" accept="audio/*" hidden onChange={(e) => void addMusic([...(e.target.files ?? [])])} />
      </Section>

      {music ? (
        <>
          {speechPresent && music.mode === 'fixed' && !music.modeLocked ? (
            <div className="suggest">
              <Lightbulb size={16} /> Videoda konuşma var. Müziğin konuşurken kısılmasını ister misiniz?
              <button className="btn tiny primary" onClick={() => set({ mode: 'duck' })}>
                Konuşmada kıs
              </button>
              <button className="btn tiny" onClick={() => set({ mode: 'bed' })}>
                Hep kısık aksın
              </button>
            </div>
          ) : null}
          <Section title="Müzik modu">
            <div className="mode-list">
              {MODES.map((m) => (
                <button key={m.value} className={`mode ${music.mode === m.value ? 'on' : ''}`} onClick={() => set({ mode: m.value, modeLocked: true })}>
                  <b>{m.title}</b>
                  <small>{m.desc}</small>
                  {m.value === 'duck' && !speechPresent ? <small className="warn">Bu projede henüz konuşma algılanmadı.</small> : null}
                </button>
              ))}
            </div>
            <Envelope />
            <small className="muted">Çizgi müziğin seviyesi, turuncu alanlar konuşma.</small>
          </Section>
          <Section title="Seviye">
            {music.mode === 'bed' ? (
              <Slider label="Arka plan seviyesi" value={music.bedDb} min={-36} max={-6} step={1} format={fmtDb} onChange={(v) => set({ bedDb: v }, 'bed')} />
            ) : (
              <Slider label="Müzik seviyesi" value={music.gainDb} min={-30} max={0} step={1} format={fmtDb} onChange={(v) => set({ gainDb: v }, 'gain')} />
            )}
            {music.mode === 'duck' ? (
              <>
                <Slider label="Konuşmada ne kadar kısılsın" value={-music.duckDb} min={4} max={30} step={1} format={(v) => `−${v} dB`} onChange={(v) => set({ duckDb: -v }, 'duck')} />
                <Slider label="Geri gelme süresi" value={music.release} min={0.2} max={2} step={0.05} format={fmtSec} onChange={(v) => set({ release: v }, 'release')} />
              </>
            ) : null}
            <Slider
              label="Müziğin başlangıç noktası"
              value={music.start}
              min={0}
              max={Math.max(1, (musicAsset?.duration ?? 60) - 1)}
              step={0.1}
              format={fmtSec}
              onChange={(v) => set({ start: v }, 'start')}
            />
            <Slider label="Girişte yükselme" value={music.fadeIn} min={0} max={3} step={0.1} format={fmtSec} onChange={(v) => set({ fadeIn: v }, 'fin')} />
            <Slider label="Sonda azalma" value={music.fadeOut} min={0} max={5} step={0.1} format={fmtSec} onChange={(v) => set({ fadeOut: v }, 'fout')} />
          </Section>
        </>
      ) : null}

      <Section title="Kliplerin kendi sesi" hint="Ortam sesini kısın, rüzgârı susturun ya da belirli bir klipte müziği kapatın.">
        {project.clips.map((c, i) => {
          const a = library.get(c.assetId);
          if (a?.kind !== 'video') return null;
          return (
            <div key={c.id} className="clip-audio">
              <div className="row-between">
                <b className="ellipsis">
                  {i + 1}. {a.name}
                </b>
                <button
                  className="icon-btn"
                  title={c.muted ? 'Sesi aç' : 'Sustur'}
                  onClick={() => apply([{ type: 'clip.update', clipId: c.id, patch: { muted: !c.muted } }])}
                >
                  {c.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </button>
              </div>
              {!a.hasAudio ? <small className="muted">Bu klipte ses yok.</small> : null}
              {a.hasAudio && !c.muted ? (
                <Slider
                  label="Klip sesi"
                  value={c.gainDb}
                  min={-40}
                  max={6}
                  step={1}
                  format={fmtDb}
                  onChange={(v) => apply([{ type: 'clip.update', clipId: c.id, patch: { gainDb: v } }], { key: `gain:${c.id}`, label: 'Klip sesi' })}
                />
              ) : null}
              {music ? (
                <Toggle checked={c.musicMuted} onChange={(v) => apply([{ type: 'clip.update', clipId: c.id, patch: { musicMuted: v } }])} label="Bu klipte müziği sustur" />
              ) : null}
            </div>
          );
        })}
      </Section>
    </div>
  );
};
