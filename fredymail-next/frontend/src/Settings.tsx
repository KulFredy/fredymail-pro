import { useEffect, useState } from "react";
import { api, ApiError } from "./api";
import { useStore } from "./store";
import { folderLabel, fmtRelative } from "./util";
import { Banner, Icon, Spinner } from "./ui";

export function SettingsPage() {
  const { sync, ai, folders, tags, refreshSync, refreshAi, refreshFolders, refreshTags, refreshCounts, toast, meta } = useStore();
  const [settings, setSettings] = useState<Record<string, unknown> | null>(null);
  const [newTag, setNewTag] = useState({ name: "", color: "#0f7a4f" });
  const [muted, setMuted] = useState<string[] | null>(null);
  const loadMuted = () => api.get<{ emails: string[] }>("/api/followups/muted").then((r) => setMuted(r.emails)).catch(() => setMuted([]));

  useEffect(() => {
    refreshSync();
    refreshAi();
    refreshFolders();
    api.get<Record<string, unknown>>("/api/settings").then(setSettings).catch(() => setSettings({}));
    loadMuted();
  }, [refreshSync, refreshAi, refreshFolders]);

  async function act<T>(p: Promise<T>, ok: string, after?: () => void) {
    try {
      await p;
      toast(ok, "ok");
      after?.();
    } catch (e) {
      toast((e as ApiError).message, "error");
    }
  }

  return (
    <main className="page" aria-label="Ayarlar">
      <div className="page-inner">
      <div className="page-head">
        <div>
          <h1>Ayarlar & Senkron</h1>
          <p className="lead">Senkron durumu, klasörler, AI gizliliği ve etiketler.{meta && ` · sürüm ${meta.version}`}</p>
        </div>
      </div>
      <div className="settings-grid">
        <section className="card">
          <h2>Senkron durumu</h2>
          {!sync ? <Spinner /> : (
            <>
              {!sync.worker.healthy && (
                <Banner kind="warn">
                  Arka plan senkron servisi (worker) {sync.worker.age_seconds == null ? "henüz kalp atışı göndermedi" : `${fmtRelative(new Date(Date.now() - sync.worker.age_seconds * 1000).toISOString())} son görüldü`}. Yeni mailler gelmeyebilir.
                </Banner>
              )}
              {!sync.meilisearch && <Banner kind="warn">Arama motoru (Meilisearch) erişilemiyor; basit veritabanı araması kullanılıyor.</Banner>}
              {sync.source !== "demo" && !sync.sync_enabled && (
                <Banner kind="info">Canlı posta senkronu kapalı (FM_SYNC_ENABLED=false). Açmadan önce `fredymail sync-plan` ile kapsamı kontrol edin.</Banner>
              )}
              <dl className="kv">
                <dt>Kaynak</dt><dd>{sync.source === "demo" ? "Demo verisi" : "IMAP (salt okunur)"}</dd>
                <dt>Senkron aralığı</dt><dd>{Math.round(sync.interval_seconds / 60)} dk · kapsam: {sync.sync_since}</dd>
                <dt>Toplam mail</dt><dd>{sync.messages_total.toLocaleString("tr-TR")}</dd>
                <dt>İndeks bekleyen</dt><dd>{sync.index_pending}</dd>
                <dt>Worker</dt><dd>{sync.worker.healthy ? <span className="ok-text">çalışıyor</span> : <span className="warn-text">yanıt yok</span>}{sync.worker.last_error ? ` · son hata: ${sync.worker.last_error}` : ""}</dd>
                <dt>Arama motoru</dt><dd>{sync.meilisearch ? <span className="ok-text">çalışıyor</span> : <span className="warn-text">erişilemiyor</span>}</dd>
              </dl>
              <div className="row gap">
                <button className="btn primary" onClick={() => act(api.post("/api/sync/request"), "Senkron isteği alındı", refreshSync)}>
                  <Icon name="refresh" size={15} /> Şimdi senkronla
                </button>
                <button className="btn" onClick={refreshSync}>Durumu yenile</button>
              </div>
              <h3>Son çalıştırmalar</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Klasör</th><th>Başlangıç</th><th>Durum</th><th>Alınan</th><th>Yeni</th><th>Tekrar</th></tr></thead>
                  <tbody>
                    {sync.runs.map((r) => (
                      <tr key={r.id}>
                        <td>{r.folder === "INBOX" ? "Gelen Kutusu" : r.folder}</td>
                        <td>{fmtRelative(r.started_at)}</td>
                        <td><span className={`pill ${r.status === "ok" ? "ok" : r.status === "partial" ? "warn" : r.status === "running" ? "" : "err"}`} title={r.error ?? ""}>{r.status}</span></td>
                        <td>{r.fetched}</td><td>{r.created}</td><td>{r.duplicates}</td>
                      </tr>
                    ))}
                    {!sync.runs.length && <tr><td colSpan={6} className="muted">Henüz senkron çalışmadı.</td></tr>}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h2>Klasörler</h2>
          <p className="muted small">Senkron yalnızca okur; sunucudaki klasör yapınız ve kurallarınız değişmez.</p>
          <ul className="folder-settings">
            {folders.map((f) => (
              <li key={f.id}>
                <div>
                  <div>{f.origin === "import" ? `Outlook arşivi / ${f.display_name}` : f.name === "INBOX" ? "Gelen Kutusu" : f.name}</div>
                  <div className="muted small">
                    {folderLabel(f) !== f.display_name ? `${folderLabel(f)} · ` : ""}{f.count} mail{f.server_count != null && f.origin === "server" ? ` (sunucuda ${f.server_count})` : ""}
                    {f.last_synced_at ? ` · ${fmtRelative(f.last_synced_at)}` : ""}
                    {f.status === "error" && <span className="text-danger"> · hata: {f.last_error}</span>}
                  </div>
                </div>
                <label className="switch" title={f.sync_enabled ? "Senkron açık" : "Senkron kapalı"}>
                  <input type="checkbox" checked={f.sync_enabled} aria-label={`${f.name} senkronu`}
                    onChange={(e) => act(api.patch(`/api/folders/${f.id}`, { sync_enabled: e.target.checked }), e.target.checked ? "Klasör senkrona eklendi" : "Klasör senkrondan çıkarıldı", refreshFolders)} />
                  <span />
                </label>
              </li>
            ))}
          </ul>
        </section>

        <section className="card">
          <h2>AI asistanı</h2>
          {!ai ? <Spinner /> : (
            <>
              <div className="row between">
                <div>
                  <div><strong>{ai.enabled ? "Açık" : "Kapalı"}</strong> {ai.configured ? `· ${ai.provider} / ${ai.model}${ai.model_heavy ? ` · güçlü: ${ai.model_heavy}` : ""}` : "· yapılandırılmamış"}</div>
                  {ai.endpoint_host && <div className="muted small">Uç nokta: {ai.endpoint_host}</div>}
                </div>
                {ai.configured && (
                  <label className="switch">
                    <input type="checkbox" checked={ai.enabled} aria-label="AI asistanı"
                      onChange={(e) => act(api.post("/api/ai/toggle", { enabled: e.target.checked }), e.target.checked ? "AI açıldı" : "AI kapatıldı", refreshAi)} />
                    <span />
                  </label>
                )}
              </div>
              <dl className="kv">
                <dt>Bugünkü kullanım</dt><dd>{ai.usage_today.calls} / {ai.limits.max_calls_per_day} çağrı</dd>
                <dt>Bugünkü maliyet</dt><dd>${ai.usage_today.cost_usd.toFixed(4)} / ${ai.limits.daily_budget_usd.toFixed(2)}</dd>
                <dt>Gönderim sınırı</dt><dd>en fazla {ai.limits.max_messages} mail, {ai.limits.max_total_chars.toLocaleString("tr-TR")} karakter</dd>
              </dl>
              <h3>Gizlilik</h3>
              <ul className="plain checks-list">
                <li><Icon name="check" size={14} /> AI yalnızca siz bir düğmeye bastığınızda çalışır (arka plan çağrısı yok)</li>
                <li><Icon name={ai.privacy.pii_redaction ? "check" : "warn"} size={14} /> IBAN, kart ve TC kimlik numaraları {ai.privacy.pii_redaction ? "maskelenir" : "maskelenmiyor"}</li>
                <li><Icon name="check" size={14} /> Ek içerikleri modele gönderilmez (yalnızca dosya adları)</li>
                <li><Icon name="check" size={14} /> Alıntılanmış eski yazışmalar kırpılır</li>
                <li><Icon name="check" size={14} /> E-postalardaki talimatlar uygulanmaz; kaynaklar doğrulanır</li>
              </ul>
            </>
          )}
        </section>

        <section className="card">
          <h2>Etiketler</h2>
          <ul className="tag-settings">
            {tags.map((t) => (
              <li key={t.id}>
                <span className="tag-dot" style={{ background: t.color }} />
                <span className="grow">{t.name}</span>
                <span className="muted small">{t.count}</span>
                <input type="color" value={t.color} aria-label={`${t.name} rengi`}
                  onChange={(e) => act(api.patch(`/api/tags/${t.id}`, { name: t.name, color: e.target.value }), "Renk güncellendi", refreshTags)} />
                <button className="icon-btn sm" aria-label={`${t.name} etiketini sil`}
                  onClick={() => window.confirm(`“${t.name}” etiketi silinsin mi? Maillerden kaldırılır.`) && act(api.del(`/api/tags/${t.id}`), "Etiket silindi", refreshTags)}>
                  <Icon name="trash" size={15} />
                </button>
              </li>
            ))}
            {!tags.length && <li className="muted small">Henüz etiket yok.</li>}
          </ul>
          <form className="row gap mt" onSubmit={(e) => { e.preventDefault(); if (newTag.name.trim()) act(api.post("/api/tags", newTag), "Etiket oluşturuldu", () => { setNewTag({ name: "", color: newTag.color }); refreshTags(); }); }}>
            <input className="grow" placeholder="Yeni etiket adı" value={newTag.name} onChange={(e) => setNewTag({ ...newTag, name: e.target.value })} aria-label="Yeni etiket adı" />
            <input type="color" value={newTag.color} onChange={(e) => setNewTag({ ...newTag, color: e.target.value })} aria-label="Etiket rengi" />
            <button className="btn" disabled={!newTag.name.trim()}>Ekle</button>
          </form>
        </section>

        <section className="card">
          <h2>Takipte gösterilmeyenler</h2>
          <p className="muted small">Bu adreslerden gelen mailler Yanıt Bekleyenler listesine girmez. Mailler silinmez, aramada görünür.</p>
          <ul className="tag-settings" data-testid="muted-senders">
            {(muted ?? []).map((e) => (
              <li key={e}>
                <span className="grow">{e}</span>
                <button className="btn sm ghost" onClick={() => act(api.post("/api/followups/muted", { email: e, muted: false }), "Yeniden takipte", () => { loadMuted(); refreshCounts(); })}>
                  Geri al
                </button>
              </li>
            ))}
            {muted && !muted.length && <li className="muted small">Liste boş. Yanıt Bekleyenler'de bir kartta “Bu göndereni gösterme” ile eklenir.</li>}
          </ul>
        </section>

        <section className="card wide">
          <h2>Yapılandırma (salt okunur)</h2>
          <p className="muted small">Ayarlar sunucudaki ortam değişkenlerinden gelir. Sırlar gösterilmez (***).</p>
          {!settings ? <Spinner /> : (
            <div className="table-wrap">
              <table className="table kvtable">
                <tbody>
                  {Object.entries(settings).map(([k, v]) => (
                    <tr key={k}><th>{k}</th><td><code>{typeof v === "object" ? JSON.stringify(v) : String(v)}</code></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
      </div>
    </main>
  );
}
