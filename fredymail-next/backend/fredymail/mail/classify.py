"""Kural tabanlı sınıflandırma: belge türü (fatura/fiyat listesi/...), dosya türü,
otomatik gönderim (bülten/no-reply) ve prompt-injection şüphesi.

Kurallar bilerek basit ve açıklanabilir tutuldu; AI'ya bağımlı değildir.
"""

from __future__ import annotations

import re

_TR_FOLD = str.maketrans({
    "İ": "i", "I": "i", "ı": "i", "Ş": "s", "ş": "s", "Ğ": "g", "ğ": "g",
    "Ü": "u", "ü": "u", "Ö": "o", "ö": "o", "Ç": "c", "ç": "c", "Â": "a", "â": "a",
})


def fold(s: str) -> str:
    """Türkçe karakterleri ASCII'ye katlayıp küçük harfe çevirir (eşleştirme için)."""
    return s.translate(_TR_FOLD).lower()


_SUBJECT_PREFIX = re.compile(
    r"^\s*((re|fw|fwd|ynt|yanit|cevap|ilt|ilet|iletildi|aw|wg|tr|sv|vs|rif|r)\s*(\[\d+\])?\s*[:：]\s*)+",
    re.IGNORECASE,
)
_REPLY_PREFIX = re.compile(r"^\s*(re|ynt|yanit|cevap|aw|sv|rif|r)\s*(\[\d+\])?\s*[:：]", re.IGNORECASE)


def normalize_subject(subject: str) -> str:
    s = fold(subject or "")
    prev = None
    while prev != s:
        prev = s
        s = _SUBJECT_PREFIX.sub("", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:500]


def has_reply_prefix(subject: str) -> bool:
    return bool(_REPLY_PREFIX.match(fold(subject or "")))


# ---------------------------------------------------------------- belge türleri

DOC_KIND_LABELS = {
    "invoice": "Fatura",
    "proforma": "Proforma",
    "pricelist": "Fiyat listesi",
    "quote": "Teklif",
    "order": "Sipariş",
    "statement": "Ekstre / cari",
    "contract": "Sözleşme",
    "shipping": "Sevkiyat / irsaliye",
}

_DOC_RULES: dict[str, list[str]] = {
    "invoice": [r"\bfatura", r"\be-?fatura", r"\be-?arsiv", r"\binvoice", r"\bfaturasi\b", r"\bbill(ing)?\b", r"\brechnung"],
    "proforma": [r"\bproforma", r"\bpro-forma", r"\bpi\s*(no|#)"],
    "pricelist": [r"fiyat\s*liste", r"\bprice\s*-?\s*list", r"\bpricelist", r"\bfiyatlar\b", r"\bpreisliste", r"\bdealer\s*price", r"\bbayi\s*fiyat"],
    "quote": [r"\bteklif", r"\bquotation", r"\bquote\b", r"\bfiyat\s*teklif", r"\brfq\b", r"\bangebot"],
    "order": [r"\bsiparis", r"\bpurchase\s*order", r"\bp\.?o\.?\s*(no|#)", r"\border\s*(confirmation|no|#)"],
    "statement": [r"\bekstre", r"\bcari\s*(hesap|ekstre|mutabakat)", r"\bmutabakat", r"\bstatement of account", r"\bhesap\s*ozeti"],
    "contract": [r"\bsozlesme", r"\bcontract\b", r"\bagreement\b", r"\bdistributor\s*agreement"],
    "shipping": [r"\birsaliye", r"\bkonsimento", r"\bpacking\s*list", r"\bbill of lading", r"\bawb\b", r"\bgumruk", r"\bcustoms\b", r"\bshipment"],
}
_DOC_RE = {k: re.compile("|".join(v)) for k, v in _DOC_RULES.items()}

