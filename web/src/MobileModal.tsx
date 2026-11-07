import React, { useEffect, useState } from 'react';
import { api } from './api';
import { useProject } from './state';
import { Modal } from './ui';

export const MobileQr: React.FC<{ page: 'upload' | 'indir'; projectId: string | null; size?: number }> = ({ page, projectId, size = 220 }) => {
  const [data, setData] = useState<{ url: string | null; qr: string | null; reason?: string } | null>(null);
  useEffect(() => {
    api.mobile(projectId, page).then(setData).catch(() => setData({ url: null, qr: null, reason: 'Sunucuya ulaşılamadı' }));
  }, [page, projectId]);
  if (!data) return <p className="muted">QR hazırlanıyor…</p>;
  if (!data.qr) return <p className="warn">{data.reason ?? 'QR oluşturulamadı'}</p>;
  return (
    <div className="qr-wrap">
      <div className="qr" style={{ width: size, height: size }} dangerouslySetInnerHTML={{ __html: data.qr }} />
      <code className="qr-url">{data.url}</code>
    </div>
  );
};

export const MobileModal: React.FC<{ page: 'upload' | 'indir'; onClose: () => void }> = ({ page, onClose }) => {
  const { project } = useProject();
  return (
    <Modal title={page === 'upload' ? 'Telefondan ekle' : 'Telefona indir'} onClose={onClose}>
      <ol className="steps-list">
        <li>Telefon ile Mac aynı Wi-Fi ağında olsun.</li>
        <li>Telefonun kamerasıyla QR kodu okutun.</li>
        <li>
          {page === 'upload'
            ? '“Galeriden seç” ile fotoğraf, video ve müziği bir kerede seçin. Dosyalar seçim sırasıyla bu projeye eklenir.'
            : 'Son dışa aktarılan dosyaları indirin ve açıklamayı kopyalayın.'}
        </li>
      </ol>
      <MobileQr page={page} projectId={project.id} />
    </Modal>
  );
};
