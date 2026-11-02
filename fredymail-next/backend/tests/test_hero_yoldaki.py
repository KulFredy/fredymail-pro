"""Yoldaki Mallar okuyucusu: veritabanı/ağ gerektirmez. Veriler sentetiktir."""

from __future__ import annotations

import io
from datetime import date

import openpyxl
import pytest

from fredymail.hero import brands
from fredymail.hero.yoldaki import arriving_in, parse_status, parse_workbook

TODAY = date(2026, 11, 2)


@pytest.mark.parametrize(("raw", "kind", "start", "end", "uncertain"), [
    ("TAHMİNİ VARIŞ 20.11.2026", "date", date(2026, 11, 20), date(2026, 11, 20), False),
    ("TAHMINI VARIŞ KASIM ORTASI", "window", date(2026, 11, 10), date(2026, 11, 20), False),
    ("TAHMİNİ VARIŞ KASIM SONU", "window", date(2026, 11, 21), date(2026, 11, 30), False),
    ("TAHMİNİ VARIŞ KASIM İLK HAFTA", "window", date(2026, 11, 1), date(2026, 11, 7), False),
    ("TAHMİNİ VARIŞ EKİM SONU", "window", date(2026, 10, 21), date(2026, 10, 31), False),
    ("ARALIK", "window", date(2026, 12, 1), date(2026, 12, 31), False),
    ("OCAK BAŞI", "window", date(2027, 1, 1), date(2027, 1, 10), False),  # Kasım'da yazılan Ocak = gelecek yıl
    ("GÜMRÜKTE", "customs", date(2026, 11, 2), date(2026, 11, 16), False),
    ("PAKETLENDİ UÇUŞ BİLGİSİ BEKLENİYOR", "packed", date(2026, 11, 12), date(2026, 12, 17), True),
    ("DEPODA", "arrived", TODAY, TODAY, False),
    ("", "unknown", None, None, True),
])
def test_parse_status(raw, kind, start, end, uncertain):
    a = parse_status(raw, TODAY)
    assert (a.kind, a.start, a.end, a.uncertain) == (kind, start, end, uncertain)


def test_overdue_only_for_dated_statuses():
    assert parse_status("TAHMİNİ VARIŞ EKİM SONU", TODAY).overdue(TODAY)
    assert not parse_status("GÜMRÜKTE", TODAY).overdue(TODAY)
    assert not parse_status("KASIM SONU", TODAY).overdue(TODAY)


def test_brand_aliases():
    assert brands.canonical("KODAK SD") == "Kodak"
    assert brands.canonical("om") == "OM System"
    assert brands.canonical("KF CONCEPT") == "K&F Concept"
    assert brands.canonical("Bilinmeyen") is None
    assert brands.from_product_name("Manfrotto 035 Süper Clamp") == "Manfrotto"
    assert brands.from_product_name("Lowepro Tahoe BP 150") == "Lowepro"
    assert brands.from_product_name("OM PEN 14-42mm III Kit") == "OM System"
    assert brands.from_product_name("OMNI tripod") is None


