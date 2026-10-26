"""Birleşik arama servisi.

- Metin sorgusu varsa Meilisearch kullanılır (Türkçe/İngilizce, yazım toleransı, vurgulama).
- Metin yoksa (gelen kutusu, klasör, filtre görünümleri) Postgres doğrudan kullanılır.
- Meilisearch erişilemezse aynı filtrelerle Postgres'te basit ILIKE araması yapılır
  ve sonuç `degraded=True` olarak işaretlenir (arama hiçbir zaman tamamen düşmez).
Her iki yolda da kayıtlar Postgres'ten okunur; böylece etiket/okundu gibi durumlar daima günceldir.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta

from sqlalchemy import and_, exists, false, func, or_, select, text
from sqlalchemy.orm import Session

from ..models import Attachment, Folder, Message, MessageLocation, MessageTag, Note, Tag, Thread
from .meili import HL_POST, HL_PRE, Meili, MeiliError

VIEWS = ("all", "inbox", "sent", "important", "snoozed", "unread", "folder")


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
    sort: str = ""  # relevance | date_desc | date_asc
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
    senders = resolve_people(db, p.sender, "from")
    if senders is not None:
        conds.append(Message.from_email.in_(senders))
    rcpts = resolve_people(db, p.recipient, "to")
    if rcpts is not None:
        conds.append(or_(*[Message.to_addrs.contains([{"email": r}]) for r in rcpts[:50]],
                         *[Message.cc_addrs.contains([{"email": r}]) for r in rcpts[:50]]))
    if p.date_from:
        conds.append(Message.date >= _ts(p.date_from))
    if p.date_to:
        conds.append(Message.date <= _ts(p.date_to, end=True))
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
    senders = resolve_people(db, p.sender, "from")
    if senders is not None:
        f.append(f"from_email IN [{', '.join(json.dumps(s) for s in senders)}]")
    rcpts = resolve_people(db, p.recipient, "to")
    if rcpts is not None:
        f.append(f"to_emails IN [{', '.join(json.dumps(s) for s in rcpts)}]")
    if p.date_from:
        f.append(f"date_ts >= {int(_ts(p.date_from).timestamp())}")
    if p.date_to:
        f.append(f"date_ts <= {int(_ts(p.date_to, end=True).timestamp())}")
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


def search(db: Session, meili: Meili | None, p: SearchParams) -> dict:
    p.per_page = max(1, min(p.per_page, 100))
    p.page = max(1, min(p.page, 100))
    q = p.q.strip()[:500]
    if q and meili is not None:
        try:
            return _search_meili(db, meili, p, q)
        except MeiliError as e:
            res = _search_pg(db, p, q)
            res["degraded"] = True
            res["notice"] = f"Arama motoru erişilemiyor ({e}); basit veritabanı araması kullanıldı."
            return res
    res = _search_pg(db, p, q)
    if q and meili is None:
        res["degraded"] = True
    return res


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
    if sort == "date_desc":
        body["sort"] = ["date_ts:desc"]
    elif sort == "date_asc":
        body["sort"] = ["date_ts:asc"]
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
    conds = _view_filters_pg(p, db)
    if q:
        terms = [t for t in q.split() if t][:8]
        for t in terms:
            like = f"%{t}%"
            conds.append(or_(Message.subject.ilike(like), Message.from_name.ilike(like),
                             Message.from_email.ilike(like), Message.body_text.ilike(like),
                             exists().where(Attachment.message_id == Message.id, Attachment.filename.ilike(like))))
    where = and_(*conds) if conds else false()
    total = db.execute(select(func.count()).select_from(Message).where(where)).scalar_one()
    order = Message.date.asc().nulls_last() if p.sort == "date_asc" else Message.date.desc().nulls_last()
    msgs = db.execute(
        select(Message).where(where).order_by(order, Message.id.desc())
        .offset((p.page - 1) * p.per_page).limit(p.per_page)
    ).scalars().all()
    return {"engine": "postgres", "degraded": False, "total": total, "page": p.page, "per_page": p.per_page,
            "items": serialize_list(db, list(msgs))}


# ------------------------------------------------------------------ iş akışı görünümleri


def followups(db: Session, kind: str, days: int, my_addresses: set[str], limit: int = 100) -> list[dict]:
    """kind='awaiting': ben yazdım, karşı taraf N gündür yanıt vermedi.
    kind='needs_reply': bir insan yazdı, ben yanıt vermedim (sunucuda \\Answered da yok)."""
    cutoff = datetime.now(UTC) - timedelta(days=days)
    q = select(Thread).where(Thread.message_count > 0)
    if kind == "awaiting":
        q = q.where(Thread.last_from_me.is_(True), Thread.last_outbound_date <= cutoff,
                    Thread.last_outbound_date >= datetime.now(UTC) - timedelta(days=120))
    else:
        q = q.where(Thread.last_from_me.is_(False), Thread.has_human_inbound.is_(True),
                    Thread.last_inbound_date <= cutoff,
                    Thread.last_inbound_date >= datetime.now(UTC) - timedelta(days=60))
    q = q.where(or_(Thread.followup_dismissed_at.is_(None),
                    Thread.followup_dismissed_at < func.coalesce(Thread.last_date, Thread.first_date)))
    threads = db.execute(q.order_by(Thread.last_date.desc()).limit(limit * 2)).scalars().all()
    out = []
    for t in threads:
        last = db.execute(
            select(Message).where(Message.thread_id == t.id, Message.deleted_on_server.is_(False))
            .order_by(Message.date.desc().nulls_last()).limit(1)
        ).scalar_one_or_none()
        if last is None:
            continue
        if kind == "needs_reply" and (last.is_automated or "\\Answered" in (last.server_flags or [])):
            continue
        if kind == "awaiting":
            externals = [a["email"] for a in (last.to_addrs or []) if a["email"] not in my_addresses]
            if not externals:
                continue
        ref = t.last_outbound_date if kind == "awaiting" else t.last_inbound_date
        out.append({
            "thread_id": t.id,
            "subject": t.subject or "(konu yok)",
            "participants": t.participants[:5],
            "message_count": t.message_count,
            "last_date": t.last_date.isoformat() if t.last_date else None,
            "days_waiting": (datetime.now(UTC) - ref).days if ref else None,
            "last_message": serialize_list(db, [last])[0],
        })
        if len(out) >= limit:
            break
    return out
