"""Posta, iş akışı, senkron ve taslak uç noktaları (hepsi oturum gerektirir)."""

from __future__ import annotations

import re
import unicodedata
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..mail.classify import DOC_KIND_LABELS, FILE_KIND_LABELS
from ..mail.html import csp_for, render_document
from ..models import (
    Attachment,
    Draft,
    Folder,
    KeyValue,
    Message,
    MessageLocation,
    MessageTag,
    Note,
    SavedSearch,
    SyncRun,
    Tag,
    Task,
    Thread,
)
from ..search.meili import Meili, reindex_one
from ..search.query import SearchParams, followups, search, serialize_list
from .deps import get_db, get_meili, require_user, source_for_folder

router = APIRouter(prefix="/api", dependencies=[Depends(require_user)])


def _get_msg(db: Session, mid: int) -> Message:
    m = db.get(Message, mid)
    if m is None:
        raise HTTPException(404, "Mail bulunamadı")
    return m


# ------------------------------------------------------------------ arama ve listeler


@router.get("/search")
def api_search(
    q: str = "", view: str = "all", folder_id: int | None = None, sender: str = "", recipient: str = "",
    date_from: date | None = None, date_to: date | None = None, has_attachment: bool | None = None,
    file_kind: str = "", doc_kind: str = "", tag_id: int | None = None, unread: bool | None = None,
    important: bool | None = None, sort: str = "", page: int = 1, per_page: int = 50,
    year: int | None = None, participant: str = "", facets: bool = False,
    db: Session = Depends(get_db), meili: Meili = Depends(get_meili),
):
    p = SearchParams(q=q, view=view, folder_id=folder_id, sender=sender, recipient=recipient, date_from=date_from,
                     date_to=date_to, has_attachment=has_attachment, file_kind=file_kind, doc_kind=doc_kind,
                     tag_id=tag_id, unread=unread, important=important, sort=sort, page=page, per_page=per_page,
                     year=year, participant=participant)
    return search(db, meili, p, with_facets=facets)


@router.get("/insights")
def api_insights(period: str = "this_month", db: Session = Depends(get_db),
                 settings: Settings = Depends(get_settings)):
    from ..search.insights import PERIOD_LABELS, insights

    aw = len(followups(db, "awaiting", settings.awaiting_reply_days, settings.my_addresses, limit=200))
    nr = len(followups(db, "needs_reply", settings.needs_reply_days, settings.my_addresses, limit=200))
    out = insights(db, period, settings.my_addresses, aw, nr)
    out["periods"] = PERIOD_LABELS
    return out


