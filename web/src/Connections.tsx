import React, { useEffect, useState } from 'react';
import { CheckCircle2, KeyRound, Loader2, Plug, RefreshCw, Trash2, XCircle } from 'lucide-react';
import { api, type Conn, type TtsCatalog } from './api';
import { useApp } from './state';
import { Modal } from './ui';

const SOURCE: Record<string, string> = { anahtarlik: 'Mac Anahtar Zinciri', dosya: 'gizli dosya (yalnız bu kullanıcı)', ortam: 'ortam değişkeni' };

/** Ayarlar → Bağlantılar: dış servislerin durumu, anahtarları ve ayarları. Anahtarın kendisi asla gösterilmez. */
export const ConnectionsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { toast } = useApp();
  const [list, setList] = useState<Conn[] | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [cat, setCat] = useState<TtsCatalog | null>(null);
  const load = async (test = true) => setList(await api.connections(test));
  useEffect(() => {
    void load(true);
  }, []);
  const el = list?.find((c) => c.id === 'elevenlabs');
  useEffect(() => {
    if (el?.configured && el.status?.ok && !cat) api.ttsCatalog().then(setCat, () => undefined);
  }, [el?.configured, el?.status?.ok]);

  const save = async (c: Conn) => {
    setBusy(c.id);
    try {
      const r = await api.setConnection(c.id, key);
      setList(r.connections.map((x) => (x.id === c.id ? { ...x, status: r.status } : x)));
      toast(r.status.ok ? `${c.name} bağlandı` : `${c.name}: ${r.status.detail}`, r.status.ok ? 'ok' : 'error');
      if (r.status.ok) setEditing(null);
      setKey('');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };
  const test = async (c: Conn) => {
    setBusy(c.id);
    const st = await api.testConnection(c.id).catch((e) => ({ ok: false, detail: (e as Error).message }));
    setList((l) => l?.map((x) => (x.id === c.id ? { ...x, status: st } : x)) ?? null);
    setBusy(null);
  };
  const remove = async (c: Conn) => {
    if (!window.confirm(`${c.name} anahtarı bu Mac'ten silinsin mi?`)) return;
    setList((await api.removeConnection(c.id)).connections);
  };

  return (
    <Modal title="Bağlantılar" onClose={onClose} width={720}>
      <p className="hint">
        Temel kurgu hiçbir bağlantı gerektirmez. Bağlantılar yalnız seçtiğiniz üretim işlerinde kullanılır; ücretli bir iş başlamadan önce ne gönderileceği ve tahmini maliyet gösterilir.
        Anahtarlar yalnız bu Mac'te saklanır; tarayıcıya, proje dosyalarına ve loglara yazılmaz.
      </p>
      {!list ? (
        <p className="hint">
          <Loader2 size={13} className="spin" /> Bağlantılar deneniyor…
        </p>
      ) : (
        <div className="conn-list">
          {list.map((c) => (
            <div key={c.id} className={`conn ${c.configured ? (c.status?.ok === false ? 'bad' : 'ok') : ''}`} data-conn={c.id}>
              <div className="row-between">
                <b>
                  <Plug size={14} /> {c.name} {!c.verified ? <span className="badge warn">doğrulanmadı</span> : null}
                </b>
                <span className="conn-state small">
                  {busy === c.id ? (
                    <Loader2 size={13} className="spin" />
                  ) : c.configured ? (
                    c.status?.ok === false ? (
                      <>
                        <XCircle size={13} /> {c.status.detail}
                      </>
                    ) : (
                      <>
                        <CheckCircle2 size={13} /> {c.status?.detail ?? 'Bağlı'}
                      </>
                    )
                  ) : (
                    'Bağlı değil'
                  )}
                </span>
              </div>
              <small className="muted">{c.capabilities.join(' · ')}</small>
              {c.configured ? (
                <small className="muted">
                  Anahtar: {c.hint} · {SOURCE[c.source ?? ''] ?? c.source}
                </small>
              ) : null}
              {c.note ? <small className="impact-warn">{c.note}</small> : null}
              {c.id === 'anthropic' && c.usage ? (
                <small className="muted">
                  Uygulama içi komutlar (sizin API anahtarınız): toplam {c.usage.commands} komut ≈ {(c.usage.usd * 100).toFixed(1).replace('.', ',')} sent · bugün {c.usage.todayCommands} komut. Claude Code ise kendi
                  aboneliğinizle MCP üzerinden çalışır; onun maliyeti burada görünmez.
                </small>
              ) : null}
              {c.id === 'gemini' && c.configured ? (
                <label className="field">
                  <span>Görsel modeli</span>
                  <select
                    value={c.settings.model}
                    onChange={async (e) => {
                      await api.connectionSettings({ gemini: { model: e.target.value } });
                      await load(false);
                    }}
                  >
                    {(c.settings.models ?? []).map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {c.id === 'elevenlabs' && cat ? (
                <div className="row-wrap">
                  <label className="field">
                    <span>Varsayılan ses</span>
                    <select value={c.settings.voiceId ?? cat.defaultVoiceId ?? ''} onChange={async (e) => (await api.connectionSettings({ elevenlabs: { voiceId: e.target.value } }), await load(false))}>
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
                    <select value={c.settings.modelId ?? cat.defaultModelId ?? ''} onChange={async (e) => (await api.connectionSettings({ elevenlabs: { modelId: e.target.value } }), await load(false))}>
                      {cat.models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                          {m.turkish ? ' · Türkçe' : ''} · ×{m.costMultiplier} kredi
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
              {c.id === 'youtube' && c.configured ? (
                <div className="row-wrap">
                  {c.account ? (
                    <button
                      className="btn tiny ghost"
                      onClick={async () => {
                        if (!window.confirm('YouTube hesabının bağlantısı kesilsin mi? (İstemci kimliği kalır)')) return;
                        await api.disconnectYoutube();
                        await load(true);
                      }}
                    >
                      Hesap bağlantısını kes
                    </button>
                  ) : (
                    <button
                      className="btn tiny primary"
                      onClick={() => {
                        const w = window.open('/api/youtube/baglan', 'youtube-baglan', 'width=520,height=680');
                        const done = (e: MessageEvent) => {
                          if (e.data === 'youtube-baglandi') {
                            window.removeEventListener('message', done);
                            void load(true);
                          }
                        };
                        window.addEventListener('message', done);
                        if (!w) location.href = '/api/youtube/baglan';
                      }}
                    >
                      Hesabı bağla
                    </button>
                  )}
                  <small className="muted">Yükleme yalnız onaylı paketten ve açık onayınızla yapılır.</small>
                </div>
              ) : null}
              {editing === c.id ? (
                <div className="row-wrap">
                  <input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={c.id === 'higgsfield' ? 'KEY_ID:SECRET' : c.id === 'youtube' ? 'İSTEMCİ_KİMLİĞİ:GİZLİ_ANAHTAR' : 'Anahtarı yapıştırın'} autoComplete="off" aria-label={`${c.name} anahtarı`} />
                  <button className="btn primary tiny" disabled={key.trim().length < 4 || busy === c.id} onClick={() => void save(c)}>
                    Kaydet ve dene
                  </button>
                  <button className="btn tiny ghost" onClick={() => (setEditing(null), setKey(''))}>
                    Vazgeç
                  </button>
                  <small className="muted">Nereden: {c.where}</small>
                </div>
              ) : (
                <div className="row-wrap">
                  <button className="btn tiny" onClick={() => setEditing(c.id)}>
                    <KeyRound size={13} /> {c.configured ? 'Anahtarı değiştir' : 'Anahtar ekle'}
                  </button>
                  {c.configured ? (
                    <>
                      <button className="btn tiny ghost" onClick={() => void test(c)}>
                        <RefreshCw size={13} /> Dene
                      </button>
                      {c.source !== 'ortam' ? (
                        <button className="btn tiny ghost danger" onClick={() => void remove(c)}>
                          <Trash2 size={13} /> Kaldır
                        </button>
                      ) : null}
                    </>
                  ) : null}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
};
