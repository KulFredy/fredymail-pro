import React, { useEffect, useState } from 'react';
import { Languages, Loader2, RefreshCw, RotateCcw } from 'lucide-react';
import { formatTime } from '../../src/core/timeline';
import { api } from './api';
import { useApp, useProject } from './state';

export const LANGS: { id: string; label: string }[] = [
  { id: 'tr', label: 'Türkçe' },
  { id: 'en', label: 'İngilizce' },
  { id: 'de', label: 'Almanca' },
  { id: 'fr', label: 'Fransızca' },
  { id: 'es', label: 'İspanyolca' },
  { id: 'it', label: 'İtalyanca' },
  { id: 'ar', label: 'Arapça' },
  { id: 'ru', label: 'Rusça' },
  { id: 'zh', label: 'Çince' },
  { id: 'ja', label: 'Japonca' },
];
export const langLabel = (id: string | undefined | null) => LANGS.find((l) => l.id === id)?.label ?? (id ? id.toUpperCase() : '—');
const usd = (n: number) => `≈ ${'$'}${n.toFixed(3)}`;

/**
 * Konuşmanın dili: otomatik algılanır; yanlışsa dil seçilip yeniden çözülür
 * (ör. İngilizce video Türkçe sanılıp anlamsız kelimeler çıktıysa).
 */
export const SpeechLang: React.FC<{ assetId: string }> = ({ assetId }) => {
  const { library, toast } = useApp();
  const a = library.get(assetId);
  const [pick, setPick] = useState('auto');
  if (!a) return null;
  const busy = a.transcript.status === 'pending' || a.transcript.status === 'running';
  return (
    <span className="spl" data-testid="speech-lang" onClick={(e) => e.stopPropagation()}>
      <small className="muted">Konuşma: {a.transcript.status === 'done' ? langLabel(a.transcript.language) : busy ? 'çözülüyor…' : '—'}</small>
      <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Konuşma dili" title="Yanlış dilde çözüldüyse doğru dili seçip yeniden çözün">
        <option value="auto">Otomatik</option>
        {LANGS.map((l) => (
          <option key={l.id} value={l.id}>
            {l.label}
          </option>
        ))}
      </select>
      <button
        className="icon-btn sm"
        disabled={busy}
        aria-label="Yeniden çöz"
        title="Bu dosyanın konuşmasını seçilen dilde yeniden yazıya dök (yerel, ücretsiz)"
        onClick={() =>
          api.transcribe(assetId, pick).then(
            () => toast(`Yeniden çözülüyor (${pick === 'auto' ? 'otomatik dil' : langLabel(pick)})`),
            (e) => toast((e as Error).message, 'error'),
          )
        }
      >
        {busy ? <Loader2 size={13} className="spin" /> : <RefreshCw size={13} />}
      </button>
    </span>
  );
};

type Est = Awaited<ReturnType<typeof api.translateEstimate>>;

