"""Thread (yazışma zinciri) birleştirme.

Sıra: In-Reply-To/References → (sonradan gelen ebeveyn için) bu maile referans veren
çocuklar → yanıt önekli konu + ortak katılımcı + 45 gün penceresi. Birden fazla thread
eşleşirse birleştirilir. Konu tek başına asla yeterli sayılmaz (yanlış birleştirme riski).
"""

from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, or_, select, update
from sqlalchemy.orm import Session

from ..models import Message, Thread
from .classify import has_reply_prefix

SUBJECT_WINDOW = timedelta(days=45)


def _participants(m: Message) -> set[str]:
    s = {m.from_email} | {a["email"] for a in (m.to_addrs or [])} | {a["email"] for a in (m.cc_addrs or [])}
    return {x for x in s if x}


def assign_thread(db: Session, m: Message, my_addresses: set[str]) -> Thread:
    candidate_ids = [x for x in ([m.in_reply_to] + list(m.references or [])) if x]
    thread_ids: set[int] = set()
    if candidate_ids:
        rows = db.execute(
            select(Message.thread_id).where(
                Message.account_id == m.account_id,
                Message.message_id_header.in_(candidate_ids),
                Message.thread_id.is_not(None),
            )
        ).scalars()
        thread_ids.update(rows)
    if m.message_id_header:
        rows = db.execute(
            select(Message.thread_id).where(
                Message.account_id == m.account_id,
                Message.thread_id.is_not(None),
                or_(Message.in_reply_to == m.message_id_header,
                    Message.references.contains([m.message_id_header])),
            )
        ).scalars()
        thread_ids.update(rows)

    if not thread_ids and m.normalized_subject and len(m.normalized_subject) >= 4 and has_reply_prefix(m.subject):
        parts = _participants(m) - my_addresses
        q = select(Thread).where(Thread.account_id == m.account_id, Thread.normalized_subject == m.normalized_subject)
        if m.date is not None:
            q = q.where(Thread.last_date >= m.date - SUBJECT_WINDOW, Thread.first_date <= m.date + SUBJECT_WINDOW)
        for t in db.execute(q.order_by(Thread.last_date.desc()).limit(5)).scalars():
            if not parts or parts & set(t.participants or []):
                thread_ids.add(t.id)
                break

    if not thread_ids:
        t = Thread(account_id=m.account_id, subject=m.subject, normalized_subject=m.normalized_subject)
        db.add(t)
        db.flush()
    else:
        ids = sorted(thread_ids)
        t = db.get(Thread, ids[0])
        if len(ids) > 1:
            merge_threads(db, ids[0], ids[1:])
    m.thread_id = t.id
    db.flush()
    refresh_thread(db, t, my_addresses)
    return t


def merge_threads(db: Session, keep_id: int, other_ids: list[int]) -> None:
    db.execute(update(Message).where(Message.thread_id.in_(other_ids))
               .values(thread_id=keep_id, index_dirty=True))
    from ..models import Draft

    db.execute(update(Draft).where(Draft.thread_id.in_(other_ids)).values(thread_id=keep_id))
    for tid in other_ids:
        t = db.get(Thread, tid)
        if t is not None:
            db.delete(t)
    db.flush()


def refresh_thread(db: Session, t: Thread, my_addresses: set[str]) -> None:
    msgs = db.execute(
        select(Message).where(Message.thread_id == t.id, Message.deleted_on_server.is_(False))
        .order_by(func.coalesce(Message.date, Message.created_at))
    ).scalars().all()
    if not msgs:
        t.message_count = 0
        return
    t.message_count = len(msgs)
    first, last = msgs[0], msgs[-1]
    t.subject = first.subject or last.subject
    t.normalized_subject = first.normalized_subject or last.normalized_subject
    t.first_date = first.date
    t.last_date = last.date
    t.last_from_me = last.is_from_me
    inbound = [x for x in msgs if not x.is_from_me]
    outbound = [x for x in msgs if x.is_from_me]
    t.last_inbound_date = inbound[-1].date if inbound else None
    t.last_outbound_date = outbound[-1].date if outbound else None
    t.has_human_inbound = any(not x.is_automated for x in inbound)
    parts: list[str] = []
    for x in msgs:
        for p in sorted(_participants(x)):
            if p not in parts and p not in my_addresses:
                parts.append(p)
    t.participants = parts[:30]
