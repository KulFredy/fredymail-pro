"""Pano / istatistikler: yalnızca sayımlar (mail içeriği dönmez), Postgres'ten hesaplanır."""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import and_, func, select, true
from sqlalchemy.orm import Session

from ..models import Attachment, Message
from .query import SearchParams, _view_filters_pg

PERIODS = ("today", "this_week", "this_month", "last_month", "last_30_days", "this_year", "last_year", "all")
PERIOD_LABELS = {
    "today": "Bugün", "this_week": "Bu hafta", "this_month": "Bu ay", "last_month": "Geçen ay",
    "last_30_days": "Son 30 gün", "this_year": "Bu yıl", "last_year": "Geçen yıl", "all": "Tüm zamanlar",
}


@dataclass
class Range:
    start: datetime | None
    end: datetime | None
    label: str


def period_range(kind: str, now: datetime | None = None, *, n: int | None = None, year: int | None = None,
                 month: int | None = None, start: date | None = None, end: date | None = None) -> Range:
    now = now or datetime.now(UTC)
    today = datetime(now.year, now.month, now.day, tzinfo=UTC)
    if kind == "today":
        return Range(today, None, "Bugün")
    if kind == "yesterday":
        return Range(today - timedelta(days=1), today, "Dün")
    if kind == "this_week":
        return Range(today - timedelta(days=today.weekday()), None, "Bu hafta")
    if kind == "last_week":
        s = today - timedelta(days=today.weekday() + 7)
        return Range(s, s + timedelta(days=7), "Geçen hafta")
    if kind == "this_month":
        return Range(today.replace(day=1), None, "Bu ay")
    if kind == "last_month":
        first = today.replace(day=1)
        prev = (first - timedelta(days=1)).replace(day=1)
        return Range(prev, first, "Geçen ay")
    if kind == "last_30_days":
        return Range(today - timedelta(days=30), None, "Son 30 gün")
    if kind == "last_n_days" and n:
        return Range(today - timedelta(days=n), None, f"Son {n} gün")
    if kind == "this_year":
        return Range(today.replace(month=1, day=1), None, "Bu yıl")
    if kind == "last_year":
        return Range(datetime(now.year - 1, 1, 1, tzinfo=UTC), datetime(now.year, 1, 1, tzinfo=UTC), "Geçen yıl")
    if kind == "year" and year:
        return Range(datetime(year, 1, 1, tzinfo=UTC), datetime(year + 1, 1, 1, tzinfo=UTC), str(year))
    if kind == "month" and month:
        y = year or now.year
        s = datetime(y, month, 1, tzinfo=UTC)
        e = datetime(y + (month == 12), month % 12 + 1, 1, tzinfo=UTC)
        names = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim",
                 "Kasım", "Aralık"]
        return Range(s, e, f"{names[month - 1]} {y}")
    if kind == "range" and (start or end):
        s = datetime.combine(start, datetime.min.time(), tzinfo=UTC) if start else None
        e = datetime.combine(end, datetime.min.time(), tzinfo=UTC) + timedelta(days=1) if end else None
        return Range(s, e, f"{start or '…'} – {end or '…'}")
    return Range(None, None, "Tüm zamanlar")


def _conds(db: Session, r: Range, params: SearchParams | None = None) -> list:
    conds = _view_filters_pg(params or SearchParams(), db)
    if r.start:
        conds.append(Message.date >= r.start)
    if r.end:
        conds.append(Message.date < r.end)
    return conds


def top_senders(db: Session, r: Range, params: SearchParams | None = None, limit: int = 8,
                include_automated: bool = False) -> list[dict]:
    conds = _conds(db, r, params) + [Message.is_from_me.is_(False)]
    if not include_automated:
        conds.append(Message.is_automated.is_(False))
    rows = db.execute(select(Message.from_email, func.max(Message.from_name), func.count())
                      .where(and_(*conds)).group_by(Message.from_email)
                      .order_by(func.count().desc()).limit(limit)).all()
    return [{"email": e, "name": n or e, "count": c, "filter": {"sender": e}} for e, n, c in rows]