# Klasör adı → belge türü (Outlook/IceWarp kurallarıyla oluşturulan klasörler)
_FOLDER_KIND = {
    "faturalar": "invoice",
    "fatura": "invoice",
    "invoices": "invoice",
    "fiyat listeleri": "pricelist",
    "fiyat listesi": "pricelist",
    "price lists": "pricelist",
    "teklifler": "quote",
    "siparisler": "order",
}


def doc_kinds(subject: str, body: str, attachment_names: list[str], folder_names: list[str]) -> list[str]:
    """Konu ve ek adları güçlü sinyaldir; gövde yalnızca ilk 3000 karakterde aranır
    (alıntılanan eski yazışmaların yanlış pozitif üretmesini azaltmak için)."""
    kinds: set[str] = set()
    strong = fold(subject + "\n" + "\n".join(attachment_names))
    weak = fold(body[:3000])
    for kind, rx in _DOC_RE.items():
        if rx.search(strong):
            kinds.add(kind)
        elif kind in ("invoice", "pricelist", "proforma") and rx.search(weak) and _has_document(attachment_names):
            # gövdede geçiyor ve gerçek bir belge eki var (imza görseli değil) → büyük ihtimalle belge ekli
            kinds.add(kind)
    for fname in folder_names:
        leaf = fold(fname.replace("\\", "/").split("/")[-1].strip())
        if leaf in _FOLDER_KIND:
            kinds.add(_FOLDER_KIND[leaf])
    if "proforma" in kinds:  # proforma fatura muhasebe faturası değildir
        kinds.discard("invoice")
    return sorted(kinds)


_DOC_EXTS = (".pdf", ".xls", ".xlsx", ".xlsm", ".csv", ".xml", ".doc", ".docx", ".odt", ".ods", ".zip", ".rar")


def _has_document(names: list[str]) -> bool:
    return any(n.lower().endswith(_DOC_EXTS) for n in names)


# ---------------------------------------------------------------- dosya türleri

_EXT_KIND = {
    "pdf": "pdf",
    "xls": "spreadsheet", "xlsx": "spreadsheet", "xlsm": "spreadsheet", "csv": "spreadsheet", "ods": "spreadsheet", "numbers": "spreadsheet",
    "doc": "document", "docx": "document", "odt": "document", "rtf": "document", "txt": "document", "pages": "document",
    "ppt": "presentation", "pptx": "presentation", "key": "presentation",
    "jpg": "image", "jpeg": "image", "png": "image", "gif": "image", "heic": "image", "webp": "image", "tif": "image", "tiff": "image", "bmp": "image",
    "zip": "archive", "rar": "archive", "7z": "archive", "gz": "archive", "tar": "archive",
    "xml": "einvoice",  # e-Fatura UBL XML
    "eml": "email", "msg": "email",
}

FILE_KIND_LABELS = {
    "pdf": "PDF", "spreadsheet": "Tablo (Excel/CSV)", "document": "Belge (Word/metin)",
    "presentation": "Sunum", "image": "Görsel", "archive": "Arşiv (zip/rar)",
    "einvoice": "e-Fatura XML", "email": "Ekli e-posta", "other": "Diğer",
}


