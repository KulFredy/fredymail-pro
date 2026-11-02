"""Hero planı: Google istemcisi (sahte HTTP), tablo okuma/yazma, plan ve günlük senkron. Veriler sentetiktir."""

from __future__ import annotations

import base64
import io
import json
from datetime import UTC, date, datetime

import httpx
import openpyxl
import pytest
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

from fredymail.hero import service
from fredymail.hero.google import GoogleClient, GoogleError, sign_jwt
from fredymail.hero.sheet import (
    LINK_PENDING_NOTE,
    archive_title,
    build_write_requests,
    col_letter,
    parse_grid,
    period_text,
)
from fredymail.hero.yoldaki import parse_workbook

TODAY = date(2026, 11, 2)


# ---------------------------------------------------------------- Google istemcisi

@pytest.fixture(scope="module")
def sa():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                            serialization.NoEncryption()).decode()
    return {"client_email": "bot@test-proje.iam.gserviceaccount.com", "private_key": pem,
            "private_key_id": "kid1", "token_uri": "https://oauth2.example.test/token"}, key.public_key()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def test_jwt_signature_and_claims(sa):
    info, pub = sa
    tok = sign_jwt(info, now=1_000_000)
    h, c, sig = tok.split(".")
    pub.verify(_unb64(sig), f"{h}.{c}".encode(), padding.PKCS1v15(), hashes.SHA256())
    claims = json.loads(_unb64(c))
    assert claims["iss"] == info["client_email"] and claims["aud"] == info["token_uri"]
    assert claims["exp"] - claims["iat"] == 3600 and "spreadsheets" in claims["scope"]
    assert json.loads(_unb64(h))["kid"] == "kid1"


def _client(sa, handler) -> GoogleClient:
    return GoogleClient(sa[0], httpx.Client(transport=httpx.MockTransport(handler)))


def test_download_xlsx_and_export(sa):
    calls = []

    def handler(req: httpx.Request):
        calls.append((req.method, req.url.path, dict(req.url.params)))
        if req.url.host == "oauth2.example.test":
            assert b"jwt-bearer" in req.content
            return httpx.Response(200, json={"access_token": "t0k", "expires_in": 3600})
        assert req.headers["Authorization"] == "Bearer t0k"
        if req.url.path.endswith("/files/X") and "alt" not in req.url.params:
            return httpx.Response(200, json={"id": "X", "name": "Y.xlsx", "mimeType": "application/x-xlsx"})
        if req.url.path.endswith("/files/G") and "alt" not in req.url.params:
            return httpx.Response(200, json={"id": "G", "name": "G", "mimeType": "application/vnd.google-apps.spreadsheet"})
        if req.url.path.endswith("/files/X"):
            return httpx.Response(200, content=b"XLSX")
        if req.url.path.endswith("/files/G/export"):
            return httpx.Response(200, content=b"EXPORTED")
        return httpx.Response(404, json={"error": {"message": "File not found"}})

    c = _client(sa, handler)
    assert c.download_xlsx("X")[0] == b"XLSX"
    assert c.download_xlsx("G")[0] == b"EXPORTED"
    assert sum(1 for m, p, _ in calls if p == "/token") == 1  # belirteç önbelleklenir
    with pytest.raises(GoogleError) as e:
        c.download_xlsx("YOK")
    assert e.value.status == 404 and "paylaşıldı mı" in str(e.value)


def test_auth_failure_message(sa):
    c = _client(sa, lambda req: httpx.Response(400, json={"error": "invalid_grant",
                                                          "error_description": "Invalid JWT Signature."}))
    with pytest.raises(GoogleError, match="Invalid JWT Signature"):
        c.file_meta("X")


# ---------------------------------------------------------------- tablo

def _c(text="", link=None, runs_link=None):
    c = {"formattedValue": text} if text != "" else {}
    if link:
        c["hyperlink"] = link
    if runs_link:
        c["textFormatRuns"] = [{"startIndex": 0, "format": {"link": {"uri": runs_link}}}]
    return c


