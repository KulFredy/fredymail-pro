import React, { useCallback, useEffect, useState } from 'react';
import { outputTitle } from '../../../src/core/channels';
import { Download, FolderOpen, Smartphone, Check, X, Loader2, Copy, History, Save } from 'lucide-react';
import { outputLabel } from '../../../src/core/formats';
import { api, fileHref, type ExportEntry, type Version } from '../api';
import { MobileModal } from '../MobileModal';
import { useApp, useProject } from '../state';
import { Progress, Section, Segmented, Toggle, fmtBytes } from '../ui';
import { RESOLUTION_LABELS, renderSize } from '../../../src/core/formats';
import { RESOLUTIONS } from '../../../src/core/schema';
import { safeAreaIssues } from '../../../src/core/graphics';

export const ExportStep: React.FC = () => {
  const { project, apply, refs } = useProject();
  const { jobs, library, toast, onExportEvent } = useApp();
  const issues = safeAreaIssues(project, refs);
  const [exports, setExports] = useState<ExportEntry[]>([]);
  const [versions, setVersions] = useState<Version[]>([]);
  const [noMusic, setNoMusic] = useState<Record<string, boolean>>({});
  const [mobile, setMobile] = useState(false);
  const [desc, setDesc] = useState(project.description);

  const load = useCallback(() => {
    api.exports(project.id).then(setExports).catch(() => undefined);
    api.versions(project.id).then(setVersions).catch(() => undefined);
  }, [project.id]);
  useEffect(load, [load]);
  useEffect(() => onExportEvent((e) => e.projectId === project.id && load()), [onExportEvent, project.id, load]);

  const notReady = project.clips.filter((c) => library.get(c.assetId)?.status !== 'ready').length;
  const pendingTr = project.clips.filter((c) => ['pending', 'running'].includes(library.get(c.assetId)?.transcript.status ?? '')).length;

  const start = async (outputId: string) => {
    try {
      await api.render(project.id, outputId, 'full');
      if (noMusic[outputId] && project.music) await api.render(project.id, outputId, 'nomusic');
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };

  return (
    <div className="stack">
      {notReady ? <p className="warn">{notReady} klip hâlâ hazırlanıyor. Bitince dışa aktarabilirsiniz.</p> : null}
      {pendingTr ? <p className="hint">Konuşma çözümlemesi sürüyor; altyazıların gömülmesi için bitmesini bekleyin.</p> : null}

      {project.outputs.map((o) => {
        const running = jobs.filter((j) => j.type === 'render' && j.outputId === o.id && j.projectId === project.id && (j.status === 'running' || j.status === 'queued'));
        const failed = jobs.find((j) => j.type === 'render' && j.outputId === o.id && j.projectId === project.id && j.status === 'error');
        const list = exports.filter((e) => e.outputId === o.id).slice(0, 4);
        return (
          <Section key={o.id} title={`${outputTitle(o)} · ${RESOLUTION_LABELS[o.resolution ?? '1080']}`}>
            {issues
              .filter((i) => i.outputId === o.id)
              .map((i) => (
                <small key={i.kind + i.id} className="impact-warn">
                  ⚠ {i.text} — Stüdyo'da öğeyi seçip “Güvenli alana al”
                </small>
              ))}
            <div className="row-wrap">
              <Segmented
                size="sm"
                value={o.resolution ?? '1080'}
                onChange={(r) => apply([{ type: 'output.update', outputId: o.id, patch: { resolution: r } }])}
                options={RESOLUTIONS.map((r) => {
                  const sz = renderSize(o.format, r);
                  return { value: r, label: RESOLUTION_LABELS[r], hint: `${sz.width}×${sz.height}` };
                })}
              />
              <small className="muted">
                {(() => {
                  const sz = renderSize(o.format, o.resolution ?? '1080');
                  return `${sz.width}×${sz.height}`;
                })()}
                {o.resolution === '2160' ? ' · render yaklaşık 4 kat uzun sürer' : o.resolution === '1440' ? ' · render yaklaşık 2 kat uzun sürer' : ''}
              </small>
            </div>
            {(o.resolution === '1440' || o.resolution === '2160') && o.format !== 'landscape' ? (
              <p className="hint small">Instagram yüklerken 1080 genişliğe küçültür; 2K/4K en çok YouTube ve arşiv için yararlıdır.</p>
            ) : null}
            <div className="row-wrap">
              <button className="btn primary" disabled={!!notReady || running.length > 0} onClick={() => start(o.id)}>
                {running.length ? <Loader2 size={15} className="spin" /> : <Download size={15} />} Dışa aktar
              </button>
              {o.kind === 'video' && project.music ? (
                <Toggle checked={!!noMusic[o.id]} onChange={(v) => setNoMusic((s) => ({ ...s, [o.id]: v }))} label="Müziksiz sürümü de ver (Instagram müziği için)" />
              ) : null}
            </div>
            {running.map((j) => (
              <div key={j.id} className="job-progress">
                <small>
                  {j.status === 'queued' ? 'Sırada' : j.message} · %{Math.round(j.progress * 100)}
                </small>
                <Progress value={j.progress} />
              </div>
            ))}
            {failed && !running.length && !list.some((e) => e.createdAt > failed.createdAt) ? <p className="warn small">Son deneme başarısız: {failed.error}</p> : null}
            {list.map((e) => (
              <div key={e.id} className={`export ${e.verification.ok ? 'ok' : 'bad'}`}>
                <div className="row-between">
                  <b>
                    {e.name}
                    {e.variant === 'nomusic' ? <span className="badge">müziksiz</span> : null}
                  </b>
                  <small className="muted">{fmtBytes(e.verification.size)}</small>
                </div>
                <div className="checks">
                  {e.verification.checks.map((c) => (
                    <span key={c.label} className={c.ok ? 'ok' : 'bad'} title={c.detail}>
                      {c.ok ? <Check size={12} /> : <X size={12} />} {c.label}: {c.detail.replace(/\s*\(beklenen.*\)/, '')}
                    </span>
                  ))}
                </div>
                {e.kind === 'video' ? <video src={fileHref(e.file)} controls preload="metadata" className="export-video" /> : <img src={fileHref(e.file)} className="export-img" alt="" />}
                <div className="row-wrap">
                  <a className="btn tiny" href={fileHref(e.file)} download={e.name}>
                    <Download size={13} /> İndir
                  </a>
                  <button className="btn tiny" onClick={() => api.reveal(e.file)}>
                    <FolderOpen size={13} /> Klasörde göster
                  </button>
                  <button className="btn tiny" onClick={() => setMobile(true)}>
                    <Smartphone size={13} /> Telefona indir
                  </button>
                </div>
              </div>
            ))}
          </Section>
        );
      })}

      <Section
        title="Açıklama"
        aside={
          <button
            className="btn tiny"
            onClick={() => navigator.clipboard.writeText(desc).then(() => toast('Açıklama kopyalandı'))}
            disabled={!desc}
          >
            <Copy size={13} /> Kopyala
          </button>
        }
      >
        <textarea
          rows={4}
          placeholder="Instagram açıklaması, etiketler…"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc !== project.description && apply([{ type: 'project.setDescription', text: desc }])}
        />
      </Section>

      <Section
        title="Sürümler"
        hint="Bu hâli adlandırıp saklayın; istediğinizde geri dönün. Geri al (⌘Z) da her zaman çalışır."
        aside={
          <button
            className="btn tiny"
            onClick={async () => {
              const name = prompt('Sürüm adı', `Sürüm ${versions.length + 1}`);
              if (!name) return;
              await api.saveVersion(project.id, name);
              load();
              toast('Sürüm kaydedildi');
            }}
          >
            <Save size={13} /> Bu hâli kaydet
          </button>
        }
      >
        {versions.length === 0 ? <p className="muted small">Henüz kayıtlı sürüm yok.</p> : null}
        {[...versions].reverse().map((v) => (
          <div key={v.id} className="row-between version">
            <span>
              <History size={13} /> {v.name} <small className="muted">{new Date(v.at).toLocaleString('tr-TR')}</small>
            </span>
            <button
              className="btn tiny"
              onClick={async () => {
                if (!confirm(`“${v.name}” sürümüne dönülsün mü? (Geri alınabilir)`)) return;
                await api.restoreVersion(project.id, v.id);
                location.reload();
              }}
            >
              Bu sürüme dön
            </button>
          </div>
        ))}
      </Section>

      {mobile ? <MobileModal page="indir" onClose={() => setMobile(false)} /> : null}
    </div>
  );
};
