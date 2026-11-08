import React, { useEffect, useState } from 'react';
import { Clapperboard, Zap, Play, Trash2, Mic, Cpu, FolderOpen, Smartphone, Plug, Tag, Megaphone } from 'lucide-react';
import { BrandApplyForm, BrandsModal } from './Brands';
import { CHANNELS, isChannel } from '../../src/core/channels';
import { ConnectionsModal } from './Connections';
import { FORMATS } from '../../src/core/formats';
import type { FormatId } from '../../src/core/schema';
import { api, fileHref, type ProjectSummary } from './api';
import { useApp } from './state';
import { Modal } from './ui';

const ago = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'az önce';
  if (d < 3600) return `${Math.floor(d / 60)} dk önce`;
  if (d < 86400) return `${Math.floor(d / 3600)} sa önce`;
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
};

const FORMAT_CHOICES: { key: string; format: FormatId; kind: 'video' | 'image'; label: string; sub: string }[] = [
  { key: 'story', format: 'story', kind: 'video', label: 'Story', sub: '9:16 · MP4' },
  { key: 'reel', format: 'reel', kind: 'video', label: 'Reel', sub: '9:16 · MP4' },
  { key: 'post-img', format: 'post', kind: 'image', label: 'Fotoğraf postu', sub: '4:5 · JPEG' },
  { key: 'post-vid', format: 'post', kind: 'video', label: 'Video postu', sub: '4:5 · MP4' },
  { key: 'square', format: 'square', kind: 'video', label: 'Kare video', sub: '1:1 · MP4' },
  { key: 'landscape', format: 'landscape', kind: 'video', label: 'Yatay video', sub: '16:9 · MP4' },
];

