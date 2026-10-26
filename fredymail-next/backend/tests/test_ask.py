from __future__ import annotations

from datetime import UTC, datetime

import pytest

from fredymail.search.ask import parse_rules, run_question
from fredymail.search.query import SearchParams, search

NOW = datetime(2026, 10, 26, 12, 0, tzinfo=UTC)


@pytest.mark.parametrize("q, expect", [
    ("bu ay en çok kimden mail aldım?", {"mode": "stats", "stat": "top_senders", "period": "this_month"}),
    ("geçen yıl en çok kime mail attım", {"mode": "stats", "stat": "top_recipients", "period": "last_year"}),
    ("Roy Bey'den gelen faturalar", {"mode": "search", "person": "Roy Bey", "doc_kind": "invoice", "direction": "in"}),
    ("2024 fiyat listeleri pdf", {"mode": "search", "doc_kind": "pricelist", "file_kind": "pdf", "period": "year"}),
    ("son 30 gün cevaplanmamış mailler", {"mode": "followups", "followup": "needs_reply", "period": "last_n_days"}),
    ("yanıt beklediğim yazışmalar", {"mode": "followups", "followup": "awaiting"}),
    ("mart 2025 Klodin ile yazışmalar", {"mode": "search", "person": "Klodin", "period": "month"}),
    ("hangi firmalarla en çok yazıştım bu yıl", {"mode": "stats", "stat": "top_domains", "period": "this_year"}),
    ("bu hafta kaç mail geldi", {"mode": "stats", "stat": "count", "period": "this_week"}),
    ("aylara göre mail dağılımı", {"mode": "stats", "stat": "volume"}),
    ("SJ-500 stok", {"mode": "search", "keywords": "sj-500 stok"}),
    ("okunmamış önemli mailler", {"mode": "search"}),
])
def test_rule_parser(q, expect):
    p = parse_rules(q, NOW)
    assert p.mode == expect["mode"], p
    if "stat" in expect:
        assert p.stat == expect["stat"]
    if "period" in expect:
        assert p.period["kind"] == expect["period"], p.period
    if "person" in expect:
        assert p.person == expect["person"], p.person
    if "doc_kind" in expect:
        assert p.doc_kind == expect["doc_kind"]
    if "file_kind" in expect:
        assert p.file_kind == expect["file_kind"]
    if "direction" in expect:
        assert p.direction == expect["direction"]
    if "followup" in expect:
        assert p.followup_kind == expect["followup"]
    if "keywords" in expect:
        assert p.keywords == expect["keywords"]
    assert p.understood or p.keywords


def test_ask_top_senders_and_drilldown(db, synced, settings):
    out = run_question(db, None, settings, "bu yıl en çok kimden mail aldım?", allow_ai=False)
    assert out["mode"] == "stats" and out["engine"] == "rules"
    rows = out["stats"]["rows"]
    assert rows and rows[0]["count"] >= rows[-1]["count"]
    assert all("bulten" not in r["sublabel"] and "no-reply" not in r["sublabel"] for r in rows)  # bültenler hariç
    # satıra tıklayınca uygulanan filtre gerçekten o kişinin maillerini getirir
    first = rows[0]
    res = search(db, None, SearchParams(sender=first["filter"]["sender"], year=NOW.year if False else None))
    assert res["total"] >= 1 and all(i["from_email"] == first["sublabel"] for i in res["items"])


def test_ask_person_doc_search(db, synced, settings):
    out = run_question(db, None, settings, "Ege Lojistik'ten gelen faturalar", allow_ai=False)
    assert out["mode"] == "search"
    items = out["search"]["items"]
    assert items and all("invoice" in i["doc_kinds"] and "egelojistik" in i["from_email"] for i in items)
    assert "facets" in out["search"]


def test_ask_followups_and_unknown_person(db, synced, settings):
    out = run_question(db, None, settings, "cevaplanmamış mailler", allow_ai=False)
    assert out["mode"] == "followups" and any("SJ-500" in x["subject"] for x in out["followups"])
    out = run_question(db, None, settings, "Zorbay'dan gelen mailler", allow_ai=False)
    assert any("bulunamadı" in u for u in out["understood"])


