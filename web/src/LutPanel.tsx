import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Columns2, FolderOpen, Loader2, Pencil, Search, Star, Trash2, Upload, X } from 'lucide-react';
import { sampleLut, type Lut3D } from '../../src/core/lut';
import { INPUT_LABELS, applyLutToPixels, inputLabel, lutWarnings, type LutMeta } from '../../src/core/lutlib';
import type { OpInput } from '../../src/core/ops';
import { effectiveCamera } from '../../src/core/looks';
import { lutUrls, type LutInfo } from '../../src/core/refs';
import { FPS, type Clip, type Project } from '../../src/core/schema';
import { layoutClips } from '../../src/core/timeline';
import { loadLut } from '../../src/remotion/GradedMedia';
import { api, upload } from './api';
import { useApp, useProject } from './state';
import type { Selection } from './Timeline';
import { Modal, Segmented, Slider, fmtPct } from './ui';

const lower = (s: string) => s.toLocaleLowerCase('tr');
const LUT_EXT = /\.(cube|3dl|zip|look|xmp)$/i;

/** Kaynağın bir karesini piksel olarak getirir (sunucuda küçültülmüş JPEG) */
const frameCache = new Map<string, Promise<ImageData>>();
export const loadFrame = (assetId: string, t: number, w: number) => {
  const key = `${assetId}@${t.toFixed(2)}@${w}`;
  let p = frameCache.get(key);
  if (!p) {
    p = (async () => {
      const img = new Image();
      img.src = `/api/assets/${encodeURIComponent(assetId)}/frame?t=${t.toFixed(2)}&w=${w}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height);
    })();
    frameCache.set(key, p);
    p.catch(() => frameCache.delete(key));
  }
  return p;
};

/** Kareye (isteğe bağlı kamera dönüşümünden sonra) LUT uygulayıp tuvale çizer — yaklaşık önizleme */
export const LutCanvas: React.FC<{ base: ImageData | null; lutUrl: string | null; camUrl: string | null; amount?: number; className?: string }> = ({ base, lutUrl, camUrl, amount = 1, className }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!base) return;
    let alive = true;
    void (async () => {
      const [cam, lut] = await Promise.all([camUrl ? loadLut(camUrl).catch(() => null) : null, lutUrl ? loadLut(lutUrl).catch(() => null) : null]);
      if (!alive || !ref.current) return;
      let px: Uint8ClampedArray = base.data;
      if (cam) px = applyLutToPixels(px, cam, 1, sampleLut);
      if (lut) px = applyLutToPixels(px, lut as Lut3D, amount, sampleLut);
      const c = ref.current;
      c.width = base.width;
      c.height = base.height;
      c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(px), base.width, base.height), 0, 0);
    })();
    return () => {
      alive = false;
    };
  }, [base, lutUrl, camUrl, amount]);
  return <canvas ref={ref} className={className} />;
};

/** LUT'u bir klibe ya da (clip = null) tüm kurguya uygulayan işlemler; kendi rengi olan kliplere de yazılır */
export const lutOps = (project: Project, clip: Clip | null, id: string | null, amt: number): OpInput[] =>
  clip
    ? [{ type: 'clip.setLook', clipId: clip.id, look: { lut: id, lutIntensity: amt } }]
    : [{ type: 'look.set', look: { lut: id, lutIntensity: amt } }, ...project.clips.filter((c) => c.look).map((c) => ({ type: 'clip.setLook' as const, clipId: c.id, look: { lut: id, lutIntensity: amt } }))];

/** Hedef klip: seçili klip, yoksa imlecin altındaki, yoksa ilk klip */
export const targetItem = (project: Project, selection: Selection, t: number) => {
  const layout = layoutClips(project);
  const item = (selection?.kind === 'clip' ? layout.find((l) => l.clip.id === selection.id) : undefined) ?? layout.find((l) => t >= l.start && t < l.end) ?? layout[0];
  return { item, index: item ? layout.indexOf(item) + 1 : 0 };
};

type Report = { file: string; status: 'eklendi' | 'vardi' | 'hata'; name?: string; reason?: string }[];

export const LutPanel: React.FC<{ selection: Selection }> = ({ selection }) => {
  const { project, frame, apply, preview, reload, seekRef } = useProject();
  const { luts, refreshLuts, library, toast } = useApp();
  const [list, setList] = useState<LutInfo[]>([]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'tum' | 'fav' | 'gorunum' | 'teknik'>('tum');
  const [tag, setTag] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [amount, setAmount] = useState(1);
  const [target, setTarget] = useState<'klip' | 'tum'>('klip');
  const [previewing, setPreviewing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [editing, setEditing] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparing, setComparing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const dirInput = useRef<HTMLInputElement>(null);
  const urls = useMemo(() => lutUrls(luts, ''), [luts]);

  const reloadList = async () => setList(await api.luts(true));
  useEffect(() => {
    void reloadList();
  }, [luts]);

  // Hedef klip: seçili klip, yoksa imlecin altındaki
  const t = frame / FPS;
  const layout = layoutClips(project);
  const item =
    (selection?.kind === 'clip' ? layout.find((l) => l.clip.id === selection.id) : undefined) ??
    layout.find((l) => t >= l.start && t < l.end) ??
    layout[0];
  const clip = item?.clip;
  const asset = clip ? library.get(clip.assetId) : undefined;
  const detected = asset?.camera.detected ?? null;
  const cam = clip ? effectiveCamera(clip, detected) : null;
  // Önizleme karesi: hedef klipte imlecin karşılığı (yarım saniyeye yuvarlanır; oynatırken sürekli yenilenmez)
  const srcT = item && asset?.kind === 'video' ? Math.round((clip!.in + Math.max(0, Math.min(item.duration, t - item.start))) * 2) / 2 : 0;
  const [base, setBase] = useState<ImageData | null>(null);
  useEffect(() => {
    if (!asset || asset.kind === 'audio' || asset.status !== 'ready') return setBase(null);
    let alive = true;
    loadFrame(asset.id, srcT, 192).then((d) => alive && setBase(d), () => alive && setBase(null));
    return () => {
      alive = false;
    };
  }, [asset?.id, asset?.status, srcT]);

  const userLuts = list.filter((l) => l.group === 'kullanici' && l.meta);
  const allTags = [...new Set(userLuts.flatMap((l) => l.meta!.tags))].sort((a, b) => a.localeCompare(b, 'tr'));
  const q = lower(query.trim());
  const shown = userLuts
    .filter((l) => {
      const m = l.meta!;
      if (filter === 'fav' && !m.favorite) return false;
      if ((filter === 'gorunum' || filter === 'teknik') && m.kind !== filter) return false;
      if (tag && !m.tags.includes(tag)) return false;
      return !q || lower(`${m.name} ${m.tags.join(' ')} ${m.input ? inputLabel(m.input) : ''} ${m.source}`).includes(q);
    })
    .sort((a, b) => Number(b.meta!.favorite) - Number(a.meta!.favorite) || a.title.localeCompare(b.title, 'tr'));

  const active = userLuts.find((l) => l.id === activeId) ?? null;
  const liveLut = target === 'klip' && clip ? (clip.look ?? project.look).lut : project.look.lut;
  // “Kullanımda”: kayıtlı durum (önizleme sırasında değişmez)
  const savedLut = useRef(liveLut);
  if (!previewing) savedLut.current = liveLut;
  const currentLut = savedLut.current;
  const camUrlFor = (m: LutMeta) => (m.kind === 'teknik' || !cam ? null : (urls[cam] ?? null));

  const opsFor = (id: string | null, amt: number) => lutOps(project, target === 'klip' ? (clip ?? null) : null, id, amt);

  const tryLut = (id: string, amt = amount) => {
    setActiveId(id);
    // Etki görünsün: imleç hedef klipte değilse klibin ortasına git
    if (target === 'klip' && item && (t < item.start || t >= item.end)) seekRef.current?.(Math.round((item.start + item.duration / 2) * FPS));
    preview(opsFor(id, amt));
    setPreviewing(true);
  };
  const stopPreview = async () => {
    if (previewing) await reload();
    setPreviewing(false);
  };
  const applyActive = async (extra: OpInput[] = []) => {
    if (!active) return;
    if (previewing) await reload();
    apply([...extra, ...opsFor(active.id, amount)], { label: `LUT: ${active.title}` });
    setPreviewing(false);
    toast(`${active.title} ${target === 'klip' ? `${item ? `${layout.indexOf(item) + 1}. klibe` : 'klibe'}` : 'tüm kurguya'} uygulandı`);
  };
  const removeLut = async () => {
    if (previewing) await reload();
    apply(opsFor(null, 1), { label: 'LUT kaldırıldı' });
    setPreviewing(false);
    setActiveId(null);
  };

  const doImport = async (files: File[]) => {
    const lutFiles = files.filter((f) => !f.name.startsWith('.') && LUT_EXT.test(f.name));
    const skipped = files.length - lutFiles.length;
    if (!lutFiles.length) return toast('Bu seçimde LUT dosyası (.cube / .3dl / .zip) yok', 'error');
    setBusy(`${lutFiles.length} dosya içe aktarılıyor…`);
    try {
      const r = await upload('/api/luts', lutFiles, () => undefined);
      setReport(r.report);
      await refreshLuts();
      const n = (s: string) => (r.report as Report).filter((x) => x.status === s).length;
      toast(`${n('eklendi')} LUT eklendi${n('vardi') ? ` · ${n('vardi')} zaten vardı` : ''}${n('hata') ? ` · ${n('hata')} okunamadı` : ''}${skipped ? ` · ${skipped} başka dosya atlandı` : ''}`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const toggleFav = async (l: LutInfo) => {
    await api.updateLut(l.id, { favorite: !l.meta!.favorite });
    await reloadList();
  };

  const warnings = active?.meta && clip ? lutWarnings(active.meta, cam, detected) : [];
  // Tüm kurgu hedefinde: uyuşmayan klip sayısı
  const mismatched =
    active?.meta && target === 'tum'
      ? project.clips.filter((c) => {
          const a = library.get(c.assetId);
          return a?.kind === 'video' && lutWarnings(active.meta!, effectiveCamera(c, a.camera.detected ?? null), a.camera.detected ?? null).length > 0;
        }).length
      : 0;

  return (
    <div
      className="lutp"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void doImport([...e.dataTransfer.files]);
      }}
    >
      <div className="row-between">
        <h4>LUT'larım</h4>
        <div className="row">
          <button className="btn tiny" onClick={() => fileInput.current?.click()} title=".cube, .3dl veya .zip seçin (birden çok)">
            <Upload size={13} /> Dosya
          </button>
          <button className="btn tiny" onClick={() => dirInput.current?.click()} title="Bir klasördeki bütün LUT'ları ekleyin">
            <FolderOpen size={13} /> Klasör
          </button>
        </div>
        <input ref={fileInput} type="file" multiple hidden accept=".cube,.3dl,.zip,.CUBE,.3DL" onChange={(e) => (void doImport([...(e.target.files ?? [])]), (e.target.value = ''))} />
        <input
          ref={dirInput}
          type="file"
          hidden
          multiple
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
          onChange={(e) => (void doImport([...(e.target.files ?? [])]), (e.target.value = ''))}
        />
      </div>
      {busy ? (
        <p className="hint small">
          <Loader2 size={12} className="spin" /> {busy}
        </p>
      ) : null}
      {report ? (
        <details className="lut-report">
          <summary>
            Son içe aktarma: {report.filter((r) => r.status === 'eklendi').length} eklendi · {report.filter((r) => r.status === 'vardi').length} zaten vardı ·{' '}
            {report.filter((r) => r.status === 'hata').length} okunamadı
          </summary>
          {report.map((r, i) => (
            <div key={i} className={`small rep-${r.status}`}>
              {r.status === 'eklendi' ? '✓' : r.status === 'vardi' ? '=' : '✗'} {r.file}
              {r.reason ? <span className="muted"> — {r.reason}</span> : null}
            </div>
          ))}
          <button className="link small" onClick={() => setReport(null)}>
            Kapat
          </button>
        </details>
      ) : null}

      {!userLuts.length ? (
        <div className="lut-empty">
          <p className="small">Henüz LUT yok. Bir klasörü buraya sürükleyin ya da “Klasör” ile seçin.</p>
          <p className="muted small">.cube ve .3dl dosyaları ile bunları içeren .zip paketleri eklenir; aynı LUT ikinci kez eklenmez.</p>
        </div>
      ) : (
        <>
          <div className="tr-search">
            <Search size={14} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="LUT ara (ad, etiket, kamera)" aria-label="LUT ara" />
            {query ? (
              <button className="icon-btn sm" onClick={() => setQuery('')} title="Temizle">
                <X size={13} />
              </button>
            ) : null}
          </div>
          <div className="chips">
            {(
              [
                ['tum', `Tümü ${userLuts.length}`],
                ['fav', '★ Favoriler'],
                ['gorunum', 'Görünüm'],
                ['teknik', 'Teknik'],
              ] as const
            ).map(([k, l]) => (
              <button key={k} className={`chip ${filter === k ? 'on' : ''}`} onClick={() => setFilter(k)}>
                {l}
              </button>
            ))}
            {allTags.map((tg) => (
              <button key={tg} className={`chip tag ${tag === tg ? 'on' : ''}`} onClick={() => setTag(tag === tg ? null : tg)}>
                #{tg}
              </button>
            ))}
          </div>
          <div className="row-between small">
            <Segmented
              size="sm"
              value={target}
              onChange={(v) => (void stopPreview(), setTarget(v))}
              options={[
                { value: 'klip', label: item ? `${layout.indexOf(item) + 1}. klip` : 'Seçili klip', hint: 'Yalnız bu klibe uygula' },
                { value: 'tum', label: 'Tüm kurgu', hint: 'Projenin bütün kliplerine' },
              ]}
            />
            {currentLut ? (
              <button className="link small" onClick={removeLut} title="Bu hedeften LUT'u kaldır">
                LUT'u kaldır
              </button>
            ) : null}
          </div>
      {active?.meta ? (
            <div className="lut-active">
              <div className="row-between">
                <b className="ellipsis">{active.meta.name}</b>
                <button className="icon-btn sm" onClick={() => (void stopPreview(), setActiveId(null), setEditing(false))} title={previewing ? 'Önizlemeyi bırak (kaydedilmez)' : 'Kapat'} aria-label="Kapat">
                  <X size={13} />
                </button>
              </div>
              <small className="muted">
                {previewing ? 'Önizlemede · ' : ''}
                {active.meta.kind === 'teknik' ? `Teknik · ${inputLabel(active.meta.input)} girişi bekler` : 'Görünüm · normal video için'} · {active.meta.size}³
                {active.uses ? ` · ${active.uses} projede kullanılıyor` : ''}
              </small>
              {warnings.map((w) => (
                <div key={w.text} className="impact-warn">
                  ⚠ {w.text}{' '}
                  {w.fix && clip ? (
                    <button className="link small" onClick={() => void applyActive([{ type: 'clip.update', clipId: clip.id, patch: { camera: w.fix!.camera } }])}>
                      {w.fix.label} ve uygula
                    </button>
                  ) : null}
                </div>
              ))}
              {mismatched ? <div className="impact-warn">⚠ Kurgudaki {mismatched} klip bu LUT'un beklediği görüntü türünde değil.</div> : null}
              <Slider label="Yoğunluk" value={amount} min={0} max={1} format={fmtPct} onChange={(v) => (setAmount(v), tryLut(active.id, v))} />
              <div className="row lut-actions">
                <button className="btn primary tiny" onClick={() => void applyActive()}>
                  <Check size={13} /> Uygula
                </button>
                <button
                  className="btn tiny"
                  onClick={() => {
                    setCompareIds((ids) => (ids.includes(active.id) ? ids : [active.id, ...ids].slice(0, 4)));
                    setComparing(true);
                  }}
                  title="Aynı karede önce/sonra ve başka LUT'larla karşılaştır"
                >
                  <Columns2 size={13} /> Karşılaştır
                </button>
                <button className={`icon-btn sm ${editing ? 'on' : ''}`} onClick={() => setEditing((v) => !v)} title="Ad, tür, etiket · sil" aria-label="Düzenle">
                  <Pencil size={13} />
                </button>
              </div>
              {editing ? <LutEditor lut={active} onDone={async () => (setEditing(false), await reloadList(), await refreshLuts())} onDeleted={async () => (setEditing(false), setActiveId(null), await stopPreview(), await refreshLuts())} /> : null}
            </div>
          ) : null}
          <div className="lut-grid">
            {shown.map((l) => {
              const m = l.meta!;
              return (
                <div
                  key={l.id}
                  className={`lut-card ${activeId === l.id ? 'sel' : ''} ${currentLut === l.id ? 'inuse' : ''}`}
                  onClick={() => tryLut(l.id)}
                  data-lut={l.title}
                  title={`${m.name} · ${m.kind === 'teknik' ? `teknik: ${inputLabel(m.input)}` : 'görünüm'} · ${m.size}³${m.source && m.source !== `${m.name}.cube` ? ` · ${m.source}` : ''}`}
                >
                  <LutCanvas base={base} lutUrl={urls[l.id] ?? null} camUrl={camUrlFor(m)} className="lut-thumb" />
                  <div className="lut-meta">
                    <span className="ellipsis">{m.name}</span>
                    <button
                      className={`star ${m.favorite ? 'on' : ''}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void toggleFav(l);
                      }}
                      title={m.favorite ? 'Favorilerden çıkar' : 'Favorilere ekle'}
                      aria-label="Favori"
                    >
                      <Star size={13} />
                    </button>
                  </div>
                  <div className="lut-badges">
                    {m.kind === 'teknik' ? <span className="scope output">{inputLabel(m.input)}</span> : null}
                    {currentLut === l.id ? <span className="scope track">kullanımda</span> : null}
                  </div>
                </div>
              );
            })}
            {!shown.length ? <p className="muted small">Bu filtrede LUT yok.</p> : null}
          </div>
          <p className="muted tiny-note">Küçük resimler yaklaşıktır; tıklayınca büyük önizlemede gerçek sonuç görünür.</p>
        </>
      )}

      {comparing ? (
        <CompareModal
          ids={compareIds}
          all={userLuts}
          urls={urls}
          asset={asset?.kind !== 'audio' && asset?.status === 'ready' ? asset.id : null}
          srcT={srcT}
          camUrl={cam ? (urls[cam] ?? null) : null}
          amount={amount}
          setAmount={setAmount}
          onPick={(id) => setActiveId(id)}
          onAdd={(id) => setCompareIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id].slice(-4)))}
          activeId={activeId}
          onApply={() => (setComparing(false), void applyActive())}
          onClose={() => setComparing(false)}
        />
      ) : null}
    </div>
  );
};

