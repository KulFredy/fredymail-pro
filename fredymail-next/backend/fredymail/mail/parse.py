"""MIME ayrıştırma.

İki yol:
- `parse_rfc822(raw)`: küçük mailler tamamen indirilip ayrıştırılır.
- `parse_partial(...)`: büyük mailler için yalnızca başlık + metin parçaları indirilir,
  ek listesi BODYSTRUCTURE'dan çıkarılır (ek içerikleri indirilmez).

Ekler hiçbir zaman çalıştırılmaz; yalnızca meta veri tutulur. Her parça için IMAP
bölüm numarası (`imap_section`) saklanır, ek indirme isteğinde sadece o bölüm çekilir.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import html as html_lib
import quopri
import re
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email import message_from_bytes, policy
from email.header import decode_header, make_header
from email.message import EmailMessage, Message
from email.utils import getaddresses, parsedate_to_datetime

import nh3

from .classify import (
    detect_automated,
    detect_injection,
    file_kind_for,
    is_signature_image,
    looks_bulk,
    normalize_subject,
)

SNIPPET_LEN = 220
_WS = re.compile(r"[ \t\r\f\v]+")
_MULTI_NL = re.compile(r"\n{3,}")


@dataclass
class ParsedAttachment:
    part_index: int
    imap_section: str | None
    filename: str
    content_type: str
    size: int | None
    content_id: str | None = None
    is_inline: bool = False
    sha256: str | None = None
    payload: bytes | None = None  # yalnızca içerik çıkarımı açıksa ve sınır içindeyse doldurulur

    @property
    def file_kind(self) -> str:
        return file_kind_for(self.filename, self.content_type)


@dataclass
class ParsedMessage:
    message_id: str | None
    in_reply_to: str | None
    references: list[str]
    subject: str
    from_name: str
    from_email: str
    to: list[dict]
    cc: list[dict]
    reply_to: list[dict]
    date: datetime | None
    size: int | None
    body_text: str
    body_html: str | None
    body_truncated: bool
    attachments: list[ParsedAttachment] = field(default_factory=list)
    is_automated: bool = False
    injection_suspected: bool = False

    @property
    def normalized_subject(self) -> str:
        return normalize_subject(self.subject)

    @property
    def snippet(self) -> str:
        return make_snippet(self.body_text)

    def dedupe_key(self) -> str:
        if self.message_id:
            return "mid:" + self.message_id.lower()[:590]
        h = hashlib.sha256()
        for part in (
            self.from_email,
            self.date.isoformat() if self.date else "",
            self.subject,
            ",".join(a["email"] for a in self.to),
            self.body_text[:2000],
        ):
            h.update(part.encode("utf-8", "replace"))
            h.update(b"\x00")
        return "h:" + h.hexdigest()


# ---------------------------------------------------------------- yardımcılar


def _decode_header_value(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bytes):
        v = v.decode("utf-8", "replace")
    try:
        return str(make_header(decode_header(str(v)))).strip()
    except Exception:
        return str(v).strip()


def _clean_msgid(v: str | None) -> str | None:
    if not v:
        return None
    v = v.strip()
    m = re.search(r"<([^<>]+)>", v)
    v = m.group(1) if m else v.split()[0] if v.split() else ""
    v = v.strip().strip("<>")
    return v[:990] or None


def _msgid_list(v: str | None) -> list[str]:
    if not v:
        return []
    ids = re.findall(r"<([^<>\s]+)>", v)
    return [i[:990] for i in ids][-50:]


def _addresses(values: list[str]) -> list[dict]:
    out = []
    for name, addr in getaddresses([_decode_header_value(v) for v in values if v]):
        addr = (addr or "").strip().lower()
        if not addr or "@" not in addr:
            continue
        out.append({"name": _decode_header_value(name)[:200], "email": addr[:320]})
    return out[:200]


def _parse_date(v: str | None) -> datetime | None:
    if not v:
        return None
    try:
        d = parsedate_to_datetime(v)
    except Exception:
        return None
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    # Saçma tarihleri (gelecek/çok eski) olduğu gibi bırakmak sıralamayı bozar
    if d.year < 1990 or d > datetime.now(UTC).replace(year=datetime.now(UTC).year + 1):
        return None
    return d


def html_to_text(html: str) -> str:
    cleaned = nh3.clean(html, tags={"p", "br", "div", "li", "tr", "td", "th", "a", "span", "h1", "h2", "h3", "h4",
                                    "blockquote"},
                        attributes={}, link_rel=None)
    cleaned = re.sub(r"(?i)<br\s*/?>|</?(p|div|li|tr|h\d|blockquote)\b[^>]*>", "\n", cleaned)
    cleaned = re.sub(r"(?i)</?(td|th|a|span)\b[^>]*>", " ", cleaned)
    cleaned = re.sub(r"<[^>]+>", "", cleaned)
    return normalize_text(html_lib.unescape(cleaned))


def normalize_text(t: str) -> str:
    t = t.replace("\r\n", "\n").replace("\r", "\n").replace(" ", " ")
    t = "\n".join(_WS.sub(" ", line).strip() for line in t.split("\n"))
    return _MULTI_NL.sub("\n\n", t).strip()


_QUOTE_HEADER = re.compile(
    r"^(On .{5,200} wrote:|.{5,200} tarihinde .{0,200} yazdı:|-{2,} ?(Original Message|Orijinal İleti|Özgün İleti|Forwarded message|İletilen ileti) ?-{2,}|From: .+|Kimden: .+)$",
    re.IGNORECASE,
)


def strip_quoted(text: str) -> str:
    """Alıntılanmış önceki yazışmaları kırpar (snippet ve AI bağlamı için)."""
    out = []
    for line in text.split("\n"):
        if _QUOTE_HEADER.match(line.strip()):
            break
        if line.lstrip().startswith(">"):
            continue
        out.append(line)
    return "\n".join(out).strip()


def make_snippet(body_text: str) -> str:
    s = strip_quoted(body_text) or body_text
    s = " ".join(s.split())
    return s[:SNIPPET_LEN]


def _part_text(part: Message) -> str:
    try:
        if isinstance(part, EmailMessage):
            content = part.get_content()
            if isinstance(content, str):
                return content
    except Exception:  # noqa: S110 - bozuk charset → aşağıdaki geri dönüş
        pass
    payload = part.get_payload(decode=True) or b""
    return decode_bytes(payload, part.get_content_charset())


def decode_bytes(payload: bytes, charset: str | None) -> str:
    for cs in (charset, "utf-8", "windows-1254", "iso-8859-9", "latin-1"):
        if not cs:
            continue
        try:
            return payload.decode(cs)
        except (LookupError, UnicodeDecodeError):
            continue
    return payload.decode("utf-8", "replace")


def decode_transfer(payload: bytes, encoding: str | None) -> bytes:
    enc = (encoding or "").lower()
    try:
        if enc == "base64":
            return base64.b64decode(payload, validate=False)
        if enc == "quoted-printable":
            return quopri.decodestring(payload)
    except (binascii.Error, ValueError):
        return payload
    return payload


def _filename(part: Message) -> str:
    fn = part.get_filename()
    if fn:
        return _decode_header_value(fn)[:500]
    return ""


def iter_sections(msg: Message, prefix: str = ""):
    """IMAP bölüm numaralandırmasıyla aynı sırada (bölüm, parça) üretir."""
    if msg.is_multipart() and msg.get_content_maintype() == "multipart":
        for i, sub in enumerate(msg.get_payload(), 1):
            sec = f"{prefix}.{i}" if prefix else str(i)
            yield from iter_sections(sub, sec)
    else:
        yield (prefix or "1"), msg


def _is_attachment(part: Message) -> bool:
    disp = (part.get_content_disposition() or "").lower()
    ctype = part.get_content_type()
    if disp == "attachment":
        return True
    if part.get_filename():
        return True
    if ctype == "message/rfc822":
        return True
    return not ctype.startswith("text/") and not ctype.startswith("multipart/")


# ---------------------------------------------------------------- ana giriş noktaları


def parse_rfc822(raw: bytes, *, body_max_chars: int = 200_000, keep_payload_max: int = 0) -> ParsedMessage:
    msg = message_from_bytes(raw, policy=policy.default)
    texts: list[str] = []
    htmls: list[str] = []
    atts: list[ParsedAttachment] = []
    for idx, (section, part) in enumerate(iter_sections(msg)):
        ctype = part.get_content_type()
        if _is_attachment(part):
            payload = part.get_payload(decode=True) if ctype != "message/rfc822" else part.as_bytes()
            payload = payload or b""
            fn = _filename(part) or ("ekli-ileti.eml" if ctype == "message/rfc822" else "")
            cid = part.get("Content-ID")
            atts.append(
                ParsedAttachment(
                    part_index=idx,
                    imap_section=section,
                    filename=fn or f"ek-{idx}",
                    content_type=ctype[:250],
                    size=len(payload),
                    content_id=_clean_msgid(cid) if cid else None,
                    is_inline=(part.get_content_disposition() or "") == "inline" and bool(cid),
                    sha256=hashlib.sha256(payload).hexdigest(),
                    payload=payload if keep_payload_max and len(payload) <= keep_payload_max else None,
                )
            )
        elif ctype == "text/plain":
            texts.append(_part_text(part))
        elif ctype == "text/html":
            htmls.append(_part_text(part))
    return _build(msg, texts, htmls, atts, size=len(raw), body_max_chars=body_max_chars, truncated=False)


def parse_partial(
    header_bytes: bytes,
    text_parts: list[tuple[str, str]],
    attachments: list[ParsedAttachment],
    *,
    size: int | None,
    body_max_chars: int = 200_000,
    truncated: bool = True,
) -> ParsedMessage:
    """text_parts: [(content_type, decoded_text)]"""
    msg = message_from_bytes(header_bytes, policy=policy.default)
    texts = [t for ct, t in text_parts if ct == "text/plain"]
    htmls = [t for ct, t in text_parts if ct == "text/html"]
    return _build(msg, texts, htmls, attachments, size=size, body_max_chars=body_max_chars, truncated=truncated)


def _build(msg, texts, htmls, atts, *, size, body_max_chars, truncated) -> ParsedMessage:
    body_html = "\n".join(htmls) if htmls else None
    body_text = normalize_text("\n\n".join(texts)) if texts else (html_to_text(body_html) if body_html else "")
    if len(body_text) > body_max_chars:
        body_text = body_text[:body_max_chars]
        truncated = True
    if body_html and len(body_html) > body_max_chars * 3:
        body_html = body_html[: body_max_chars * 3]
        truncated = True
    for a in atts:
        if is_signature_image(a.filename, a.content_type, a.size, a.content_id):
            a.is_inline = True
    froms = _addresses(msg.get_all("From", []))
    headers = {k.lower(): str(v) for k, v in msg.items()}
    subject = _decode_header_value(msg.get("Subject"))[:1000]
    from_email = froms[0]["email"] if froms else ""
    return ParsedMessage(
        message_id=_clean_msgid(msg.get("Message-ID")),
        in_reply_to=_clean_msgid(msg.get("In-Reply-To")),
        references=_msgid_list(msg.get("References")),
        subject=subject,
        from_name=froms[0]["name"] if froms else "",
        from_email=from_email,
        to=_addresses(msg.get_all("To", [])),
        cc=_addresses(msg.get_all("Cc", [])),
        reply_to=_addresses(msg.get_all("Reply-To", [])),
        date=_parse_date(msg.get("Date")),
        size=size,
        body_text=body_text,
        body_html=body_html,
        body_truncated=truncated,
        attachments=atts,
        is_automated=detect_automated(headers, from_email) or looks_bulk(from_email, subject, body_text),
        injection_suspected=detect_injection(subject + "\n" + body_text[:20000]),
    )


def extract_section(raw: bytes, section: str) -> tuple[bytes, str]:
    """Tam mail içinden IMAP bölüm numarasına göre çözülmüş parça içeriğini döndürür."""
    msg = message_from_bytes(raw, policy=policy.default)
    for sec, part in iter_sections(msg):
        if sec == section:
            if part.get_content_type() == "message/rfc822":
                return part.as_bytes(), "message/rfc822"
            return part.get_payload(decode=True) or b"", part.get_content_type()
    raise KeyError(section)