class AskIn(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    allow_ai: bool = True


@router.post("/ask")
def api_ask(body: AskIn, db: Session = Depends(get_db), meili: Meili = Depends(get_meili),
            settings: Settings = Depends(get_settings)):
    from ..search.ask import run_question

    return run_question(db, meili, settings, body.question, allow_ai=body.allow_ai)


@router.get("/followups")
def api_followups(kind: str = Query("needs_reply", pattern="^(needs_reply|awaiting)$"),
                  db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    days = settings.needs_reply_days if kind == "needs_reply" else settings.awaiting_reply_days
    return {"kind": kind, "days": days, "items": followups(db, kind, days, settings.my_addresses)}


@router.post("/threads/{tid}/dismiss-followup")
def dismiss_followup(tid: int, db: Session = Depends(get_db)):
    t = db.get(Thread, tid)
    if t is None:
        raise HTTPException(404, "Yazışma bulunamadı")
    t.followup_dismissed_at = datetime.now(UTC)
    db.commit()
    return {"ok": True}


@router.get("/contacts")
def contacts(q: str = "", db: Session = Depends(get_db)):
    like = f"%{q.strip()}%"
    rows = db.execute(
        select(Message.from_email, func.max(Message.from_name), func.count())
        .where((Message.from_email.ilike(like)) | (Message.from_name.ilike(like)))
        .group_by(Message.from_email).order_by(func.count().desc()).limit(10)
    ).all()
    return [{"email": e, "name": n, "count": c} for e, n, c in rows]


# ------------------------------------------------------------------ mail detayı


def _message_detail(db: Session, m: Message) -> dict:
    base = serialize_list(db, [m])[0]
    notes = db.execute(select(Note).where(Note.message_id == m.id).order_by(Note.created_at)).scalars().all()
    base.update({
        "cc": m.cc_addrs,
        "to": m.to_addrs,
        "reply_to": m.reply_to,
        "body_text": m.body_text,
        "has_html": bool(m.body_html),
        "body_truncated": m.body_truncated,
        "size": m.size,
        "message_id_header": m.message_id_header,
        "attachments": [{"id": a.id, "filename": a.filename, "content_type": a.content_type, "size": a.size,
                         "file_kind": a.file_kind, "is_inline": a.is_inline,
                         "extraction_status": a.extraction_status} for a in m.attachments],
        "notes": [{"id": n.id, "body": n.body, "created_at": n.created_at.isoformat(),
                   "updated_at": n.updated_at.isoformat()} for n in notes],
        "injection_suspected": m.injection_suspected,
        "server_flags": m.server_flags,
        "deleted_on_server": m.deleted_on_server,
    })
    return base


@router.get("/messages/{mid}")
def get_message(mid: int, db: Session = Depends(get_db)):
    return _message_detail(db, _get_msg(db, mid))


@router.get("/messages/{mid}/html")
def message_html(mid: int, remote: bool = False, db: Session = Depends(get_db)):
    m = _get_msg(db, mid)
    doc, blocked = render_document(m.body_html, m.body_text or "", remote)
    return Response(content=doc, media_type="text/html; charset=utf-8", headers={
        "Content-Security-Policy": csp_for(remote),
        "X-Frame-Options": "SAMEORIGIN",
        "X-Blocked-Images": str(blocked),
        "Cache-Control": "private, no-store",
    })


def _safe_filename(name: str) -> str:
    name = unicodedata.normalize("NFC", name or "ek")
    name = re.sub(r'[\x00-\x1f\x7f"\\/:*?<>|]+', "_", name).strip(" .") or "ek"
    return name[:180]


@router.get("/messages/{mid}/attachments/{aid}")
def download_attachment(mid: int, aid: int, db: Session = Depends(get_db), settings: Settings = Depends(get_settings)):
    from urllib.parse import quote

    m = _get_msg(db, mid)
    att = db.get(Attachment, aid)
    if att is None or att.message_id != m.id or not att.imap_section:
        raise HTTPException(404, "Ek bulunamadı")
    if att.size and att.size > settings.attachment_download_max_bytes:
        raise HTTPException(413, "Ek boyutu indirme sınırını aşıyor")
    if not m.locations:
        raise HTTPException(410, "Mail sunucuda artık bulunmuyor")
    loc = m.locations[0]
    from ..mail.source import SourceError

    try:
        src = source_for_folder(loc.folder, settings)
        try:
            data, _ctype = src.fetch_section(loc.folder.name, loc.uidvalidity, loc.uid, att.imap_section)
        finally:
            src.close()
    except (SourceError, KeyError) as e:
        raise HTTPException(502, f"Ek kaynaktan alınamadı: {e}") from e
    if len(data) > settings.attachment_download_max_bytes:
        raise HTTPException(413, "Ek boyutu indirme sınırını aşıyor")
    fname = _safe_filename(att.filename)
    ascii_name = fname.encode("ascii", "ignore").decode() or "ek"
    return Response(content=data, media_type="application/octet-stream", headers={
        # Daima indirme olarak sunulur; tarayıcıda çalıştırılmaz/gösterilmez
        "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(fname)}",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
        "Cache-Control": "private, no-store",
    })


class MessagePatch(BaseModel):
    is_read: bool | None = None
    is_important: bool | None = None
    snoozed_until: datetime | None = None
    clear_snooze: bool = False


@router.patch("/messages/{mid}")
def patch_message(mid: int, body: MessagePatch, db: Session = Depends(get_db), meili: Meili = Depends(get_meili)):
    m = _get_msg(db, mid)
    if body.is_read is not None:
        m.is_read = body.is_read
    if body.is_important is not None:
        m.is_important = body.is_important
    if body.clear_snooze:
        m.snoozed_until = None
    elif body.snoozed_until is not None:
        su = body.snoozed_until if body.snoozed_until.tzinfo else body.snoozed_until.replace(tzinfo=UTC)
        if su <= datetime.now(UTC):
            raise HTTPException(400, "Erteleme zamanı gelecekte olmalı")
        m.snoozed_until = su
    m.index_dirty = True
    db.flush()
    reindex_one(db, meili, m.id)
    db.commit()
    return serialize_list(db, [m])[0]


class BulkPatch(BaseModel):
    ids: list[int] = Field(max_length=500)
    is_read: bool | None = None


@router.post("/messages/bulk-read")
def bulk_read(body: BulkPatch, db: Session = Depends(get_db)):
    if body.is_read is None:
        raise HTTPException(400, "is_read gerekli")
    for m in db.execute(select(Message).where(Message.id.in_(body.ids))).scalars():
        m.is_read = body.is_read
        m.index_dirty = True
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ etiketler


class TagIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    color: str = Field(default="#5b6ee1", pattern=r"^#[0-9a-fA-F]{6}$")


@router.get("/tags")
def list_tags(db: Session = Depends(get_db)):
    rows = db.execute(select(Tag, func.count(MessageTag.message_id)).outerjoin(MessageTag)
                      .group_by(Tag.id).order_by(Tag.name)).all()
    return [{"id": t.id, "name": t.name, "color": t.color, "count": c} for t, c in rows]


@router.post("/tags")
def create_tag(body: TagIn, db: Session = Depends(get_db)):
    if db.execute(select(Tag).where(func.lower(Tag.name) == body.name.strip().lower())).first():
        raise HTTPException(409, "Bu etiket zaten var")
    t = Tag(name=body.name.strip(), color=body.color)
    db.add(t)
    db.commit()
    return {"id": t.id, "name": t.name, "color": t.color, "count": 0}


@router.patch("/tags/{tid}")
def update_tag(tid: int, body: TagIn, db: Session = Depends(get_db)):
    t = db.get(Tag, tid)
    if t is None:
        raise HTTPException(404, "Etiket yok")
    t.name, t.color = body.name.strip(), body.color
    _dirty_tag(db, tid)
    db.commit()
    return {"id": t.id, "name": t.name, "color": t.color}


@router.delete("/tags/{tid}")
def delete_tag(tid: int, db: Session = Depends(get_db)):
    _dirty_tag(db, tid)
    db.execute(delete(Tag).where(Tag.id == tid))
    db.commit()
    return {"ok": True}


def _dirty_tag(db: Session, tid: int) -> None:
    ids = db.execute(select(MessageTag.message_id).where(MessageTag.tag_id == tid)).scalars().all()
    for m in db.execute(select(Message).where(Message.id.in_(ids))).scalars():
        m.index_dirty = True


class TagAssign(BaseModel):
    tag_id: int | None = None
    name: str | None = Field(default=None, max_length=80)


@router.post("/messages/{mid}/tags")
def add_tag(mid: int, body: TagAssign, db: Session = Depends(get_db), meili: Meili = Depends(get_meili)):
    m = _get_msg(db, mid)
    tag = db.get(Tag, body.tag_id) if body.tag_id else None
    if tag is None and body.name:
        tag = db.execute(select(Tag).where(func.lower(Tag.name) == body.name.strip().lower())).scalar_one_or_none()
        if tag is None:
            tag = Tag(name=body.name.strip())
            db.add(tag)
            db.flush()
    if tag is None:
        raise HTTPException(400, "Etiket belirtilmedi")
    if db.get(MessageTag, (m.id, tag.id)) is None:
        db.add(MessageTag(message_id=m.id, tag_id=tag.id))
    db.flush()
    reindex_one(db, meili, m.id)
    db.commit()
    return serialize_list(db, [m])[0]


@router.delete("/messages/{mid}/tags/{tid}")
def remove_tag(mid: int, tid: int, db: Session = Depends(get_db), meili: Meili = Depends(get_meili)):
    m = _get_msg(db, mid)
    db.execute(delete(MessageTag).where(MessageTag.message_id == mid, MessageTag.tag_id == tid))
    db.flush()
    reindex_one(db, meili, m.id)
    db.commit()
    return serialize_list(db, [m])[0]


# ------------------------------------------------------------------ notlar


class NoteIn(BaseModel):
    body: str = Field(min_length=1, max_length=10_000)


@router.post("/messages/{mid}/notes")
def add_note(mid: int, body: NoteIn, db: Session = Depends(get_db), meili: Meili = Depends(get_meili)):
    m = _get_msg(db, mid)
    n = Note(message_id=m.id, body=body.body)
    db.add(n)
    db.flush()
    reindex_one(db, meili, m.id)
    db.commit()
    return {"id": n.id, "body": n.body, "created_at": n.created_at.isoformat(), "updated_at": n.updated_at.isoformat()}


@router.patch("/notes/{nid}")
def edit_note(nid: int, body: NoteIn, db: Session = Depends(get_db), meili: Meili = Depends(get_meili)):
    n = db.get(Note, nid)
    if n is None:
        raise HTTPException(404, "Not bulunamadı")
    n.body = body.body
    db.flush()
    reindex_one(db, meili, n.message_id)
    db.commit()
    return {"id": n.id, "body": n.body}


@router.delete("/notes/{nid}")
def delete_note(nid: int, db: Session = Depends(get_db), meili: Meili = Depends(get_meili)):
    n = db.get(Note, nid)
    if n is not None:
        mid = n.message_id
        db.delete(n)
        db.flush()
        reindex_one(db, meili, mid)
        db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ thread


@router.get("/threads/{tid}")
def get_thread(tid: int, db: Session = Depends(get_db)):
    t = db.get(Thread, tid)
    if t is None:
        raise HTTPException(404, "Yazışma bulunamadı")
    msgs = db.execute(select(Message).where(Message.thread_id == tid)
                      .order_by(func.coalesce(Message.date, Message.created_at))).scalars().all()
    return {
        "id": t.id, "subject": t.subject, "participants": t.participants, "message_count": t.message_count,
        "first_date": t.first_date.isoformat() if t.first_date else None,
        "last_date": t.last_date.isoformat() if t.last_date else None,
        "messages": [_message_detail(db, m) for m in msgs],
    }


# ------------------------------------------------------------------ klasörler / akıllı klasörler


@router.get("/folders")
def list_folders(db: Session = Depends(get_db)):
    counts = dict(db.execute(select(MessageLocation.folder_id, func.count()).group_by(MessageLocation.folder_id)).all())
    unread = dict(db.execute(
        select(MessageLocation.folder_id, func.count()).join(Message, Message.id == MessageLocation.message_id)
        .where(Message.is_read.is_(False)).group_by(MessageLocation.folder_id)).all())
    rows = db.execute(select(Folder).order_by(Folder.origin, Folder.name)).scalars().all()
    order = {"inbox": 0, "sent": 1, "archive": 2}
    rows = sorted(rows, key=lambda f: (f.origin != "server" and f.origin != "demo", order.get(f.role or "", 5),
                                       f.name.lower()))
    return [{"id": f.id, "name": f.name, "display_name": f.display_name, "parent": f.parent_name, "role": f.role,
             "origin": f.origin, "sync_enabled": f.sync_enabled, "status": f.status, "last_error": f.last_error,
             "count": counts.get(f.id, 0), "unread": unread.get(f.id, 0), "server_count": f.server_message_count,
             "last_synced_at": f.last_synced_at.isoformat() if f.last_synced_at else None} for f in rows]


class FolderPatch(BaseModel):
    sync_enabled: bool


@router.patch("/folders/{fid}")
def patch_folder(fid: int, body: FolderPatch, db: Session = Depends(get_db)):
    f = db.get(Folder, fid)
    if f is None:
        raise HTTPException(404, "Klasör yok")
    f.sync_enabled = body.sync_enabled
    f.consecutive_failures = 0
    db.commit()
    return {"ok": True}


class SavedSearchIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    query: str = Field(default="", max_length=500)
    filters: dict = Field(default_factory=dict)
    position: int = 0


DEFAULT_SMART_FOLDERS = [
    ("Faturalar", "", {"doc_kind": "invoice"}),
    ("Fiyat listeleri", "", {"doc_kind": "pricelist"}),
    ("Teklifler", "", {"doc_kind": "quote"}),
    ("Proformalar", "", {"doc_kind": "proforma"}),
    ("Excel ekleri", "", {"file_kind": "spreadsheet"}),
    ("PDF ekleri", "", {"file_kind": "pdf"}),
]


def ensure_default_smart_folders(db: Session) -> None:
    if db.execute(select(func.count()).select_from(SavedSearch)).scalar_one() == 0:
        for i, (name, q, f) in enumerate(DEFAULT_SMART_FOLDERS):
            db.add(SavedSearch(name=name, query=q, filters=f, position=i))
        db.commit()


_ALLOWED_FILTERS = {"view", "folder_id", "sender", "recipient", "date_from", "date_to", "has_attachment",
                    "file_kind", "doc_kind", "tag_id", "unread", "important", "sort"}


@router.get("/saved-searches")
def list_saved(db: Session = Depends(get_db)):
    ensure_default_smart_folders(db)
    rows = db.execute(select(SavedSearch).order_by(SavedSearch.position, SavedSearch.id)).scalars().all()
    return [{"id": s.id, "name": s.name, "query": s.query, "filters": s.filters, "position": s.position} for s in rows]


@router.post("/saved-searches")
def create_saved(body: SavedSearchIn, db: Session = Depends(get_db)):
    s = SavedSearch(name=body.name, query=body.query,
                    filters={k: v for k, v in body.filters.items() if k in _ALLOWED_FILTERS}, position=body.position)
    db.add(s)
    db.commit()
    return {"id": s.id, "name": s.name, "query": s.query, "filters": s.filters, "position": s.position}


@router.delete("/saved-searches/{sid}")
def delete_saved(sid: int, db: Session = Depends(get_db)):
    db.execute(delete(SavedSearch).where(SavedSearch.id == sid))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ yapılacaklar


class TaskIn(BaseModel):
    text: str = Field(min_length=1, max_length=500)
    due: date | None = None
    message_id: int | None = None
    source: str = Field(default="user", pattern="^(user|ai)$")


class TaskPatch(BaseModel):
    text: str | None = Field(default=None, max_length=500)
    due: date | None = None
    clear_due: bool = False
    done: bool | None = None


def _task_out(t: Task) -> dict:
    return {"id": t.id, "text": t.text, "due": t.due.isoformat() if t.due else None, "done": t.done,
            "source": t.source, "message_id": t.message_id, "thread_id": t.thread_id,
            "created_at": t.created_at.isoformat(), "done_at": t.done_at.isoformat() if t.done_at else None}


@router.get("/tasks")
def list_tasks(message_id: int | None = None, thread_id: int | None = None, include_done: bool = False,
               db: Session = Depends(get_db)):
    q = select(Task)
    if message_id:
        q = q.where(Task.message_id == message_id)
    if thread_id:
        q = q.where(Task.thread_id == thread_id)
    if not include_done:
        q = q.where(Task.done.is_(False))
    q = q.order_by(Task.done, Task.due.asc().nulls_last(), Task.id.desc()).limit(500)
    return [_task_out(t) for t in db.execute(q).scalars()]


@router.post("/tasks")
def create_task(body: TaskIn, db: Session = Depends(get_db)):
    thread_id = None
    if body.message_id:
        thread_id = _get_msg(db, body.message_id).thread_id
    t = Task(text=body.text.strip(), due=body.due, message_id=body.message_id, thread_id=thread_id, source=body.source)
    db.add(t)
    db.commit()
    return _task_out(t)


@router.patch("/tasks/{tid}")
def update_task(tid: int, body: TaskPatch, db: Session = Depends(get_db)):
    t = db.get(Task, tid)
    if t is None:
        raise HTTPException(404, "Görev yok")
    if body.text is not None:
        t.text = body.text.strip() or t.text
    if body.clear_due:
        t.due = None
    elif body.due is not None:
        t.due = body.due
    if body.done is not None:
        t.done = body.done
        t.done_at = datetime.now(UTC) if body.done else None
    db.commit()
    return _task_out(t)


@router.delete("/tasks/{tid}")
def delete_task(tid: int, db: Session = Depends(get_db)):
    db.execute(delete(Task).where(Task.id == tid))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ taslaklar (gönderme YOK)


class DraftIn(BaseModel):
    subject: str = Field(default="", max_length=500)
    body: str = Field(default="", max_length=50_000)
    to: list[str] = Field(default_factory=list, max_length=50)
    reviewed: bool | None = None


def _draft_out(d: Draft) -> dict:
    return {"id": d.id, "thread_id": d.thread_id, "reply_to_message_id": d.reply_to_message_id, "to": d.to_addrs,
            "subject": d.subject, "body": d.body, "source": d.source, "reviewed": d.reviewed,
            "ai_run_id": d.ai_run_id, "created_at": d.created_at.isoformat(), "updated_at": d.updated_at.isoformat(),
            "can_send": False}


@router.get("/drafts")
def list_drafts(db: Session = Depends(get_db)):
    return [_draft_out(d) for d in db.execute(select(Draft).order_by(Draft.updated_at.desc()).limit(200)).scalars()]


@router.get("/drafts/{did}")
def get_draft(did: int, db: Session = Depends(get_db)):
    d = db.get(Draft, did)
    if d is None:
        raise HTTPException(404, "Taslak yok")
    return _draft_out(d)


@router.patch("/drafts/{did}")
def update_draft(did: int, body: DraftIn, db: Session = Depends(get_db)):
    d = db.get(Draft, did)
    if d is None:
        raise HTTPException(404, "Taslak yok")
    d.subject, d.body = body.subject, body.body
    d.to_addrs = [t.strip().lower() for t in body.to if "@" in t]
    if body.reviewed is not None:
        d.reviewed = body.reviewed
    db.commit()
    return _draft_out(d)


@router.delete("/drafts/{did}")
def delete_draft(did: int, db: Session = Depends(get_db)):
    db.execute(delete(Draft).where(Draft.id == did))
    db.commit()
    return {"ok": True}


# ------------------------------------------------------------------ senkron durumu


@router.get("/sync/status")
def sync_status(db: Session = Depends(get_db), meili: Meili = Depends(get_meili),
                settings: Settings = Depends(get_settings)):
    hb = db.get(KeyValue, "worker")
    runs = db.execute(select(SyncRun).order_by(SyncRun.id.desc()).limit(20)).scalars().all()
    fnames = dict(db.execute(select(Folder.id, Folder.name)).all())
    dirty = db.execute(select(func.count()).select_from(Message).where(Message.index_dirty.is_(True))).scalar_one()
    total = db.execute(select(func.count()).select_from(Message)).scalar_one()
    age = None
    if hb is not None and hb.value.get("at"):
        age = (datetime.now(UTC) - datetime.fromisoformat(hb.value["at"])).total_seconds()
    return {
        "source": settings.mail_source,
        "sync_enabled": settings.sync_enabled,
        "sync_since": settings.sync_since,
        "interval_seconds": settings.sync_interval_seconds,
        "worker": {**(hb.value if hb else {}), "age_seconds": age,
                   "healthy": age is not None and age < max(settings.sync_interval_seconds * 3, 600)},
        "meilisearch": meili.healthy(),
        "messages_total": total,
        "index_pending": dirty,
        "runs": [{"id": r.id, "folder": fnames.get(r.folder_id), "started_at": r.started_at.isoformat(),
                  "finished_at": r.finished_at.isoformat() if r.finished_at else None, "status": r.status,
                  "fetched": r.fetched, "created": r.created, "duplicates": r.duplicates, "removed": r.removed,
                  "error": r.error} for r in runs],
    }


@router.post("/sync/request")
def request_sync(db: Session = Depends(get_db)):
    kv = db.get(KeyValue, "sync_requested") or KeyValue(key="sync_requested", value={})
    kv.value = {"at": datetime.now(UTC).isoformat()}
    db.merge(kv)
    db.commit()
    return {"ok": True, "message": "Senkron isteği alındı; worker bir sonraki kontrolde başlatacak."}


@router.get("/meta")
def meta(settings: Settings = Depends(get_settings)):
    from .. import __version__

    return {"version": __version__, "doc_kinds": DOC_KIND_LABELS, "file_kinds": FILE_KIND_LABELS,
            "account": settings.account_email, "source": settings.mail_source, "send_enabled": False}


@router.get("/settings")
def get_settings_view(settings: Settings = Depends(get_settings)):
    return settings.redacted()
