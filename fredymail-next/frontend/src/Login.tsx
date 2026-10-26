import { useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { Icon, Logo } from "./ui";

export function Login({ totpRequired, onDone }: { totpRequired: boolean; onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [totp, setTotp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/api/auth/login", { username, password, totp: totpRequired ? totp : null });
      onDone();
    } catch (err) {
      const ae = err as ApiError;
      setError(ae.status === 429 ? ae.message : ae.status === 401 ? "Kullanıcı adı, parola veya kod hatalı." : ae.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="login-wrap">
      <section className="login-art" aria-hidden="true">
        <div className="brand">
          <Logo size={42} />
          <span className="brand-name"><b>FredyMail</b><small>Intelligence</small></span>
        </div>
        <div style={{ position: "relative", zIndex: 1 }}>
          <h2>Yıllarca biriken postanız, tek bir sakin çalışma masasında.</h2>
          <ul>
            <li><Icon name="search" size={18} /> Türkçe/İngilizce eş anlamlılarla, eklerin içinde bile arama</li>
            <li><Icon name="sparkle" size={18} /> Doğal dille sorun: “bu ay en çok kimden mail aldım?”</li>
            <li><Icon name="reply" size={18} /> Yanıt bekleyenler, yapılacaklar ve taslaklar tek yerde</li>
            <li><Icon name="check" size={18} /> Salt okunur: hiçbir mail gönderilmez, klasörleriniz değişmez</li>
          </ul>
        </div>
        <span className="small" style={{ color: "#8fb3a3", position: "relative", zIndex: 1 }}>Kişisel posta arşivi · yalnızca sizin sunucunuzda</span>
      </section>
      <div className="login-side">
      <form className="login-card" onSubmit={submit} aria-labelledby="login-title">
        <div className="brand">
          <Logo />
          <span className="brand-name"><b>FredyMail</b><small>Intelligence</small></span>
        </div>
        <h1 id="login-title">Tekrar hoş geldiniz</h1>
        <p className="muted">Akıllı posta çalışma masanıza giriş yapın.</p>
        <label className="field">
          <span>Kullanıcı adı</span>
          <input autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} required autoFocus />
        </label>
        <label className="field">
          <span>Parola</span>
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {totpRequired && (
          <label className="field">
            <span>Doğrulama kodu (6 hane)</span>
            <input inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={totp} onChange={(e) => setTotp(e.target.value)} required />
          </label>
        )}
        {error && (
          <div className="banner banner-error" role="alert">
            <Icon name="warn" size={16} />
            <div className="banner-body">{error}</div>
          </div>
        )}
        <button className="btn primary block lg" disabled={busy}>
          {busy ? "Giriş yapılıyor…" : "Giriş yap"}
        </button>
        <p className="muted xs mt">Bu sistem mail göndermez, sunucudaki klasörlerinize ve kurallarınıza dokunmaz.</p>
      </form>
      </div>
    </main>
  );
}
