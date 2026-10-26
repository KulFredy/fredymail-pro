from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from fredymail.config import get_settings
from fredymail.models import Message
from fredymail.security.auth import hash_password

PASSWORD = "dogru-at-pil-zımba-42"
H = {"Origin": "http://testserver", "X-Requested-With": "fredymail"}


@pytest.fixture
def client(db, synced, meili, monkeypatch):
    from fredymail.search.meili import index_dirty

    s = get_settings()
    monkeypatch.setattr(s, "admin_password_hash", hash_password(PASSWORD))
    monkeypatch.setattr(s, "totp_secret", "")
    index_dirty(db, meili)
    from fredymail.api import deps
    from fredymail.api.main import create_app

    deps._meili.cache_clear()
    monkeypatch.setattr(deps, "_meili", lambda: meili)
    return TestClient(create_app())


def login(c):
    r = c.post("/api/auth/login", json={"username": "fatih", "password": PASSWORD}, headers=H)
    assert r.status_code == 200, r.text
    return c


def msg_id(db, subject_like):
    return db.execute(select(Message.id).where(Message.subject.like(subject_like))).scalars().first()


# ------------------------------------------------------------------ güvenlik


def test_api_requires_auth(client):
    for path in ["/api/search?q=fatura", "/api/folders", "/api/messages/1", "/api/ai/status", "/api/sync/status",
                 "/api/settings", "/api/drafts"]:
        assert client.get(path).status_code == 401, path
    assert client.get("/api/health").json() == {"status": "ok"}
    ready = client.get("/api/health/ready").json()
    assert set(ready) == {"database", "search"}  # anonim uç ayrıntı sızdırmaz


def test_login_cookie_flags_and_logout(client):
    r = client.post("/api/auth/login", json={"username": "fatih", "password": PASSWORD}, headers=H)
    assert r.status_code == 200, r.text
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert client.get("/api/auth/me").json()["authenticated"]
    client.post("/api/auth/logout", headers=H)
    assert client.get("/api/folders").status_code == 401


def test_bruteforce_lockout(client):
    for _ in range(5):
        assert client.post("/api/auth/login", json={"username": "fatih", "password": "yanlis"}, headers=H).status_code == 401
    r = client.post("/api/auth/login", json={"username": "fatih", "password": PASSWORD}, headers=H)
    assert r.status_code == 429  # doğru parola bile kilit süresince reddedilir


def test_csrf_protection(client):
    login(client)
    mid = 1
    assert client.patch(f"/api/messages/{mid}", json={"is_read": True}).status_code == 403
    bad = {"Origin": "https://evil.test", "X-Requested-With": "fredymail"}
    assert client.patch(f"/api/messages/{mid}", json={"is_read": True}, headers=bad).status_code == 403
    no_hdr = {"Origin": "http://testserver"}
    assert client.patch(f"/api/messages/{mid}", json={"is_read": True}, headers=no_hdr).status_code == 403


def test_security_headers(client):
    r = client.get("/api/health")
    assert "default-src 'self'" in r.headers["content-security-policy"]
    assert r.headers["x-frame-options"] == "DENY"
    assert r.headers["x-content-type-options"] == "nosniff"


def test_html_view_is_sanitized_and_remote_images_blocked(client, db):
    login(client)
    mid = msg_id(db, "Fotomarket kampanya%")
    r = client.get(f"/api/messages/{mid}/html")
    body = r.text
    assert "<script" not in body and "onclick" not in body and "tracker.fotomarket.test" not in body
    assert r.headers["x-blocked-images"] == "1"
    assert "img-src data:;" in r.headers["content-security-policy"] or "img-src data: " in r.headers["content-security-policy"]
    assert "script-src" not in r.headers["content-security-policy"]  # default-src 'none' → script yok
    r2 = client.get(f"/api/messages/{mid}/html?remote=true")
    assert "https:" in r2.headers["content-security-policy"]


