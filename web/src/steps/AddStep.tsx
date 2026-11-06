import React, { useRef, useState } from 'react';
import { Upload, Plus, Music2, Image as ImageIcon, Video, Loader2 } from 'lucide-react';
import { fileHref, upload } from '../api';
import { MobileQr } from '../MobileModal';
import { useApp, useProject } from '../state';
import { Progress, Section } from '../ui';

export const AddStep: React.FC = () => {
  const { project, apply, reload } = useProject();
  const { library, toast } = useApp();
  const [prog, setProg] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const send = async (files: File[]) => {
    if (!files.length) return;
    setProg(0);
    try {
      await upload(`/api/import?projectId=${project.id}`, files, setProg);
      await reload();
      toast(`${files.length} dosya eklendi; önizleme kopyaları hazırlanıyor`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setProg(null);
    }
  };

  const inProject = new Set(project.clips.map((c) => c.assetId));
  const assets = [...library.values()].sort((a, b) => b.importedAt.localeCompare(a.importedAt));

  return (
    <div className="stack">
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void send([...e.dataTransfer.files]);
        }}
        onClick={() => input.current?.click()}
      >
        <Upload size={28} />
        <b>Fotoğraf, video ve müziği buraya bırakın</b>
        <span className="muted">veya tıklayıp seçin · seçim sırası klip sırası olur · orijinaller değiştirilmez</span>
        {prog !== null ? <Progress value={prog} /> : null}
        <input ref={input} type="file" multiple hidden accept="image/*,video/*,audio/*,.heic,.HEIC" onChange={(e) => void send([...(e.target.files ?? [])])} />
      </div>

      <Section title="Telefondan ekle" hint="Telefonun kamerasıyla okutun; galeriden üç dosyayı bir kerede seçebilirsiniz. Telefon ve Mac aynı Wi-Fi'de olmalı.">
        <MobileQr page="upload" projectId={project.id} size={168} />
      </Section>

      <Section title="Kütüphane" hint="Önceki projelerdeki dosyalar burada; yeniden yüklemeden ekleyebilirsiniz.">
        {assets.length === 0 ? <p className="muted">Kütüphane boş.</p> : null}
        <div className="lib-grid">
          {assets.map((a) => (
            <div key={a.id} className="lib-item">
              <div className="lib-thumb" style={{ backgroundImage: a.poster ? `url(${fileHref(a.poster)})` : undefined }}>
                {a.kind === 'audio' ? <Music2 size={22} /> : null}
                {a.status === 'importing' ? <Loader2 size={18} className="spin" /> : null}
                <span className="lib-kind">{a.kind === 'image' ? <ImageIcon size={12} /> : a.kind === 'video' ? <Video size={12} /> : <Music2 size={12} />}</span>
              </div>
              <div className="lib-meta">
                <span className="ellipsis" title={a.name}>
                  {a.name}
                </span>
                <small className="muted">
                  {a.kind === 'image' ? `${a.width}×${a.height}` : `${a.duration.toFixed(1)} sn${a.kind === 'video' ? ` · ${a.width}×${a.height}${a.hdr ? ' · HDR' : ''}` : ''}`}
                </small>
              </div>
              {a.kind === 'audio' ? (
                <button
                  className="btn tiny"
                  disabled={project.music?.assetId === a.id}
                  onClick={() => apply([{ type: 'music.set', music: { assetId: a.id } }])}
                >
                  {project.music?.assetId === a.id ? 'Müzik' : 'Müzik yap'}
                </button>
              ) : (
                <button className="btn tiny" onClick={() => apply([{ type: 'clips.add', assetIds: [a.id] }])} title="Projeye klip olarak ekle">
                  <Plus size={14} /> {inProject.has(a.id) ? 'Tekrar' : 'Ekle'}
                </button>
              )}
            </div>
          ))}
        </div>
      </Section>
    </div>
  );
};
