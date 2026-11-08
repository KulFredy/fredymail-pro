import React, { useEffect, useMemo, useState } from 'react';
import { Check, Loader2, Plus, Tag, Trash2, Upload, X } from 'lucide-react';
import { CHANNELS, CHANNEL_IDS, type ChannelId } from '../../src/core/channels';
import { DEFAULT_APPLY, type BrandApplyOptions } from '../../src/core/brand';
import { FONTS, type FontId } from '../../src/core/schema';
import { api, fileHref, upload, type Brand, type BrandInput, type TtsCatalog } from './api';
import { useApp } from './state';
import { Modal, Slider, Toggle } from './ui';

const EMPTY: BrandInput = {
  name: '',
  logoAssetIds: [],
  palette: [],
  textColor: '#FFFFFF',
  accentColor: '#FFD60A',
  fonts: { heading: 'Montserrat', body: 'Inter' },
  tone: '',
  hashtags: [],
  lutIds: [],
  lutIntensity: 0.8,
  referenceAssetIds: [],
  voice: null,
  captionBox: false,
  captionUppercase: false,
  products: [],
  channels: ['ig-reels', 'ig-story'],
};
const toInput = (b: Brand): BrandInput => {
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = b;
  return rest;
};

/** Kütüphaneden görsel seçici (logo, referans) + yükleme */
const ImagePicker: React.FC<{ value: string[]; onChange: (ids: string[]) => void; label: string; single?: boolean; testid: string }> = ({ value, onChange, label, single, testid }) => {
  const { library, refreshLibrary, toast } = useApp();
  const imgs = useMemo(() => [...library.values()].filter((a) => a.kind === 'image' && a.status === 'ready' && a.role !== 'uretim').sort((a, b) => Number(b.alpha) - Number(a.alpha) || b.importedAt.localeCompare(a.importedAt)), [library]);
  const [open, setOpen] = useState(false);
  const pick = (id: string) => onChange(single ? [id] : value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  return (
    <div className="field" data-testid={testid}>
      <span>{label}</span>
      <div className="row-wrap">
        {value.map((id) => {
          const a = library.get(id);
          return (
            <span key={id} className="brand-thumb">
              {a?.poster ? <img src={fileHref(a.poster)} alt={a.name} /> : <Loader2 size={12} className="spin" />}
              <button className="icon-btn" aria-label="Çıkar" onClick={() => onChange(value.filter((x) => x !== id))}>
                <X size={11} />
              </button>
            </span>
          );
        })}
        <button className="btn tiny" onClick={() => setOpen((o) => !o)}>
          <Plus size={12} /> Kütüphaneden seç
        </button>
        <label className="btn tiny ghost">
          <Upload size={12} /> Yükle
          <input
            type="file"
            accept="image/png,image/svg+xml,image/jpeg,image/webp"
            multiple={!single}
            hidden
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])];
              if (!files.length) return;
              try {
                const r = await upload('/api/import', files, () => undefined);
                await refreshLibrary();
                const ids = (r.assets ?? []).map((a: { id: string }) => a.id);
                onChange(single ? ids.slice(0, 1) : [...value, ...ids.filter((id: string) => !value.includes(id))]);
              } catch (err) {
                toast((err as Error).message, 'error');
              }
            }}
          />
        </label>
      </div>
      {open ? (
        <div className="brand-pick">
          {imgs.length ? null : <small className="muted">Kütüphanede görsel yok.</small>}
          {imgs.map((a) => (
            <button key={a.id} className={`brand-pick-item ${value.includes(a.id) ? 'on' : ''}`} title={a.name} onClick={() => pick(a.id)}>
              {a.poster ? <img src={fileHref(a.poster)} alt="" /> : null}
              {a.alpha ? <span className="badge">saydam</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
};

const ColorInput: React.FC<{ value: string; onChange: (v: string) => void; label: string }> = ({ value, onChange, label }) => (
  <label className="color-in" title={label}>
    <input type="color" value={value} onChange={(e) => onChange(e.target.value.toUpperCase())} aria-label={label} />
    <small>{label}</small>
  </label>
);

const BrandEditor: React.FC<{ initial: BrandInput; id: string | null; onSaved: (b: Brand) => void; onDeleted: () => void }> = ({ initial, id, onSaved, onDeleted }) => {
  const { luts, toast } = useApp();
  const [b, setB] = useState<BrandInput>(initial);
  const [busy, setBusy] = useState(false);
  const [cat, setCat] = useState<TtsCatalog | null>(null);
  const [tags, setTags] = useState(initial.hashtags.join(', '));
  useEffect(() => {
    setB(initial);
    setTags(initial.hashtags.join(', '));
  }, [initial, id]);
  useEffect(() => {
    api.ttsCatalog().then(setCat, () => setCat(null));
  }, []);
  const set = <K extends keyof BrandInput>(k: K, v: BrandInput[K]) => setB((x) => ({ ...x, [k]: v }));
  const userLuts = luts.filter((l) => l.group === 'kullanici' && l.meta?.kind !== 'teknik');
  const save = async () => {
    setBusy(true);
    const body: BrandInput = { ...b, hashtags: tags.split(/[,\n]/).map((t) => t.trim().replace(/^#/, '')).filter(Boolean) };
    try {
      const saved = id ? await api.updateBrand(id, body) : await api.createBrand(body);
      toast(`${saved.name} kaydedildi`, 'ok');
      onSaved(saved);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="brand-editor">
      <label className="field">
        <span>Marka adı</span>
        <input value={b.name} onChange={(e) => set('name', e.target.value)} placeholder="ör. Köşe Kahve" aria-label="Marka adı" />
      </label>
      <ImagePicker label="Logo (saydam PNG/SVG en iyisi; ilki ana logo)" value={b.logoAssetIds} onChange={(v) => set('logoAssetIds', v)} testid="brand-logo" />
      <div className="field">
        <span>Renkler</span>
        <div className="row-wrap">
          <ColorInput label="Yazı" value={b.textColor} onChange={(v) => set('textColor', v)} />
          <ColorInput label="Vurgu" value={b.accentColor} onChange={(v) => set('accentColor', v)} />
          <span className="sep" />
          {b.palette.map((c, i) => (
            <span key={i} className="palette-item">
              <ColorInput label={`${i + 1}`} value={c} onChange={(v) => set('palette', b.palette.map((x, j) => (j === i ? v : x)))} />
              <button className="icon-btn" aria-label="Rengi sil" onClick={() => set('palette', b.palette.filter((_, j) => j !== i))}>
                <X size={11} />
              </button>
            </span>
          ))}
          {b.palette.length < 8 ? (
            <button className="btn tiny ghost" onClick={() => set('palette', [...b.palette, '#888888'])}>
              <Plus size={12} /> Renk
            </button>
          ) : null}
        </div>
      </div>
      <div className="row-wrap">
        <label className="field">
          <span>Başlık yazı tipi</span>
          <select value={b.fonts.heading} onChange={(e) => set('fonts', { ...b.fonts, heading: e.target.value as FontId })} aria-label="Başlık yazı tipi">
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Altyazı yazı tipi</span>
          <select value={b.fonts.body} onChange={(e) => set('fonts', { ...b.fonts, body: e.target.value as FontId })} aria-label="Altyazı yazı tipi">
            {FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <div className="font-sample" style={{ fontFamily: `"${b.fonts.heading}"`, color: b.textColor, borderColor: b.accentColor }}>
          Çağ Şöleni <span style={{ fontFamily: `"${b.fonts.body}"`, color: b.accentColor }}>İyi günler</span>
        </div>
      </div>
      <div className="row-wrap">
        <Toggle checked={b.captionBox} onChange={(v) => set('captionBox', v)} label="Altyazı kutulu" />
        <Toggle checked={b.captionUppercase} onChange={(v) => set('captionUppercase', v)} label="Altyazı büyük harf" />
      </div>
      <label className="field">
        <span>Metin tonu (Claude metin yazarken kullanır)</span>
        <textarea rows={2} value={b.tone} onChange={(e) => set('tone', e.target.value)} placeholder="ör. samimi, kısa cümleler, emoji yok, “siz” diye hitap" aria-label="Metin tonu" />
      </label>
      <label className="field">
        <span>Etiketler (virgülle)</span>
        <input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="köşekahve, kahve, filtrekahve" aria-label="Etiketler" />
      </label>
      <div className="field">
        <span>Ürünler</span>
        {b.products.map((p, i) => (
          <div key={p.id ?? i} className="row-wrap product-row">
            <input value={p.name} onChange={(e) => set('products', b.products.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} placeholder="Ürün adı (yazımı kontrol edilir)" aria-label={`Ürün ${i + 1} adı`} />
            <input value={p.notes} onChange={(e) => set('products', b.products.map((x, j) => (j === i ? { ...x, notes: e.target.value } : x)))} placeholder="Kısa not: içerik, boyut, öne çıkan" aria-label={`Ürün ${i + 1} notu`} />
            <button className="icon-btn danger" aria-label="Ürünü sil" onClick={() => set('products', b.products.filter((_, j) => j !== i))}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
        <div>
          <button className="btn tiny ghost" onClick={() => set('products', [...b.products, { name: '', notes: '' }])}>
            <Plus size={12} /> Ürün ekle
          </button>
        </div>
      </div>
      <div className="field">
        <span>Varsayılan kanallar</span>
        <div className="chips">
          {CHANNEL_IDS.map((c) => (
            <button key={c} className={`chip ${b.channels.includes(c) ? 'on' : ''}`} onClick={() => set('channels', b.channels.includes(c) ? b.channels.filter((x) => x !== c) : [...b.channels, c])}>
              {CHANNELS[c].label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>LUT favorileri (ilki “marka görünümü”)</span>
        {userLuts.length ? (
          <div className="chips">
            {userLuts.map((l) => (
              <button key={l.id} className={`chip tag ${b.lutIds.includes(l.id) ? 'on' : ''}`} onClick={() => set('lutIds', b.lutIds.includes(l.id) ? b.lutIds.filter((x) => x !== l.id) : [...b.lutIds, l.id])}>
                {b.lutIds[0] === l.id ? <Check size={11} /> : null}
                {l.meta?.name ?? l.title}
              </button>
            ))}
          </div>
        ) : (
          <small className="muted">LUT'larım'da görünüm LUT'u yok.</small>
        )}
        {b.lutIds.length ? <Slider label="Marka görünümü yoğunluğu" value={b.lutIntensity} min={0} max={1} onChange={(v) => set('lutIntensity', v)} format={(v) => `%${Math.round(v * 100)}`} /> : null}
      </div>
      <ImagePicker label="Marka referansları (renk/ışık örneği)" value={b.referenceAssetIds} onChange={(v) => set('referenceAssetIds', v)} testid="brand-refs" />
      <label className="field">
        <span>Tercih edilen dış ses (ElevenLabs)</span>
        {cat ? (
          <select
            value={b.voice?.voiceId ?? ''}
            onChange={(e) => {
              const v = cat.voices.find((x) => x.id === e.target.value);
              set('voice', v ? { voiceId: v.id, voiceName: v.name } : null);
            }}
            aria-label="Tercih edilen dış ses"
          >
            <option value="">Seçilmedi</option>
            {cat.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.category === 'cloned' || v.category === 'professional' ? ' (marka sesi)' : ''}
              </option>
            ))}
          </select>
        ) : (
          <small className="muted">{b.voice ? `${b.voice.voiceName} (ElevenLabs bağlı değil)` : 'ElevenLabs bağlanınca seçilebilir.'}</small>
        )}
      </label>
      <div className="modal-actions">
        {id ? (
          <button
            className="btn ghost danger"
            onClick={async () => {
              if (!window.confirm(`“${b.name}” markası silinsin mi? Projeler açılmaya devam eder; dosyalar silinmez.`)) return;
              await api.deleteBrand(id);
              onDeleted();
            }}
          >
            <Trash2 size={14} /> Sil
          </button>
        ) : null}
        <button className="btn primary" disabled={busy || !b.name.trim() || b.products.some((p) => !p.name.trim())} onClick={() => void save()}>
          {busy ? <Loader2 size={14} className="spin" /> : <Check size={14} />} Kaydet
        </button>
      </div>
    </div>
  );
};

/** Markalar: profil listesi ve düzenleyici */
export const BrandsModal: React.FC<{ onClose: () => void; onChanged?: () => void }> = ({ onClose, onChanged }) => {
  const [list, setList] = useState<Brand[] | null>(null);
  const [sel, setSel] = useState<string | 'yeni' | null>(null);
  const load = async () => {
    const l = await api.brands();
    setList(l);
    return l;
  };
  useEffect(() => {
    void load().then((l) => setSel(l[0]?.id ?? 'yeni'));
  }, []);
  const cur = list?.find((b) => b.id === sel) ?? null;
  const initial = useMemo(() => (cur ? toInput(cur) : EMPTY), [cur?.id, cur?.updatedAt, sel]);
  return (
    <Modal title="Markalar" onClose={onClose} width={980}>
      <div className="brands">
        <div className="brand-list">
          {(list ?? []).map((b) => (
            <button key={b.id} className={`brand-item ${sel === b.id ? 'on' : ''}`} onClick={() => setSel(b.id)}>
              <span className="brand-dots">
                {[b.textColor, b.accentColor, ...b.palette].slice(0, 4).map((c, i) => (
                  <i key={i} style={{ background: c }} />
                ))}
              </span>
              <b>{b.name}</b>
              <small className="muted">
                {b.products.length} ürün · {b.channels.map((c) => CHANNELS[c as ChannelId]?.label).join(', ')}
              </small>
            </button>
          ))}
          <button className={`brand-item new ${sel === 'yeni' ? 'on' : ''}`} onClick={() => setSel('yeni')}>
            <Plus size={14} /> Yeni marka
          </button>
          <p className="hint">
            <Tag size={12} /> Marka; logo, renk, yazı tipi, ton, etiket, LUT, referans, dış ses ve ürünleri bir arada tutar. Projeye uygulayınca hepsi tek adımda gelir ve geri alınabilir.
          </p>
        </div>
        {list === null ? (
          <Loader2 className="spin" />
        ) : (
          <BrandEditor
            key={sel ?? 'x'}
            initial={initial}
            id={cur?.id ?? null}
            onSaved={async (b) => {
              await load();
              setSel(b.id);
              onChanged?.();
            }}
            onDeleted={async () => {
              const l = await load();
              setSel(l[0]?.id ?? 'yeni');
              onChanged?.();
            }}
          />
        )}
      </div>
    </Modal>
  );
};

/** Markayı projeye uygula: marka, ürün, kampanya, neler uygulanacağı ve önizleme maddeleri */
export const BrandApplyForm: React.FC<{
  projectId: string;
  initial?: { brandId: string; productId: string | null; campaign: string; brandName?: string; productName?: string } | null;
  onApply: (ops: import('../../src/core/ops').OpInput[], label: string) => void | Promise<void>;
  onCancel: () => void;
  openBrands: () => void;
}> = ({ projectId, initial, onApply, onCancel, openBrands }) => {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [brandId, setBrandId] = useState(initial?.brandId ?? '');
  const [productId, setProductId] = useState<string | null>(initial?.productId ?? null);
  const [campaign, setCampaign] = useState(initial?.campaign ?? '');
  const [opts, setOpts] = useState<BrandApplyOptions>(DEFAULT_APPLY);
  const [plan, setPlan] = useState<{ ops: import('../../src/core/ops').OpInput[]; items: string[] } | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const initialNames = initial;
  useEffect(() => {
    api.brands().then((l) => {
      setBrands(l);
      if (!l.some((b) => b.id === brandId) && l[0]) {
        // Bağlı marka silinmiş olabilir: aynı adlı marka varsa onu seç, ürünü adından bul
        const same = l.find((b) => b.name === initialNames?.brandName) ?? l[0];
        setBrandId(same.id);
        setProductId(same.products.find((p) => p.name === initialNames?.productName)?.id ?? null);
      }
    });
  }, []);
  const brand = brands?.find((b) => b.id === brandId);
  useEffect(() => {
    if (brand && productId && !brand.products.some((p) => p.id === productId)) setProductId(brand.products.find((p) => p.name === initial?.productName)?.id ?? null);
    if (brand && !productId && brand.products.length === 1) setProductId(brand.products[0].id);
  }, [brand?.id]);
  useEffect(() => {
    if (!brandId || !brands?.some((b) => b.id === brandId)) return setPlan(null);
    const t = setTimeout(
      () =>
        api.brandPlan(projectId, { brandId, productId, campaign, options: opts }).then(
          (p) => (setPlan(p), setPlanErr(null)),
          (e) => (setPlan(null), setPlanErr((e as Error).message)),
        ),
      150,
    );
    return () => clearTimeout(t);
  }, [brandId, productId, campaign, opts, projectId, brands]);
  if (brands && !brands.length)
    return (
      <div className="lut-empty">
        <p>Henüz marka yok.</p>
        <button className="btn primary tiny" onClick={openBrands}>
          <Plus size={13} /> Marka oluştur
        </button>
      </div>
    );
  return (
    <div className="stack" data-testid="brand-apply">
      <div className="row-wrap">
        <label className="field">
          <span>Marka</span>
          <select value={brandId} onChange={(e) => setBrandId(e.target.value)} aria-label="Marka">
            {(brands ?? []).map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Ürün</span>
          <select value={productId ?? ''} onChange={(e) => setProductId(e.target.value || null)} aria-label="Ürün">
            <option value="">Genel (ürünsüz)</option>
            {(brand?.products ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Kampanya</span>
          <input value={campaign} onChange={(e) => setCampaign(e.target.value)} placeholder="ör. Yaz 2026" aria-label="Kampanya" />
        </label>
      </div>
      <div className="row-wrap">
        {(
          [
            ['logo', 'Logo'],
            ['captions', 'Altyazı rengi ve yazı tipi'],
            ['texts', 'Yazılar'],
            ['look', 'Marka görünümü (LUT)'],
            ['references', 'Referanslar'],
            ['channels', 'Kanallar'],
          ] as [keyof BrandApplyOptions, string][]
        ).map(([k, label]) => (
          <Toggle key={k} checked={opts[k]} onChange={(v) => setOpts((o) => ({ ...o, [k]: v }))} label={label} />
        ))}
      </div>
      <div className="impact" data-testid="brand-plan">
        {plan === null ? (
          planErr ? <small className="impact-warn">{planErr}</small> : <Loader2 size={13} className="spin" />
        ) : plan.items.length ? (
          <ul>
            {plan.items.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ul>
        ) : (
          <small className="muted">Proje zaten bu markaya uygun.</small>
        )}
      </div>
      <div className="modal-actions">
        <button className="btn ghost" onClick={openBrands}>
          Markaları düzenle
        </button>
        <button className="btn ghost" onClick={onCancel}>
          Vazgeç
        </button>
        <button className="btn primary" disabled={!plan?.ops.length} onClick={() => plan && void onApply(plan.ops, `Marka: ${brand?.name ?? ''}`)}>
          <Check size={14} /> Uygula
        </button>
      </div>
    </div>
  );
};
