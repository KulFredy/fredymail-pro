import { useState, type FormEvent } from "react";
import { api, ApiError } from "./api";
import { Icon } from "./ui";

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
      <form className="login-card" onSubmit={submit} aria-labelledby="login-title">
        <div className="brand big">
          <span className="brand-mark">
            <Icon name="unread" size={22} />
          </span>
          <span>FredyMail</span>
        </div>
        <h1 id="login-title">Giriş yap</h1>
        <p className="muted">Akıllı posta çalışma masanız. Bu sistem mail göndermez, sunucudaki klasörlerinize dokunmaz.</p>
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
        <button className="btn primary block" disabled={busy}>
          {busy ? "Giriş yapılıyor…" : "Giriş yap"}
        </button>
      </form>
    </main>
  );
}
