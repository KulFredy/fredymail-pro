import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Smartphone, Wifi } from 'lucide-react';
import { api, type Editor, type MobileStatus, type ProjectSummary } from './api';
import { Modal, Segmented } from './ui';

export type PhoneTarget = { kind: 'son' | 'proje' | 'yeni'; projectId?: string };
const editorHash = (editor: Editor, id: string) => `#/${editor === 'studio' ? 'studyo' : 'proje'}/${id}`;
const today = () => new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });

/**
 * Ana sayfa → Telefondan ekle: önce hedef (son proje / başka proje / yeni proje), sonra o projeye ait QR.
 * Mevcut yerel aktarım altyapısını kullanır (/api/mobile, /m/<anahtar>?p=<proje>); durum /api/mobile/durum'dan.
 */
export const PhoneTransferModal: React.FC<{
  projects: ProjectSummary[];
  lastProjectId: string | null;
  initial?: PhoneTarget;
  onClose: (changed: boolean) => void;
}> = ({ projects, lastProjectId, initial, onClose }) => {
  const last = projects.find((p) => p.id === lastProjectId) ?? null;
  const others = projects.filter((p) => p.id !== last?.id);
  const [kind, setKind] = useState<PhoneTarget['kind']>(initial?.kind ?? (last ? 'son' : others.length ? 'proje' : 'yeni'));
  const [otherId, setOtherId] = useState(initial?.kind === 'proje' && initial.projectId ? initial.projectId : (others[0]?.id ?? ''));
  const [newName, setNewName] = useState(`Telefondan · ${today()}`);
  const [newEditor, setNewEditor] = useState<Editor>('quick');
  /** Onaylanmış hedef (QR bu projeye ait) */
  const [target, setTarget] = useState<{ id: string; name: string; editor: Editor; created: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState<{ url: string | null; qr: string | null; reason?: string } | null>(null);
  const [status, setStatus] = useState<MobileStatus | null>(null);
  const since = useRef(new Date(Date.now() - 1000).toISOString());

  const loadQr = async (id: string) => {
    setQr(null);
    try {
      setQr(await api.mobile(id, 'upload'));
    } catch {
      setQr({ url: null, qr: null, reason: 'Uygulamanın sunucusuna ulaşılamadı.' });
    }
  };

  const confirm = async () => {
    setBusy(true);
    try {
      if (kind === 'yeni') {
        const st = await api.createProject(newName.trim() || `Telefondan · ${today()}`, newEditor === 'studio' ? [{ format: 'landscape', kind: 'video' }] : [{ format: 'story' }, { format: 'post', kind: 'image' }], newEditor);
        setTarget({ id: st.project.id, name: st.project.name, editor: newEditor, created: true });
        since.current = new Date(Date.now() - 1000).toISOString();
        await loadQr(st.project.id);
      } else {
        const p = kind === 'son' ? last : projects.find((x) => x.id === otherId);
        if (!p) return;
        setTarget({ id: p.id, name: p.name, editor: p.editor, created: false });
        since.current = new Date(Date.now() - 1000).toISOString();
        await loadQr(p.id);
      }
    } catch (e) {
      setQr({ url: null, qr: null, reason: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // Aktarım durumu (yerel sunucu; 1,5 sn'de bir)
  useEffect(() => {
    if (!target || !qr?.qr) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api.mobileStatus(target.id, since.current);
        if (!stop) setStatus(s);
      } catch {
        /* sunucu geçici olarak yanıt vermedi */
      }
    };
    void tick();
    const t = setInterval(tick, 1500);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [target?.id, qr?.qr]);

  const close = async () => {
    // Bu pencerede açılan ama hiç dosya almayan yeni proje geride boş kalmasın
    if (target?.created && !(status?.received ?? 0)) await api.deleteProject(target.id).catch(() => undefined);
    onClose(!!target);
  };
  const received = status?.received ?? 0;
  const processing = Math.max(0, received - (status?.ready ?? 0) - (status?.failed ?? 0));

  return (
    <Modal title="Telefondan ekle" onClose={() => void close()} width={620} testid="phone">
      {!target ? (
        <div className="stack" data-testid="phone-target">
          <p className="hint">Telefondaki fotoğraf, video ve müzikler hangi projeye gitsin?</p>
          <div className="target-list" role="radiogroup" aria-label="Hedef proje">
            <label className={`target ${kind === 'son' ? 'on' : ''} ${last ? '' : 'disabled'}`}>
              <input type="radio" name="hedef" checked={kind === 'son'} disabled={!last} onChange={() => setKind('son')} />
              <span>
                <b>Son proje</b>
                <small className="muted">{last ? last.name : 'Henüz proje yok'}</small>
              </span>
            </label>
            <label className={`target ${kind === 'proje' ? 'on' : ''} ${others.length ? '' : 'disabled'}`}>
              <input type="radio" name="hedef" checked={kind === 'proje'} disabled={!others.length} onChange={() => setKind('proje')} />
              <span>
                <b>Başka bir mevcut proje</b>
                {kind === 'proje' ? (
                  <select value={otherId} onChange={(e) => setOtherId(e.target.value)} aria-label="Proje seç">
                    {others.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                ) : (
                  <small className="muted">{others.length ? `${others.length} proje arasından seçin` : 'Başka proje yok'}</small>
                )}
              </span>
            </label>
            <label className={`target ${kind === 'yeni' ? 'on' : ''}`}>
              <input type="radio" name="hedef" checked={kind === 'yeni'} onChange={() => setKind('yeni')} />
              <span>
                <b>Yeni proje</b>
                {kind === 'yeni' ? (
                  <span className="row-wrap">
                    <input value={newName} onChange={(e) => setNewName(e.target.value)} aria-label="Yeni proje adı" />
                    <Segmented
                      size="sm"
                      value={newEditor}
                      onChange={setNewEditor}
                      options={[
                        { value: 'quick', label: 'Hızlı Edit' },
                        { value: 'studio', label: 'Kurgu Stüdyosu' },
                      ]}
                    />
                  </span>
                ) : (
                  <small className="muted">Hızlı Edit veya Kurgu Stüdyosu</small>
                )}
              </span>
            </label>
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => void close()}>
              Vazgeç
            </button>
            <button className="btn primary" disabled={busy || (kind === 'proje' && !otherId)} onClick={() => void confirm()}>
              {busy ? <Loader2 size={14} className="spin" /> : <Smartphone size={14} />} QR kodu göster
            </button>
          </div>
        </div>
      ) : (
        <div className="phone-qr stack" data-testid="phone-qr">
          <div className="row-between">
            <span>
              Hedef: <b data-testid="phone-target-name">{target.name}</b> <span className="badge">{target.editor === 'studio' ? 'Stüdyo' : 'Hızlı Edit'}</span>
            </span>
            {!received ? (
              <button className="link small" onClick={() => void (target.created ? api.deleteProject(target.id).catch(() => undefined) : null, setTarget(null), setQr(null), setStatus(null))}>
                Hedefi değiştir
              </button>
            ) : null}
          </div>
          <div className="phone-grid">
            <div className="qr-box">
              {!qr ? (
                <p className="muted">
                  <Loader2 size={14} className="spin" /> QR hazırlanıyor…
                </p>
              ) : qr.qr ? (
                <>
                  <div className="qr" dangerouslySetInnerHTML={{ __html: qr.qr }} />
                  <code className="qr-url">{qr.url}</code>
                </>
              ) : (
                <div className="phone-err" role="alert">
                  <AlertTriangle size={16} className="warn" />
                  <p>{qr.reason ?? 'QR oluşturulamadı.'}</p>
                  <button className="btn tiny" onClick={() => void loadQr(target.id)}>
                    <RefreshCw size={13} /> Yeniden dene
                  </button>
                </div>
              )}
            </div>
            <ol className="steps-list">
              <li>
                <Wifi size={13} /> Telefon ile bu Mac <b>aynı Wi-Fi ağına</b> bağlı olsun.
              </li>
              <li>Telefonun kamerasıyla QR kodu okutun; açılan sayfada “Galeriden seç”e basın.</li>
              <li>Fotoğraf, video ve müziği bir kerede seçin. Dosyalar “{target.name}” projesine eklenir.</li>
            </ol>
          </div>
          <div className="phone-status" aria-live="polite" data-testid="phone-status">
            {status?.error ? (
              <div className="phone-err" role="alert">
                <AlertTriangle size={15} className="warn" />
                <span>Aktarım başarısız: {status.error}. Telefonda aynı sayfadan yeniden gönderin.</span>
                <button className="btn tiny" onClick={() => void (since.current = new Date().toISOString(), setStatus(null), loadQr(target.id))}>
                  <RefreshCw size={13} /> Yeniden dene
                </button>
              </div>
            ) : status?.active ? (
              <span>
                <Loader2 size={14} className="spin" /> Telefondan dosya geliyor…
              </span>
            ) : received ? (
              <span>
                <CheckCircle2 size={15} className="ok" /> {received} dosya geldi
                {processing ? ` · ${processing} hazırlanıyor` : ' · hazır'}
                {status?.failed ? ` · ${status.failed} açılamadı` : ''}
              </span>
            ) : qr?.qr ? (
              <span className="muted">Telefondan dosya bekleniyor…</span>
            ) : null}
          </div>
          <div className="modal-actions">
            <button className="btn ghost" onClick={() => void close()}>
              Kapat
            </button>
            <button className="btn primary" disabled={!received} onClick={() => (onClose(true), (location.hash = editorHash(target.editor, target.id)))}>
              Projeyi aç
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
};
