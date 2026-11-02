"""Yoldaki Mallar tablosunun (xlsx) kural tabanlı okuyucusu. AI kullanmaz.

Tablo marka başına bir sekmeden oluşur ve sekmelerin sütun düzeni farklıdır:

    kod | ürün adı | adet | durum              (çoğu sekme)
    ürün adı | adet | not | durum              (OM)
    ürün adı | adet | durum                    (YABER)
    marka | ürün adı | adet | durum            (BT-TECH: birden çok marka)

Bu yüzden satır, sütun sırasına göre değil içeriğe göre okunur: durum hücresi kalıbından,
adet sayısal hücreden, kod/ürün adı adetin solundan, not adetin sağından alınır.
Adeti ve durumu olmayan satırlar ("1247 NOLU LED IŞIK FATURA" gibi) başlık sayılıp atlanır.
"""

from __future__ import annotations

import calendar
import io
import re
from dataclasses import dataclass, field
from datetime import date, timedelta

from ..mail.classify import fold
from . import brands

MONTHS = {
    "ocak": 1, "subat": 2, "mart": 3, "nisan": 4, "mayis": 5, "haziran": 6, "temmuz": 7,
    "agustos": 8, "eylul": 9, "ekim": 10, "kasim": 11, "aralik": 12,
}

_STATUS_HINT = re.compile(
    r"tahmini|varis|gumruk|paketlen|ucus|yolda|uretim|depo|teslim|sevk|\beta\b|"
    r"\b(" + "|".join(MONTHS) + r")\b"
)
_DATE = re.compile(r"\b(\d{1,2})[./](\d{1,2})(?:[./](\d{2,4}))?\b")
_NEW_FLAG = re.compile(r"yeni\s*urun")
_SPARE = re.compile(r"yedek\s*parca|spare\s*part")

# Belirsiz durumlar için tahmini pencere (gün, bugünden itibaren)
CUSTOMS_DAYS = (0, 14)
PACKED_DAYS = (10, 45)


@dataclass(frozen=True)
class Arrival:
    """Tahmini varış. kind: date | window | customs | packed | arrived | unknown."""

    kind: str
    start: date | None
    end: date | None
    uncertain: bool
    raw: str

    def overlaps(self, first: date, last: date) -> bool:
        if self.start is None or self.end is None:
            return False
        return self.start <= last and self.end >= first

    def overdue(self, today: date) -> bool:
        """Tarihi geçmiş ama hâlâ yolda görünüyor: tablodaki durum güncel değil."""
        return self.kind in ("date", "window") and self.end is not None and self.end < today


def _guess_year(month: int, today: date) -> int:
    # "OCAK" Kasım'da yazılmışsa gelecek yılın Ocak'ıdır; geçmiş ay yakınsa (EKİM SONU) bu yıldır.
    if month < today.month - 3:
        return today.year + 1
    if month > today.month + 8:
        return today.year - 1
    return today.year


def _month_window(text: str, month: int, year: int) -> tuple[date, date]:
    last = calendar.monthrange(year, month)[1]
    d = lambda day: date(year, month, min(day, last))  # noqa: E731
    if re.search(r"ilk hafta", text):
        return d(1), d(7)
    if re.search(r"ikinci hafta", text):
        return d(8), d(14)
    if re.search(r"ucuncu hafta", text):
        return d(15), d(21)
    if re.search(r"son hafta", text):
        return d(last - 6), d(last)
    if re.search(r"\bbasi\b|\bbasinda\b", text):
        return d(1), d(10)
    if re.search(r"ortasi|ortalari|ortasinda", text):
        return d(10), d(20)
    if re.search(r"\bsonu\b|sonlari|sonunda", text):
        return d(21), d(last)
    return d(1), d(last)


