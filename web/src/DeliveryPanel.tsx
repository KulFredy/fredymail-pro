import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileText, FolderOpen, Image as ImageIcon, Loader2, Package, Plus, Sparkles, Wand2, XCircle } from 'lucide-react';
import { CHANNELS, CHANNEL_IDS, captionsFor, channelOf, normalizeTags, outputName, outputTitle } from '../../src/core/channels';
import { AREA_LABELS } from '../../src/core/delivery';
import type { OpInput } from '../../src/core/ops';
import { FPS, type Output, type OutputMeta } from '../../src/core/schema';
import { formatTime } from '../../src/core/timeline';
import { api, fileHref, type OutputChecks, type PackageEntry, type Publication } from './api';
import { PublicationLine, PublishModal } from './PublishModal';
import { useApp, useProject } from './state';
import { Modal, Progress, Segmented, Toggle } from './ui';

const LEVEL_ICON = {
  ok: <CheckCircle2 size={13} className="ok" />,
  uyari: <AlertTriangle size={13} className="warn" />,
  hata: <XCircle size={13} className="err" />,
};

/** Metin alanı: yazarken yerel, odak çıkınca kaydedilir (tek geri alma adımı) */
const MetaField: React.FC<{ label: string; max: number; hint?: string; value: string; multiline?: boolean; onCommit: (v: string) => void }> = ({ label, max, hint, value, multiline, onCommit }) => {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const over = v.length > max;
  const props = { value: v, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV(e.target.value), onBlur: () => v !== value && onCommit(v), 'aria-label': label };
  return (
    <label className="field meta-field">
      <span className="row-between">
        <span>{label}</span>
        <small className={over ? 'err' : 'muted'}>
          {v.length}/{max}
          {hint ? ` ${hint}` : ''}
        </small>
      </span>
      {multiline ? <textarea rows={4} {...props} /> : <input {...props} />}
    </label>
  );
};

