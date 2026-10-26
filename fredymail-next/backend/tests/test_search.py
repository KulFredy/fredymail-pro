from __future__ import annotations

import httpx
from sqlalchemy import func, select

from fredymail.models import Message
from fredymail.search.meili import HL_PRE, Meili, index_dirty, rebuild
from fredymail.search.query import SearchParams, followups, search


def subjects(res):
    return [i["subject"] for i in res["items"]]


def live_count(db):
    return db.execute(select(func.count()).select_from(Message).where(
        Message.deleted_on_server.is_(False), ~Message.dedupe_key.startswith("err:"))).scalar_one()


def test_index_and_search_bilingual(db, synced, meili):
    n = index_dirty(db, meili)
    assert n == db.execute(select(func.count()).select_from(Message)).scalar_one()
    assert meili.stats()["numberOfDocuments"] == live_count(db)

    # Türkçe sorgu → İngilizce fiyat listesi (eş anlamlı) + Türkçe bayi fiyat listesi
    r = search(db, meili, SearchParams(q="fiyat listesi"))
    s = subjects(r)
    assert r["engine"] == "meilisearch"
    assert any("Nordlicht Imaging – Price List" in x for x in s)
    assert any("Bayi fiyat listesi" in x for x in s)

    # İngilizce sorgu → Türkçe fatura mailleri
    s = subjects(search(db, meili, SearchParams(q="invoice")))
    assert any(x.startswith("e-Fatura") for x in s)
    assert any("Proforma Invoice" in x for x in s)


def test_turkish_casing_and_attachment_content(db, synced, meili):
    index_dirty(db, meili)
    s = subjects(search(db, meili, SearchParams(q="istanbul mağaza")))
    assert any("Şirket içi toplantı" in x for x in s)
    # Ek içeriği (XLSX) aranabilir
    s = subjects(search(db, meili, SearchParams(q="ND Filter Kit")))
    assert any("Price List Q3" in x for x in s)
    # PDF içeriği
    s = subjects(search(db, meili, SearchParams(q="navlun gumruk")))
    assert any(x.startswith("e-Fatura") for x in s)


def test_filters_and_highlight(db, synced, meili):
    index_dirty(db, meili)
    r = search(db, meili, SearchParams(q="fatura", doc_kind="invoice", sender="egelojistik"))
    assert r["total"] >= 3 and all("ege" in i["from_email"] for i in r["items"])
    assert any(HL_PRE in (i["highlight"].get("subject") or "") for i in r["items"])
    r = search(db, meili, SearchParams(q="price", file_kind="spreadsheet"))
    assert subjects(r) == ["Nordlicht Imaging – Price List Q3 2026"]
    # Sonuçlarda kaynak klasör ve tarih görünür
    item = r["items"][0]
    assert item["date"] and {f["path"] for f in item["folders"]} == {"Fiyat Listeleri", "INBOX"}


def test_views_without_query_use_postgres(db, synced):
    r = search(db, None, SearchParams(doc_kind="invoice"))
    assert r["engine"] == "postgres" and r["total"] == 3
    r = search(db, None, SearchParams(view="sent"))
    assert r["total"] >= 3 and all(i["is_from_me"] for i in r["items"])
    r = search(db, None, SearchParams(view="inbox", per_page=10, page=1))
    dates = [i["date"] for i in r["items"]]
    assert dates == sorted(dates, reverse=True)
    r2 = search(db, None, SearchParams(view="inbox", per_page=10, page=2))
    assert not {i["id"] for i in r["items"]} & {i["id"] for i in r2["items"]}


def test_degraded_mode_when_meili_down(db, synced, settings):
    dead = Meili(settings, client=httpx.Client(base_url="http://127.0.0.1:9", timeout=0.5))
    r = search(db, dead, SearchParams(q="Nordlicht"))
    assert r["degraded"] and r["engine"] == "postgres"
    assert any("Nordlicht" in s for s in subjects(r))