const LutEditor: React.FC<{ lut: LutInfo; onDone: () => void; onDeleted: () => void }> = ({ lut, onDone, onDeleted }) => {
  const m = lut.meta!;
  const { toast } = useApp();
  const [name, setName] = useState(m.name);
  const [kind, setKind] = useState(m.kind);
  const [input, setInput] = useState<string | null>(m.input);
  const [tags, setTags] = useState(m.tags.join(', '));
  const save = async () => {
    try {
      await api.updateLut(lut.id, { name: name.trim() || m.name, kind, input: kind === 'teknik' ? (input ?? 'log') : null, tags: tags.split(',').map((x) => x.trim()).filter(Boolean) });
      toast('LUT bilgileri kaydedildi');
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    }
  };
  const del = async () => {
    const msg = lut.uses
      ? `“${m.name}” ${lut.uses} projede kullanılıyor. Silerseniz o projelerde bu LUT'un etkisi kalkar. Silinsin mi?`
      : `“${m.name}” kütüphaneden silinsin mi? (Asıl dosyanıza dokunulmaz.)`;
    if (!window.confirm(msg)) return;
    await api.deleteLut(lut.id);
    toast('LUT silindi');
    onDeleted();
  };
  return (
    <div className="lut-edit">
      <label className="field">
        <span>Ad</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <Segmented
        size="sm"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'gorunum', label: 'Görünüm', hint: 'Normal (Rec.709) videoya uygulanır' },
          { value: 'teknik', label: 'Teknik', hint: 'Log, HDR gibi belirli bir giriş bekler' },
        ]}
      />
      {kind === 'teknik' ? (
        <label className="field">
          <span>Beklediği giriş</span>
          <select value={input ?? 'log'} onChange={(e) => setInput(e.target.value)}>
            {Object.entries(INPUT_LABELS)
              .filter(([k], i, arr) => arr.findIndex(([, v]) => v === INPUT_LABELS[k]) === i)
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </select>
        </label>
      ) : null}
      <label className="field">
        <span>Etiketler (virgülle)</span>
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="film, sıcak, kafe" />
      </label>
      <div className="row-between">
        <button className="btn primary tiny" onClick={save}>
          Kaydet
        </button>
        <button className="btn tiny danger" onClick={del}>
          <Trash2 size={13} /> Sil
        </button>
      </div>
    </div>
  );
};

