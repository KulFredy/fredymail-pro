"""Web Push: RFC 8291 şifreleme, VAPID imzası, abonelik güvenliği ve yeni mail bildirimi (ağ çağrısı yok)."""

from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import httpx
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives.asymmetric.utils import encode_dss_signature
from sqlalchemy import func, select

from fredymail.models import KeyValue, Message, PushSubscription
from fredymail.notify import webpush as wp

UA_PUB = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
AUTH = "BTBZMqHH6r4Tts7J_aSIgg"


def test_encrypt_matches_rfc8291_vector():
    as_priv = ec.derive_private_key(int.from_bytes(wp.unb64u("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"), "big"),
                                    ec.SECP256R1())
    out = wp.encrypt(b"When I grow up, I want to be a watermelon", UA_PUB, AUTH,
                     salt=wp.unb64u("DGv6ra1nlYgDCS1FRnbzlw"), server_key=as_priv)
    assert wp.b64u(out) == ("DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInm"
                            "YWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQ"
                            "exSgSxsj_Qulcy4a-fN")


def test_vapid_signature_verifies(db):
    priv, pub = wp.vapid_keys(db)
    assert wp.vapid_keys(db)[1] == pub  # anahtar bir kez üretilir, sonra aynı kalır
    h = wp.vapid_header(priv, pub, "https://fcm.googleapis.com/fcm/send/abc", "mailto:a@b.test")
    token = h.split("t=")[1].split(",")[0]
    head, claims, sig = token.split(".")
    assert json.loads(wp.unb64u(claims))["aud"] == "https://fcm.googleapis.com"
    raw = wp.unb64u(sig)
    key = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), wp.unb64u(pub))
    key.verify(encode_dss_signature(int.from_bytes(raw[:32], "big"), int.from_bytes(raw[32:], "big")),
               f"{head}.{claims}".encode(), ec.ECDSA(hashes.SHA256()))


def test_only_known_push_services_allowed():
    assert wp.endpoint_allowed("https://fcm.googleapis.com/fcm/send/x")
    assert wp.endpoint_allowed("https://web.push.apple.com/QG")
    assert wp.endpoint_allowed("https://wns2-db5p.notify.windows.com/w/?token=x")
    for bad in ("http://fcm.googleapis.com/x", "https://evil.test/x", "https://fcm.googleapis.com.evil.test/x",
                "https://127.0.0.1/x", "https://api:8080/api/x"):
        assert not wp.endpoint_allowed(bad), bad


def test_new_mail_notifications(db, synced, settings):
    sent = []

    def handler(req):
        sent.append(req)
        return httpx.Response(410 if "gone" in str(req.url) else 201)

    client = httpx.Client(transport=httpx.MockTransport(handler))
    assert wp.notify_new_mail(db, settings, client) == 0  # ilk çalışma: yalnızca başlangıç noktası
    db.add(PushSubscription(endpoint="https://fcm.googleapis.com/fcm/send/ok", p256dh=UA_PUB, auth=AUTH, failures=0))
    db.add(PushSubscription(endpoint="https://fcm.googleapis.com/fcm/send/gone", p256dh=UA_PUB, auth=AUTH, failures=0))
    db.commit()
    assert wp.notify_new_mail(db, settings, client) == 0 and not sent  # yeni mail yok

    recent = db.execute(select(Message).where(Message.is_from_me.is_(False),
                                              Message.date >= datetime.now(UTC) - timedelta(days=3))
                        .order_by(Message.id)).scalars().all()
    assert recent
    db.merge(KeyValue(key="push_last_message_id", value={"id": recent[0].id - 1}))
    db.commit()
    n = wp.notify_new_mail(db, settings, client)
    assert n == len(recent)
    assert sent and all(r.headers["Content-Encoding"] == "aes128gcm" and r.headers["Authorization"].startswith("vapid t=")
                        for r in sent)
    # süresi dolan (410) abonelik silinir; diğeri kalır
    left = db.execute(select(PushSubscription.endpoint)).scalars().all()
    assert left == ["https://fcm.googleapis.com/fcm/send/ok"]
    # aynı mailler ikinci kez bildirilmez
    sent.clear()
    assert wp.notify_new_mail(db, settings, client) == 0 and not sent
    assert db.execute(select(func.max(Message.id))).scalar_one() == db.get(KeyValue, "push_last_message_id").value["id"]


def test_subscribe_api_validates(db, synced, monkeypatch):
    from fastapi.testclient import TestClient

    from fredymail.api.main import create_app
    from fredymail.config import get_settings
    from fredymail.security.auth import hash_password

    s = get_settings()
    monkeypatch.setattr(s, "admin_password_hash", hash_password("dogru-parola-uzun-1"))
    c = TestClient(create_app())
    H = {"Origin": "http://testserver", "X-Requested-With": "fredymail"}
    assert c.get("/api/push/config").status_code == 401
    c.post("/api/auth/login", json={"username": "fatih", "password": "dogru-parola-uzun-1"}, headers=H)
    cfg = c.get("/api/push/config").json()
    assert len(wp.unb64u(cfg["public_key"])) == 65 and cfg["subscriptions"] == 0
    bad = c.post("/api/push/subscribe", json={"endpoint": "https://evil.test/collect-everything",
                                               "keys": {"p256dh": UA_PUB, "auth": AUTH}}, headers=H)
    assert bad.status_code == 400
    ok = c.post("/api/push/subscribe", json={"endpoint": "https://fcm.googleapis.com/fcm/send/dev1",
                                              "keys": {"p256dh": UA_PUB, "auth": AUTH}, "label": "Mac"}, headers=H)
    assert ok.status_code == 200 and c.get("/api/push/config").json()["subscriptions"] == 1
    c.post("/api/push/unsubscribe", json={"endpoint": "https://fcm.googleapis.com/fcm/send/dev1"}, headers=H)
    assert c.get("/api/push/config").json()["subscriptions"] == 0
