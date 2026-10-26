"""Web Push bildirimleri (RFC 8030 / 8291 / 8292) — ek servis veya üçüncü taraf hesabı gerektirmez.

İçerik tarayıcının açık anahtarıyla uçtan uca şifrelenir (aes128gcm); push servisi (Google/Apple/Mozilla)
yalnızca şifreli baytı taşır. VAPID anahtarı ilk kullanımda üretilip veritabanında saklanır.
Abonelik adresi yalnızca bilinen push servislerine izin verilir (sunucunun keyfi adrese istek atması engellenir).
"""

from __future__ import annotations

import base64
import json
import logging
import os
import time
from datetime import UTC, datetime, timedelta
from urllib.parse import urlparse

import httpx
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import decode_dss_signature
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import KeyValue, Message, PushSubscription

log = logging.getLogger("fredymail.notify")

PUSH_HOSTS = ("fcm.googleapis.com", "android.googleapis.com", "updates.push.services.mozilla.com",
              "push.services.mozilla.com", "web.push.apple.com", ".push.apple.com", ".notify.windows.com")
_VAPID_KEY = "webpush_vapid"
_LAST_KEY = "push_last_message_id"
MAX_INDIVIDUAL = 3  # bundan fazla yeni mail tek bir özet bildirimde toplanır
RECENT = timedelta(days=3)  # eski tarihli içe aktarımlar bildirim üretmez


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def unb64u(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def endpoint_allowed(url: str) -> bool:
    p = urlparse(url)
    host = (p.hostname or "").lower()
    return p.scheme == "https" and any(host == h or (h.startswith(".") and host.endswith(h)) for h in PUSH_HOSTS)


def _pub_bytes(key: ec.EllipticCurvePublicKey) -> bytes:
    return key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)


def vapid_keys(db: Session) -> tuple[ec.EllipticCurvePrivateKey, str]:
    kv = db.get(KeyValue, _VAPID_KEY)
    if kv is None or not kv.value.get("private"):
        priv = ec.generate_private_key(ec.SECP256R1())
        d = priv.private_numbers().private_value.to_bytes(32, "big")
        kv = KeyValue(key=_VAPID_KEY, value={"private": b64u(d), "public": b64u(_pub_bytes(priv.public_key()))})
        db.merge(kv)
        db.commit()
        kv = db.get(KeyValue, _VAPID_KEY)
    priv = ec.derive_private_key(int.from_bytes(unb64u(kv.value["private"]), "big"), ec.SECP256R1())
    return priv, kv.value["public"]


def vapid_header(priv: ec.EllipticCurvePrivateKey, public_b64: str, endpoint: str, subject: str) -> str:
    p = urlparse(endpoint)
    header = b64u(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = b64u(json.dumps({"aud": f"{p.scheme}://{p.netloc}", "exp": int(time.time()) + 12 * 3600,
                              "sub": subject}, separators=(",", ":")).encode())
    r, s = decode_dss_signature(priv.sign(f"{header}.{claims}".encode(), ec.ECDSA(hashes.SHA256())))
    sig = b64u(r.to_bytes(32, "big") + s.to_bytes(32, "big"))
    return f"vapid t={header}.{claims}.{sig}, k={public_b64}"


def _hkdf(salt: bytes, ikm: bytes, info: bytes, length: int) -> bytes:
    return HKDF(algorithm=hashes.SHA256(), length=length, salt=salt, info=info).derive(ikm)


def encrypt(payload: bytes, p256dh: str, auth: str, *, salt: bytes | None = None,
            server_key: ec.EllipticCurvePrivateKey | None = None) -> bytes:
    """RFC 8291 aes128gcm: tek kayıt, dolgu yok."""
    ua_pub = unb64u(p256dh)
    ua_key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), ua_pub)
    server_key = server_key or ec.generate_private_key(ec.SECP256R1())
    as_pub = _pub_bytes(server_key.public_key())
    secret = server_key.exchange(ec.ECDH(), ua_key)
    ikm = _hkdf(unb64u(auth), secret, b"WebPush: info\x00" + ua_pub + as_pub, 32)
    salt = salt or os.urandom(16)
    cek = _hkdf(salt, ikm, b"Content-Encoding: aes128gcm\x00", 16)
    nonce = _hkdf(salt, ikm, b"Content-Encoding: nonce\x00", 12)
    body = AESGCM(cek).encrypt(nonce, payload + b"\x02", None)
    return salt + (4096).to_bytes(4, "big") + bytes([len(as_pub)]) + as_pub + body


