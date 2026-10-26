"""Tek kullanıcılı kimlik doğrulama.

- Parola: argon2id özeti ortam değişkeninde (FM_ADMIN_PASSWORD_HASH); düz parola hiçbir yerde tutulmaz.
- İsteğe bağlı TOTP (FM_TOTP_SECRET) — Google Authenticator vb.
- Oturum: rastgele 256-bit token, çerezde (HttpOnly, Secure, SameSite=Strict);
  veritabanında yalnızca HMAC-SHA256 özeti tutulur. Boşta kalma + mutlak süre sınırı.
- Kaba kuvvet koruması: IP başına ve global başarısız giriş sınırı.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import AuthSession, LoginAttempt

COOKIE_NAME = "fm_session"
_ph = PasswordHasher()
# Zamanlama farkını azaltmak için kullanıcı adı yanlışken de bir doğrulama yapılır
_DUMMY_HASH = _ph.hash(secrets.token_hex(16))


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(stored_hash: str, password: str) -> bool:
    try:
        return _ph.verify(stored_hash or _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False


def _token_hash(settings: Settings, token: str) -> str:
    key = (settings.session_secret or "").encode() or b"fm-dev-only"
    return hmac.new(key, token.encode(), hashlib.sha256).hexdigest()


def is_rate_limited(db: Session, settings: Settings, ip: str) -> bool:
    since = datetime.now(UTC) - timedelta(minutes=settings.login_window_minutes)
    per_ip = db.execute(select(func.count()).select_from(LoginAttempt).where(
        LoginAttempt.ip == ip, LoginAttempt.success.is_(False), LoginAttempt.created_at >= since)).scalar_one()
    total = db.execute(select(func.count()).select_from(LoginAttempt).where(
        LoginAttempt.success.is_(False), LoginAttempt.created_at >= since)).scalar_one()
    return per_ip >= settings.login_max_failures or total >= settings.login_max_failures * 6


def check_credentials(settings: Settings, username: str, password: str, totp: str | None) -> bool:
    user_ok = hmac.compare_digest(username.strip().lower().encode(), settings.admin_user.strip().lower().encode())
    pw_ok = verify_password(settings.admin_password_hash if user_ok else "", password)
    if not (user_ok and pw_ok and settings.admin_password_hash):
        return False
    if settings.totp_secret:
        import pyotp

        return bool(totp) and pyotp.TOTP(settings.totp_secret).verify(totp.strip(), valid_window=1)
    return True


def record_attempt(db: Session, ip: str, success: bool) -> None:
    db.add(LoginAttempt(ip=ip[:64], success=success))
    # eski kayıtları temizle
    db.execute(delete(LoginAttempt).where(LoginAttempt.created_at < datetime.now(UTC) - timedelta(days=7)))
    db.commit()


def create_session(db: Session, settings: Settings, ip: str, user_agent: str) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now(UTC)
    db.add(AuthSession(token_hash=_token_hash(settings, token), ip=ip[:64], user_agent=(user_agent or "")[:300],
                       last_seen_at=now, expires_at=now + timedelta(hours=settings.session_absolute_hours)))
    db.execute(delete(AuthSession).where(AuthSession.expires_at < now))
    db.commit()
    return token


def validate_session(db: Session, settings: Settings, token: str | None) -> AuthSession | None:
    if not token or len(token) > 200:
        return None
    s = db.execute(select(AuthSession).where(AuthSession.token_hash == _token_hash(settings, token))).scalar_one_or_none()
    if s is None:
        return None
    now = datetime.now(UTC)
    if s.expires_at < now or s.last_seen_at < now - timedelta(minutes=settings.session_idle_minutes):
        db.delete(s)
        db.commit()
        return None
    if now - s.last_seen_at > timedelta(minutes=1):
        s.last_seen_at = now
        db.commit()
    return s


def destroy_session(db: Session, settings: Settings, token: str | None) -> None:
    if token:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == _token_hash(settings, token)))
        db.commit()


def client_ip(settings: Settings, headers, peer: str | None) -> str:
    """Cloudflare Tunnel arkasında gerçek istemci IP'si CF-Connecting-IP'dedir.
    Bu başlık yalnızca FM_TRUST_PROXY=cloudflare iken dikkate alınır (aksi halde taklit edilebilir)."""
    if settings.trust_proxy == "cloudflare":
        v = headers.get("cf-connecting-ip")
        if v:
            return v.strip()[:64]
    return (peer or "unknown")[:64]