const CompareModal: React.FC<{
  ids: string[];
  all: LutInfo[];
  urls: Record<string, string>;
  asset: string | null;
  srcT: number;
  camUrl: string | null;
  amount: number;
  setAmount: (v: number) => void;
  activeId: string | null;
  onPick: (id: string) => void;
  onAdd: (id: string) => void;
  onApply: () => void;
  onClose: () => void;
}> = ({ ids, all, urls, asset, srcT, camUrl, amount, setAmount, activeId, onPick, onAdd, onApply, onClose }) => {
  const [big, setBig] = useState<ImageData | null>(null);
  const [split, setSplit] = useState(50);
  useEffect(() => {
    if (!asset) return;
    loadFrame(asset, srcT, 640).then(setBig, () => setBig(null));
  }, [asset, srcT]);
  const active = all.find((l) => l.id === activeId) ?? all.find((l) => l.id === ids[0]);
  const camFor = (l: LutInfo) => (l.meta?.kind === 'teknik' ? null : camUrl);
  return (
    <Modal title="LUT karşılaştır" onClose={onClose} width={900}>
      {!asset ? <p className="muted">Karşılaştırmak için kurguda bir görüntü olmalı.</p> : null}
      {active ? (
        <div className="cmp-split" style={{ ['--split' as string]: `${split}%` }}>
          <LutCanvas base={big} lutUrl={urls[active.id] ?? null} camUrl={camFor(active)} amount={amount} className="cmp-after" />
          <LutCanvas base={big} lutUrl={null} camUrl={camFor(active)} className="cmp-before" />
          <span className="cmp-label left">Önce</span>
          <span className="cmp-label right">{active.title}</span>
          <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Önce / sonra" className="cmp-range" />
        </div>
      ) : null}
      <Slider label="Yoğunluk" value={amount} min={0} max={1} format={fmtPct} onChange={setAmount} />
      <div className="cmp-grid">
        {ids
          .map((id) => all.find((l) => l.id === id))
          .filter(Boolean)
          .map((l) => (
            <button key={l!.id} className={`cmp-cell ${active?.id === l!.id ? 'sel' : ''}`} onClick={() => onPick(l!.id)}>
              <LutCanvas base={big} lutUrl={urls[l!.id] ?? null} camUrl={camFor(l!)} amount={amount} />
              <span className="ellipsis">{l!.title}</span>
              <span
                className="cmp-remove"
                role="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd(l!.id);
                }}
                title="Karşılaştırmadan çıkar"
              >
                <X size={12} />
              </span>
            </button>
          ))}
      </div>
      <details className="cmp-add">
        <summary className="small">Karşılaştırmaya LUT ekle (en çok 4)</summary>
        <div className="chips">
          {all
            .filter((l) => !ids.includes(l.id))
            .map((l) => (
              <button key={l.id} className="chip" onClick={() => onAdd(l.id)}>
                + {l.title}
              </button>
            ))}
        </div>
      </details>
      <div className="modal-actions">
        <button className="btn ghost" onClick={onClose}>
          Kapat
        </button>
        <button className="btn primary" disabled={!active} onClick={() => (active && onPick(active.id), onApply())}>
          <Check size={15} /> {active ? `“${active.title}” uygula` : 'Uygula'}
        </button>
      </div>
    </Modal>
  );
};
