import React, { useEffect, useMemo, useState } from 'react';
import { Check, Image as ImageIcon, Layers, Loader2, Mic2, Play, Plug, Sparkles } from 'lucide-react';
import { FPS } from '../../src/core/schema';
import { formatTime } from '../../src/core/timeline';
import { api, fileHref, type Generation, type TtsCatalog } from './api';
import { useApp, useProject } from './state';
import { Segmented } from './ui';

export type RegenRequest = { voiceItemId: string; text: string; voiceId: string; modelId: string };

const STATUS: Record<Generation['status'], string> = { calisiyor: 'sürüyor', bitti: 'bitti', 'onay-bekliyor': 'onay bekliyor', onaylandi: 'onaylandı', hata: 'hata' };

/**
 * Üret (Faz 5): ücretli servislerle dış ses ve ürün arka planı.
 * Her işten önce ne gönderileceği ve tahmini maliyet gösterilir; sonuç yerel medya olarak saklanır.
 */
export const GeneratePanel: React.FC<{ regen: RegenRequest | null; onRegenDone: () => void; openConnections: () => void }> = ({ regen, onRegenDone, openConnections }) => {
  const { project, frame, reload } = useProject();
  const { library, toast, refreshLibrary } = useApp();
  const [mode, setMode] = useState<'ses' | 'gorsel'>('ses');
  const [gens, setGens] = useState<Generation[]>([]);
  const loadGens = async () => setGens(await api.generations(project.id).catch(() => []));
  useEffect(() => {
    void loadGens();
  }, [project.id]);
  useEffect(() => {
    if (regen) setMode('ses');
  }, [regen]);
  return (
    <div className="genp">
      <div className="row-between">
        <h4>
          <Sparkles size={14} /> Üret
        </h4>
        <button className="btn tiny ghost" onClick={openConnections} title="Ayarlar → Bağlantılar">
          <Plug size={13} /> Bağlantılar
        </button>
      </div>
      <Segmented
        size="sm"
        value={mode}
        onChange={setMode}
        options={[
          { value: 'ses', label: 'Dış ses', hint: 'ElevenLabs ile metinden Türkçe dış ses' },
          { value: 'gorsel', label: 'Ürün arka planı', hint: 'Nano Banana 2 ile ürün fotoğrafına yeni arka plan' },
        ]}
      />
      {mode === 'ses' ? (
        <VoiceForm playhead={frame / FPS} regen={regen} onDone={async () => (onRegenDone(), await reload(), await loadGens())} openConnections={openConnections} />
      ) : (
        <ImageForm onDone={async () => (await refreshLibrary(), await loadGens())} openConnections={openConnections} />
      )}
      {gens
        .filter((g) => g.kind === 'arka-plan' && (g.status === 'onay-bekliyor' || g.status === 'onaylandi') && g.resultAssetIds.length)
        .slice(0, 1)
        .map((g) => (
          <div key={g.id} className="gen-pending">
            <small>
              <b>{g.status === 'onaylandi' ? 'Son üretim:' : 'Onay bekliyor:'}</b> {g.request.prompt}
            </small>
            <Results gen={g} library={library} onApproved={async () => (await refreshLibrary(), await loadGens(), toast("Medya'ya eklendi"))} />
          </div>
        ))}
      {gens.length ? (
        <details className="gen-history">
          <summary className="small">Bu projedeki üretimler ({gens.length})</summary>
          {gens.slice(0, 20).map((g) => (
            <div key={g.id} className={`gen-row small st-${g.status}`}>
              <span>{g.kind === 'dis-ses' ? <Mic2 size={11} /> : <ImageIcon size={11} />}</span>
              <span className="ellipsis" title={g.request.text ?? g.request.prompt}>
                {g.request.text ?? g.request.prompt}
              </span>
              <span className="muted">
                {g.estimate.credits !== undefined ? `${g.estimate.credits} kredi` : `${g.estimate.units} ${g.estimate.unit}`} · {STATUS[g.status]}
              </span>
              {g.error ? <span className="impact-warn">{g.error}</span> : null}
              {g.kind === 'arka-plan' && g.resultAssetIds.length ? <Results gen={g} library={library} onApproved={async () => (await refreshLibrary(), await loadGens(), toast('Medya\'ya eklendi'))} /> : null}
            </div>
          ))}
        </details>
      ) : null}
    </div>
  );
};

const NotConnected: React.FC<{ name: string; open: () => void }> = ({ name, open }) => (
  <div className="lut-empty">
    <p className="small">{name} bağlı değil.</p>
    <button className="btn tiny primary" onClick={open}>
      <Plug size={13} /> Ayarlar → Bağlantılar
    </button>
  </div>
);