/** Altyazı çevirisi (Claude): önce satır sayısı ve tahmini maliyet, onayla çevir, satır satır düzelt, orijinale dön */
export const CaptionTranslate: React.FC<{ openConnections?: () => void; autoEstimate?: number }> = ({ openConnections, autoEstimate }) => {
  const { project, apply } = useProject();
  const { library, toast } = useApp();
  const tr = project.captions.translation;
  const [lang, setLang] = useState(tr?.lang ?? 'tr');
  const [est, setEst] = useState<Est | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);

  const estimate = async () => {
    setBusy('Hesaplanıyor…');
    try {
      setEst(await api.translateEstimate(project.id, lang));
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  // Komut panelinden “altyazıyı Türkçeye çevir” gelince tahmin hemen gösterilir
  useEffect(() => {
    if (autoEstimate) void estimate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoEstimate]);

  const run = async () => {
    setBusy('Claude çeviriyor…');
    try {
      const r = await api.translate(project.id, lang);
      apply([{ type: 'captions.setTranslation', translation: r.translation }], { label: `Altyazı ${langLabel(lang)} çevirisi` });
      setNote(r.note || '');
      setEst(null);
      setOpen(true);
      toast(`Altyazı ${langLabel(lang)} oldu · ${usd(r.usage.usd)} · geri almak için ⌘Z`);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const srcLangs = est?.sourceLangs ?? [...new Set(project.clips.map((c) => library.get(c.assetId)?.transcript.language).filter((x): x is string => !!x))];
  const sameLang = srcLangs.length === 1 && srcLangs[0] === lang;
  const lines = tr ? Object.entries(tr.byAsset) : [];

  return (
    <div className="ctr" data-testid="caption-translate">
      <div className="ctr-head">
        <Languages size={15} />
        <b>Altyazı dili</b>
        <span className={`badge ${tr ? 'ok' : ''}`}>{tr ? `${langLabel(tr.lang)} çeviri` : `Orijinal${srcLangs.length ? ` (${srcLangs.map(langLabel).join(', ')})` : ''}`}</span>
      </div>
      <div className="row-wrap">
        <select value={lang} onChange={(e) => (setLang(e.target.value), setEst(null))} aria-label="Çeviri dili">
          {LANGS.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        {!est ? (
          <button className="btn tiny" disabled={!!busy} onClick={() => void estimate()}>
            <Languages size={13} /> {tr ? 'Yeniden çevir' : `${langLabel(lang)} altyazı yap`} (Claude)
          </button>
        ) : null}
        {tr ? (
          <button className="btn tiny ghost" onClick={() => apply([{ type: 'captions.setTranslation', translation: null }])} title="Çeviriyi kaldır; altyazı konuşmanın kendi dilinde">
            <RotateCcw size={13} /> Orijinale dön
          </button>
        ) : null}
      </div>
      {est ? (
        <div className="ctr-est" data-testid="translate-estimate">
          {est.pending ? <p className="impact-warn small">Konuşma hâlâ yazıya dökülüyor; bitmeden çevirmeyin.</p> : null}
          {!est.lines ? (
            <p className="small muted">Çevrilecek konuşma yok.</p>
          ) : (
            <>
              <small>
                {est.lines} altyazı satırı · {est.chars.toLocaleString('tr-TR')} karakter · tahmini {usd(est.usd)} ({est.model.replace(/^claude-(\w+)-(\d+)-(\d+).*$/, (_m, n: string, a: string, b: string) => `${n[0].toUpperCase()}${n.slice(1)} ${a}.${b}`)})
              </small>
              {sameLang ? <p className="impact-warn small">Konuşma zaten {langLabel(lang)} görünüyor. Yanlış dilde çözüldüyse önce dosyanın yanındaki dil seçiciyle doğru dili seçip yeniden çözün.</p> : null}
              <small className="muted">Gönderilen: yalnız konuşmanın yazıya dökülmüş metni (video veya ses gönderilmez).</small>
              <div className="row-wrap">
                {est.connected ? (
                  <button className="btn tiny primary" disabled={!!busy} onClick={() => void run()}>
                    Onayla ve çevir
                  </button>
                ) : (
                  <button className="btn tiny primary" onClick={openConnections} disabled={!openConnections}>
                    Claude'u bağla
                  </button>
                )}
                <button className="btn tiny ghost" onClick={() => setEst(null)}>
                  Vazgeç
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {busy ? (
        <p className="hint small">
          <Loader2 size={12} className="spin" /> {busy}
        </p>
      ) : null}
      {note ? <p className="impact-warn small">Claude notu: {note}</p> : null}
      {tr ? (
        <details className="ctr-lines" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
          <summary className="small">Çeviri satırları ({lines.reduce((n, [, s]) => n + s.length, 0)}) · tıklayıp düzeltin</summary>
          {lines.map(([assetId, segs]) => (
            <div key={assetId}>
              {lines.length > 1 ? <small className="muted ellipsis">{library.get(assetId)?.name}</small> : null}
              {segs.map((s, i) => (
                <label key={`${assetId}:${i}:${s.text}`} className="ctr-line">
                  <span className="mono muted">{formatTime(s.t0)}</span>
                  <input
                    defaultValue={s.text}
                    aria-label={`Çeviri satırı ${i + 1}`}
                    onBlur={(e) => e.target.value.trim() !== s.text && apply([{ type: 'captions.editTranslation', assetId, index: i, text: e.target.value.trim() }])}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                </label>
              ))}
            </div>
          ))}
        </details>
      ) : null}
    </div>
  );
};
