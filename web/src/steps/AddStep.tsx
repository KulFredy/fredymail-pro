import React, { useRef, useState } from 'react';
import { Upload, Plus, Music2, Image as ImageIcon, Video, Loader2, Mic } from 'lucide-react';
import { fileHref, upload } from '../api';
import { MobileQr } from '../MobileModal';
import { useApp, useProject } from '../state';
import { Progress, Section, useContextMenu, type CtxItem } from '../ui';
import { FPS } from '../../../src/core/schema';
import { clipIndexAt, formatTime, voiceFreeAt } from '../../../src/core/timeline';
import { ASSET_MIME, dragAsset, isAssetDrag } from '../Timeline';

export const AddStep: React.FC = () => {
  const { project, apply, reload, frame } = useProject();
  const [ctxMenu, openCtx] = useContextMenu();
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

  const addFromLibrary = (id: string) => {
    const a = library.get(id);
    if (!a) return;
    if (a.kind === 'audio') {
      apply([{ type: 'music.set', music: { assetId: id } }]);
      toast(`Müzik: ${a.name}`);
    } else {
      apply([{ type: 'clips.add', assetIds: [id] }]);
      toast(`Eklendi: ${a.name}`);
    }
  };
  const libMenu = (e: React.MouseEvent, id: string) => {
    const a = library.get(id);
    if (!a) return;
    const t = frame / FPS;
    const list: CtxItem[] =
      a.kind === 'audio'
        ? [
            { label: project.music?.assetId === id ? 'Zaten müzik' : 'Müzik yap', icon: <Music2 size={14} />, disabled: project.music?.assetId === id, onSelect: () => addFromLibrary(id) },
            { label: `Dış ses olarak imlece ekle · ${formatTime(t)}`, icon: <Mic size={14} />, disabled: !project.clips.length, onSelect: () => (apply([{ type: 'voice.add', assetId: id, at: voiceFreeAt(project.voice, t) }]), toast(`Dış ses eklendi: ${a.name}`)) },
          ]
        : [
            { label: 'Sona ekle', icon: <Plus size={14} />, onSelect: () => addFromLibrary(id) },
            { label: `İmlece ekle · ${formatTime(t)}`, icon: <Plus size={14} />, disabled: !project.clips.length, onSelect: () => (apply([{ type: 'clips.add', assetIds: [id], index: clipIndexAt(project, t) }]), toast(`İmlece eklendi: ${a.name}`)) },
            { label: 'Başa ekle', icon: <Plus size={14} />, onSelect: () => (apply([{ type: 'clips.add', assetIds: [id], index: 0 }]), toast(`Başa eklendi: ${a.name}`)) },
          ];
    openCtx(e, list, a.name);
  };
  const inProject = new Set(project.clips.map((c) => c.assetId));
  const assets = [...library.values()].sort((a, b) => b.importedAt.localeCompare(a.importedAt));

  return (
    <div className="stack">
      {ctxMenu}
      <div
        className={`dropzone ${over ? 'over' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          if (isAssetDrag(e)) e.dataTransfer.dropEffect = 'copy';
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          // Kütüphaneden sürüklenen dosya: yeniden yüklemeden projeye ekle
          const id = e.dataTransfer.getData(ASSET_MIME);
          if (id) return addFromLibrary(id);
          void send([...e.dataTransfer.files]);
        }}
        data-testid="add-dropzone"
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

      <Section title="Kütüphane" hint="Önceki projelerdeki dosyalar burada; yeniden yüklemeden ekleyin: düğmeyle ya da kartı yukarıdaki alana veya alttaki zaman çizelgesine sürükleyerek.">
        {assets.length === 0 ? <p className="muted">Kütüphane boş.</p> : null}
        <div className="lib-grid">
          {assets.map((a) => (
            <div
              key={a.id}
              className="lib-item"
              data-asset={a.id}
              draggable={a.status !== 'importing'}
              onDragStart={(e) => dragAsset(e, a.id)}
              onContextMenu={(e) => libMenu(e, a.id)}
              title="Yukarıdaki alana veya alttaki zaman çizelgesine sürükleyin · sağ tık: seçenekler"
            >
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