def parse_status(raw: str, today: date) -> Arrival:
    """'TAHMİNİ VARIŞ 20.11.2026' / 'KASIM SONU' / 'GÜMRÜKTE' gibi yazıları tarih penceresine çevirir."""
    text = fold(raw or "").strip()
    if not text:
        return Arrival("unknown", None, None, True, raw or "")
    if "gumruk" in text:
        return Arrival("customs", today + timedelta(days=CUSTOMS_DAYS[0]),
                       today + timedelta(days=CUSTOMS_DAYS[1]), False, raw)
    if re.search(r"depoda|depoya girdi|teslim alindi|geldi", text):
        return Arrival("arrived", today, today, False, raw)
    m = _DATE.search(text)
    if m:
        day, month = int(m.group(1)), int(m.group(2))
        year = int(m.group(3)) if m.group(3) else _guess_year(month, today)
        if year < 100:
            year += 2000
        try:
            d = date(year, month, day)
            return Arrival("date", d, d, False, raw)
        except ValueError:
            pass
    for name, month in MONTHS.items():
        if re.search(rf"\b{name}\b", text):
            year = _guess_year(month, today)
            start, end = _month_window(text, month, year)
            return Arrival("window", start, end, False, raw)
    if re.search(r"paketlen|ucus|yolda|sevk|uretim", text):
        return Arrival("packed", today + timedelta(days=PACKED_DAYS[0]),
                       today + timedelta(days=PACKED_DAYS[1]), True, raw)
    return Arrival("unknown", None, None, True, raw)


@dataclass
class YoldakiItem:
    brand: str
    name: str
    code: str | None
    qty: int | None
    note: str | None
    arrival: Arrival
    new_flag: bool  # tabloda "YENİ ÜRÜN" yazıyor
    sheet: str
    rows: list[int] = field(default_factory=list)
    # Aynı ürün birden çok sevkiyatta olabilir: [(adet, durum yazısı)]
    shipments: list[tuple[int | None, str]] = field(default_factory=list)

    @property
    def key(self) -> str:
        return f"{self.brand}|{fold(self.code) if self.code else _norm_name(self.name)}"


def _norm_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", fold(name)).strip()


def _num(v) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, int | float):
        return float(v)
    return None


def _code_str(v) -> str:
    f = _num(v)
    if f is not None and f.is_integer():
        return str(int(f))
    return str(v).strip()


def _is_status(v) -> bool:
    return isinstance(v, str) and bool(_STATUS_HINT.search(fold(v)))


def parse_row(cells: list[tuple[int, object]], sheet: str, today: date) -> dict | None:
    """Tek satır → alanlar. cells: (sütun no, değer), boşlar hariç. Başlık satırı için None."""
    cells = [(c, v.strip() if isinstance(v, str) else v) for c, v in cells]
    cells = [(c, v) for c, v in cells if v not in (None, "")]
    if not cells:
        return None
    status_col = next((c for c, v in reversed(cells) if _is_status(v)), None)
    rest = [(c, v) for c, v in cells if c != status_col]
    nums = [(c, v) for c, v in rest if _num(v) is not None]
    qty_col = nums[-1][0] if nums and (len(nums) > 1 or nums[-1][0] != rest[0][0]) else None
    if status_col is None and qty_col is None:
        return None  # fatura başlığı vb.
    before = [(c, v) for c, v in rest if qty_col is None or c < qty_col]
    after = [(c, v) for c, v in rest if qty_col is not None and c > qty_col]

    brand = None
    texts = []
    for c, v in before:
        if c == qty_col:
            continue
        if isinstance(v, str) and brands.canonical(v) and len(before) > 1 and brand is None and not texts:
            brand = brands.canonical(v)
            continue
        texts.append(v)
    if not texts:
        return None
    if len(texts) >= 2:
        code, name = _code_str(texts[0]), str(texts[-1])
    else:
        code, name = None, str(texts[0])
    if _num(name) is not None or _SPARE.search(fold(name)):
        return None

    qty = None
    if qty_col is not None:
        q = _num(dict(rest)[qty_col])
        qty = int(q) if q is not None and q.is_integer() else None
    note = " · ".join(str(v) for _, v in after) or None
    raw_status = dict(cells)[status_col] if status_col is not None else ""
    blob = fold(" ".join(str(v) for _, v in cells))
    if brand is None:
        sheet_brand = None if fold(sheet) in brands.GROUP_SHEETS else brands.canonical(sheet)
        brand = brands.from_product_name(name) or sheet_brand or sheet.strip().title()
    return {
        "brand": brand, "name": re.sub(r"\s+", " ", name).strip(), "code": code, "qty": qty, "note": note,
        "arrival": parse_status(str(raw_status), today), "new_flag": bool(_NEW_FLAG.search(blob)),
    }


