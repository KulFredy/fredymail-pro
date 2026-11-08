import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen, Power, Workflow, Clapperboard, Cpu, FolderOpen, Keyboard, Megaphone, Mic, MoreHorizontal, Pencil, Pin, PinOff, Play, Plug, Plus, Search, Smartphone, Tag, Trash2, X, Zap,
} from 'lucide-react';
import { CHANNELS, isChannel } from '../../src/core/channels';
import { FORMATS } from '../../src/core/formats';
import type { FormatId } from '../../src/core/schema';
import { api, fileHref, type Editor, type ProjectSummary } from './api';
import { BrandApplyForm, BrandsModal } from './Brands';
import { ConnectionsModal } from './Connections';
import { GuideModal, ShortcutsModal } from './Help';
import { PhoneTransferModal, type PhoneTarget } from './PhoneTransfer';
import { PipelineModal } from './Pipeline';
import { useApp } from './state';
import { Modal, modalOpen } from './ui';

const ago = (iso: string) => {
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 60) return 'az önce';
  if (d < 3600) return `${Math.floor(d / 60)} dk önce`;
  if (d < 86400) return `${Math.floor(d / 3600)} sa önce`;
  if (d < 86400 * 7) return `${Math.floor(d / 86400)} gün önce`;
  return new Date(iso).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' });
};
const today = () => new Date().toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' });
export const editorHash = (editor: Editor, id: string) => `#/${editor === 'studio' ? 'studyo' : 'proje'}/${id}`;
const EDITOR_LABEL: Record<Editor, string> = { quick: 'Instagram Hızlı Edit', studio: 'Stüdyo' };

/** Çıktı profili adı: kanal (“YouTube video”) veya biçim (“Story”, “Post · foto”) */
const outputName = (o: string) => {
  if (isChannel(o)) return CHANNELS[o].label;
  const [f, kind] = o.split(':') as [FormatId, string];
  const label = FORMATS[f]?.label ?? f;
  return kind === 'image' ? `${label} · foto` : label;
};
const outputsText = (p: ProjectSummary) => (p.outputs.length ? [...new Set(p.outputs.map(outputName))].join(' · ') : 'Çıktı yok');

const FORMAT_CHOICES: { key: string; format: FormatId; kind: 'video' | 'image'; label: string; sub: string }[] = [
  { key: 'story', format: 'story', kind: 'video', label: 'Story', sub: '9:16 · MP4' },
  { key: 'reel', format: 'reel', kind: 'video', label: 'Reel', sub: '9:16 · MP4' },
  { key: 'post-img', format: 'post', kind: 'image', label: 'Fotoğraf postu', sub: '4:5 · JPEG' },
  { key: 'post-vid', format: 'post', kind: 'video', label: 'Video postu', sub: '4:5 · MP4' },
  { key: 'square', format: 'square', kind: 'video', label: 'Kare video', sub: '1:1 · MP4' },
  { key: 'landscape', format: 'landscape', kind: 'video', label: 'Yatay video', sub: '16:9 · MP4' },
];

/** Hızlı Edit: ad + biçimler → yeni proje */
export const NewProjectModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [name, setName] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set(['story', 'post-img']));
  const { toast } = useApp();
  const create = async () => {
    const formats = FORMAT_CHOICES.filter((f) => sel.has(f.key)).map((f) => ({ format: f.format, kind: f.kind }));
    if (!formats.length) return toast('En az bir biçim seçin', 'error');
    const st = await api.createProject(name.trim(), formats, 'quick');
    location.hash = editorHash('quick', st.project.id);
  };
  return (
    <Modal title="Instagram Hızlı Edit · yeni proje" onClose={onClose} width={560} testid="new-quick">
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
              aria-pressed={sel.has(f.key)}
              onClick={() =>
                setSel((s) => {
                  const n = new Set(s);
                  if (n.has(f.key)) n.delete(f.key);
                  else n.add(f.key);
                  return n;
                })
              }
            >
              <span className="ratio" style={{ aspectRatio: `${FORMATS[f.format].width}/${FORMATS[f.format].height}` }} />
              <b>{f.label}</b>
              <small>{f.sub}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Vazgeç
        </button>
        <button className="btn primary" onClick={create}>
          Oluştur
        </button>
      </div>
    </Modal>
  );
};

