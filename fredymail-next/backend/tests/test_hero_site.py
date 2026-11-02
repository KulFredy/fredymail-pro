"""Mağaza (IdeaSoft) site haritası okuma ve ürün eşleştirme. Linkler sentetiktir, ağ kullanılmaz."""

from __future__ import annotations

import io
from datetime import date

import httpx
import openpyxl
import pytest

from fredymail.hero import service
from fredymail.hero.sheet import BrandRow, HeroSheet, Product
from fredymail.hero.site import SiteError, SiteIndex, fetch_product_urls, model_codes, tokens
from fredymail.hero.yoldaki import parse_workbook

B = "https://shop.example.test/urun/"
URLS = [B + s for s in (
    "tamron-a063s-28-75-mm-sony-f-2-8-di-iii-vxd-g2",
    "tamron-a063z-28-75-mm-nikon-z-f-2-8-di-iii-vxd-g2",
    "tamron-a065s-70-180mm-f-2-8-di-iii-vxd-g2-sony-e",
    "kingjoy-m080-masaustu-tripod",
    "kingjoy-m080p-masaustu-tripod-pro",
    "kodak-64gb-micro-sd-uhs-i-u3-v30-a1-hafiza-karti-sari",
    "kodak-64gb-micro-sd-uhs-i-u3-v30-a1-hafiza-karti-kirmizi",
    "patona-1259-premium-batarya-canon-lp-e6n",
    "om-system-tg-7-su-gecirmez-kamera-siyah",
)]


def test_tokens_and_codes():
    assert tokens("Tamron 28-75mm F/2.8") == ["tamron", "28", "75", "mm", "f", "2", "8"]
    assert model_codes("Tamron 28-75mm (A063Z) Nikon Z") == {"a063z"}
    assert model_codes("Kodak 32GB K200W 5000mah") == {"k200w"}


@pytest.mark.parametrize(("name", "brand", "expect"), [
    ("Tamron 28-75mm F/2.8 DI III VXD G2 Nikon Z Mount Full Frame Zoom Lens (A063Z)", "Tamron", "a063z"),
    ("Tamron 28-75mm F/2.8 DI III VXD G2 Sony E Mount (A063S)", "Tamron", "a063s"),
    ("Tamron 70-180mm F/2.8 DI III VXD G2 Sony E Mount Full Frame Zoom Lens (A065S)", "Tamron", "a065s"),
    ("M080", "Kingjoy", "kingjoy-m080-"),
    ("M080P", "Kingjoy", "m080p"),
    ("Patona 1259 Premium Batarya Canon LP-E6N", "Patona", "patona-1259"),
    ("TG-7 Siyah", "OM System", "tg-7"),
])
def test_match_found(name, brand, expect):
    m = SiteIndex(URLS).match(name, brand)
    assert m.status == "found" and expect in m.url


def test_match_missing_and_ambiguous():
    idx = SiteIndex(URLS)
    assert idx.match("Tamron 16-50mm F2.8 A Sony E-Mount (B091S)", "Tamron").status == "missing"
    assert idx.match("L2 PLUS", "Yaber").status == "missing"
    assert idx.match("OM PEN 14-42mm III Kit Black", "OM System").status == "missing"
    # renk farkı dışında aynı iki ürün: hangisi olduğu bilinemez
    assert idx.match("Kodak 64GB UHS-I U3/V30/A1 Micro SD Hafıza Kartı", "Kodak").status == "ambiguous"