export const NewProjectModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [name, setName] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set(['story', 'post-img']));
  const { toast } = useApp();
  const create = async () => {
    const formats = FORMAT_CHOICES.filter((f) => sel.has(f.key)).map((f) => ({ format: f.format, kind: f.kind }));
    if (!formats.length) return toast('En az bir biçim seçin', 'error');
    const st = await api.createProject(name.trim(), formats);
    location.hash = `#/proje/${st.project.id}`;
  };
  return (
    <Modal title="Instagram Hızlı Edit" onClose={onClose} width={520}>
      <label className="field">
        <span>Proje adı</span>
        <input autoFocus placeholder="ör. Kafe Story" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
      </label>
      <div className="field">
        <span>Ne hazırlıyorsunuz? (birden çok seçebilirsiniz)</span>
        <div className="format-grid">
          {FORMAT_CHOICES.map((f) => (
            <button
              key={f.key}
              className={`format-card ${sel.has(f.key) ? 'on' : ''}`}
              onClick={() => setSel((s) => {
                const n = new Set(s);
                if (n.has(f.key)) n.delete(f.key);
                else n.add(f.key);
                return n;
              })}
            >
              <span className="ratio" style={{ aspectRatio: `${FORMATS[f.format].width}/${FORMATS[f.format].height}` }} />
              <b>{f.label}</b>
              <small>{f.sub}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>Vazgeç</button>
        <button className="btn primary" onClick={create}>Oluştur</button>
      </div>
    </Modal>
  );
};

export const Home: React.FC = () => {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [conns, setConns] = useState(false);
  const [brandsOpen, setBrandsOpen] = useState(false);
  const [campaign, setCampaign] = useState<string | null>(null);
  const [brandFilter, setBrandFilter] = useState<string>('hepsi');
  const { health, library } = useApp();
  const load = () =>
    api.state().then((s) => {
      setProjects(s.projects);
      setLast(s.lastProjectId);
    });
  useEffect(() => {
    void load();
  }, []);
  const lastProject = projects?.find((p) => p.id === last) ?? projects?.[0];
  const brandNames = [...new Set((projects ?? []).map((p) => p.brand?.brandName).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'tr'));
  const visible = (projects ?? []).filter((p) => brandFilter === 'hepsi' || (brandFilter === 'markasiz' ? !p.brand : p.brand?.brandName === brandFilter));
  /** Marka seçiliyken ürün · kampanya başlıklarıyla grupla */
  const groups: [string, ProjectSummary[]][] =
    brandFilter === 'hepsi' || brandFilter === 'markasiz'
      ? [['', visible]]
      : Object.entries(
          visible.reduce<Record<string, ProjectSummary[]>>((acc, p) => {
            const k = [p.brand?.productName || 'Genel', p.brand?.campaign].filter(Boolean).join(' · ');
            (acc[k] ??= []).push(p);
            return acc;
          }, {}),
        );
  return (
    <div className="home">
      <header className="home-head">
        <div className="brand">
          <span className="logo">İF</span>
          <div>
            <h1>İçerik Fabrikası</h1>
            <p className="muted">Telefondan gelen çekimleri dakikalar içinde Instagram'a hazırlayın.</p>
          </div>
        </div>
        <div className="row-wrap">
          <button className="btn ghost" onClick={() => setBrandsOpen(true)} title="Logo, renk, yazı tipi, ton, ürünler">
            <Tag size={15} /> Markalar
          </button>
          <button className="btn ghost" onClick={() => setConns(true)} title="Claude, ElevenLabs, Google Gemini…">
            <Plug size={15} /> Bağlantılar
          </button>
        </div>
      </header>
      {conns ? <ConnectionsModal onClose={() => setConns(false)} /> : null}
      {brandsOpen ? <BrandsModal onClose={() => setBrandsOpen(false)} /> : null}
      {campaign ? (
        <Modal title="Marka kampanyası" onClose={() => setCampaign(null)} width={720}>
          <p className="hint">Yeni Stüdyo projesi açılır; markanın logosu, renkleri, yazı tipleri ve kanalları (YouTube, Shorts, Reels…) hazır gelir.</p>
          <BrandApplyForm
            projectId={campaign}
            onApply={async (ops) => {
              await api.ops(campaign, ops, 'Marka kampanyası');
              location.hash = `#/studyo/${campaign}`;
            }}
            onCancel={async () => {
              await api.deleteProject(campaign);
              setCampaign(null);
            }}
            openBrands={() => setBrandsOpen(true)}
          />
        </Modal>
      ) : null}

      {lastProject ? (
        <a className="continue" href={`#/${(lastProject.outputs.length === 1 && lastProject.outputs[0] === 'landscape:video') || lastProject.outputs.some((o) => isChannel(o)) ? 'studyo' : 'proje'}/${lastProject.id}`}>
          <div className="continue-poster" style={{ backgroundImage: lastProject.poster ? `url(${fileHref(lastProject.poster)})` : undefined }}>
            <Play size={28} />
          </div>
          <div>
            <small className="eyebrow">Kaldığınız yerden devam edin</small>
            <h2>{lastProject.name}</h2>
            <p className="muted">
              {lastProject.clipCount} klip · {lastProject.outputs.length} çıktı · son düzenleme {ago(lastProject.updatedAt)}
            </p>
          </div>
          <span className="btn primary">Devam et</span>
        </a>
      ) : null}

      <div className="tiles">
        <button className="tile tile-quick" onClick={() => setCreating(true)}>
          <Zap size={30} />
          <h3>Instagram Hızlı Edit</h3>
          <p>Story · Reel · Post. Sürükle, kadrajla, renk ver, müzik ve Türkçe altyazı ekle, teslim et.</p>
        </button>
        <button
          className="tile tile-studio"
          onClick={async () => {
            const st = await api.createProject(`Stüdyo · ${new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}`, [{ format: 'landscape', kind: 'video' }]);
            location.hash = `#/studyo/${st.project.id}`;
          }}
        >
          <Clapperboard size={30} />
          <h3>Kurgu Stüdyosu</h3>
          <p>Yatay video, çok izli zaman çizelgesi. Mikrofona veya yazarak Türkçe kurgu: “Buradan sonraki üç saniyeyi kes”.</p>
        </button>
        <button
          className="tile tile-brand"
          onClick={async () => {
            const st = await api.createProject(`Kampanya · ${new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })}`, [{ format: 'landscape', kind: 'video' }]);
            setCampaign(st.project.id);
          }}
        >
          <Megaphone size={30} />
          <h3>Marka kampanyası</h3>
          <p>Marka → ürün → kampanya. Aynı kurgudan YouTube + küçük resim, Shorts, Reels, Story ve 4:5 reklam; metinler, kontrol ve teslim paketi.</p>
        </button>
      </div>

      <h3 className="list-title">Projeler</h3>
      {projects === null ? (
        <p className="muted">Yükleniyor…</p>
      ) : projects.length === 0 ? (
        <div className="empty">Henüz proje yok. “Instagram Hızlı Edit” ile başlayın.</div>
      ) : (
        <>
        {brandNames.length ? (
          <div className="chips brand-filter" data-testid="brand-filter">
            {['hepsi', ...brandNames, 'markasiz'].map((b) => (
              <button key={b} className={`chip ${brandFilter === b ? 'on' : ''}`} onClick={() => setBrandFilter(b)}>
                {b === 'hepsi' ? 'Tümü' : b === 'markasiz' ? 'Markasız' : b}
              </button>
            ))}
          </div>
        ) : null}
        {groups.map(([title, list]) => (
        <div key={title} className="project-group">
        {title ? <h4 className="group-title">{title}</h4> : null}
        <div className="project-grid">
          {list.map((p) => (
            <a key={p.id} className="project-card" href={`#/${(p.outputs.length === 1 && p.outputs[0] === 'landscape:video') || p.outputs.some((o) => isChannel(o)) ? 'studyo' : 'proje'}/${p.id}`}>
              <div className="poster" style={{ backgroundImage: p.poster ? `url(${fileHref(p.poster)})` : undefined }} />
              <div className="meta">
                <b>{p.name}</b>
                {p.brand ? <small className="brand-line">{[p.brand.brandName, p.brand.productName, p.brand.campaign].filter(Boolean).join(' · ')}</small> : null}
                <small className="muted">
                  {p.outputs.map((o) => (isChannel(o) ? CHANNELS[o].label : FORMATS[o.split(':')[0] as FormatId]?.label)).join(' · ')} · {ago(p.updatedAt)}
                </small>
              </div>
              <button
                className="icon-btn danger"
                title="Projeyi sil (kaynak dosyalar kütüphanede kalır)"
                onClick={async (e) => {
                  e.preventDefault();
                  if (confirm(`“${p.name}” silinsin mi? Kaynak dosyalar kütüphanede kalır.`)) {
                    await api.deleteProject(p.id);
                    void load();
                  }
                }}
              >
                <Trash2 size={16} />
              </button>
            </a>
          ))}
        </div>
        </div>
        ))}
        </>
      )}

      <footer className="status">
        <span title={health?.whisper.bin ?? ''}>
          <Mic size={14} /> Türkçe konuşma:{' '}
          {health ? (health.whisper.available ? <b className="ok">hazır ({health.whisper.model ?? 'test'})</b> : <b className="warn">kurulu değil — scripts/setup-mac.sh</b>) : '…'}
        </span>
        <span>
          <Cpu size={14} /> Kodlayıcı: {health?.encoder ?? '…'}
        </span>
        <span>
          <FolderOpen size={14} /> Kütüphane: {library.size} dosya
        </span>
        <span>
          <Smartphone size={14} /> Telefon: {health?.lanUrl ? 'aynı Wi-Fi’de QR ile' : 'Wi-Fi yok'}
        </span>
      </footer>

      {creating ? <NewProjectModal onClose={() => setCreating(false)} /> : null}
    </div>
  );
};