def parse_workbook(data: bytes, today: date) -> list[YoldakiItem]:
    """xlsx içeriğini okur; aynı ürünün tekrar eden satırlarını (aynı marka + kod/ad) birleştirir."""
    import openpyxl

    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    merged: dict[str, YoldakiItem] = {}
    order: list[str] = []
    for ws in wb.worksheets:
        for r_idx, row in enumerate(ws.iter_rows(values_only=True), start=1):
            cells = [(i, v) for i, v in enumerate(row) if v is not None]
            p = parse_row(cells, ws.title, today)
            if p is None:
                continue
            item = YoldakiItem(sheet=ws.title, rows=[r_idx], shipments=[(p["qty"], p["arrival"].raw)], **p)
            prev = merged.get(item.key)
            if prev is None:
                merged[item.key] = item
                order.append(item.key)
                continue
            # Aynı ürün birden çok sevkiyatta: adetleri topla, en erken varışı ve "yeni" bayrağını koru
            if item.qty is not None:
                prev.qty = (prev.qty or 0) + item.qty
            prev.rows.extend(item.rows)
            prev.shipments.extend(item.shipments)
            prev.new_flag = prev.new_flag or item.new_flag
            if item.note and item.note != prev.note:
                prev.note = " · ".join(x for x in (prev.note, item.note) if x)
            a, b = prev.arrival, item.arrival
            if b.start is not None and (a.start is None or b.start < a.start):
                prev.arrival = b
    wb.close()
    return [merged[k] for k in order]


def month_bounds(year: int, month: int) -> tuple[date, date]:
    return date(year, month, 1), date(year, month, calendar.monthrange(year, month)[1])


def arriving_in(items: list[YoldakiItem], year: int, month: int, today: date) -> dict[str, list[dict]]:
    """Seçilen ay içinde stoğa girmesi beklenen ürünler, marka bazında; uyarılarla birlikte.

    Dönen her kayıtta `flags`: new (tabloda YENİ ÜRÜN), uncertain (tarih belirsiz),
    overdue (tarihi geçmiş, durum güncel değil). Yeni olanlar marka içinde öne alınır.
    """
    first, last = month_bounds(year, month)
    out: dict[str, list[dict]] = {}
    for it in items:
        a = it.arrival
        overdue = a.overdue(today)
        if not (a.overlaps(first, last) or overdue or a.kind == "unknown"):
            continue
        flags = [f for f, on in (("new", it.new_flag), ("uncertain", a.uncertain), ("overdue", overdue)) if on]
        out.setdefault(it.brand, []).append({
            "name": it.name, "code": it.code, "qty": it.qty, "status": a.raw, "kind": a.kind,
            "start": a.start.isoformat() if a.start else None, "end": a.end.isoformat() if a.end else None,
            "flags": flags, "note": it.note, "sheet": it.sheet,
            "shipments": [{"qty": q, "status": st} for q, st in it.shipments],
        })
    for lst in out.values():
        lst.sort(key=lambda x: ("new" not in x["flags"], x["start"] or "9999", x["name"]))
    return dict(sorted(out.items()))