def top_domains(db: Session, r: Range, params: SearchParams | None = None, limit: int = 8) -> list[dict]:
    dom = func.split_part(Message.from_email, "@", 2)
    conds = _conds(db, r, params) + [Message.is_from_me.is_(False), Message.is_automated.is_(False)]
    rows = db.execute(select(dom, func.count()).where(and_(*conds)).group_by(dom)
                      .order_by(func.count().desc()).limit(limit)).all()
    return [{"domain": d, "name": d, "count": c, "filter": {"sender": "@" + d}} for d, c in rows if d]


def top_recipients(db: Session, r: Range, params: SearchParams | None = None, limit: int = 8,
                   my_addresses: set[str] | None = None) -> list[dict]:
    conds = _conds(db, r, params) + [Message.is_from_me.is_(True)]
    cnt: Counter = Counter()
    names: dict[str, str] = {}
    for (addrs,) in db.execute(select(Message.to_addrs).where(and_(*conds))):
        for a in addrs or []:
            e = a.get("email", "")
            if e and e not in (my_addresses or set()):
                cnt[e] += 1
                names.setdefault(e, a.get("name") or e)
    return [{"email": e, "name": names[e], "count": c, "filter": {"recipient": e}} for e, c in cnt.most_common(limit)]


def volume(db: Session, r: Range, params: SearchParams | None = None) -> dict:
    span = (r.end or datetime.now(UTC)) - (r.start or datetime(2000, 1, 1, tzinfo=UTC))
    unit = "day" if span <= timedelta(days=62) else "month"
    b = func.date_trunc(unit, Message.date)
    rows = db.execute(select(b, Message.is_from_me, func.count()).where(and_(*_conds(db, r, params)),
                                                                      Message.date.is_not(None))
                      .group_by(b, Message.is_from_me).order_by(b)).all()
    buckets: dict[str, dict] = {}
    for bucket, mine, c in rows:
        key = bucket.date().isoformat() if unit == "day" else bucket.strftime("%Y-%m")
        d = buckets.setdefault(key, {"bucket": key, "received": 0, "sent": 0})
        d["sent" if mine else "received"] += c
    return {"unit": unit, "series": list(buckets.values())[-36:]}


def counts(db: Session, r: Range, params: SearchParams | None = None) -> dict:
    where = and_(*_conds(db, r, params))
    received, sent, unread, with_att = db.execute(select(
        func.count().filter(Message.is_from_me.is_(False)),
        func.count().filter(Message.is_from_me.is_(True)),
        func.count().filter(Message.is_from_me.is_(False), Message.is_read.is_(False)),
        func.count().filter(Message.has_attachments.is_(True)),
    ).where(where)).one()
    dk_col = func.jsonb_array_elements_text(Message.doc_kinds).table_valued("value").render_derived()
    doc = {k: c for k, c in db.execute(select(dk_col.c.value, func.count()).select_from(Message)
                                       .join(dk_col, true()).where(where).group_by(dk_col.c.value)).all()}
    fk = {k: c for k, c in db.execute(
        select(Attachment.file_kind, func.count(func.distinct(Attachment.message_id)))
        .join(Message, Message.id == Attachment.message_id)
        .where(where, Attachment.is_inline.is_(False)).group_by(Attachment.file_kind)).all()}
    return {"received": received, "sent": sent, "unread": unread, "with_attachments": with_att,
            "doc_kinds": doc, "file_kinds": fk}


def insights(db: Session, period: str, my_addresses: set[str], awaiting: int, needs_reply: int) -> dict:
    r = period_range(period if period in PERIODS else "this_month")
    return {
        "period": period, "label": r.label,
        "from": r.start.isoformat() if r.start else None, "to": r.end.isoformat() if r.end else None,
        "counts": counts(db, r) | {"awaiting": awaiting, "needs_reply": needs_reply},
        "top_senders": top_senders(db, r),
        "top_domains": top_domains(db, r),
        "top_recipients": top_recipients(db, r, my_addresses=my_addresses),
        "volume": volume(db, r),
    }