const VoiceForm: React.FC<{ playhead: number; regen: RegenRequest | null; onDone: () => void; openConnections: () => void }> = ({ playhead, regen, onDone, openConnections }) => {
  const { project } = useProject();
  const { toast } = useApp();
  const [cat, setCat] = useState<TtsCatalog | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [voiceId, setVoiceId] = useState('');
  const [modelId, setModelId] = useState('');
  const [est, setEst] = useState<Awaited<ReturnType<typeof api.ttsEstimate>> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sample, setSample] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  useEffect(() => {
    api.ttsCatalog().then(
      (c) => {
        setCat(c);
        setVoiceId((v) => v || c.defaultVoiceId || '');
        setModelId((m) => m || c.defaultModelId || '');
      },
      (e) => setErr((e as Error).message),
    );
  }, []);
  useEffect(() => {
    if (!regen) return;
    setText(regen.text);
    setVoiceId(regen.voiceId);
    setModelId(regen.modelId);
    setTarget(regen.voiceItemId);
  }, [regen]);
  // Tahmin (yazmayı bırakınca)
  useEffect(() => {
    if (!cat || !text.trim() || !voiceId || !modelId) return setEst(null);
    const t = setTimeout(() => api.ttsEstimate(text, voiceId, modelId).then(setEst, () => setEst(null)), 400);
    return () => clearTimeout(t);
  }, [text, voiceId, modelId, cat]);
  if (err) return /bağlı değil/.test(err) ? <NotConnected name="ElevenLabs" open={openConnections} /> : <p className="impact-warn">{err}</p>;
  if (!cat)
    return (
      <p className="hint small">
        <Loader2 size={12} className="spin" /> Sesler yükleniyor…
      </p>
    );
  const targetItem = target ? project.voice.find((v) => v.id === target) : null;
  const tooLong = est?.model.maxChars ? est.chars > est.model.maxChars : false;
  const noCredit = est && est.remaining !== null && est.credits > est.remaining;
  const run = async () => {
    setBusy('Dış ses üretiliyor…');
    try {
      const r = await api.tts(project.id, { text, voiceId, modelId, at: targetItem ? targetItem.at : playhead, voiceItemId: target });
      if (r.running) toast('Bu metin zaten üretiliyor; birazdan dış ses izinde görünecek.');
      else toast(r.reused ? 'Bu metin daha önce üretilmişti; kredi harcanmadan eklendi.' : targetItem ? 'Dış ses yeniden üretildi.' : `Dış ses ${formatTime(playhead)}'a eklendi.`);
      setTarget(null);
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="stack">
      {targetItem ? (
        <div className="impact-warn">
          Seçili dış ses yeniden üretilecek ({formatTime(targetItem.at)}).{' '}
          <button className="link small" onClick={() => setTarget(null)}>
            Yeni dış ses olarak ekle
          </button>
        </div>
      ) : null}
      <textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Dış ses metni (Türkçe)" aria-label="Dış ses metni" />
      <div className="row-wrap">
        <label className="field">
          <span>Ses</span>
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} aria-label="Ses">
            {cat.voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.category === 'cloned' || v.category === 'professional' ? ' (marka sesi)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Model</span>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)} aria-label="Model">
            {cat.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
                {m.turkish ? ' · Türkçe' : ''}
              </option>
            ))}
          </select>
        </label>
      </div>
      {est ? (
        <small className={`muted cost ${noCredit ? 'bad' : ''}`} data-testid="tts-estimate">
          {est.chars} karakter · ≈ {est.credits.toLocaleString('tr-TR')} kredi{est.remaining !== null ? ` · kalan ${est.remaining.toLocaleString('tr-TR')}` : ''}
          {!est.model.turkish ? ' · ⚠ bu model Türkçe listesinde yok' : ''}
          {tooLong ? ` · ⚠ en çok ${est.model.maxChars} karakter` : ''}
        </small>
      ) : null}
      <div className="row-wrap">
        <button
          className="btn tiny"
          disabled={!text.trim() || !!busy}
          onClick={async () => {
            setBusy('Örnek hazırlanıyor…');
            try {
              const r = await api.ttsSample(text, voiceId, modelId);
              setSample(fileHref(r.file));
            } catch (e) {
              toast((e as Error).message, 'error');
            } finally {
              setBusy(null);
            }
          }}
          title="İlk cümleyi dinle (küçük bir kredi harcar)"
        >
          <Play size={13} /> Örneği dinle
        </button>
        <button className="btn primary tiny" disabled={!text.trim() || !!busy || !!noCredit || tooLong} onClick={() => void run()}>
          <Mic2 size={13} /> {targetItem ? 'Yeniden üret' : `Üret ve ${formatTime(playhead)}'a ekle`}
        </button>
      </div>
      {sample ? <audio src={sample} controls autoPlay style={{ width: '100%' }} /> : null}
      {busy ? (
        <p className="hint small">
          <Loader2 size={12} className="spin" /> {busy}
        </p>
      ) : null}
      <small className="muted">Aynı metin, ses ve model tekrar istenirse kredi harcanmaz. Üretilen ses bu Mac'te saklanır; servis kapansa da projede kalır.</small>
    </div>
  );
};