def grid() -> dict:
    header = [_c("Sıra No:"), _c("Marka")] + [_c(f"Ürün-{i}") for i in range(1, 9)] + [_c("Toplam Ürün")]
    rows = [
        [],
        [_c(), _c("Hero Ürünler Listesi")],
        [_c(), _c("TARİH"), _c("1.10.2026-31.10.2026")],
        header,
        [_c("1"), _c("SJCam"), _c("Sjcam SJ30", link="https://z.test/sj30"), _c("ZV200", runs_link="https://z.test/zv")]
        + [_c()] * 6 + [_c("2")],
        [_c("2"), _c("OM System"), _c("OM SYSTEM TG-7", link="https://z.test/tg7"),
         _c("OM System Kampanya (08.10-01.11)", link="https://z.test/om")] + [_c()] * 6 + [_c("2")],
        [_c("3"), _c("Zhiyun")] + [_c(f"Zhiyun Ürün {i}", link=f"https://z.test/zh{i}") for i in range(1, 9)]
        + [_c("8")],
        [_c("TOPLAM")] + [_c()] * 9 + [_c("12")],
    ]
    return {"sheets": [{"properties": {"sheetId": 7, "title": "Sayfa1", "index": 0},
                        "data": [{"rowData": [{"values": r} for r in rows]}]}]}


def test_parse_grid():
    hs = parse_grid(grid(), "Sayfa1")
    assert hs.period == "1.10.2026-31.10.2026" and hs.period_cell == (2, 2)
    assert (hs.header_row, hs.no_col, hs.brand_col, hs.total_col) == (3, 0, 1, 10)
    assert hs.product_cols == list(range(2, 10)) and hs.total_row == 7
    assert [r.brand for r in hs.rows] == ["SJCam", "OM System", "Zhiyun"]
    assert [(p.text, p.link) for p in hs.rows[0].products] == [("Sjcam SJ30", "https://z.test/sj30"),
                                                                 ("ZV200", "https://z.test/zv")]
    with pytest.raises(ValueError):
        parse_grid(grid(), "Yok")


def test_helpers():
    assert archive_title("1.10.2026-31.10.2026") == "Ekim 2026"
    assert period_text(2026, 11) == "1.11.2026-30.11.2026" and period_text(2028, 2) == "1.2.2028-29.2.2028"
    assert [col_letter(i) for i in (0, 10, 25, 26)] == ["A", "K", "Z", "AA"]


def test_build_write_requests_adds_rows_archives_and_keeps_formats():
    hs = parse_grid(grid(), "Sayfa1")
    plan = {"period": "1.11.2026-30.11.2026", "brands": [
        {"brand": "SJCam", "products": [{"text": "Sjcam SJ30", "link": "https://z.test/sj30"}]},
        {"brand": "OM System", "products": []},
        {"brand": "Zhiyun", "products": [{"text": f"Z{i}", "link": None} for i in range(10)]},  # 8'e kırpılır
        {"brand": "Yaber", "products": [{"text": "Yaber L2 Plus", "link": None}]},
    ]}
    reqs = build_write_requests(hs, plan, ["Sayfa1"])
    assert reqs[0] == {"duplicateSheet": {"sourceSheetId": 7, "insertSheetIndex": 1, "newSheetName": "Ekim 2026"}}
    assert reqs[1]["updateCells"]["rows"][0]["values"][0]["userEnteredValue"]["stringValue"] == "1.11.2026-30.11.2026"
    assert reqs[2]["insertDimension"]["range"] == {"sheetId": 7, "dimension": "ROWS", "startIndex": 7, "endIndex": 8}
    rows = [r["updateCells"] for r in reqs if "updateCells" in r][1:]
    assert all(r["fields"] == "userEnteredValue,textFormatRuns,note" for r in rows)  # biçim alanlarına dokunulmaz
    sj = rows[0]["rows"][0]["values"]
    assert sj[2]["textFormatRuns"][0]["format"]["link"]["uri"] == "https://z.test/sj30"
    assert sj[3] == {} and sj[10]["userEnteredValue"]["formulaValue"] == "=COUNTA(C5:J5)"
    yaber = rows[3]["rows"][0]["values"]
    assert rows[3]["start"]["rowIndex"] == 7 and yaber[0]["userEnteredValue"]["numberValue"] == 4
    assert yaber[2]["note"] == LINK_PENDING_NOTE
    assert len(rows[2]["rows"][0]["values"]) == 11  # sıra + marka + 8 ürün + toplam
    total = rows[-1]
    assert total["start"]["rowIndex"] == 8 and total["rows"][0]["values"][0]["userEnteredValue"]["formulaValue"] == "=SUM(K5:K8)"

    # arşiv zaten varsa tekrar kopyalanmaz; daha az marka → satır silinir
    reqs2 = build_write_requests(hs, {"period": "x", "brands": plan["brands"][:2]}, ["Sayfa1", "Ekim 2026"])
    assert not any("duplicateSheet" in r for r in reqs2)
    assert any(r.get("deleteDimension", {}).get("range", {}).get("startIndex") == 6 for r in reqs2)

    # aynı ayı yeniden yazmak (ör. Kasım'a yeni ürün eklemek) taslağı arşive kopyalamaz
    reqs3 = build_write_requests(hs, {"period": "1.10.2026-31.10.2026", "archive_title": "Ekim 2026",
                                      "brands": plan["brands"]}, ["Sayfa1"])
    assert not any("duplicateSheet" in r for r in reqs3)


