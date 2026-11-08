import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2, RefreshCw, Upload, MonitorPlay } from 'lucide-react';
import { api, fileHref, type PublishPreview, type Publication } from './api';
import { useApp } from './state';
import { Modal, Progress, Segmented, Toggle, fmtBytes } from './ui';

const STATUS: Record<Publication['status'], string> = { yukleniyor: 'yükleniyor', isleniyor: "YouTube'da işleniyor", hazir: 'hazır', hata: 'hata' };
const PRIVACY = { private: 'Özel (yalnız siz)', unlisted: 'Liste dışı (bağlantıyla)', public: 'Herkese açık' } as const;

/** Yayın kaydı satırı: durum, bağlantı, durumu yenile */
export const PublicationLine: React.FC<{ pub: Publication; projectId: string; onChange?: () => void }> = ({ pub, projectId, onChange }) => {
  const [busy, setBusy] = useState(false);
  return (
    <span className={`pub-line st-${pub.status}`} data-testid="yt-pub">
      <MonitorPlay size={13} /> {STATUS[pub.status]}
      {pub.url ? (
        <a href={pub.url} target="_blank" rel="noreferrer">
          {pub.url.replace('https://', '')} <ExternalLink size={11} />
        </a>
      ) : null}
      {pub.youtubeStatus?.privacyStatus ? <small className="muted">· {PRIVACY[pub.youtubeStatus.privacyStatus as keyof typeof PRIVACY] ?? pub.youtubeStatus.privacyStatus}</small> : null}
      {pub.error ? <small className="impact-warn">{pub.error}</small> : null}
      {pub.videoId && pub.status !== 'hazir' ? (
        <button
          className="icon-btn"
          title="Durumu yenile"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await api.refreshPublication(projectId, pub.id).catch(() => undefined);
            setBusy(false);
            onChange?.();
          }}
        >
          {busy ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
        </button>
      ) : null}
    </span>
  );
};

/** YouTube'a gönder: ne gideceği, görünürlük, açık onay, ilerleme */
export const PublishModal: React.FC<{ projectId: string; pkgId: string; outputId: string; onClose: () => void; openConnections: () => void }> = ({ projectId, pkgId, outputId, onClose, openConnections }) => {
  const { jobs, toast } = useApp();
  const [pv, setPv] = useState<PublishPreview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState<'private' | 'unlisted' | 'public'>('private');
  const [schedule, setSchedule] = useState('');
  const [kids, setKids] = useState(false);
  const [synthetic, setSynthetic] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const load = () =>
    api.publishPreview(projectId, pkgId, outputId).then(
      (p) => (setPv(p), setSynthetic(p.containsSyntheticMedia)),
      (e) => setErr((e as Error).message),
    );
  useEffect(() => {
    void load();
  }, []);
  const job = jobs.find((j) => j.id === jobId);
  useEffect(() => {
    if (job?.status === 'done') {
      toast("YouTube'a yüklendi", 'ok');
      void load();
    } else if (job?.status === 'error') {
      toast(job.error ?? 'Yükleme başarısız', 'error');
      void load();
    }
  }, [job?.status]);
  return (
    <Modal title="YouTube'a gönder" onClose={onClose} width={720}>
      {err ? <p className="impact-warn">{err}</p> : null}
      {!pv ? (
        <Loader2 className="spin" />
      ) : (
        <div className="stack pub" data-testid="publish">
          <div className="row">
            {pv.cover ? <img className="pub-cover" src={fileHref(pv.cover)} alt="Küçük resim" /> : null}
            <div className="stack-sm">
              <b>{pv.title || '(başlık yok)'}</b>
              <small className="muted">
                {pv.kind} · {pv.file ? `${pv.file.name} · ${fmtBytes(pv.file.size)}` : 'dosya yok'}
                {pv.captions ? ' · Türkçe altyazı (.srt)' : ''}
              </small>
              <small className="muted pub-desc">{pv.description}</small>
              {pv.tags.length ? <small className="muted">Etiketler: {pv.tags.join(', ')}</small> : null}
              <small>
                Kanal: <b>{pv.channel?.title ?? '—'}</b>
              </small>
            </div>
          </div>
          {pv.already ? (
            <div className="ch-block">
              <b className="small">Bu paket zaten gönderildi</b>
              <PublicationLine pub={pv.already} projectId={projectId} onChange={load} />
              <small className="muted">Aynı video ikinci kez yüklenmez. Görünürlüğü YouTube Studio'dan değiştirebilirsiniz.</small>
            </div>
          ) : pv.blockers.length ? (
            <div className="ch-block">
              {pv.blockers.map((b, i) => (
                <div key={i} className="check-row hata">
                  <AlertTriangle size={13} className="warn" /> <span>{b}</span>
                </div>
              ))}
              {pv.blockers.some((b) => /bağlı değil/.test(b)) ? (
                <button className="btn tiny" onClick={openConnections}>
                  Ayarlar → Bağlantılar
                </button>
              ) : null}
            </div>
          ) : (
            <>
              <div className="field">
                <span>Görünürlük</span>
                <Segmented
                  value={privacy}
                  onChange={setPrivacy}
                  options={(Object.keys(PRIVACY) as (keyof typeof PRIVACY)[]).map((k) => ({ value: k, label: PRIVACY[k] }))}
                />
              </div>
              <label className="field">
                <span>Zamanla (isteğe bağlı; o saate kadar özel kalır)</span>
                <input type="datetime-local" value={schedule} onChange={(e) => setSchedule(e.target.value)} aria-label="Yayın zamanı" />
              </label>
              <Toggle checked={kids} onChange={setKids} label="Çocuklara yönelik" />
              <Toggle checked={synthetic} onChange={setSynthetic} label="Yapay zekâyla üretilmiş/değiştirilmiş gerçekçi içerik var (YouTube beyanı)" />
              <label className="confirm-line">
                <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} aria-label="Yayın onayı" />
                <span>
                  Bu videonun <b>{pv.channel?.title}</b> kanalına <b>{schedule ? `${new Date(schedule).toLocaleString('tr-TR')} için zamanlanmış` : PRIVACY[privacy].toLowerCase()}</b> olarak yükleneceğini onaylıyorum.
                </span>
              </label>
              {job && job.status !== 'done' && job.status !== 'error' ? (
                <div className="dl-progress">
                  <Progress value={job.progress} />
                  <small className="muted">{job.message}</small>
                </div>
              ) : (
                <div className="modal-actions">
                  <button className="btn ghost" onClick={onClose}>
                    Vazgeç
                  </button>
                  <button
                    className="btn primary"
                    disabled={!confirm}
                    onClick={async () => {
                      try {
                        const r = await api.publish(projectId, {
                          pkgId,
                          outputId,
                          privacy,
                          publishAt: schedule ? new Date(schedule).toISOString() : null,
                          madeForKids: kids,
                          containsSyntheticMedia: synthetic,
                          confirm,
                        });
                        if (r.job) setJobId(r.job.id);
                        else void load();
                      } catch (e) {
                        toast((e as Error).message, 'error');
                      }
                    }}
                  >
                    <Upload size={14} /> Yükle
                  </button>
                </div>
              )}
            </>
          )}
          <small className="muted">
            <CheckCircle2 size={11} /> Reklam ve bütçe bu ekranın kapsamında değil. Yüklenen video ayrıca YouTube Studio'da görünür.
          </small>
        </div>
      )}
    </Modal>
  );
};