const ChannelEditor: React.FC<{ output: Output; checks: OutputChecks | undefined }> = ({ output, checks }) => {
  const { project, apply, frame, seekRef } = useProject();
  const seek = (f: number) => seekRef.current?.(f);
  const ch = channelOf(output);
  const cap = captionsFor(project, output);
  const upd = (patch: Record<string, unknown>, label?: string) => apply([{ type: 'output.update', outputId: output.id, patch } as OpInput], label ? { label } : undefined);
  const fields = ch?.fields ?? { description: { label: 'Açıklama', max: 2200 } };
  return (
    <div className="stack ch-editor" data-testid="channel-editor">
      <div className="row-between">
        <h4>{outputTitle(output)}</h4>
        {ch ? <small className="muted">{ch.platform}{ch.maxSec ? ` · en çok ${ch.maxSec >= 600 ? `${Math.round(ch.maxSec / 60)} dk` : `${ch.maxSec} sn`}` : ''}</small> : null}
      </div>
      {output.kind === 'video' ? (
        <div className="ch-block">
          <b className="small">Altyazı</b>
          <div className="row-wrap">
            <Toggle checked={cap.enabled} onChange={(v) => upd({ captions: { enabled: v } }, v ? 'Bu çıktıda altyazı açık' : 'Bu çıktıda altyazı kapalı')} label="Görüntüye yaz" />
            {cap.enabled ? (
              <Segmented
                size="sm"
                value={cap.style.position}
                onChange={(v) => upd({ captions: { position: v } })}
                options={[
                  { value: 'bottom', label: 'Alt' },
                  { value: 'middle', label: 'Orta' },
                  { value: 'top', label: 'Üst' },
                ]}
              />
            ) : null}
            {output.captions ? (
              <button className="link small" onClick={() => upd({ captions: null }, 'Altyazı projenin ayarına döndü')}>
                Projenin ayarına dön
              </button>
            ) : null}
          </div>
          {ch?.captionFile ? <small className="muted">Altyazı ayrıca .srt ve .vtt dosyası olarak pakete eklenir.</small> : null}
        </div>
      ) : null}
      {ch?.cover && output.kind === 'video' ? (
        <div className="ch-block">
          <b className="small">
            <ImageIcon size={12} /> {ch.cover.label}
          </b>
          <div className="row-wrap">
            <button className="btn tiny" onClick={() => upd({ cover: { at: frame / FPS } }, 'Kapak seçildi')}>
              İmleçteki kare ({formatTime(frame / FPS)})
            </button>
            {output.cover ? (
              <>
                <button className="link small" onClick={() => seek(Math.round(output.cover!.at * FPS))}>
                  Seçili: {formatTime(output.cover.at)}
                </button>
                <button className="link small" onClick={() => upd({ cover: null }, 'Kapak kaldırıldı')}>
                  Kaldır
                </button>
              </>
            ) : (
              <small className="muted">Seçilmedi: ilk kare kullanılır</small>
            )}
          </div>
          <MetaField label="Kapak başlığı (isteğe bağlı)" max={40} value={output.cover?.title ?? ''} onCommit={(v) => upd({ cover: { at: output.cover?.at ?? frame / FPS, title: v } }, 'Kapak başlığı')} />
        </div>
      ) : null}
      <div className="ch-block">
        <b className="small">
          <FileText size={12} /> Yayın metni
        </b>
        {Object.keys(fields).length ? null : <small className="muted">Bu kanalda metin alanı yok.</small>}
        {Object.entries(fields).map(([k, f]) =>
          f ? (
            k === 'tags' ? (
              <MetaField
                key={k}
                label={`${f.label} (virgülle)`}
                max={f.max}
                hint={f.hint}
                value={output.meta.tags.join(', ')}
                onCommit={(v) => upd({ meta: { tags: v.split(/[,\n]/).map((t) => t.trim()).filter(Boolean) } }, 'Etiketler')}
              />
            ) : (
              <MetaField key={k} label={f.label} max={f.max} hint={f.hint} multiline={k === 'description' || k === 'primaryText'} value={String(output.meta[k as keyof OutputMeta] ?? '')} onCommit={(v) => upd({ meta: { [k]: v } }, f.label)} />
            )
          ) : null,
        )}
        {fields.tags && output.meta.tags.length ? <small className="muted">Paylaşımda: {normalizeTags(output.meta.tags, ch).join(' ')}</small> : null}
      </div>
      <div className="ch-block" data-testid="checks">
        <b className="small">Teslim öncesi kontrol</b>
        {!checks ? <Loader2 size={13} className="spin" /> : null}
        {checks?.checks.map((c) => (
          <div key={c.id} className={`check-row ${c.level}`}>
            {LEVEL_ICON[c.level]}
            <span>
              <b>{AREA_LABELS[c.area]}:</b> {c.text}
            </span>
            {c.fix ? (
              <button className="btn tiny" onClick={() => apply(c.fix!.ops, { label: c.fix!.label })}>
                {c.fix.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
};

/** Kanal paketi: kanal profilleri, kapak, altyazı, yayın metni, kontroller, paket ve onay */
export const DeliveryModal: React.FC<{ onClose: () => void; openConnections?: () => void }> = ({ onClose, openConnections }) => {
  const { project, apply } = useProject();
  const { jobs, toast } = useApp();
  const [sel, setSel] = useState<string | null>(null);
  const [include, setInclude] = useState<Set<string>>(new Set());
  const [checks, setChecks] = useState<OutputChecks[] | null>(null);
  const [pkgs, setPkgs] = useState<PackageEntry[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [writing, setWriting] = useState(false);
  const [aiOn, setAiOn] = useState(false);
  const outputs = project.outputs;
  const missing = CHANNEL_IDS.filter((c) => !outputs.some((o) => o.channel === c));
  useEffect(() => {
    if (!sel || !outputs.some((o) => o.id === sel)) setSel(outputs.find((o) => o.channel)?.id ?? outputs[0]?.id ?? null);
    setInclude((s) => (s.size ? new Set([...s].filter((id) => outputs.some((o) => o.id === id))) : new Set(outputs.filter((o) => o.channel).map((o) => o.id))));
  }, [outputs.map((o) => o.id).join()]);
  useEffect(() => {
    const t = setTimeout(() => api.checks(project.id).then(setChecks, () => undefined), 250);
    return () => clearTimeout(t);
  }, [project]);
  const [pubs, setPubs] = useState<Publication[]>([]);
  const [publishing, setPublishing] = useState<{ pkgId: string; outputId: string } | null>(null);
  const loadPkgs = () => Promise.all([api.packages(project.id).then(setPkgs, () => undefined), api.publications(project.id).then(setPubs, () => undefined)]);
  useEffect(() => {
    void loadPkgs();
    api.connections().then((l) => setAiOn(!!l.find((c) => c.id === 'anthropic')?.configured), () => undefined);
  }, [project.id]);
  const job = jobs.find((j) => j.id === jobId);
  useEffect(() => {
    if (job?.status === 'done') {
      void loadPkgs();
      api.checks(project.id).then(setChecks, () => undefined);
      toast('Paket hazır', 'ok');
      setJobId(null);
    } else if (job?.status === 'error') {
      toast(job.error ?? 'Paket hazırlanamadı', 'error');
      setJobId(null);
    }
  }, [job?.status]);
  const selected = outputs.find((o) => o.id === sel) ?? null;
  const chosen = outputs.filter((o) => include.has(o.id));
  const errors = (checks ?? []).filter((c) => include.has(c.outputId)).reduce((n, c) => n + c.errors, 0);

  const writeMeta = async (ai: boolean) => {
    if (!chosen.length) return;
    setWriting(true);
    try {
      const r = await api.writeMeta(project.id, chosen.map((o) => o.id), ai);
      apply(
        r.suggestions.map((s) => ({ type: 'output.update', outputId: s.outputId, patch: { meta: s.meta } }) as OpInput),
        { label: 'Yayın metinleri' },
      );
      toast(r.note ?? (r.source === 'claude' ? `Claude yazdı${r.usage ? ` (≈ ${(r.usage.usd * 100).toFixed(1).replace('.', ',')} sent)` : ''}; düzenleyebilirsiniz` : 'Şablondan dolduruldu; düzenleyebilirsiniz'));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setWriting(false);
    }
  };

  return (
    <Modal title="Deliver · kanal paketi" onClose={onClose} width={1040}>
      <div className="delivery">
        <div className="dl-left">
          <small className="muted">Pakete girecek kanallar</small>
          {outputs.map((o) => {
            const c = checks?.find((x) => x.outputId === o.id);
            return (
              <div key={o.id} className={`dl-ch ${sel === o.id ? 'on' : ''}`} data-output={o.channel ?? o.format}>
                <input
                  type="checkbox"
                  checked={include.has(o.id)}
                  aria-label={`${outputName(o)} pakete dahil`}
                  onChange={(e) =>
                    setInclude((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(o.id);
                      else n.delete(o.id);
                      return n;
                    })
                  }
                />
                <button className="dl-ch-name" onClick={() => setSel(o.id)}>
                  <b>{outputName(o)}</b>
                  <small className="muted">{outputTitle(o).split(' · ').slice(1).join(' · ')}</small>
                </button>
                {c ? (
                  c.errors ? (
                    <span className="badge err">{c.errors} hata</span>
                  ) : c.warnings ? (
                    <span className="badge warn">{c.warnings}</span>
                  ) : (
                    <CheckCircle2 size={14} className="ok" />
                  )
                ) : null}
              </div>
            );
          })}
          {missing.length ? (
            <div className="stack-sm">
              <small className="muted">Kanal ekle</small>
              <div className="chips">
                {missing.map((c) => (
                  <button key={c} className="chip tag" onClick={() => apply([{ type: 'output.addChannel', channel: c }])}>
                    <Plus size={11} /> {CHANNELS[c].label}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          <div className="stack-sm">
            <button className="btn tiny" disabled={writing || !chosen.length} onClick={() => void writeMeta(aiOn)}>
              {writing ? <Loader2 size={13} className="spin" /> : aiOn ? <Sparkles size={13} /> : <Wand2 size={13} />} Metinleri {aiOn ? 'Claude ile ' : ''}yaz
            </button>
            {aiOn ? (
              <button className="link small" disabled={writing} onClick={() => void writeMeta(false)}>
                İnternetsiz şablonla doldur
              </button>
            ) : (
              <small className="muted">Claude bağlıysa marka tonuyla yazar.</small>
            )}
          </div>
        </div>
        <div className="dl-main">{selected ? <ChannelEditor output={selected} checks={checks?.find((c) => c.outputId === selected.id)} /> : <p className="muted">Kanal ekleyin.</p>}</div>
      </div>
      <div className="dl-foot">
        {job ? (
          <div className="dl-progress">
            <Progress value={job.progress} />
            <small className="muted">{job.message || 'Hazırlanıyor…'}</small>
          </div>
        ) : (
          <>
            <small className={errors ? 'err' : 'muted'}>
              {chosen.length} kanal{errors ? ` · ${errors} hata var (yine de hazırlanabilir; rapora yazılır)` : ''}
            </small>
            <button
              className="btn primary"
              disabled={!chosen.length}
              onClick={async () => {
                try {
                  const j = await api.makePackage(project.id, chosen.map((o) => o.id));
                  setJobId(j.id);
                } catch (e) {
                  toast((e as Error).message, 'error');
                }
              }}
            >
              <Package size={15} /> Paketi hazırla
            </button>
          </>
        )}
      </div>
      {pkgs.length ? (
        <div className="dl-pkgs" data-testid="packages">
          <small className="muted">Paketler</small>
          {pkgs.slice(0, 5).map((p) => (
            <PackageRow key={p.id} pkg={p} projectId={project.id} onChange={loadPkgs} pubs={pubs.filter((x) => x.pkgId === p.id)} onPublish={(outputId) => setPublishing({ pkgId: p.id, outputId })} />
          ))}
        </div>
      ) : null}
      {publishing ? (
        <PublishModal
          projectId={project.id}
          pkgId={publishing.pkgId}
          outputId={publishing.outputId}
          onClose={() => (setPublishing(null), void loadPkgs())}
          openConnections={() => (setPublishing(null), openConnections?.())}
        />
      ) : null}
    </Modal>
  );
};

const PackageRow: React.FC<{ pkg: PackageEntry; projectId: string; onChange: () => void; pubs: Publication[]; onPublish: (outputId: string) => void }> = ({ pkg, projectId, onChange, pubs, onPublish }) => {
  const { toast } = useApp();
  const files = useMemo(() => pkg.items.flatMap((i) => i.files.map((f) => ({ ...f, label: i.label }))), [pkg]);
  return (
    <div className={`dl-pkg ${pkg.approved ? 'approved' : ''}`}>
      <div className="row-between">
        <span>
          <b>{pkg.name}</b>{' '}
          <small className="muted">
            {new Date(pkg.createdAt).toLocaleString('tr-TR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {pkg.items.length} kanal ·{' '}
            {pkg.errors ? <span className="err">{pkg.errors} hata</span> : null} {pkg.warnings ? <span className="warn">{pkg.warnings} uyarı</span> : null}
            {!pkg.errors && !pkg.warnings ? <span className="ok">sorunsuz</span> : null}
          </small>
        </span>
        <span className="row-wrap">
          <a className="btn tiny ghost" href={fileHref(pkg.zip)} download>
            <Download size={12} /> Zip
          </a>
          <button className="btn tiny ghost" onClick={() => void api.reveal(`${pkg.dir}/paket.json`)}>
            <FolderOpen size={12} /> Klasör
          </button>
          {pkg.approved ? (
            <span className="badge ok" title={pkg.approvedDir}>
              Onaylandı
            </span>
          ) : (
            <button
              className="btn tiny primary"
              onClick={async () => {
                const r = await api.approvePackage(projectId, pkg.id);
                toast(`Onaylandı: ${r.approvedDir}`, 'ok');
                onChange();
              }}
            >
              <CheckCircle2 size={12} /> Onayla
            </button>
          )}
        </span>
      </div>
      <div className="row-wrap dl-files">
        {files.map((f) => (
          <a key={f.name} className="chip tag" href={fileHref(`${pkg.dir}/${f.name}`)} target="_blank" rel="noreferrer" title={f.label}>
            {f.kind === 'video' ? 'MP4' : f.kind === 'gorsel' ? 'JPEG' : f.kind === 'kapak' ? 'Kapak' : f.kind.toUpperCase()} · {f.label}
          </a>
        ))}
        <a className="chip tag" href={fileHref(`${pkg.dir}/metinler.txt`)} target="_blank" rel="noreferrer">
          metinler.txt
        </a>
        <a className="chip tag" href={fileHref(`${pkg.dir}/kontrol.txt`)} target="_blank" rel="noreferrer">
          kontrol.txt
        </a>
      </div>
      {pkg.approved && pkg.approvedDir ? <small className="muted">Teslim klasörü: ~/İçerik Fabrikası/{pkg.approvedDir}</small> : null}
      {pkg.items
        .filter((i) => i.channel === 'yt-video' || i.channel === 'yt-shorts')
        .map((i) => {
          const pub = pubs.find((x) => x.outputId === i.outputId && x.status !== 'hata') ?? pubs.find((x) => x.outputId === i.outputId);
          return (
            <div key={i.outputId} className="row-wrap pub-row">
              <small className="muted">{i.label}:</small>
              {pub ? <PublicationLine pub={pub} projectId={projectId} onChange={onChange} /> : null}
              {!pub || pub.status === 'hata' ? (
                <button className="btn tiny" disabled={!pkg.approved} title={pkg.approved ? '' : 'Önce paketi onaylayın'} onClick={() => onPublish(i.outputId)}>
                  YouTube'a gönder…
                </button>
              ) : null}
            </div>
          );
        })}
    </div>
  );
};