def test_attachment_download_forced_as_file(client, db):
    login(client)
    mid = msg_id(db, "e-Fatura: FTR2026000123%")
    detail = client.get(f"/api/messages/{mid}").json()
    att = detail["attachments"][0]
    r = client.get(f"/api/messages/{mid}/attachments/{att['id']}")
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")
    assert r.headers["content-type"] == "application/octet-stream"
    assert r.headers["content-disposition"].startswith("attachment;")
    # başka mailin ekini bu mail üzerinden isteyemez
    other = msg_id(db, "Nordlicht Imaging – Price List Q3 2026")
    assert client.get(f"/api/messages/{other}/attachments/{att['id']}").status_code == 404


# ------------------------------------------------------------------ arama ve iş akışı


def test_search_endpoint(client):
    login(client)
    r = client.get("/api/search", params={"q": "fiyat listesi"}).json()
    assert r["engine"] == "meilisearch" and r["total"] >= 2
    item = r["items"][0]
    for key in ("subject", "from_email", "date", "folders", "highlight"):
        assert key in item


def test_workflow_state_is_persistent(client, db):
    login(client)
    mid = msg_id(db, "SJ-500 aksiyon kamera%")
    until = (datetime.now(UTC) + timedelta(days=2)).isoformat()
    assert client.patch(f"/api/messages/{mid}", json={"is_important": True, "snoozed_until": until}, headers=H).status_code == 200
    r = client.post(f"/api/messages/{mid}/tags", json={"name": "Bayi"}, headers=H).json()
    assert [t["name"] for t in r["tags"]] == ["Bayi"]
    n = client.post(f"/api/messages/{mid}/notes", json={"body": "Stok Perşembe gelecek"}, headers=H).json()
    db.expire_all()
    m = db.get(Message, mid)
    assert m.is_important and m.snoozed_until is not None
    # ertelenen mail gelen kutusunda görünmez, "Ertelenenler"de görünür
    inbox = client.get("/api/search", params={"view": "inbox", "per_page": 100}).json()
    assert mid not in [i["id"] for i in inbox["items"]]
    snoozed = client.get("/api/search", params={"view": "snoozed"}).json()
    assert mid in [i["id"] for i in snoozed["items"]]
    # not ve etiket aranabilir
    s = client.get("/api/search", params={"q": "Perşembe"}).json()
    assert mid in [i["id"] for i in s["items"]]
    detail = client.get(f"/api/messages/{mid}").json()
    assert detail["notes"][0]["id"] == n["id"]
    assert client.patch(f"/api/messages/{mid}", json={"clear_snooze": True}, headers=H).json()["snoozed_until"] is None
    assert client.patch(f"/api/messages/{mid}", json={"snoozed_until": "2001-01-01T00:00:00Z"}, headers=H).status_code == 400


def test_followups_and_dismiss(client):
    login(client)
    r = client.get("/api/followups", params={"kind": "awaiting"}).json()
    item = next(i for i in r["items"] if i["subject"].startswith("Fiyat teklifi"))
    assert item["days_waiting"] >= 3
    client.post(f"/api/threads/{item['thread_id']}/dismiss-followup", headers=H)
    r2 = client.get("/api/followups", params={"kind": "awaiting"}).json()
    assert item["thread_id"] not in [i["thread_id"] for i in r2["items"]]


def test_folders_tree_and_smart_folders(client):
    login(client)
    folders = client.get("/api/folders").json()
    names = [f["name"] for f in folders]
    assert names[0] == "INBOX" and "Faturalar" in names and "Fiyat Listeleri" in names
    smart = client.get("/api/saved-searches").json()
    assert {"Faturalar", "Fiyat listeleri"} <= {s["name"] for s in smart}


def test_thread_view(client, db):
    login(client)
    mid = msg_id(db, "Nordlicht Imaging – Price List Q3 2026")
    tid = client.get(f"/api/messages/{mid}").json()["thread_id"]
    t = client.get(f"/api/threads/{tid}").json()
    assert t["message_count"] == 3 and len(t["messages"]) == 3


def test_no_send_endpoint_exists(client):
    login(client)
    for path in ["/api/drafts/1/send", "/api/send", "/api/messages/1/send"]:
        assert client.post(path, json={}, headers=H).status_code in (404, 405)
    assert client.get("/api/meta").json()["send_enabled"] is False