const ImageForm: React.FC<{ onDone: () => void; openConnections: () => void }> = ({ onDone, openConnections }) => {
  const { project } = useProject();
  const { library, toast } = useApp();
  const photos = useMemo(() => [...library.values()].filter((a) => a.kind === 'image' && a.role === 'media' && a.status === 'ready').sort((a, b) => b.importedAt.localeCompare(a.importedAt)), [library]);
  const [assetId, setAssetId] = useState('');
  const [prompt, setPrompt] = useState('');
  const [aspect, setAspect] = useState<string>('');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  useEffect(() => {
    api.connections().then((l) => setConnected(!!l.find((c) => c.id === 'gemini')?.configured), () => setConnected(false));
  }, []);
  useEffect(() => {
    if (!assetId && photos[0]) setAssetId(photos[0].id);
  }, [photos]);
  if (connected === false) return <NotConnected name="Google Gemini (Nano Banana 2)" open={openConnections} />;
  const src = library.get(assetId);
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.backgrounds(project.id, { assetId, prompt, aspectRatio: aspect || null, count: 2 });
      toast(r.running ? 'Bu istek zaten sürüyor.' : '2 seçenek hazır; beğendiğinizi onaylayın.');
      setConfirm(false);
      onDone();
    } catch (e) {
      toast((e as Error).message, 'error');
      onDone();
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      {!photos.length ? <p className="muted small">Önce Medya'ya bir ürün fotoğrafı ekleyin.</p> : null}
      <label className="field">
        <span>Ürün fotoğrafı</span>
        <select value={assetId} onChange={(e) => setAssetId(e.target.value)} aria-label="Ürün fotoğrafı">
          {photos.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Yeni arka plan: ör. “güneşli bir kafe masası, sabah ışığı”" aria-label="Arka plan tarifi" />
      <label className="field">
        <span>Oran</span>
        <select value={aspect} onChange={(e) => setAspect(e.target.value)} aria-label="Oran">
          <option value="">Fotoğrafın kendi oranı</option>
          <option value="4:5">4:5 (post)</option>
          <option value="9:16">9:16 (Story/Reels)</option>
          <option value="1:1">1:1</option>
          <option value="16:9">16:9</option>
        </select>
      </label>
      {!confirm ? (
        <button className="btn primary tiny" disabled={!src || prompt.trim().length < 3 || busy} onClick={() => setConfirm(true)}>
          <Sparkles size={13} /> 2 seçenek üret…
        </button>
      ) : (
        <div className="confirm-box">
          <div className="row">
            {src?.poster ? <img src={fileHref(src.poster)} alt="" className="confirm-thumb" /> : null}
            <small>
              Google'a gönderilecek: <b>{src?.name}</b> (en çok 1536 px). 2 görsel üretilecek; ücret Google AI Studio fiyatlandırmasına göre. Ürün, logo, etiket ve ambalajın korunması istenir; sonucu
              onaylamadan Medya'ya eklenmez.
            </small>
          </div>
          <div className="row-wrap">
            <button className="btn primary tiny" disabled={busy} onClick={() => void run()}>
              {busy ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Onaylıyorum, üret
            </button>
            <button className="btn tiny ghost" onClick={() => setConfirm(false)}>
              Vazgeç
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

const Results: React.FC<{ gen: Generation; library: Map<string, import('../../src/core/schema').Asset>; onApproved: () => void }> = ({ gen, library, onApproved }) => {
  const { apply, frame } = useProject();
  return (
    <div className="gen-results">
      {gen.resultAssetIds.map((id) => {
        const a = library.get(id);
        const approved = gen.approvedAssetIds.includes(id);
        return (
          <div key={id} className={`gen-result ${approved ? 'ok' : ''}`}>
            {a?.poster ? <img src={fileHref(a.poster)} alt="" /> : <div className="ref-wait"><Loader2 size={12} className="spin" /></div>}
            {approved ? (
              <div className="row-wrap">
                <button className="link small" onClick={() => apply([{ type: 'clips.add', assetIds: [id] }])}>
                  Ana ize
                </button>
                <button className="link small" onClick={() => apply([{ type: 'overlay.add', assetId: id, at: frame / FPS, duration: 2 }])}>
                  <Layers size={11} /> Üst ize
                </button>
              </div>
            ) : (
              <button className="btn tiny" onClick={async () => (await api.approveGeneration(gen.id, [id]), onApproved())}>
                <Check size={12} /> Onayla
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
};
