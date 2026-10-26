"""Meilisearch istemcisi ve indeksleyici.

Meilisearch *yeniden üretilebilir* bir indekstir; doğruluk kaynağı Postgres'tir.
`messages.index_dirty` bir çıkış kutusu (outbox) gibi çalışır: değişen her mail
işaretlenir, indeksleyici partiler halinde gönderir. Meilisearch kapalıysa işaret
kalır ve sonraki döngüde tekrar denenir. `rebuild()` indeksi Postgres'ten sıfırdan kurar.
"""

from __future__ import annotations

import logging
import time
from datetime import UTC, datetime

import httpx
from sqlalchemy import select, update
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import Message, MessageTag, Tag

log = logging.getLogger(__name__)

HL_PRE = ""  # vurgulama işaretleri: HTML değil, istemci güvenle <mark>'a çevirir
HL_POST = ""
BODY_INDEX_CHARS = 20_000

INDEX_SETTINGS = {
    "searchableAttributes": ["subject", "from_name", "from_email", "to", "attachment_names", "body",
                             "attachment_text", "notes"],
    "filterableAttributes": ["folder_ids", "from_email", "from_domain", "to_emails", "date_ts", "has_attachments",
                             "file_kinds", "doc_kinds", "is_from_me", "is_read", "is_important", "tag_ids",
                             "thread_id", "is_automated", "snoozed_until_ts", "deleted"],
    "sortableAttributes": ["date_ts"],
    "displayedAttributes": ["id", "thread_id", "subject", "from_name", "from_email", "body", "date_ts"],
    "localizedAttributes": [{"attributePatterns": ["*"], "locales": ["tur", "eng"]}],
    "synonyms": {
        "fatura": ["invoice", "e-fatura", "efatura"],
        "invoice": ["fatura"],
        "fiyat listesi": ["price list", "pricelist", "fiyat listeleri"],
        "price list": ["fiyat listesi", "pricelist"],
        "pricelist": ["fiyat listesi", "price list"],
        "teklif": ["quotation", "quote", "offer"],
        "quotation": ["teklif"],
        "sipariş": ["order", "purchase order"],
        "order": ["sipariş"],
        "irsaliye": ["delivery note", "packing list"],
        "sözleşme": ["contract", "agreement"],
        "contract": ["sözleşme"],
    },
    "pagination": {"maxTotalHits": 5000},
    "typoTolerance": {"minWordSizeForTypos": {"oneTypo": 5, "twoTypos": 9}},
}


class MeiliError(Exception):
    pass


class Meili:
    def __init__(self, settings: Settings, client: httpx.Client | None = None):
        self.s = settings
        self.index = settings.meili_index
        self.http = client or httpx.Client(
            base_url=settings.meili_url.rstrip("/"),
            headers={"Authorization": f"Bearer {settings.meili_master_key}"} if settings.meili_master_key else {},
            timeout=10.0,
        )

    def _req(self, method: str, path: str, **kw) -> dict:
        try:
            r = self.http.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise MeiliError(f"Meilisearch erişilemiyor: {type(e).__name__}") from e
        if r.status_code >= 400:
            try:
                code = r.json().get("code", "")
            except ValueError:
                code = ""
            raise MeiliError(f"Meilisearch hata {r.status_code} {code}")
        return r.json() if r.content else {}

    def healthy(self) -> bool:
        try:
            return self._req("GET", "/health").get("status") == "available"
        except MeiliError:
            return False

    def wait(self, task: dict, timeout: float = 30.0) -> dict:
        uid = task.get("taskUid")
        if uid is None:
            return task
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            t = self._req("GET", f"/tasks/{uid}")
            if t.get("status") in ("succeeded", "failed", "canceled"):
                if t["status"] != "succeeded":
                    raise MeiliError(f"Meilisearch görevi başarısız: {t.get('error', {}).get('code')}")
                return t
            time.sleep(0.05)
        raise MeiliError("Meilisearch görevi zaman aşımına uğradı")

    def ensure_index(self) -> None:
        try:
            self._req("GET", f"/indexes/{self.index}")
        except MeiliError:
            self.wait(self._req("POST", "/indexes", json={"uid": self.index, "primaryKey": "id"}))
        self.wait(self._req("PATCH", f"/indexes/{self.index}/settings", json=INDEX_SETTINGS), timeout=120)

    def add_documents(self, docs: list[dict], wait: bool = True) -> None:
        if docs:
            t = self._req("PUT", f"/indexes/{self.index}/documents", json=docs)
            if wait:
                self.wait(t, timeout=120)

    def delete_documents(self, ids: list[int], wait: bool = True) -> None:
        if ids:
            t = self._req("POST", f"/indexes/{self.index}/documents/delete-batch", json=ids)
            if wait:
                self.wait(t)

    def delete_index(self) -> None:
        try:
            self.wait(self._req("DELETE", f"/indexes/{self.index}"))
        except MeiliError:
            pass

    def stats(self) -> dict:
        return self._req("GET", f"/indexes/{self.index}/stats")

    def search(self, body: dict) -> dict:
        return self._req("POST", f"/indexes/{self.index}/search", json=body)


