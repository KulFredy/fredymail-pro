import React, { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Circle, Clapperboard, Download, ExternalLink, FileCode2, Package, Sparkles, Wand2 } from 'lucide-react';
import { api, fileHref, type Conn, type ProjectSummary } from './api';
import { useApp } from './state';
import { Modal } from './ui';

/**
 * Üretim hattı: 01 Üretim (görsel, video, ses) → 02 Motor (Claude) → 03 Kurgu → 04 Teslim.
 * Görsel örnekteki “Higgsfield → Claude → CapCut” yapısının uygulama içi karşılığı:
 * motor ve kurgu yerleşik; dış kurgu programına (Premiere/Resolve) XML ile aktarılır.
 */
type Item = { name: string; detail: string; state: 'bagli' | 'manuel' | 'yok' | 'yerlesik' };
const STATE_LABEL: Record<Item['state'], string> = { bagli: 'bağlı', manuel: 'siteden indir', yok: 'bağlı değil', yerlesik: 'yerleşik' };

const Row: React.FC<{ it: Item }> = ({ it }) => (
  <li className={`pl-row st-${it.state}`}>
    {it.state === 'bagli' || it.state === 'yerlesik' ? <CheckCircle2 size={14} className="ok" /> : <Circle size={14} className="pl-dim" />}
    <span className="pl-name">{it.name}</span>
    <small className="pl-state">{STATE_LABEL[it.state]}</small>
    <small className="pl-detail">{it.detail}</small>
  </li>
);

export const PipelineModal: React.FC<{
  onClose: () => void;
  projectId?: string | null;
  projects?: ProjectSummary[];
  openConnections: () => void;
  openDeliver?: () => void;
}> = ({ onClose, projectId, projects, openConnections, openDeliver }) => {
  const { toast } = useApp();
  const [conns, setConns] = useState<Conn[] | null>(null);
  const [pid, setPid] = useState<string | null>(projectId ?? projects?.[0]?.id ?? null);
  const [xml, setXml] = useState<{ file: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.connections().then(setConns, () => setConns([]));
  }, []);
  const on = (id: Conn['id']) => !!conns?.find((c) => c.id === id)?.configured;

  const gen: Item[] = [
    { name: 'ElevenLabs', detail: 'Voice Over: metinden Türkçe dış ses', state: on('elevenlabs') ? 'bagli' : 'yok' },
    { name: 'Google Gemini', detail: 'Product Shot: ürün fotoğrafına arka plan', state: on('gemini') ? 'bagli' : 'yok' },
    { name: 'Higgsfield', detail: 'Görselden video: sitede üret, Media’ya at', state: 'manuel' },
    { name: 'Adobe Firefly · Envato', detail: 'Görsel, video, müzik: indir, Media’ya at', state: 'manuel' },
  ];
  const engine: Item[] = [
    { name: 'Claude (uygulama içi)', detail: 'Command paneli; serbest Türkçe kurgu, yayın metni', state: on('anthropic') ? 'bagli' : 'yok' },
    { name: 'Claude Code / Desktop', detail: 'MCP “icerik-fabrikasi”: proje, kurgu, teslim araçları', state: 'yerlesik' },
  ];
  const editor: Item[] = [
    { name: 'İçerik Fabrikası Stüdyo', detail: 'Zaman çizelgesi, renk, altyazı, logo', state: 'yerlesik' },
    { name: 'Premiere Pro · DaVinci Resolve', detail: 'Kurgu iskeleti XML ile (aşağıda)', state: 'yerlesik' },
    { name: 'CapCut', detail: 'Proje içe aktarma yok: Deliver’dan video + .srt', state: 'manuel' },
  ];
  const deliver: Item[] = [
    { name: 'Deliver', detail: 'YouTube, Shorts, Reels, Story, 4:5 reklam paketi', state: 'yerlesik' },
    { name: 'YouTube', detail: 'Onaylı paketten doğrudan yükleme', state: on('youtube') ? 'bagli' : 'yok' },
  ];

  const exportXml = async () => {
    if (!pid) return;
    setBusy(true);
    try {
      const r = await api.exportXml(pid);
      setXml(r);
      toast(r.clips ? 'XML hazır: Premiere → Dosya → İçe aktar · Resolve → Dosya → İçe aktar → Zaman çizelgesi' : 'Projede klip yok; XML boş bir dizi içerir');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const Step: React.FC<{ n: string; title: string; icon: React.ReactNode; items: Item[]; children?: React.ReactNode }> = ({ n, title, icon, items, children }) => (
    <section className="pl-step">
      <header>
        <small className="pl-n">{n}</small>
        <span className="pl-ico">{icon}</span>
        <b>{title}</b>
        {items.some((i) => i.state === 'bagli' || i.state === 'yerlesik') ? <CheckCircle2 size={16} className="ok pl-ok" /> : null}
      </header>
      <ul>
        {items.map((it) => (
          <Row key={it.name} it={it} />
        ))}
      </ul>
      {children}
    </section>
  );

  return (
    <Modal title="Üretim hattı" onClose={onClose} width={1120} testid="pipeline">
      <p className="hint">
        Üretim servisleri malzemeyi üretir, Claude kurguyu planlar, Stüdyo birleştirir, Deliver kanallara hazırlar. Ücretli işler her zaman önce maliyetini gösterir ve onayınızı bekler.
      </p>
      <div className="pl-flow">
        <Step n="01" title="Media Generator" icon={<Sparkles size={18} />} items={gen}>
          <button className="btn tiny ghost" onClick={openConnections}>
            Bağlantılar
          </button>
        </Step>
        <ArrowRight className="pl-arrow" size={18} />
        <Step n="02" title="Engine" icon={<Wand2 size={18} />} items={engine}>
          <small className="muted">Claude Code’da: “Kafe projesinde rengi film yap ve Reels paketini hazırla”.</small>
        </Step>
        <ArrowRight className="pl-arrow" size={18} />
        <Step n="03" title="Editor" icon={<Clapperboard size={18} />} items={editor}>
          {projects && projects.length ? (
            <select value={pid ?? ''} onChange={(e) => (setPid(e.target.value), setXml(null))} aria-label="XML için proje">
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <button className="btn tiny" disabled={!pid || busy} onClick={() => void exportXml()} data-testid="xml-export">
            <FileCode2 size={13} /> Premiere / Resolve XML
          </button>
          {xml ? (
            <a className="link small" href={fileHref(xml.file)} download={xml.name}>
              <Download size={12} /> {xml.name}
            </a>
          ) : null}
        </Step>
        <ArrowRight className="pl-arrow" size={18} />
        <Step n="04" title="Deliver" icon={<Package size={18} />} items={deliver}>
          {openDeliver ? (
            <button className="btn tiny primary" onClick={openDeliver}>
              <Package size={13} /> Deliver’ı aç
            </button>
          ) : (
            <small className="muted">Stüdyo’da üst çubuktaki Deliver.</small>
          )}
        </Step>
      </div>
      <p className="hint small pl-note">
        <ExternalLink size={11} /> Higgsfield, Firefly ve Envato’nun bu kullanım için açık bir uygulama arayüzü yok (ya da kurumsal sözleşme istiyor): ürettiğiniz/indirdiğiniz dosyayı Media’ya sürükleyin veya
        Telefondan ekle ile gönderin. CapCut’a proje aktarmanın resmi bir yolu yok; Premiere ve Resolve XML’i açar.
      </p>
    </Modal>
  );
};