def test_ask_count_and_volume(db, synced, settings):
    out = run_question(db, None, settings, "kaç mail var toplam", allow_ai=False)
    assert out["stats"]["total"] >= 150
    out = run_question(db, None, settings, "aylara göre mail dağılımı", allow_ai=False)
    series = out["stats"]["volume"]["series"]
    assert out["stats"]["volume"]["unit"] == "month" and sum(s["received"] + s["sent"] for s in series) >= 150


def test_sort_year_facets_participant(db, synced, meili):
    from fredymail.search.meili import index_dirty

    index_dirty(db, meili)
    r = search(db, meili, SearchParams(q="fatura", sort="size_desc"), with_facets=True)
    sizes = [i["size"] or 0 for i in r["items"]]
    assert sizes == sorted(sizes, reverse=True)
    f = r["facets"]
    assert f["years"] and f["doc_kinds"].get("invoice", 0) >= 3 and "pdf" in f["file_kinds"]
    y = int(next(iter(f["years"])))
    ry = search(db, meili, SearchParams(q="fatura", year=y))
    assert ry["total"] == f["years"][str(y)]
    # aynı filtreler Postgres yolunda da aynı sonucu verir
    rp = search(db, None, SearchParams(doc_kind="invoice", sort="sender_asc"), with_facets=True)
    assert rp["total"] == 3 and rp["facets"]["doc_kinds"]["invoice"] == 3
    names = [(i["from_name"] or i["from_email"]).lower() for i in search(db, None, SearchParams(sort="sender_asc"))["items"]]
    assert names == sorted(names)
    rpart = search(db, None, SearchParams(participant="Klaus", per_page=100))
    # "X ile yazışmalar": X'in gönderdikleri + X'e gönderdiklerim birlikte
    assert any(i["is_from_me"] for i in rpart["items"]) and any(not i["is_from_me"] for i in rpart["items"])
    assert all("nordlicht" in i["from_email"] or any("nordlicht" in t["email"] for t in i["to"])
               for i in rpart["items"])


def test_insights_and_tasks_api(db, synced, meili, monkeypatch):
    from fastapi.testclient import TestClient

    from fredymail.api import deps
    from fredymail.api.main import create_app
    from fredymail.config import get_settings
    from fredymail.security.auth import hash_password

    s = get_settings()
    monkeypatch.setattr(s, "admin_password_hash", hash_password("dogru-parola-uzun-1"))
    monkeypatch.setattr(deps, "_meili", lambda: meili)
    from fredymail.search.meili import index_dirty

    index_dirty(db, meili)
    c = TestClient(create_app())
    H = {"Origin": "http://testserver", "X-Requested-With": "fredymail"}
    assert c.post("/api/auth/login", json={"username": "fatih", "password": "dogru-parola-uzun-1"}, headers=H).status_code == 200
    ins = c.get("/api/insights", params={"period": "this_year"}).json()
    assert ins["counts"]["received"] > 0 and ins["top_senders"] and ins["volume"]["series"]
    assert ins["counts"]["needs_reply"] >= 1 and ins["counts"]["awaiting"] >= 1
    ask = c.post("/api/ask", json={"question": "bu yıl en çok kimden mail aldım"}, headers=H).json()
    assert ask["mode"] == "stats"
    mid = c.get("/api/search", params={"q": "SJ-500"}).json()["items"][0]["id"]
    t = c.post("/api/tasks", json={"text": "Stok bilgisini ilet", "due": "2026-10-28", "message_id": mid,
                                   "source": "ai"}, headers=H).json()
    assert t["thread_id"] and not t["done"]
    assert c.patch(f"/api/tasks/{t['id']}", json={"done": True}, headers=H).json()["done"]
    assert c.get("/api/tasks").json() == []
    assert len(c.get("/api/tasks", params={"include_done": True}).json()) == 1
    fu = c.post("/api/ai/followup", json={"message_id": mid}, headers=H).json()
    assert fu["suggestion"] and fu["references"]