def _workbook() -> bytes:
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    om = wb.create_sheet("OM")  # ürün | adet | not | durum
    om.append(["OM Yeni Kamera Kit", 3, "**YENİ ÜRÜN**", "GÜMRÜKTE"])
    om.append(["TG-7 Siyah", 10, "8 Adet bayi, 2 Servis", "GÜMRÜKTE"])
    kodak = wb.create_sheet("KODAK SD")  # kod | ürün | adet | durum
    kodak.append(["205TEST32", "Kodak 32GB Test Kart", 100, "GÜMRÜKTE"])
    kodak.append([None, None, None, None])
    kodak.append(["205TEST32", "Kodak 32GB Test Kart", 600, "PAKETLENDİ UÇUŞ BİLGİSİ BEKLENİYOR"])
    kodak.append(["205TEST64", "Kodak 64GB Test Kart", 50, "PAKETLENDİ UÇUŞ BİLGİSİ BEKLENİYOR"])
    yaber = wb.create_sheet("YABER")  # ürün | adet | durum
    yaber.append(["L2 PLUS", 1200, "TAHMINI VARIŞ KASIM ORTASI"])
    yaber.append(["Yaber L3", 30, "TAHMİNİ VARIŞ ARALIK SONU"])
    patona = wb.create_sheet("PATONA")  # sayısal kod | ürün | adet | durum, fatura başlıkları
    patona.append([None, "1247 NOLU LED IŞIK FATURA"])
    patona.append([1624167.0, "Patona 4167 Test Işık", 25, "GÜMRÜKTE"])
    patona.append([None, "1253 NOLU ŞARJ CİHAZI FATURA"])
    patona.append([1621422.0, "Patona 1422 Test Şarj", 140, "TAHMİNİ VARIŞ EKİM SONU"])
    bt = wb.create_sheet("BT-TECH")  # marka | ürün | adet | durum
    bt.append(["KINGJOY", "VT-TEST", 150, "TAHMİNİ VARIŞ 20.11.2026"])
    bt.append(["SARAMONIC", "WiTalk Test", 10, "TAHMİNİ VARIŞ 20.11.2026"])
    bt.append(["SARAMONIC", "Yedek Parca", None, "TAHMİNİ VARIŞ 20.11.2026"])
    vid = wb.create_sheet("VIDENDUM")  # marka ürün adından
    vid.append(["101TEST", "Manfrotto Test Tripod", 4, "GÜMRÜKTE"])
    vid.append(["150TEST", "Lowepro Test Çanta", 8, "GÜMRÜKTE"])
    wb.create_sheet("SJCAM")  # boş sekme
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_parse_workbook_layouts():
    items = {(i.brand, i.name): i for i in parse_workbook(_workbook(), TODAY)}
    assert ("Saramonic", "Yedek Parca") not in items  # yedek parça atlanır
    assert len(items) == 12  # fatura başlıkları ve boş satırlar atlanır, tekrar eden ürün birleşir

    om = items[("OM System", "OM Yeni Kamera Kit")]
    assert om.new_flag and om.qty == 3 and om.note == "**YENİ ÜRÜN**" and om.code is None
    assert not items[("OM System", "TG-7 Siyah")].new_flag

    k32 = items[("Kodak", "Kodak 32GB Test Kart")]
    assert k32.code == "205TEST32" and k32.qty == 700
    assert [s for _, s in k32.shipments] == ["GÜMRÜKTE", "PAKETLENDİ UÇUŞ BİLGİSİ BEKLENİYOR"]
    assert k32.arrival.kind == "customs"  # en erken varış korunur

    assert items[("Patona", "Patona 4167 Test Işık")].code == "1624167"
    assert items[("Kingjoy", "VT-TEST")].qty == 150
    assert ("Saramonic", "WiTalk Test") in items
    assert ("Manfrotto", "Manfrotto Test Tripod") in items and ("Lowepro", "Lowepro Test Çanta") in items
    assert items[("Yaber", "L2 PLUS")].arrival.start == date(2026, 11, 10)


def test_arriving_in_month():
    res = arriving_in(parse_workbook(_workbook(), TODAY), 2026, 11, TODAY)
    names = {b: [r["name"] for r in rows] for b, rows in res.items()}
    assert "Yaber L3" not in names["Yaber"]  # Aralık sonu: Kasım dışı
    assert names["OM System"][0] == "OM Yeni Kamera Kit"  # yeni ürün marka içinde öne alınır
    flags = {r["name"]: r["flags"] for rows in res.values() for r in rows}
    assert flags["OM Yeni Kamera Kit"] == ["new"]
    assert flags["Kodak 64GB Test Kart"] == ["uncertain"]
    assert flags["Patona 1422 Test Şarj"] == ["overdue"]  # Ekim sonu geçti, durum güncel değil
    assert flags["L2 PLUS"] == []

    dec = arriving_in(parse_workbook(_workbook(), TODAY), 2026, 12, TODAY)
    assert "Yaber L3" in [r["name"] for r in dec["Yaber"]]