def file_kind_for(filename: str, content_type: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext in _EXT_KIND:
        return _EXT_KIND[ext]
    ct = (content_type or "").lower()
    if ct == "application/pdf":
        return "pdf"
    if ct.startswith("image/"):
        return "image"
    if "spreadsheet" in ct or "excel" in ct or ct == "text/csv":
        return "spreadsheet"
    if "word" in ct or ct == "text/plain":
        return "document"
    if ct == "message/rfc822":
        return "email"
    if "zip" in ct or "compressed" in ct:
        return "archive"
    return "other"


_SIGNATURE_IMG = re.compile(r"^(image|outlook|logo|signature|imza|banner|icon|ikon)[\w-]*\.(png|jpe?g|gif|bmp)$")


def is_signature_image(filename: str, content_type: str, size: int | None, content_id: str | None) -> bool:
    """Outlook imza/logo görselleri (image001.png...) ek sayılmaz: 'Ekli' filtresini ve belge tahminini bozuyor."""
    if not (content_type or "").lower().startswith("image/"):
        return False
    if size is not None and size > 300_000:
        return False
    return bool(content_id) or bool(_SIGNATURE_IMG.match(fold(filename or "")))


# ---------------------------------------------------------------- otomatik gönderimler

_NOREPLY = re.compile(r"(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|notify@|newsletter|bulten|"
                      r"bounce|marketing@|kampanya@|campaign|spam|alerts?@|reports?@|mailer@|automated@|system@|"
                      r"info@.*mailchimp)", re.I)
_BULK_BODY = re.compile("|".join([
    r"goruntuleyemiyorsaniz", r"goruntulenemiyorsa", r"tarayicida (goruntule|ac)", r"web versiyon", r"view (it |this )?(email |e-mail )?in (your )?browser",
    r"unsubscribe", r"abonelik(ten)? (cik|iptal)", r"aboneligi(nizi)? (iptal|sonlandir)", r"listeden (cik|ayril)",
    r"e-?bulten", r"bu e-?posta(yi)? (otomatik|sistem tarafindan)", r"otomatik olarak (olusturul|gonderil)",
    r"this is an automated", r"automatically generated", r"do not reply to this", r"bu (e-?postayi|maili) yanitlamayiniz",
    r"lutfen (bu (e-?postayi|maili) )?yanitlamayiniz", r"spam report", r"ileti almak istemiyorsaniz",
]))


# Düzenli otomatik raporlar (Ads/Analytics, günlük/haftalık rapor, sunucu etiketli spam): yanıt beklemez.
_REPORT_SUBJECT = re.compile(
    r"\b(gunluk|haftalik|aylik|daily|weekly|monthly)\b.{0,60}\b(rapor|raporu|report|digest)\b"
    r"|\b(kampanya|performans|performance|analytics|ads|reklam)\b.{0,30}\b(rapor|raporu|report)\b"
    r"|^\s*\[(\*+\s*)?spam(\s*\*+)?\]")


def looks_bulk(from_email: str, subject: str, body: str) -> bool:
    """Başlık bilgisi olmasa da toplu/otomatik maili gövde, konu ve gönderen kalıplarından tanır."""
    if _NOREPLY.search(from_email or ""):
        return True
    if _REPORT_SUBJECT.search(fold(subject or "")):
        return True
    b = fold(body or "")
    return bool(_BULK_BODY.search(b[:2500] + " " + b[-2500:] + " " + fold(subject or "")))


def detect_automated(headers: dict[str, str], from_email: str) -> bool:
    if "list-unsubscribe" in headers or "list-id" in headers:
        return True
    if headers.get("precedence", "").lower() in ("bulk", "list", "junk"):
        return True
    auto = headers.get("auto-submitted", "").lower()
    if auto and auto != "no":
        return True
    if "x-autoreply" in headers or "x-autorespond" in headers:
        return True
    return bool(_NOREPLY.search(from_email or ""))


# ---------------------------------------------------------------- prompt injection şüphesi

_INJECTION = re.compile(
    "|".join([
        r"ignore (all |any )?(previous|prior|above) (instructions|prompts?)",
        r"disregard (the |all )?(previous|above|system)",
        r"you are now (a|an|in) ",
        r"system prompt",
        r"\bact as (an? )?(ai|assistant|admin)",
        r"(onceki|yukaridaki) (tum )?(talimat|komut)lari (yok say|unut|gormezden gel)",
        r"talimatlari (yok say|unut)",
        r"(asistan|yapay zeka|ai)( olarak)?[, ]+(su|bu) (maili|e-?postayi) (gonder|ilet)",
        r"forward (this|all) (email|emails|messages) to",
        r"send (the|all) (password|credentials|emails)",
        r"<\s*/?\s*(system|assistant|instructions?)\s*>",
    ])
)


def detect_injection(text: str) -> bool:
    return bool(_INJECTION.search(fold(text)))