def send(db: Session, settings: Settings, sub: PushSubscription, data: dict,
         client: httpx.Client | None = None) -> bool:
    """Tek aboneliğe bildirim gönderir. Abonelik geçersizse (404/410) siler. Yeniden deneme yok."""
    if not endpoint_allowed(sub.endpoint):
        db.delete(sub)
        return False
    priv, pub = vapid_keys(db)
    subject = f"mailto:{settings.account_email}" if settings.account_email else "mailto:admin@localhost"
    body = encrypt(json.dumps(data, ensure_ascii=False).encode(), sub.p256dh, sub.auth)
    headers = {"Authorization": vapid_header(priv, pub, sub.endpoint, subject), "Content-Encoding": "aes128gcm",
               "Content-Type": "application/octet-stream", "TTL": "86400", "Urgency": "high"}
    host = urlparse(sub.endpoint).hostname
    try:
        r = (client or httpx).post(sub.endpoint, content=body, headers=headers, timeout=10)
    except httpx.HTTPError as e:
        sub.failures += 1
        log.warning("bildirim gönderilemedi servis=%s hata=%s", host, type(e).__name__)
        return False
    if r.status_code in (404, 410):
        log.info("süresi dolmuş bildirim aboneliği silindi servis=%s", host)
        db.delete(sub)
        return False
    if r.status_code >= 300:
        sub.failures += 1
        log.warning("bildirim reddedildi servis=%s durum=%s", host, r.status_code)
        if sub.failures >= 20:
            db.delete(sub)
        return False
    sub.failures, sub.last_success_at = 0, datetime.now(UTC)
    return True


def send_all(db: Session, settings: Settings, data: dict, client: httpx.Client | None = None) -> tuple[int, int]:
    ok = fail = 0
    for sub in db.execute(select(PushSubscription)).scalars().all():
        if send(db, settings, sub, data, client):
            ok += 1
        else:
            fail += 1
    db.commit()
    return ok, fail


def notify_new_mail(db: Session, settings: Settings, client: httpx.Client | None = None) -> int:
    """Son bildirimden bu yana gelen mailleri bildirir. İlk çalışmada yalnızca başlangıç noktasını kaydeder."""
    kv = db.get(KeyValue, _LAST_KEY)
    top = db.execute(select(func.max(Message.id))).scalar_one() or 0
    if kv is None:
        db.merge(KeyValue(key=_LAST_KEY, value={"id": top}))
        db.commit()
        return 0
    last = int(kv.value.get("id", 0))
    if top <= last:
        return 0
    kv.value = {"id": top}
    has_subs = db.execute(select(func.count()).select_from(PushSubscription)).scalar_one() > 0
    new = [] if not has_subs else db.execute(
        select(Message).where(Message.id > last, Message.id <= top, Message.is_from_me.is_(False),
                              Message.deleted_on_server.is_(False), ~Message.dedupe_key.startswith("err:"),
                              Message.date >= datetime.now(UTC) - RECENT)
        .order_by(Message.date.desc().nulls_last()).limit(50)).scalars().all()
    db.commit()
    if not new:
        return 0
    if len(new) <= MAX_INDIVIDUAL:
        for m in new:
            send_all(db, settings, {"title": m.from_name or m.from_email or "Yeni mail",
                                    "body": (m.subject or "(konu yok)") + (" · ekli" if m.has_attachments else ""),
                                    "url": f"/#/mail?view=inbox&msg={m.id}", "tag": f"m{m.id}"}, client)
    else:
        names = list(dict.fromkeys((m.from_name or m.from_email or "") for m in new))
        more = f" ve {len(names) - 3} kişi daha" if len(names) > 3 else ""
        send_all(db, settings, {"title": f"{len(new)} yeni mail", "body": ", ".join(names[:3]) + more,
                                "url": "/#/mail?view=inbox", "tag": "batch"}, client)
    return len(new)
