"""Birleşik arama servisi.

- Metin sorgusu varsa Meilisearch kullanılır (Türkçe/İngilizce, yazım toleransı, vurgulama).
- Metin yoksa (gelen kutusu, klasör, filtre görünümleri) Postgres doğrudan kullanılır.
- Meilisearch erişilemezse aynı filtrelerle Postgres'te basit ILIKE araması yapılır
  ve sonuç `degraded=True` olarak işaretlenir (arama hiçbir zaman tamamen düşmez).
Her iki yolda da kayıtlar Postgres'ten okunur; böylece etiket/okundu gibi durumlar daima günceldir.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import and_, exists, false, func, or_, select, text, true
from sqlalchemy.orm import Session

from ..mail.classify import fold
from ..models import Attachment, Folder, Message, MessageLocation, MessageTag, Note, Tag, Thread
from .meili import HL_POST, HL_PRE, Meili, MeiliError

VIEWS = ("all", "inbox", "sent", "important", "snoozed", "unread", "folder")
SORTS = ("relevance", "date_desc", "date_asc", "size_desc", "size_asc", "subject_asc", "sender_asc")
_MEILI_SORT = {"date_desc": "date_ts:desc", "date_asc": "date_ts:asc", "size_desc": "size:desc",
               "size_asc": "size:asc", "subject_asc": "subject_sort:asc", "sender_asc": "from_sort:asc"}


@dataclass
class SearchParams:
    q: str = ""
    view: str = "all"
    folder_id: int | None = None
    sender: str = ""
    recipient: str = ""
    date_from: date | None = None
    date_to: date | None = None
    has_attachment: bool | None = None
    file_kind: str = ""
    doc_kind: str = ""
    tag_id: int | None = None
    unread: bool | None = None
    important: bool | None = None
    thread_id: int | None = None
    year: int | None = None
    participant: str = ""  # gönderen VEYA alıcı ("X ile yazışmalar")
    direction: str = ""  # "" | in (yalnız gelenler) | out (yalnız gönderdiklerim)
    sort: str = ""  # SORTS
    page: int = 1
    per_page: int = 50


def _ts(d: date, end: bool = False) -> datetime:
    return datetime.combine(d, time.max if end else time.min, tzinfo=UTC)


def resolve_people(db: Session, value: str, field: str = "from") -> list[str] | None:
    """'ahmet', 'acme.com', '@acme.com' veya tam e-posta → e-posta listesi (None = filtre yok)."""
    v = value.strip().lower()
    if not v:
        return None
    if "@" in v and not v.startswith("@"):
        return [v]
    like = f"%{v.lstrip('@')}%"
    if field == "from":
        rows = db.execute(
            select(Message.from_email).where(or_(Message.from_email.ilike(like), Message.from_name.ilike(like)))
            .group_by(Message.from_email).order_by(func.count().desc()).limit(100)
        ).scalars().all()
    else:
        rows = db.execute(text(
            "SELECT DISTINCT e FROM (SELECT jsonb_array_elements(to_addrs || cc_addrs) ->> 'email' AS e,"
            " jsonb_array_elements(to_addrs || cc_addrs) ->> 'name' AS n FROM messages) s"
            " WHERE e ILIKE :like OR n ILIKE :like LIMIT 100"), {"like": like}).scalars().all()
    return list(rows) or ["__yok__"]


def _participant_emails(db: Session, value: str) -> list[str] | None:
    if not value.strip():
        return None
    a = resolve_people(db, value, "from") or []
    b = resolve_people(db, value, "to") or []
    found = [e for e in dict.fromkeys(a + b) if e != "__yok__"]
    return found[:100] or ["__yok__"]


def _view_filters_pg(p: SearchParams, db: Session) -> list:
    now = datetime.now(UTC)
    conds = [Message.deleted_on_server.is_(False), ~Message.dedupe_key.startswith("err:")]
    if p.view == "inbox":
        inbox_ids = select(Folder.id).where(Folder.role == "inbox")
        conds.append(exists().where(MessageLocation.message_id == Message.id, MessageLocation.folder_id.in_(inbox_ids)))
        conds.append(or_(Message.snoozed_until.is_(None), Message.snoozed_until <= now))
    elif p.view == "sent":
        conds.append(Message.is_from_me.is_(True))
    elif p.view == "important":
        conds.append(Message.is_important.is_(True))
    elif p.view == "snoozed":
        conds.append(Message.snoozed_until > now)
    elif p.view == "unread":
        conds.append(Message.is_read.is_(False))
    if p.folder_id:
        conds.append(exists().where(MessageLocation.message_id == Message.id, MessageLocation.folder_id == p.folder_id))
    if p.direction in ("in", "out"):
        conds.append(Message.is_from_me.is_(p.direction == "out"))
    senders = resolve_people(db, p.sender, "from")
    if senders is not None:
        conds.append(Message.from_email.in_(senders))
    rcpts = resolve_people(db, p.recipient, "to")
    if rcpts is not None:
        conds.append(or_(*[Message.to_addrs.contains([{"email": r}]) for r in rcpts[:50]],
                         *[Message.cc_addrs.contains([{"email": r}]) for r in rcpts[:50]]))
    people = _participant_emails(db, p.participant)
    if people is not None:
        conds.append(or_(Message.from_email.in_(people),
                         *[Message.to_addrs.contains([{"email": r}]) for r in people[:50]],
                         *[Message.cc_addrs.contains([{"email": r}]) for r in people[:50]]))
    if p.date_from:
        conds.append(Message.date >= _ts(p.date_from))
    if p.date_to:
        conds.append(Message.date <= _ts(p.date_to, end=True))
    if p.year:
        conds.append(Message.date >= datetime(p.year, 1, 1, tzinfo=UTC))
        conds.append(Message.date < datetime(p.year + 1, 1, 1, tzinfo=UTC))
    if p.has_attachment is not None:
        conds.append(Message.has_attachments.is_(p.has_attachment))
    if p.file_kind:
        conds.append(exists().where(Attachment.message_id == Message.id, Attachment.file_kind == p.file_kind,
                                    Attachment.is_inline.is_(False)))
    if p.doc_kind:
        conds.append(Message.doc_kinds.contains([p.doc_kind]))
    if p.tag_id:
        conds.append(exists().where(MessageTag.message_id == Message.id, MessageTag.tag_id == p.tag_id))
    if p.unread is not None:
        conds.append(Message.is_read.is_(not p.unread))
    if p.important is not None:
        conds.append(Message.is_important.is_(p.important))
    if p.thread_id:
        conds.append(Message.thread_id == p.thread_id)
    return conds


def _meili_filter(p: SearchParams, db: Session) -> list:
    now_ts = int(datetime.now(UTC).timestamp())
    f: list = ["deleted = false"]
    if p.view == "inbox":
        ids = db.execute(select(Folder.id).where(Folder.role == "inbox")).scalars().all() or [-1]
        f.append(f"folder_ids IN [{', '.join(map(str, ids))}]")
        f.append(f"snoozed_until_ts <= {now_ts}")
    elif p.view == "sent":
        f.append("is_from_me = true")
    elif p.view == "important":
        f.append("is_important = true")
    elif p.view == "snoozed":
        f.append(f"snoozed_until_ts > {now_ts}")
    elif p.view == "unread":
        f.append("is_read = false")
    if p.folder_id:
        f.append(f"folder_ids = {int(p.folder_id)}")
    if p.direction in ("in", "out"):
        f.append(f"is_from_me = {'true' if p.direction == 'out' else 'false'}")
    senders = resolve_people(db, p.sender, "from")
    if senders is not None:
        f.append(f"from_email IN [{', '.join(json.dumps(s) for s in senders)}]")
    rcpts = resolve_people(db, p.recipient, "to")
    if rcpts is not None:
        f.append(f"to_emails IN [{', '.join(json.dumps(s) for s in rcpts)}]")
    people = _participant_emails(db, p.participant)
    if people is not None:
        lst = ", ".join(json.dumps(s) for s in people)
        f.append(f"from_email IN [{lst}] OR to_emails IN [{lst}]")
    if p.date_from:
        f.append(f"date_ts >= {int(_ts(p.date_from).timestamp())}")
    if p.date_to:
        f.append(f"date_ts <= {int(_ts(p.date_to, end=True).timestamp())}")
    if p.year:
        f.append(f"year = {int(p.year)}")
    if p.has_attachment is not None:
        f.append(f"has_attachments = {str(p.has_attachment).lower()}")
    if p.file_kind:
        f.append(f"file_kinds = {json.dumps(p.file_kind)}")
    if p.doc_kind:
        f.append(f"doc_kinds = {json.dumps(p.doc_kind)}")
    if p.tag_id:
        f.append(f"tag_ids = {int(p.tag_id)}")
    if p.unread is not None:
        f.append(f"is_read = {str(not p.unread).lower()}")
    if p.important is not None:
        f.append(f"is_important = {str(p.important).lower()}")
    if p.thread_id:
        f.append(f"thread_id = {int(p.thread_id)}")
    return f


def serialize_list(db: Session, msgs: list[Message], highlights: dict[int, dict] | None = None) -> list[dict]:
    if not msgs:
        return []
    ids = [m.id for m in msgs]
    tags: dict[int, list[dict]] = {}
    for mid, tid, name, color in db.execute(
        select(MessageTag.message_id, Tag.id, Tag.name, Tag.color).join(Tag).where(MessageTag.message_id.in_(ids))
    ):
        tags.setdefault(mid, []).append({"id": tid, "name": name, "color": color})
    noted = set(db.execute(select(Note.message_id).where(Note.message_id.in_(ids))).scalars())
    tids = {m.thread_id for m in msgs if m.thread_id}
    tcount = dict(db.execute(select(Thread.id, Thread.message_count).where(Thread.id.in_(tids))).all()) if tids else {}
    out = []
    for m in msgs:
        h = (highlights or {}).get(m.id, {})
        out.append({
            "id": m.id,
            "thread_id": m.thread_id,
            "thread_count": tcount.get(m.thread_id, 1),
            "subject": m.subject or "(konu yok)",
            "from_name": m.from_name,
            "from_email": m.from_email,
            "to": m.to_addrs[:5],
            "date": m.date.isoformat() if m.date else None,
            "size": m.size,
            "snippet": m.snippet,
            "highlight": h,
            "has_attachments": m.has_attachments,
            "attachments": [{"id": a.id, "filename": a.filename, "file_kind": a.file_kind}
                            for a in m.attachments if not a.is_inline][:6],
            "doc_kinds": m.doc_kinds or [],
            "folders": [{"id": loc.folder_id, "name": loc.folder.display_name, "path": loc.folder.name}
                        for loc in m.locations],
            "is_read": m.is_read,
            "is_important": m.is_important,
            "is_from_me": m.is_from_me,
            "is_automated": m.is_automated,
            "snoozed_until": m.snoozed_until.isoformat() if m.snoozed_until else None,
            "tags": tags.get(m.id, []),
            "has_note": m.id in noted,
            "answered": "\\Answered" in (m.server_flags or []),
        })
    return out


def search(db: Session, meili: Meili | None, p: SearchParams, with_facets: bool = False) -> dict:
    p.per_page = max(1, min(p.per_page, 100))
    p.page = max(1, min(p.page, 100))
    if p.sort not in SORTS:
        p.sort = ""
    q = p.q.strip()[:500]
    res = None
    if q and meili is not None:
        try:
            res = _search_meili(db, meili, p, q)
            if with_facets:
                res["facets"] = _facets_meili(db, meili, p, q)
        except MeiliError as e:
            res = None
            notice = f"Arama motoru erişilemiyor ({e}); basit veritabanı araması kullanıldı."
    if res is None:
        res = _search_pg(db, p, q)
        if q:
            res["degraded"] = True
            if meili is not None:
                res["notice"] = locals().get("notice", "")
        if with_facets:
            res["facets"] = _facets_pg(db, p, q)
    return res


# Her çip grubunun sayısı yalnızca KENDİ filtresi kaldırılarak hesaplanır; diğer seçili filtreler geçerli kalır
# (ör. PDF seçiliyken yıl çipleri "o yılın PDF'li sonuç sayısını" gösterir).
_FACET_GROUPS = {"years": ("year", None), "file_kinds": ("file_kind", ""), "doc_kinds": ("doc_kind", "")}
_MEILI_FACET = {"years": "year", "file_kinds": "file_kinds", "doc_kinds": "doc_kinds"}


def _facets_meili(db: Session, meili: Meili, p: SearchParams, q: str) -> dict:
    from dataclasses import replace

    out: dict = {}
    for group, (field_name, empty) in _FACET_GROUPS.items():
        base = replace(p, **{field_name: empty})
        r = meili.search({"q": q, "filter": _meili_filter(base, db), "limit": 0, "facets": [_MEILI_FACET[group]]})
        out[group] = r.get("facetDistribution", {}).get(_MEILI_FACET[group], {})
    out["years"] = {str(k): v for k, v in sorted(out["years"].items(), reverse=True) if str(k) != "0"}
    return out


def _facets_pg(db: Session, p: SearchParams, q: str) -> dict:
    from dataclasses import replace

    def where_without(field_name, empty):
        return and_(*(_view_filters_pg(replace(p, **{field_name: empty}), db) + _text_conds(q)))

    yr = func.extract("year", Message.date)
    w = where_without("year", None)
    years = {str(int(y)): c for y, c in db.execute(
        select(yr, func.count()).where(w, Message.date.is_not(None)).group_by(yr).order_by(yr.desc())).all()}
    w = where_without("file_kind", "")
    fk = {k: c for k, c in db.execute(
        select(Attachment.file_kind, func.count(func.distinct(Attachment.message_id)))
        .join(Message, Message.id == Attachment.message_id)
        .where(w, Attachment.is_inline.is_(False)).group_by(Attachment.file_kind)).all()}
    w = where_without("doc_kind", "")
    dk_col = func.jsonb_array_elements_text(Message.doc_kinds).table_valued("value").render_derived()
    dk = {k: c for k, c in db.execute(
        select(dk_col.c.value, func.count()).select_from(Message).join(dk_col, true()).where(w)
        .group_by(dk_col.c.value)).all()}
    return {"years": years, "file_kinds": fk, "doc_kinds": dk}


def _text_conds(q: str) -> list:
    conds = []
    for t in [t for t in q.split() if t][:8]:
        like = f"%{t}%"
        conds.append(or_(Message.subject.ilike(like), Message.from_name.ilike(like),
                         Message.from_email.ilike(like), Message.body_text.ilike(like),
                         exists().where(Attachment.message_id == Message.id, Attachment.filename.ilike(like))))
    return conds


def _search_meili(db: Session, meili: Meili, p: SearchParams, q: str) -> dict:
    sort = p.sort or "relevance"
    body = {
        "q": q,
        "filter": _meili_filter(p, db),
        "hitsPerPage": p.per_page,
        "page": p.page,
        "attributesToRetrieve": ["id"],
        "attributesToHighlight": ["subject", "from_name"],
        "attributesToCrop": ["body"],
        "cropLength": 28,
        "cropMarker": "…",
        "highlightPreTag": HL_PRE,
        "highlightPostTag": HL_POST,
        "showMatchesPosition": False,
    }
    if sort in _MEILI_SORT:
        body["sort"] = [_MEILI_SORT[sort]]
    r = meili.search(body)
    ids = [h["id"] for h in r.get("hits", [])]
    hl = {}
    for h in r.get("hits", []):
        f = h.get("_formatted", {})
        hl[h["id"]] = {"subject": f.get("subject"), "from_name": f.get("from_name"), "body": f.get("body")}
    by_id = {m.id: m for m in db.execute(select(Message).where(Message.id.in_(ids))).scalars()} if ids else {}
    msgs = [by_id[i] for i in ids if i in by_id]  # Meili sırası korunur
    return {
        "engine": "meilisearch",
        "degraded": False,
        "total": r.get("totalHits", len(ids)),
        "page": p.page,
        "per_page": p.per_page,
        "processing_ms": r.get("processingTimeMs"),
        "items": serialize_list(db, msgs, hl),
    }


def _search_pg(db: Session, p: SearchParams, q: str) -> dict:
    conds = _view_filters_pg(p, db) + _text_conds(q)
    where = and_(*conds) if conds else false()
    total = db.execute(select(func.count()).select_from(Message).where(where)).scalar_one()
    order = {
        "date_asc": Message.date.asc().nulls_last(),
        "size_desc": Message.size.desc().nulls_last(),
        "size_asc": Message.size.asc().nulls_last(),
        "subject_asc": Message.normalized_subject.asc(),
        "sender_asc": func.lower(func.coalesce(func.nullif(Message.from_name, ""), Message.from_email)).asc(),
    }.get(p.sort, Message.date.desc().nulls_last())
    msgs = db.execute(
        select(Message).where(where).order_by(order, Message.id.desc())
        .offset((p.page - 1) * p.per_page).limit(p.per_page)
    ).scalars().all()
    return {"engine": "postgres", "degraded": False, "total": total, "page": p.page, "per_page": p.per_page,
            "items": serialize_list(db, list(msgs))}


# ------------------------------------------------------------------ iş akışı görünümleri


_REQUEST = re.compile("|".join([
    r"\?", r"\brica\b", r"rica ederim", r"ricamiz", r"lutfen", r"bekliyorum", r"bekliyoruz", r"donus", r"geri donus",
    r"teklif", r"fiyat", r"onay", r"bilgi(lendirme)? (verir|ver|rica)", r"iletebilir", r"gonderebilir", r"paylasabilir",
    r"musait", r"toplanti", r"gorusme", r"could you", r"can you", r"please", r"let me know", r"kindly", r"looking forward",
    r"awaiting", r"waiting for", r"confirm",
]))


def _known_contacts(db: Session, my_addresses: set[str]) -> set[str]:
    """Bugüne kadar mail gönderdiğim adresler (öncelik sinyali)."""
    out: set[str] = set()
    for (addrs,) in db.execute(select(Message.to_addrs).where(Message.is_from_me.is_(True))):
        out.update(a.get("email", "") for a in (addrs or []))
    return out - my_addresses


def followups(db: Session, kind: str, days: int, my_addresses: set[str], limit: int | None = 100) -> list[dict]:
    """kind='needs_reply': bir insan BANA yazdı, ben yanıt vermedim (\\Answered da yok, otomatik/toplu değil).
    kind='awaiting': ben bir şey istedim/sordum/belge gönderdim, karşı taraf N gündür dönmedi.
    Daha önce yazıştığım kişiler önce gelir."""
    from ..mail.parse import strip_quoted

    now = datetime.now(UTC)
    cutoff = now - timedelta(days=days)
    q = select(Thread).where(Thread.message_count > 0)
    if kind == "awaiting":
        q = q.where(Thread.last_from_me.is_(True), Thread.last_outbound_date <= cutoff,
                    Thread.last_outbound_date >= now - timedelta(days=45))
    else:
        q = q.where(Thread.last_from_me.is_(False), Thread.has_human_inbound.is_(True),
                    Thread.last_inbound_date <= cutoff, Thread.last_inbound_date >= now - timedelta(days=60))
    q = q.where(or_(Thread.followup_dismissed_at.is_(None),
                    Thread.followup_dismissed_at < func.coalesce(Thread.last_date, Thread.first_date)))
    threads = db.execute(q.order_by(Thread.last_date.desc()).limit(3000)).scalars().all()
    known = _known_contacts(db, my_addresses)
    picked: list[tuple[bool, Thread, Message]] = []
    for t in threads:
        last = db.execute(
            select(Message).where(Message.thread_id == t.id, Message.deleted_on_server.is_(False))
            .order_by(Message.date.desc().nulls_last()).limit(1)
        ).scalar_one_or_none()
        if last is None:
            continue
        rcpts = {a["email"] for a in (last.to_addrs or []) + (last.cc_addrs or [])}
        if kind == "needs_reply":
            if last.is_automated or "\\Answered" in (last.server_flags or []):
                continue
            if my_addresses and not rcpts & my_addresses:
                continue  # bana doğrudan yazılmamış (Bcc / dağıtım listesi)
            prio = last.from_email in known
        else:
            externals = rcpts - my_addresses
            if not externals:
                continue
            body = fold(strip_quoted(last.body_text or "")[:3000] + " " + (last.subject or ""))
            has_doc = any(not a.is_inline for a in last.attachments)
            if not (_REQUEST.search(body) or has_doc):
                continue  # "teşekkürler" türü, yanıt beklemeyen mail
            prio = bool(externals & known)
        picked.append((prio, t, last))
    picked.sort(key=lambda x: (not x[0], -(x[1].last_date.timestamp() if x[1].last_date else 0)))
    out = []
    for prio, t, last in picked[: limit if limit else None]:
        ref = t.last_outbound_date if kind == "awaiting" else t.last_inbound_date
        out.append({
            "thread_id": t.id,
            "subject": t.subject or "(konu yok)",
            "participants": t.participants[:5],
            "message_count": t.message_count,
            "last_date": t.last_date.isoformat() if t.last_date else None,
            "days_waiting": (now - ref).days if ref else None,
            "known_contact": prio,
            "last_message": serialize_list(db, [last])[0],
        })
    return out


def followup_total(db: Session, kind: str, days: int, my_addresses: set[str]) -> int:
    return len(followups(db, kind, days, my_addresses, limit=None))