def test_index_is_rebuildable_from_postgres(db, synced, meili):
    index_dirty(db, meili)
    before = subjects(search(db, meili, SearchParams(q="teklif", sort="date_desc")))
    meili.delete_index()  # tüm arama verisi kayboldu
    n = rebuild(db, meili)
    assert n == db.execute(select(func.count()).select_from(Message)).scalar_one()
    after = subjects(search(db, meili, SearchParams(q="teklif", sort="date_desc")))
    assert before == after and before


def test_followup_views(db, synced, settings):
    needs = followups(db, "needs_reply", settings.needs_reply_days, settings.my_addresses)
    subj = [x["subject"] for x in needs]
    assert "SJ-500 aksiyon kamera stok durumu" in subj
    assert not any("bülten" in s.lower() for s in subj)  # otomatik mailler hariç
    awaiting = followups(db, "awaiting", settings.awaiting_reply_days, settings.my_addresses)
    assert "Fiyat teklifi: Fuar standı ekipmanları" in [x["subject"] for x in awaiting]
    # Nordlicht thread'inde son mesaj karşı taraftan → bekleyen değil
    assert not any("Nordlicht" in x["subject"] for x in awaiting)
    # bülten (başlıksız da olsa) ve "teşekkürler, bilginize" maili listelere girmez
    assert not any("30X" in x["subject"] for x in needs)
    assert not any("Fotomarket kampanya" in x["subject"] for x in awaiting)
    # daha önce yazıştığım kişi (Lumora/Nordlicht vb.) varsa önce gelir; sıralama bozulmaz
    flags = [x["known_contact"] for x in needs]
    assert flags == sorted(flags, reverse=True)


def test_index_version_migration_rebuilds_cleanly(db, synced, meili):
    from fredymail.models import KeyValue
    from fredymail.search.meili import INDEX_VERSION, migrate_index_version

    index_dirty(db, meili)
    db.merge(KeyValue(key="index_version", value={"v": INDEX_VERSION - 1}))
    db.commit()
    assert migrate_index_version(db, meili) is True
    assert meili.stats()["numberOfDocuments"] == 0  # eski belgeler gitti (disk şişmez)
    index_dirty(db, meili)
    assert meili.stats()["numberOfDocuments"] == live_count(db)
    assert migrate_index_version(db, meili) is False  # ikinci kez çalışmaz


def test_reports_are_automated_and_senders_can_be_muted(db, synced, settings):
    from fredymail.mail.classify import looks_bulk
    from fredymail.search.query import muted_senders, set_sender_muted

    for s in ("SJCAM Günlük Kampanya Raporu | 22.10.2026", "Zoom İthalat | Haftalık Ads & Analytics Raporu",
              "Zoom İthalat | Günlük Ads Sağlık Raporu | 2 Ekim", "[Spam] SJCAM Günlük Kampanya Raporu",
              "Weekly performance report", "[SPAM] Fırsat"):
        assert looks_bulk("rapor.hesabi@gmail.com", s, "Merhaba"), s
    for s in ("SJ-500 stok durumu", "Haftalık toplantı", "Rapor hakkında bir sorum var", "Satış raporu ektedir"):
        assert not looks_bulk("ali@firma.test", s, "Merhaba Fatih Bey, bilginize."), s

    def needs():
        return [x["subject"] for x in followups(db, "needs_reply", settings.needs_reply_days, settings.my_addresses)]

    assert "SJ-500 aksiyon kamera stok durumu" in needs()
    assert set_sender_muted(db, "Merve@KameraDunyasi.test", True) == ["merve@kameradunyasi.test"]
    assert "SJ-500 aksiyon kamera stok durumu" not in needs()
    set_sender_muted(db, "merve@kameradunyasi.test", False)
    assert muted_senders(db) == [] and "SJ-500 aksiyon kamera stok durumu" in needs()