def test_fetch_product_urls_respects_crawl_delay():
    pages = {
        "/sitemap.xml": '<sitemapindex><sitemap><loc>https://shop.example.test/xml/sitemap_product_1.xml?sr=a</loc>'
                        '</sitemap><sitemap><loc>https://shop.example.test/xml/sitemap_image_1.xml?sr=b</loc></sitemap>'
                        '<sitemap><loc>https://shop.example.test/xml/sitemap_product_2.xml?sr=c</loc></sitemap>'
                        '</sitemapindex>',
        "/xml/sitemap_product_1.xml": f"<urlset><url><loc>{URLS[0]}</loc></url><url><loc>https://shop.example.test/"
                                      f"kategori/lens</loc></url></urlset>",
        "/xml/sitemap_product_2.xml": f"<urlset><url><loc> {URLS[3]} </loc></url><url><loc>{URLS[0]}</loc></url></urlset>",
    }
    seen, sleeps = [], []

    def handler(req: httpx.Request):
        seen.append(req.url.path)
        assert "FredyMail" in req.headers["user-agent"]
        return httpx.Response(200, text=pages[req.url.path]) if req.url.path in pages else httpx.Response(404)

    http = httpx.Client(transport=httpx.MockTransport(handler), headers={"User-Agent": "FredyMail-Hero/test"})
    urls = fetch_product_urls("https://shop.example.test/", http=http, delay=30, sleep=sleeps.append)
    assert urls == sorted({URLS[0], URLS[3]})
    assert seen == ["/sitemap.xml", "/xml/sitemap_product_1.xml", "/xml/sitemap_product_2.xml"]  # görsel haritası yok
    assert sleeps == [30, 30]
    with pytest.raises(SiteError):
        fetch_product_urls("https://shop.example.test", http=httpx.Client(transport=httpx.MockTransport(
            lambda r: httpx.Response(200, text="<sitemapindex></sitemapindex>"))), sleep=lambda s: None)