/** Yeni proje: Hızlı Edit veya Kurgu Stüdyosu (marka kampanyası ikincil seçenek) */
const NewProjectChooser: React.FC<{ onClose: () => void; onQuick: () => void; onCampaign: () => void }> = ({ onClose, onQuick, onCampaign }) => {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Yeni proje" onClose={onClose} width={680} testid="new-project">
      <div className="choice-grid">
        <button className="choice choice-quick" onClick={onQuick}>
          <Zap size={26} />
          <b>Instagram Hızlı Edit</b>
          <span>Story · Reel · Post. Adım adım: ekle, kadrajla, renk ver, müzik ve Türkçe altyazı, teslim.</span>
        </button>
        <button
          className="choice choice-studio"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const st = await api.createProject(`Stüdyo · ${today()}`, [{ format: 'landscape', kind: 'video' }], 'studio');
            location.hash = editorHash('studio', st.project.id);
          }}
        >
          <Clapperboard size={26} />
          <b>Kurgu Stüdyosu</b>
          <span>YouTube ve yatay video; çok izli zaman çizelgesi, transkript, sesli veya yazılı Türkçe komutla kurgu.</span>
        </button>
      </div>
      <button className="link small campaign-link" onClick={onCampaign}>
        <Megaphone size={13} /> Marka kampanyası olarak başlat (markanın logosu, renkleri ve kanallarıyla)
      </button>
    </Modal>
  );
};

/** Kart menüsü: yeniden adlandır, sabitle, sil */
const CardMenu: React.FC<{ p: ProjectSummary; onRename: () => void; onPin: () => void; onDelete: () => void }> = ({ p, onRename, onPin, onDelete }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
        btn.current?.focus();
      }
    };
    document.addEventListener('mousedown', off);
    window.addEventListener('keydown', key, true);
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    return () => {
      document.removeEventListener('mousedown', off);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  const item = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  return (
    <div className="card-menu" ref={ref}>
      <button ref={btn} className="icon-btn" aria-haspopup="menu" aria-expanded={open} aria-label={`Proje menüsü: ${p.name}`} onClick={(e) => (e.preventDefault(), setOpen((o) => !o))}>
        <MoreHorizontal size={17} />
      </button>
      {open ? (
        <div className="card-menu-list" role="menu">
          <button role="menuitem" onClick={item(onRename)}>
            <Pencil size={14} /> Yeniden adlandır
          </button>
          <button role="menuitem" onClick={item(onPin)}>
            {p.pinned ? <PinOff size={14} /> : <Pin size={14} />} {p.pinned ? 'Sabitlemeyi kaldır' : 'Sabitle'}
          </button>
          <button role="menuitem" className="danger" onClick={item(onDelete)}>
            <Trash2 size={14} /> Sil
          </button>
        </div>
      ) : null}
    </div>
  );
};

const RenameModal: React.FC<{ p: ProjectSummary; onClose: () => void; onDone: () => void }> = ({ p, onClose, onDone }) => {
  const [name, setName] = useState(p.name);
  const save = async () => {
    if (!name.trim() || name.trim() === p.name) return onClose();
    await api.ops(p.id, [{ type: 'project.rename', name: name.trim() }], 'Proje adı değişti');
    onDone();
  };
  return (
    <Modal title="Yeniden adlandır" onClose={onClose} width={440} testid="rename">
      <label className="field">
        <span>Proje adı</span>
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} aria-label="Yeni proje adı" />
      </label>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Vazgeç
        </button>
        <button className="btn primary" disabled={!name.trim()} onClick={() => void save()}>
          Kaydet
        </button>
      </div>
    </Modal>
  );
};

type Dialog =
  | { kind: 'yeni' }
  | { kind: 'hizli' }
  | { kind: 'kampanya' }
  | { kind: 'telefon'; initial?: PhoneTarget }
  | { kind: 'kilavuz' }
  | { kind: 'hat' }
  | { kind: 'kisayol' }
  | { kind: 'markalar' }
  | { kind: 'baglantilar' }
  | { kind: 'ad'; p: ProjectSummary };