# ------------------------------------------------------------------ belge üretimi


def build_document(m: Message, tag_ids: list[int], tag_names: list[str], notes: list[str]) -> dict:
    folder_ids = sorted({loc.folder_id for loc in m.locations})
    to = [f"{a.get('name', '')} <{a['email']}>".strip() for a in (m.to_addrs or []) + (m.cc_addrs or [])]
    atts = [a for a in m.attachments if not a.is_inline]
    return {
        "id": m.id,
        "thread_id": m.thread_id,
        "subject": m.subject,
        "from_name": m.from_name,
        "from_email": m.from_email,
        "from_domain": m.from_email.split("@")[-1] if "@" in m.from_email else "",
        "to": to,
        "to_emails": [a["email"] for a in (m.to_addrs or []) + (m.cc_addrs or [])],
        "body": (m.body_text or "")[:BODY_INDEX_CHARS],
        "attachment_names": [a.filename for a in atts],
        "attachment_text": "\n".join((a.extracted_text or "")[:10000] for a in atts if a.extracted_text)[:30000],
        "notes": notes + tag_names,
        "has_attachments": bool(atts),
        "file_kinds": sorted({a.file_kind for a in atts}),
        "doc_kinds": m.doc_kinds or [],
        "folder_ids": folder_ids,
        "date_ts": int(m.date.timestamp()) if m.date else 0,
        "is_from_me": m.is_from_me,
        "is_read": m.is_read,
        "is_important": m.is_important,
        "is_automated": m.is_automated,
        "tag_ids": tag_ids,
        "snoozed_until_ts": int(m.snoozed_until.timestamp()) if m.snoozed_until else 0,
        "deleted": m.deleted_on_server,
    }


def _docs_for(db: Session, msgs: list[Message]) -> list[dict]:
    from ..models import Note

    ids = [m.id for m in msgs]
    tags: dict[int, list[tuple[int, str]]] = {}
    for mid, tid, name in db.execute(
        select(MessageTag.message_id, Tag.id, Tag.name).join(Tag, Tag.id == MessageTag.tag_id)
        .where(MessageTag.message_id.in_(ids))
    ):
        tags.setdefault(mid, []).append((tid, name))
    notes: dict[int, list[str]] = {}
    for mid, body in db.execute(select(Note.message_id, Note.body).where(Note.message_id.in_(ids))):
        notes.setdefault(mid, []).append(body[:2000])
    return [build_document(m, [t[0] for t in tags.get(m.id, [])], [t[1] for t in tags.get(m.id, [])],
                           notes.get(m.id, [])) for m in msgs]


def index_dirty(db: Session, meili: Meili, batch: int = 200, max_batches: int = 50) -> int:
    """Kirli mailleri indeksler. Meilisearch kapalıysa MeiliError fırlatır, işaretler korunur."""
    total = 0
    for _ in range(max_batches):
        msgs = db.execute(
            select(Message).where(Message.index_dirty.is_(True)).order_by(Message.id).limit(batch)
        ).scalars().all()
        if not msgs:
            break
        live = [m for m in msgs if not m.deleted_on_server and not m.dedupe_key.startswith("err:")]
        dead = [m.id for m in msgs if m not in live]
        meili.add_documents(_docs_for(db, live))
        meili.delete_documents(dead)
        now = datetime.now(UTC)
        db.execute(update(Message).where(Message.id.in_([m.id for m in msgs]))
                   .values(index_dirty=False, indexed_at=now))
        db.commit()
        total += len(msgs)
    return total


def reindex_one(db: Session, meili: Meili, message_id: int) -> None:
    """Kullanıcı durumu değişince (etiket/okundu...) tek belgeyi hemen günceller; olmazsa kirli bırakır."""
    m = db.get(Message, message_id)
    if m is None:
        return
    try:
        # kısa bekleme: kullanıcı not/etiket ekleyip hemen aradığında sonuç güncel olsun
        meili.wait(meili._req("PUT", f"/indexes/{meili.index}/documents", json=_docs_for(db, [m])), timeout=3)
        m.index_dirty = False
    except MeiliError:
        m.index_dirty = True


def rebuild(db: Session, meili: Meili) -> int:
    """İndeksi silip Postgres'ten yeniden kurar (yalnızca FredyMail'in kendi indeksi)."""
    meili.delete_index()
    meili.ensure_index()
    db.execute(update(Message).values(index_dirty=True))
    db.commit()
    return index_dirty(db, meili, max_batches=100000)