# ---------------------------------------------------------------- plan

def _yoldaki() -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    om = wb.create_sheet("OM")
    om.append(["OM Yeni Kamera Kit", 3, "**YENİ ÜRÜN**", "GÜMRÜKTE"])
    om.append(["TG-7 Siyah", 10, None, "GÜMRÜKTE"])
    y = wb.create_sheet("YABER")
    y.append(["L2 PLUS", 1200, "TAHMINI VARIŞ KASIM ORTASI"])
    y.append(["Yaber L3", 30, "TAHMİNİ VARIŞ ARALIK SONU"])
    z = wb.create_sheet("ZHIYUN")
    z.append(["C1", "Zhiyun Yeni Işık", 5, "GÜMRÜKTE"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_campaign_end_and_same_product():
    ref = date(2026, 11, 1)
    assert service.campaign_end("OM System Kampanya (08.10-01.11)", ref) == date(2026, 11, 1)
    assert service.campaign_end("Kampanya 20.12-10.01", ref) == date(2027, 1, 10)
    assert service.campaign_end("Tamron 28-75mm", ref) is None
    assert service.same_product("OM SYSTEM TG-7", "TG-7 Siyah") is False
    assert service.same_product("Yaber L2 Plus", "L2 PLUS")
    assert service.same_product("Kingjoy M080", "M080")


def test_build_plan():
    hs = parse_grid(grid(), "Sayfa1")
    items = parse_workbook(_yoldaki(), TODAY)
    yaber = next(i for i in items if i.name == "L2 PLUS")
    plan = service.build_plan(hs, items, {yaber.key}, 2026, 11, TODAY)
    assert plan["period"] == "1.11.2026-30.11.2026" and plan["archive_title"] == "Ekim 2026"
    om = next(b for b in plan["brands"] if b["brand"] == "OM System")
    assert [p["text"] for p in om["products"]] == ["OM SYSTEM TG-7", "OM Yeni Kamera Kit"]
    assert plan["dropped"] == [{"brand": "OM System", "text": "OM System Kampanya (08.10-01.11)",
                                "reason": "kampanya 01.11 bitti"}]
    assert om["products"][1]["source"] == "yeni" and om["products"][1]["link"] is None
    assert plan["brands"][-1] == {"brand": "Yaber", "new_brand": True, "products": [
        {"text": "L2 PLUS", "link": None, "source": "yeni", "flags": ["new"],
         "status": "TAHMINI VARIŞ KASIM ORTASI", "qty": 1200}]}
    # Zhiyun dolu (8): yeni ürün taşanlara gider; "yeni" olmayan TG-7 Siyah ve Aralık'taki L3 eklenmez
    assert [o["text"] for o in plan["overflow"]] == []
    assert all(p["text"] != "TG-7 Siyah" for b in plan["brands"] for p in b["products"])
    plan2 = service.build_plan(hs, items, {i.key for i in items}, 2026, 11, TODAY)
    assert [o["text"] for o in plan2["overflow"]] == ["Zhiyun Yeni Işık"]


# ---------------------------------------------------------------- günlük kopya (Postgres)

def test_sync_items_baseline_then_new(db):
    items = parse_workbook(_yoldaki(), TODAY)
    r1 = service.sync_items(db, items, TODAY)
    assert r1 == {"items": 5, "added": 0, "baseline": True}
    # kurulum günü: yalnızca YENİ ÜRÜN notlu ürün yeni sayılır
    keys = service.new_product_keys(db)
    assert {k.split("|")[0] for k in keys} == {"OM System"} and len(keys) == 1
    assert service.first_seen_keys(db, TODAY, 45) == set()

    wb = openpyxl.load_workbook(io.BytesIO(_yoldaki()))
    wb["YABER"].append(["Yaber K3", 50, "KASIM SONU"])
    buf = io.BytesIO()
    wb.save(buf)
    later = date(2026, 11, 5)
    r2 = service.sync_items(db, parse_workbook(buf.getvalue(), later), later)
    assert r2["added"] == 1 and not r2["baseline"]
    seen = service.first_seen_keys(db, later, 45)
    assert len(seen) == 1 and next(iter(seen)).startswith("Yaber|")
    assert service.first_seen_keys(db, date(2027, 2, 1), 45) == set()
    # yoldaki listeye ilk kez girmek tek başına "yeni ürün" yapmaz
    assert {k.split("|")[0] for k in service.new_product_keys(db)} == {"OM System"}


def test_maybe_run_daily_once_per_day_and_reminder(db, settings, tmp_path, monkeypatch):
    sa_file = tmp_path / "sa.json"
    sa_file.write_text("{}")
    monkeypatch.setattr(settings, "google_sa_file", str(sa_file))
    monkeypatch.setattr(settings, "hero_yoldaki_file_id", "FILE")
    runs, msgs = [], []

    def fake_run_sync(db, settings, today=None, client=None):
        runs.append(today)
        service._set_kv(db, "hero_sync", {"date": today.isoformat(), "items": 1, "added": 0})
        return {"items": 1, "added": 0}

    monkeypatch.setattr(service, "run_sync", fake_run_sync)
    site_runs = []
    monkeypatch.setattr(service, "run_site_check",
                        lambda db, settings, today=None, **k: site_runs.append(today) or service._set_kv(
                            db, "hero_site", {"date": today.isoformat()}) or {"products": 0, "found": 0,
                                                                               "missing": 0, "ambiguous": 0})
    ist = lambda d, h: datetime(2026, 11, d, h - 3, tzinfo=UTC)  # noqa: E731  (İstanbul = UTC+3)
    service.maybe_run_daily(db, settings, msgs.append, now=ist(2, 7))  # 08:00'den önce
    assert runs == []
    service.maybe_run_daily(db, settings, msgs.append, now=ist(2, 9))
    service.maybe_run_daily(db, settings, msgs.append, now=ist(2, 15))  # aynı gün tekrar yok
    service.maybe_run_daily(db, settings, msgs.append, now=ist(3, 9))
    assert runs == [date(2026, 11, 2), date(2026, 11, 3)] and msgs == []
    assert site_runs == runs  # mağaza kontrolü senkrondan sonra, günde bir
    service.maybe_run_daily(db, settings, msgs.append, now=ist(25, 9))
    service.maybe_run_daily(db, settings, msgs.append, now=ist(26, 9))
    assert len(msgs) == 1 and "12.2026" in msgs[0] and "2026-12" in msgs[0]

    def failing(db, settings, today=None, client=None):
        raise RuntimeError("ağ yok")

    monkeypatch.setattr(service, "run_sync", failing)
    service.maybe_run_daily(db, settings, None, now=ist(27, 9))  # hata yutulur, worker durmaz
    assert "ağ yok" in db.get(service.KeyValue, "hero_sync").value["error"]


def test_first_sync_uses_old_revision_as_baseline(db, settings, sa, monkeypatch):
    old = openpyxl.load_workbook(io.BytesIO(_yoldaki()))
    del old["YABER"]  # Yaber eski sürümde yoktu → yeni sayılmalı
    buf = io.BytesIO()
    old.save(buf)
    old_bytes, new_bytes = buf.getvalue(), _yoldaki()

    def handler(req: httpx.Request):
        p = req.url.path
        if req.url.host == "oauth2.example.test":
            return httpx.Response(200, json={"access_token": "t", "expires_in": 3600})
        if p.endswith("/revisions"):
            return httpx.Response(200, json={"revisions": [
                {"id": "r1", "modifiedTime": "2026-09-01T10:00:00Z"},
                {"id": "r2", "modifiedTime": "2026-09-15T10:00:00Z"},
                {"id": "r3", "modifiedTime": "2026-11-01T10:00:00Z"}]})
        if p.endswith("/revisions/r2"):  # 2 Kasım - 45 gün = 18 Eylül → r2
            return httpx.Response(200, content=old_bytes)
        if "alt" in req.url.params:
            return httpx.Response(200, content=new_bytes)
        return httpx.Response(200, json={"id": "F", "name": "Y.xlsx", "mimeType": "x"})

    monkeypatch.setattr(settings, "hero_yoldaki_file_id", "F")
    res = service.run_sync(db, settings, client=_client(sa, handler), today=TODAY)
    assert res["baseline"] and res["added"] == 2 and res["baseline_from"] == "2026-09-15T10:00:00Z"
    keys = service.first_seen_keys(db, TODAY, 45)
    assert len(keys) == 2 and all(k.startswith("Yaber|") for k in keys)


def test_local_tz_fallback(monkeypatch):
    from datetime import timedelta

    def missing(name):
        raise service.ZoneInfoNotFoundError(name)

    monkeypatch.setattr(service, "ZoneInfo", missing)
    assert service.local_tz("Europe/Istanbul").utcoffset(None) == timedelta(hours=3)
    assert service.local_tz("Europe/Berlin").utcoffset(None) == timedelta(0)