export const Home: React.FC = () => {
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [last, setLast] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<string>('hepsi');
  const { health, library, toast } = useApp();
  const load = () =>
    api.state().then((s) => {
      setProjects(s.projects);
      setLast(s.lastProjectId);
    });
  useEffect(() => {
    void load();
  }, []);
  // “?” → Stüdyo kısayolları (yazı alanı ve açık pencere yokken)
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (e.key === '?' && !modalOpen() && tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT') {
        e.preventDefault();
        setDialog({ kind: 'kisayol' });
      }
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, []);

  const lastProject = projects?.find((p) => p.id === last) ?? projects?.[0] ?? null;
  const brandNames = useMemo(() => [...new Set((projects ?? []).map((p) => p.brand?.brandName).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'tr')), [projects]);
  const q = query.trim().toLocaleLowerCase('tr-TR');
  const visible = (projects ?? [])
    .filter((p) => (filter === 'hepsi' ? true : filter === 'sabit' ? p.pinned : p.brand?.brandName === filter))
    .filter((p) => !q || p.name.toLocaleLowerCase('tr-TR').includes(q))
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  const pinnedCount = (projects ?? []).filter((p) => p.pinned).length;

  const togglePin = async (p: ProjectSummary) => {
    await api.pinProject(p.id, !p.pinned);
    toast(p.pinned ? 'Sabitleme kaldırıldı' : 'Sabitlendi');
    void load();
  };
  const remove = async (p: ProjectSummary) => {
    if (!confirm(`“${p.name}” silinsin mi? Kaynak dosyalar kütüphanede kalır.`)) return;
    await api.deleteProject(p.id);
    void load();
  };
  const close = () => setDialog(null);
  const createStudio = async () => {
    const st = await api.createProject(`Stüdyo · ${today()}`, [{ format: 'landscape', kind: 'video' }], 'studio');
    location.hash = editorHash('studio', st.project.id);
  };

  return (
    <div className="home">
      <header className="home-head">
        <div className="brand">
          <span className="logo">İF</span>
          <div>
            <h1>İçerik Fabrikası</h1>
            <p className="muted">Telefondan gelen çekimleri dakikalar içinde kanallara hazırlayın.</p>
          </div>
        </div>
        <nav className="home-links" aria-label="Yardım ve ayarlar">
          <button className="btn ghost sm" onClick={() => setDialog({ kind: 'hat' })} title="Üretim → Claude → Kurgu → Teslim">
            <Workflow size={15} /> Üretim hattı
          </button>
          <button className="btn ghost sm" onClick={() => setDialog({ kind: 'kilavuz' })}>
            <BookOpen size={15} /> Kullanım kılavuzu
          </button>
          <button className="btn ghost sm" onClick={() => setDialog({ kind: 'kisayol' })} aria-keyshortcuts="?">
            <Keyboard size={15} /> Stüdyo kısayolları
          </button>
          <button className="btn ghost sm" onClick={() => setDialog({ kind: 'markalar' })} title="Logo, renk, yazı tipi, ton, ürünler">
            <Tag size={15} /> Markalar
          </button>
          <button className="btn ghost sm" onClick={() => setDialog({ kind: 'baglantilar' })} title="Claude, ElevenLabs, Google Gemini, YouTube">
            <Plug size={15} /> Bağlantılar
          </button>
          <button
            className="icon-btn"
            title="Uygulamayı kapat (arka plandaki sunucu durur; tekrar açmak için Uygulamalar'daki İçerik Fabrikası)"
            aria-label="Uygulamayı kapat"
            onClick={async () => {
              if (!confirm('İçerik Fabrikası kapatılsın mı? Süren render veya içe aktarma varsa yarıda kalır.')) return;
              await api.shutdown().catch(() => undefined);
              document.body.innerHTML = '<div class="loading">İçerik Fabrikası kapatıldı. Bu pencereyi kapatabilirsiniz.</div>';
              setTimeout(() => window.close(), 400);
            }}
          >
            <Power size={16} />
          </button>
        </nav>
      </header>

      <section className="actions" aria-label="Ana eylemler">
        <div className={`home-action action-last ${lastProject ? '' : 'empty-last'}`} data-testid="last-project">
          {lastProject ? (
            <>
              <a className="last-cover" href={editorHash(lastProject.editor, lastProject.id)} style={{ backgroundImage: lastProject.poster ? `url(${fileHref(lastProject.poster)})` : undefined }} aria-label={`${lastProject.name} projesine dön`}>
                {lastProject.poster ? null : <Clapperboard size={26} />}
                <span className="play">
                  <Play size={20} />
                </span>
              </a>
              <div className="last-meta">
                <small className="eyebrow">Son projeye dön</small>
                <h2 title={lastProject.name}>{lastProject.name}</h2>
                <p className="muted small">
                  <span className="badge">{EDITOR_LABEL[lastProject.editor]}</span> {outputsText(lastProject)}
                </p>
                <p className="muted small">
                  {lastProject.clipCount} klip · son düzenleme {ago(lastProject.updatedAt)}
                </p>
                <div className="row-wrap">
                  <a className="btn primary" href={editorHash(lastProject.editor, lastProject.id)}>
                    <Play size={15} /> Devam et
                  </a>
                  <button className="btn ghost sm" onClick={() => setDialog({ kind: 'telefon', initial: { kind: 'son', projectId: lastProject.id } })}>
                    <Smartphone size={14} /> Bu projeye telefondan ekle
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="last-meta">
              <small className="eyebrow">Son projeye dön</small>
              <h2>Henüz proje yok</h2>
              <p className="muted small">İlk projeyi “Instagram Hızlı Edit” veya “Kurgu Stüdyosu” ile başlatın ya da telefondan dosya gönderin.</p>
            </div>
          )}
        </div>
        <div className="home-action action-new" data-testid="new-actions">
          <span className="action-title">
            <Plus size={20} /> Yeni proje
          </span>
          <button className="new-opt new-ig" onClick={() => setDialog({ kind: 'hizli' })}>
            <Zap size={18} />
            <span>
              <b>Instagram Hızlı Edit</b>
              <small>Story · Reel · Post</small>
            </span>
          </button>
          <button className="new-opt new-studio" onClick={() => void createStudio()}>
            <Clapperboard size={18} />
            <span>
              <b>Kurgu Stüdyosu</b>
              <small>YouTube · yatay video</small>
            </span>
          </button>
          <button className="link small" onClick={() => setDialog({ kind: 'kampanya' })}>
            <Megaphone size={12} /> Marka kampanyası
          </button>
        </div>
        <button className="home-action action-phone" onClick={() => setDialog({ kind: 'telefon' })}>
          <Smartphone size={28} />
          <b>Telefondan ekle</b>
          <span>QR ile aynı Wi-Fi'den fotoğraf, video, müzik</span>
        </button>
      </section>

      <section className="projects" aria-label="Projeler">
        <div className="projects-head">
          <h3>Projeler</h3>
          <label className="search">
            <Search size={15} />
            <input type="search" placeholder="Projelerde ara" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Projelerde ara" />
            {query ? (
              <button className="icon-btn" aria-label="Aramayı temizle" onClick={() => setQuery('')}>
                <X size={14} />
              </button>
            ) : null}
          </label>
        </div>
        <div className="chips" role="group" aria-label="Süzgeç" data-testid="project-filter">
          <button className={`chip ${filter === 'hepsi' ? 'on' : ''}`} aria-pressed={filter === 'hepsi'} onClick={() => setFilter('hepsi')}>
            Tümü {projects ? `(${projects.length})` : ''}
          </button>
          <button className={`chip ${filter === 'sabit' ? 'on' : ''}`} aria-pressed={filter === 'sabit'} onClick={() => setFilter('sabit')}>
            <Pin size={12} /> Sabitlenenler ({pinnedCount})
          </button>
          {brandNames.map((b) => (
            <button key={b} className={`chip ${filter === b ? 'on' : ''}`} aria-pressed={filter === b} onClick={() => setFilter(b)}>
              <Tag size={12} /> {b}
            </button>
          ))}
        </div>

        {projects === null ? (
          <p className="muted">Yükleniyor…</p>
        ) : projects.length === 0 ? (
          <div className="empty" data-testid="empty-projects">
            <b>Henüz proje yok.</b>
            <p>Yeni bir proje başlatın ya da telefondaki çekimleri gönderin; proje kendiliğinden burada görünür.</p>
            <div className="row-wrap center">
              <button className="btn primary" onClick={() => setDialog({ kind: 'yeni' })}>
                <Plus size={15} /> Yeni proje
              </button>
              <button className="btn ghost" onClick={() => setDialog({ kind: 'telefon' })}>
                <Smartphone size={15} /> Telefondan ekle
              </button>
            </div>
          </div>
        ) : visible.length === 0 ? (
          <div className="empty" data-testid="no-results">
            {q ? (
              <>
                <b>“{query.trim()}” adında proje bulunamadı.</b>
                <p>Adın bir bölümünü yazmayı deneyin{filter !== 'hepsi' ? ' ya da süzgeci “Tümü”ne alın' : ''}.</p>
                <div className="row-wrap center">
                  <button className="btn ghost" onClick={() => (setQuery(''), setFilter('hepsi'))}>
                    Aramayı temizle
                  </button>
                </div>
              </>
            ) : filter === 'sabit' ? (
              <>
                <b>Sabitlenen proje yok.</b>
                <p>Sık kullandığınız projeyi kartındaki ⋯ menüsünden “Sabitle” ile en üste alın.</p>
              </>
            ) : (
              <b>Bu süzgeçte proje yok.</b>
            )}
          </div>
        ) : (
          <div className="project-grid" data-testid="project-grid">
            {visible.map((p) => (
              <article key={p.id} className={`project-card ${p.pinned ? 'pinned' : ''}`} data-project={p.id}>
                <a className="card-link" href={editorHash(p.editor, p.id)} aria-label={`${p.name} projesini aç`}>
                  <div className="poster" style={{ backgroundImage: p.poster ? `url(${fileHref(p.poster)})` : undefined }}>
                    {p.poster ? null : <Clapperboard size={22} />}
                  </div>
                  <div className="meta">
                    <b className="card-name" title={p.name}>
                      {p.pinned ? <Pin size={12} className="pin-ico" aria-label="Sabitlendi" /> : null}
                      {p.name}
                    </b>
                    {p.brand ? <small className="brand-line">{[p.brand.brandName, p.brand.productName, p.brand.campaign].filter(Boolean).join(' · ')}</small> : null}
                    <small className="muted">
                      <span className={`type-tag type-${p.editor}`}>{p.editor === 'quick' ? 'Instagram' : 'Stüdyo'}</span> {outputsText(p)}
                    </small>
                    <small className="muted">{ago(p.updatedAt)}</small>
                  </div>
                </a>
                <CardMenu p={p} onRename={() => setDialog({ kind: 'ad', p })} onPin={() => void togglePin(p)} onDelete={() => void remove(p)} />
              </article>
            ))}
          </div>
        )}
      </section>

      <footer className="status">
        <span title={health?.whisper.bin ?? ''}>
          <Mic size={14} /> Türkçe konuşma:{' '}
          {health ? health.whisper.available ? <b className="ok">hazır ({health.whisper.model ?? 'test'})</b> : <b className="warn">kurulu değil — scripts/setup-mac.sh</b> : '…'}
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

      {dialog?.kind === 'yeni' ? <NewProjectChooser onClose={close} onQuick={() => setDialog({ kind: 'hizli' })} onCampaign={() => setDialog({ kind: 'kampanya' })} /> : null}
      {dialog?.kind === 'hizli' ? <NewProjectModal onClose={close} /> : null}
      {dialog?.kind === 'kampanya' ? (
        <Modal title="Marka kampanyası" onClose={close} width={720} testid="campaign">
          <p className="hint">Yeni Stüdyo projesi açılır; markanın logosu, renkleri, yazı tipleri ve kanalları (YouTube, Shorts, Reels…) hazır gelir. Proje “Uygula”ya basınca oluşturulur.</p>
          <BrandApplyForm
            projectId={null}
            onApply={async (_ops, label, choice) => {
              const st = await api.createProject(`${choice.campaign || 'Kampanya'} · ${today()}`, [{ format: 'landscape', kind: 'video' }], 'studio');
              const plan = await api.brandPlan(st.project.id, choice);
              if (plan.ops.length) await api.ops(st.project.id, plan.ops, label);
              location.hash = editorHash('studio', st.project.id);
            }}
            onCancel={close}
            // “Marka oluştur / Markaları düzenle”: bu pencere kapanır, Markalar açılır
            openBrands={() => setDialog({ kind: 'markalar' })}
          />
        </Modal>
      ) : null}
      {dialog?.kind === 'telefon' && projects ? (
        <PhoneTransferModal
          projects={projects}
          lastProjectId={lastProject?.id ?? null}
          initial={dialog.initial}
          onClose={(changed) => {
            close();
            if (changed) void load();
          }}
        />
      ) : null}
      {dialog?.kind === 'kilavuz' ? <GuideModal onClose={close} /> : null}
      {dialog?.kind === 'hat' ? <PipelineModal onClose={close} projects={projects ?? []} projectId={lastProject?.id ?? null} openConnections={() => setDialog({ kind: 'baglantilar' })} /> : null}
      {dialog?.kind === 'kisayol' ? <ShortcutsModal onClose={close} /> : null}
      {dialog?.kind === 'markalar' ? <BrandsModal onClose={close} onChanged={() => void load()} /> : null}
      {dialog?.kind === 'baglantilar' ? <ConnectionsModal onClose={close} /> : null}
      {dialog?.kind === 'ad' ? <RenameModal p={dialog.p} onClose={close} onDone={() => (close(), void load(), toast('Ad değişti'))} /> : null}
    </div>
  );
};