# ------------------------------------------------------------------ AI


def test_ai_summary_with_sources(client, db):
    login(client)
    mid = msg_id(db, "Nordlicht Imaging – Price List Q3 2026")
    r = client.post("/api/ai/thread_summary", json={"message_id": mid}, headers=H)
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["references"] and all(ref["message_id"] for ref in out["references"])
    assert set(out["cited"]) <= {ref["label"] for ref in out["references"]}
    assert out["meta"]["messages_sent"] == 3 and out["meta"]["pii_redacted"]
    # aynı istek önbellekten gelir, yeni çağrı/maliyet oluşturmaz
    again = client.post("/api/ai/thread_summary", json={"message_id": mid}, headers=H).json()
    assert again["meta"]["cached"]
    assert client.get("/api/ai/status").json()["usage_today"]["calls"] == 1


def test_ai_draft_never_sends_and_recipients_locked(client, db):
    login(client)
    mid = msg_id(db, "SJ-500 aksiyon kamera%")
    out = client.post("/api/ai/draft", json={"message_id": mid, "instruction": "stok var de"}, headers=H).json()
    d = client.get(f"/api/drafts/{out['draft_id']}").json()
    assert d["to"] == ["merve@kameradunyasi.test"] and d["source"] == "ai" and not d["reviewed"]
    assert d["can_send"] is False


def test_ai_disabled_search_still_works(client, db):
    login(client)
    client.post("/api/ai/toggle", json={"enabled": False}, headers=H)
    mid = msg_id(db, "SJ-500 aksiyon kamera%")
    r = client.post("/api/ai/summary", json={"message_id": mid}, headers=H)
    assert r.status_code == 409 and "Arama" in r.json()["detail"]
    assert client.get("/api/search", params={"q": "SJ-500"}).json()["total"] >= 1


def test_ai_budget_limit(client, db, monkeypatch):
    login(client)
    s = get_settings()
    monkeypatch.setattr(s, "ai_max_calls_per_day", 1)
    ids = db.execute(select(Message.id).limit(3)).scalars().all()
    assert client.post("/api/ai/summary", json={"message_id": ids[0]}, headers=H).status_code == 200
    r = client.post("/api/ai/summary", json={"message_id": ids[1]}, headers=H)
    assert r.status_code == 409 and "sınır" in r.json()["detail"]


def test_ai_provider_failure_degrades_gracefully(client, db, monkeypatch):
    from fredymail.ai import service
    from fredymail.ai.provider import AIError

    class Down:
        name, model = "openai_compatible", "x"

        def complete(self, *a, **k):
            raise AIError("AI sağlayıcısına ulaşılamadı (ConnectTimeout)")

    monkeypatch.setattr(service, "get_provider", lambda s, tier="light": Down())
    login(client)
    mid = msg_id(db, "SJ-500 aksiyon kamera%")
    r = client.post("/api/ai/summary", json={"message_id": mid}, headers=H)
    assert r.status_code == 502 and "etkilenmez" in r.json()["detail"]
    assert client.get(f"/api/messages/{mid}").status_code == 200


def test_ai_search_summary_validates_filters(client):
    login(client)
    r = client.post("/api/ai/search_summary", json={"query": "fatura", "filters": {"tag_id": "1 OR 1=1"}}, headers=H)
    assert r.status_code == 400
    r = client.post("/api/ai/search_summary", json={"query": "fatura", "filters": {"doc_kind": "invoice"}}, headers=H)
    assert r.status_code == 200 and r.json()["references"]


def test_password_unicode_normalization():
    import unicodedata

    from fredymail.security.auth import hash_password, verify_password

    pw_nfc = unicodedata.normalize("NFC", "Şişli-Güneş-Çiçeği-2026")
    pw_nfd = unicodedata.normalize("NFD", pw_nfc)
    assert pw_nfc != pw_nfd
    h = hash_password(pw_nfd)  # parola bir cihazda NFD girildi
    assert verify_password(h, pw_nfc) and verify_password(h, pw_nfd)  # her iki biçim de kabul
    assert not verify_password(h, "Sisli-Gunes-Cicegi-2026")
