"""Hero Ürünler Listesi (Google Sheets) okuma ve yazma.

Tablo düzeni (kullanıcının elle tuttuğu şablon):

    TARİH | 1.10.2026-31.10.2026
    Sıra No: | Marka | Ürün-1 … Ürün-8 | Toplam Ürün
    1 | SJCam | <ürün (linkli)> …   | 7
    …
    TOPLAM |      |                   | 62

Yazarken yalnızca hücre değeri, link ve not değişir; renk/yazı tipi/kenarlık gibi biçimler korunur.
Önce mevcut sekme arşive kopyalanır (ör. "Ekim 2026"), sonra sabit sekme (`Sayfa1`) güncellenir: link aynı kalır.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from ..mail.classify import fold
from . import brands

MAX_PRODUCTS = 8
MONTH_NAMES = ("Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim",
               "Kasım", "Aralık")
LINK_PENDING_NOTE = "Link bekleniyor: ürün sayfası zoomithalat.com'da henüz açılmadı."


@dataclass
class Product:
    text: str
    link: str | None = None


@dataclass
class BrandRow:
    row: int  # 0 tabanlı satır
    brand: str
    products: list[Product] = field(default_factory=list)


@dataclass
class HeroSheet:
    sheet_id: int
    title: str
    index: int
    period: str | None
    period_cell: tuple[int, int] | None
    header_row: int
    no_col: int | None
    brand_col: int
    product_cols: list[int]
    total_col: int | None
    rows: list[BrandRow]
    total_row: int | None

    def as_dict(self) -> dict:
        return {"period": self.period, "brands": [
            {"brand": r.brand, "products": [{"text": p.text, "link": p.link} for p in r.products]} for r in self.rows]}


def _cell_text(c: dict) -> str:
    return str(c.get("formattedValue") or "").strip()


def _cell_link(c: dict) -> str | None:
    if c.get("hyperlink"):
        return c["hyperlink"]
    for run in c.get("textFormatRuns") or []:
        uri = ((run.get("format") or {}).get("link") or {}).get("uri")
        if uri:
            return uri
    return None


_PERIOD = re.compile(r"\d{1,2}\.\d{1,2}\.\d{4}\s*-\s*\d{1,2}\.\d{1,2}\.\d{4}")


def parse_grid(resp: dict, tab: str) -> HeroSheet:
    """`GoogleClient.sheet_grid` yanıtını şablona göre çözer."""
    sheet = next((s for s in resp.get("sheets", []) if s["properties"]["title"] == tab), None)
    if sheet is None:
        raise ValueError(f"'{tab}' sekmesi bulunamadı")
    props = sheet["properties"]
    data = (sheet.get("data") or [{}])[0]
    r0, c0 = data.get("startRow", 0), data.get("startColumn", 0)
    grid: list[list[dict]] = [(rd.get("values") or []) for rd in data.get("rowData") or []]

    header_row = brand_col = None
    for ri, row in enumerate(grid):
        for ci, c in enumerate(row):
            if fold(_cell_text(c)) == "marka":
                header_row, brand_col = ri, ci
                break
        if header_row is not None:
            break
    if header_row is None or brand_col is None:
        raise ValueError("Başlık satırı ('Marka') bulunamadı; tablo düzeni değişmiş olabilir")

    product_cols, total_col, no_col = [], None, None
    for ci, c in enumerate(grid[header_row]):
        t = fold(_cell_text(c))
        if re.match(r"urun\s*-?\s*\d+", t):
            product_cols.append(ci)
        elif t.startswith("toplam"):
            total_col = ci
        elif t.startswith("sira"):
            no_col = ci
    if not product_cols:
        raise ValueError("'Ürün-1…' sütunları bulunamadı")

    period = period_cell = None
    for ri in range(header_row):
        for ci, c in enumerate(grid[ri]):
            if _PERIOD.search(_cell_text(c)):
                period, period_cell = _PERIOD.search(_cell_text(c)).group(0), (r0 + ri, c0 + ci)
                break
        if period:
            break

    rows: list[BrandRow] = []
    total_row = None
    for ri in range(header_row + 1, len(grid)):
        row = grid[ri]
        get = lambda ci, row=row: row[ci] if ci < len(row) else {}  # noqa: E731
        first = fold(_cell_text(get(0)))
        if first.startswith("toplam") or (no_col is not None and fold(_cell_text(get(no_col))).startswith("toplam")):
            total_row = r0 + ri
            break
        name = _cell_text(get(brand_col))
        if not name:
            if rows:
                break
            continue
        prods = [Product(_cell_text(get(ci)), _cell_link(get(ci))) for ci in product_cols if _cell_text(get(ci))]
        rows.append(BrandRow(r0 + ri, brands.canonical(name) or name, prods))
    return HeroSheet(sheet_id=props.get("sheetId", 0), title=props["title"], index=props.get("index", 0),
                     period=period, period_cell=period_cell, header_row=r0 + header_row,
                     no_col=None if no_col is None else c0 + no_col, brand_col=c0 + brand_col,
                     product_cols=[c0 + c for c in product_cols], total_col=None if total_col is None else c0 + total_col,
                     rows=rows, total_row=total_row)


def period_text(year: int, month: int) -> str:
    import calendar

    return f"1.{month}.{year}-{calendar.monthrange(year, month)[1]}.{month}.{year}"


def archive_title(period: str | None) -> str | None:
    """'1.10.2026-31.10.2026' -> 'Ekim 2026'."""
    m = re.match(r"\d{1,2}\.(\d{1,2})\.(\d{4})", period or "")
    if not m:
        return None
    return f"{MONTH_NAMES[int(m.group(1)) - 1]} {m.group(2)}"


def col_letter(ci: int) -> str:
    s = ""
    ci += 1
    while ci:
        ci, rem = divmod(ci - 1, 26)
        s = chr(65 + rem) + s
    return s


def _str(v: str) -> dict:
    return {"userEnteredValue": {"stringValue": v}}


# Renkler (yazı rengi): kategori → (ad, RGB, açıklama). Beyaz zeminde okunaklı, birbirinden ayrışan tonlar.
CATEGORIES = {
    "new": ("Kırmızı", (198, 40, 40), "Bu ay listeye ilk kez giren ürün"),
    "arriving": ("Kahverengi", (141, 85, 36), "Listede devam eden, bu ay stoğa girecek ürün (Yoldaki Mallar)"),
    "carried": ("Mavi", (30, 90, 168), "Önceki aydan devreden ürün"),
}
FONT_SIZE = 10
BASIC_FIELDS = "userEnteredValue,textFormatRuns,note"
PRODUCT_FIELDS = (BASIC_FIELDS + ",userEnteredFormat.textFormat.foregroundColorStyle,userEnteredFormat.textFormat.fontSize,"
                  "userEnteredFormat.textFormat.bold,userEnteredFormat.wrapStrategy,"
                  "userEnteredFormat.horizontalAlignment,userEnteredFormat.verticalAlignment")
LEGEND_ROWS = 7  # TOPLAM satırının altında açıklama için ayrılan satır sayısı


def _rgb(c: tuple[int, int, int]) -> dict:
    return {"rgbColor": {"red": c[0] / 255, "green": c[1] / 255, "blue": c[2] / 255}}


def category_of(p: dict) -> str:
    return p.get("category") or ("new" if p.get("source") == "yeni" else "carried")


def _product_cell(p: dict | None) -> dict:
    fmt = {"wrapStrategy": "WRAP", "horizontalAlignment": "CENTER", "verticalAlignment": "MIDDLE",
           "textFormat": {"fontSize": FONT_SIZE, "bold": False}}
    if not p or not p.get("text"):
        return {"userEnteredFormat": fmt}  # değer, link, not ve renk temizlenir; hizalama korunur
    color = _rgb(CATEGORIES[category_of(p)][1])
    fmt["textFormat"]["foregroundColorStyle"] = color
    cell = {**_str(p["text"]), "userEnteredFormat": fmt}
    if p.get("link"):
        cell["textFormatRuns"] = [{"startIndex": 0, "format": {"link": {"uri": p["link"]},
                                                                "foregroundColorStyle": color, "underline": True}}]
    else:
        cell["note"] = LINK_PENDING_NOTE
    return cell


def legend_rows(start_col: int, text_col: int) -> list[dict[int, dict]]:
    """Sayfanın altındaki renk açıklaması (satır satır, sütun → hücre)."""
    def txt(v: str, color=None, bold=False) -> dict:
        tf = {"bold": bold, "fontSize": FONT_SIZE}
        if color:
            tf["foregroundColorStyle"] = _rgb(color)
        return {**_str(v), "userEnteredFormat": {"textFormat": tf, "wrapStrategy": "OVERFLOW_CELL",
                                                 "horizontalAlignment": "LEFT", "verticalAlignment": "MIDDLE"}}

    rows: list[dict[int, dict]] = [{}, {start_col: txt("Renklerin anlamı", bold=True)}]
    for name, color, desc in CATEGORIES.values():
        rows.append({start_col: txt(f"● {name}", color, bold=True), text_col: txt(desc)})
    rows.append({start_col: txt("Notlar", bold=True), text_col: txt(
        "Bir ürün en fazla 3 ay üst üste listede kalır (bu ay yeni olarak gelmiyorsa). Linki olmayan ürünün mağaza "
        "sayfası henüz açılmamıştır. Liste her ay otomatik hazırlanır, onaylandıktan sonra yazılır.")})
    return rows


def build_write_requests(hs: HeroSheet, plan: dict, existing_titles: list[str]) -> list[dict]:
    """Plan → Sheets batchUpdate istekleri. Sıra önemlidir: önce arşiv kopyası, sonra satır sayısı, sonra değerler."""
    reqs: list[dict] = []
    others = [t for t in existing_titles if t != hs.title]  # canlı sekmenin kendi adı hariç
    # 1) Canlı sekmenin adı yeni ayın adı olur (kimliği, yani tasarımcının linki değişmez)
    new_title = archive_title(plan.get("period"))
    if new_title and new_title != hs.title:
        if new_title in others:
            raise ValueError(f"'{new_title}' adında başka bir sekme var; canlı sekme yeniden adlandırılamıyor. "
                             "O sekmeyi silin ya da yeniden adlandırın.")
        reqs.append({"updateSheetProperties": {"properties": {"sheetId": hs.sheet_id, "title": new_title},
                                               "fields": "title"}})
    # 2) Eski içerik arşive kopyalanır (ad artık boşta); aynı ay yeniden yazılıyorsa arşivlenmez
    arch = plan.get("archive_title") or archive_title(hs.period)
    same_month = bool(plan.get("period")) and plan.get("period") == hs.period
    if arch and arch not in others and not same_month:
        reqs.append({"duplicateSheet": {"sourceSheetId": hs.sheet_id, "insertSheetIndex": hs.index + 1,
                                        "newSheetName": arch}})
    if hs.period_cell and plan.get("period"):
        r, c = hs.period_cell
        reqs.append({"updateCells": {"start": {"sheetId": hs.sheet_id, "rowIndex": r, "columnIndex": c},
                                     "rows": [{"values": [_str(plan["period"])]}], "fields": "userEnteredValue"}})

    brands_plan = plan["brands"]
    if not hs.rows:
        raise ValueError("Tabloda marka satırı yok; şablon bozulmuş olabilir")
    first, n_old, n_new = hs.rows[0].row, len(hs.rows), len(brands_plan)
    if n_new > n_old:
        reqs.append({"insertDimension": {"range": {"sheetId": hs.sheet_id, "dimension": "ROWS",
                                                   "startIndex": first + n_old, "endIndex": first + n_new},
                                         "inheritFromBefore": True}})
    elif n_new < n_old:
        reqs.append({"deleteDimension": {"range": {"sheetId": hs.sheet_id, "dimension": "ROWS",
                                                   "startIndex": first + n_new, "endIndex": first + n_old}}})

    p_first, p_last = col_letter(hs.product_cols[0]), col_letter(hs.product_cols[-1])
    for i, b in enumerate(brands_plan):
        r = first + i
        cells: dict[int, dict] = {}
        if hs.no_col is not None:
            cells[hs.no_col] = {"userEnteredValue": {"numberValue": i + 1}}
        cells[hs.brand_col] = _str(b["brand"])
        if hs.total_col is not None:
            cells[hs.total_col] = {"userEnteredValue": {"formulaValue": f"=COUNTA({p_first}{r + 1}:{p_last}{r + 1})"}}
        reqs.extend(_row_updates(hs.sheet_id, r, cells))
        prods = (b.get("products") or [])[:len(hs.product_cols)]
        pcells = {ci: _product_cell(prods[k] if k < len(prods) else None) for k, ci in enumerate(hs.product_cols)}
        reqs.extend(_row_updates(hs.sheet_id, r, pcells, PRODUCT_FIELDS))

    if hs.total_row is not None and hs.total_col is not None:
        tr = hs.total_row + (n_new - n_old)
        tc = col_letter(hs.total_col)
        reqs.extend(_row_updates(hs.sheet_id, tr, {hs.total_col: {"userEnteredValue": {
            "formulaValue": f"=SUM({tc}{first + 1}:{tc}{first + n_new})"}}}))
        # Renk açıklaması: TOPLAM'ın altındaki alan önce temizlenir (geçen ayın açıklaması da satırlarla birlikte
        # kaydığı için aynı yerde durur), sonra yeniden yazılır.
        start_col, text_col = hs.brand_col, hs.product_cols[0]
        reqs.append({"repeatCell": {
            "range": {"sheetId": hs.sheet_id, "startRowIndex": tr + 1, "endRowIndex": tr + 1 + LEGEND_ROWS,
                      "startColumnIndex": start_col, "endColumnIndex": hs.product_cols[-1] + 1},
            "cell": {}, "fields": "userEnteredValue,textFormatRuns,note,userEnteredFormat.textFormat"}})
        for k, cells in enumerate(legend_rows(start_col, text_col)):
            if cells:
                reqs.extend(_row_updates(hs.sheet_id, tr + 1 + k, cells, PRODUCT_FIELDS))
    return reqs


def _row_updates(sheet_id: int, row: int, cells: dict[int, dict], fields: str = BASIC_FIELDS) -> list[dict]:
    """Bitişik sütun grupları için birer updateCells; yönetilmeyen sütunlara dokunulmaz."""
    out, cols = [], sorted(cells)
    i = 0
    while i < len(cols):
        j = i
        while j + 1 < len(cols) and cols[j + 1] == cols[j] + 1:
            j += 1
        out.append({"updateCells": {
            "start": {"sheetId": sheet_id, "rowIndex": row, "columnIndex": cols[i]},
            "rows": [{"values": [cells[c] for c in cols[i:j + 1]]}],
            "fields": fields}})
        i = j + 1
    return out