def _yoldaki() -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    t = wb.create_sheet("TAMRON")
    t.append(["103A063Z", "Tamron 28-75mm F/2.8 DI III VXD G2 Nikon Z Mount (A063Z)", 5, "KASIM İLK HAFTA"])
    t.append(["103B091S", "Tamron 16-50mm F2.8 A Sony E-Mount (B091S)", 50, "KASIM İLK HAFTA"])
    y = wb.create_sheet("YABER")
    y.append(["L2 PLUS", 1200, "TAHMINI VARIŞ KASIM ORTASI"])
    k = wb.create_sheet("KODAK SD")
    k.append(["205X", "Kodak 64GB UHS-I U3/V30/A1 Micro SD Hafıza Kartı", 100, "GÜMRÜKTE"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_site_check_marks_new_products_and_links(db, settings, monkeypatch):
    today = date(2026, 11, 2)
    items = parse_workbook(_yoldaki(), today)
    service.sync_items(db, items, today)
    monkeypatch.setattr("fredymail.hero.site.fetch_product_urls", lambda *a, **k: URLS)
    res = service.run_site_check(db, settings, today=today)
    assert res == {"date": "2026-11-02", "products": len(URLS), "found": 1, "missing": 2, "ambiguous": 1}

    new = service.new_product_keys(db)
    assert {k.split("|")[0] for k in new} == {"Tamron", "Yaber"} and len(new) == 2  # belirsiz Kodak yeni sayılmaz
    links = service.site_links(db)
    assert list(links.values()) == [URLS[1]]

    hs = HeroSheet(0, "Sayfa1", 0, "1.10.2026-31.10.2026", (2, 2), 3, 0, 1, list(range(2, 10)), 10,
                   [BrandRow(4, "Tamron", [Product("Tamron 28-75mm Nikon Z (A063Z)", None)]),
                    BrandRow(5, "Kingjoy", [Product("Kingjoy M080", None)])], 6)
    plan = service.build_plan(hs, items, new, 2026, 11, today, site=service.load_site_index(db), links=links)
    tamron = plan["brands"][0]["products"]
    assert tamron[0]["link"] == URLS[1] and tamron[0]["flags"] == ["link-site"]
    assert [p["text"] for p in tamron] == ["Tamron 28-75mm Nikon Z (A063Z)", "Tamron 16-50mm F2.8 A Sony E-Mount (B091S)"]
    assert plan["brands"][1]["products"][0]["link"] == URLS[3]  # Kingjoy M080: tablodaki eksik link mağazadan
    assert plan["brands"][-1]["brand"] == "Yaber" and plan["brands"][-1]["products"][0]["link"] is None
    assert plan["other_brands"] == []


def test_new_products_of_unmarketed_brands_are_reported_not_added():
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    v = wb.create_sheet("VIDENDUM")
    v.append(["150X", "Lowepro Tahoe BP 150 Sırt Çantası Siyah", 200, "GÜMRÜKTE"])
    buf = io.BytesIO()
    wb.save(buf)
    items = parse_workbook(buf.getvalue(), date(2026, 11, 2))
    hs = HeroSheet(0, "Sayfa1", 0, "1.10.2026-31.10.2026", (2, 2), 3, 0, 1, list(range(2, 10)), 10,
                   [BrandRow(4, "Kingjoy", [Product("Kingjoy M080", "x")])], 5)
    plan = service.build_plan(hs, items, {items[0].key}, 2026, 11, date(2026, 11, 2))
    assert [b["brand"] for b in plan["brands"]] == ["Kingjoy"]
    assert [o["text"] for o in plan["other_brands"]] == ["Lowepro Tahoe BP 150 Sırt Çantası Siyah"]


# ---------------------------------------------------------------- canlı çıktıda görülen hatalı eşleşmeler

LIVE = [B + s for s in (
    "zhiyun-weebill-5-gimbal",
    "zhiyun-weebill-5-combo-gimbal",
    "zhiyun-molus-m40-se-cob-led-isik",
    "zhiyun-parabolik-softbox-60d",
    "patona-1002-canon-nb-2lh-batarya",
    "patona-1259-premium-batarya-canon-lp-e6n",
    "patona-4141-platinum-powerbank-dji-osmo-pocket-3",
    "kodak-32gb-micro-sd-uhs-i-u3-v30-a1-hafiza-karti-adaptor-kirmizi",
    "kodak-32gb-micro-sd-uhs-i-u3-v30-a1-hafiza-karti-adaptor-sari",
    "om-system-tg-7-su-gecirmez-kamera-kirmizi",
    "om-system-tg-7-su-gecirmez-kamera-siyah",
    "tamron-a063s-28-75-mm-sony-f-2-8-di-iii-vxd-g2",
    "tamron-b061r-18-300mm-canon-rf",
    "kingjoy-m080-masaustu-tripod",
    "saramonic-witalk9-x-intercom",
)]


@pytest.mark.parametrize(("name", "brand", "expect"), [
    ("WEEBILL 5(CR133)", "Zhiyun", "weebill-5-gimbal"),            # iç kod (CR133) mağazada yok → yok sayılır
    ("WEEBILL 5 COMBO(CR133)", "Zhiyun", "weebill-5-combo"),       # "combo" varyantı seçer
    ("M40 SE PLM111(KHAKI)COMBO", "Zhiyun", "m40-se"),
    ("Patona 1002 Battery Canon S30-S70 NB2LH NB-2LH", "Patona", "patona-1002"),  # ürün numarası + battery→batarya
    ("Patona 4141 Platinum Powerbank for Dji OSmo Pocket 3/4/4P 5000mAh Black", "Patona", "patona-4141"),
    ("Kodak 32GB UHS-I U3/V30/A1 Micro SD Hafıza Kartı + Adaptör (Kırmızı)", "Kodak", "kirmizi"),  # renk ayırır
    ("Kodak 32GB UHS-I U3/V30/A1 Micro SD Hafıza Kartı + Adaptör (Sarı)", "Kodak", "sari"),
    ("TG-7 Kırmızı", "OM System", "kirmizi"),
    ("TG-7 Siyah", "OM System", "siyah"),
])
def test_live_false_misses_now_found(name, brand, expect):
    m = SiteIndex(LIVE).match(name, brand)
    assert m.status == "found" and expect in m.url, m


@pytest.mark.parametrize(("name", "brand"), [
    ("L2 PLUS", "Yaber"),                                          # marka mağazada hiç yok → yeni
    ("Yaber L1 Pro", "Yaber"),
    ("Lowepro Tahoe BP 150 Sırt Çantası Siyah", "Lowepro"),
    ("Tamron 16-50mm F2.8 A Sony E-Mount (B091S)", "Tamron"),      # Tamron linkleri kod taşır; B091S yok → yeni
    ("M080P", "Kingjoy"),
    ("Patona 1352 Platinum Usb-C Girişli Batarya Canon LP-E17", "Patona"),  # numara mağazada yok
])
def test_live_true_new_products_stay_missing(name, brand):
    assert SiteIndex(LIVE).match(name, brand).status == "missing"
