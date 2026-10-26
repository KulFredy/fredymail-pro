"""Artımlı, idempotent ve kesintiye dayanıklı senkron motoru.

Garanti edilenler:
- Konum (klasör, UIDVALIDITY, UID) benzersizdir → aynı mail aynı klasörden iki kez alınmaz.
- Mail kimliği (Message-ID / içerik özeti) hesap içinde benzersizdir → aynı mail farklı
  klasörlerde veya hem sunucuda hem içe aktarılan Outlook arşivinde olsa bile tek kayıttır.
- Her parti kendi transaction'ında yazılır; kesilen senkron kaldığı yerden devam eder
  (zaten bilinen UID'ler atlanır).
- UIDVALIDITY değişirse o klasörün konumları sıfırlanır ve klasör yeniden taranır; mailler
  dedupe anahtarıyla yeniden eşleştiği için kopya oluşmaz.
- Ayrıştırılamayan mail bir "hata kaydı" olarak işaretlenir, sonsuz yeniden denenmez.
- Bağlantı hatalarında sınırlı sayıda, artan beklemeli yeniden deneme yapılır.
"""

from __future__ import annotations

import logging
import random
import time
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, func, select, text
from sqlalchemy.orm import Session

from ..config import Settings
from ..models import Account, Attachment, Folder, Message, MessageLocation, SyncRun, Thread
from .attachments import extract_text
from .classify import doc_kinds
from .source import FetchedMessage, FolderInfo, MailSource, SourceAuthError, SourceError
from .threading import assign_thread, refresh_thread

log = logging.getLogger(__name__)

SYNC_LOCK_KEY = 0x46524544  # "FRED"
ROLE_NAMES_TR = {"inbox": "Gelen Kutusu", "sent": "Gönderilen", "drafts": "Taslaklar", "trash": "Çöp Kutusu",
                 "junk": "Gereksiz", "archive": "Arşiv"}


@dataclass
class FolderStats:
    folder: str
    fetched: int = 0
    created: int = 0
    duplicates: int = 0
    errors: int = 0
    removed: int = 0
    remaining: int = 0
    status: str = "ok"
    error: str | None = None


@dataclass
class SyncResult:
    folders: list[FolderStats] = field(default_factory=list)
    skipped_locked: bool = False

    @property
    def created(self) -> int:
        return sum(f.created for f in self.folders)


# ------------------------------------------------------------------ yardımcılar


def ensure_account(db: Session, settings: Settings, kind: str, host: str | None = None,
                   capabilities: list[str] | None = None) -> Account:
    email = (settings.account_email or "demo@ornek.test").lower()
    acc = db.execute(select(Account).where(Account.email == email)).scalar_one_or_none()
    if acc is None:
        acc = Account(email=email, source_kind=kind, imap_host=host, capabilities=capabilities or [])
        db.add(acc)
        db.flush()
    elif capabilities:
        acc.capabilities = capabilities
        acc.imap_host = host or acc.imap_host
    return acc


def folder_is_default_enabled(info: FolderInfo, settings: Settings) -> bool:
    if not info.selectable:
        return False
    wanted = settings.sync_folders.strip()
    if wanted and wanted.lower() != "auto":
        names = {n.strip().lower() for n in wanted.split(",") if n.strip()}
        return info.name.lower() in names
    if info.role in ("trash", "junk", "drafts"):
        return False
    leaf = info.name.split(info.delimiter or "/")[-1].lower() if info.delimiter else info.name.lower()
    excluded = settings.excluded_folders
    if info.name.lower() in excluded or leaf in excluded:
        return False
    # Çöp/spam altındaki alt klasörler de hariç
    root = info.name.split(info.delimiter or "/")[0].lower() if info.delimiter else ""
    return not (root and root in excluded)


def discover_folders(db: Session, account: Account, source: MailSource, settings: Settings,
                     origin: str = "server", source_path: str | None = None) -> list[Folder]:
    existing = {f.name: f for f in db.execute(select(Folder).where(Folder.account_id == account.id)).scalars()}
    out = []
    for info in source.list_folders():
        f = existing.get(info.name)
        parent = None
        if info.delimiter and info.delimiter in info.name:
            parent = info.name.rsplit(info.delimiter, 1)[0]
        display = info.name.split(info.delimiter)[-1] if info.delimiter else info.name
        if parent is None and info.role in ROLE_NAMES_TR:  # yalnızca üst düzey sistem klasörleri çevrilir
            display = ROLE_NAMES_TR[info.role]
        if f is None:
            f = Folder(account_id=account.id, name=info.name, display_name=display, delimiter=info.delimiter,
                       parent_name=parent, flags=info.flags, role=info.role, origin=origin,
                       source_path=source_path,
                       sync_enabled=folder_is_default_enabled(info, settings) or origin != "server")
            db.add(f)
        else:
            f.flags, f.role, f.delimiter, f.parent_name = info.flags, info.role, info.delimiter, parent
            if source_path:
                f.source_path = source_path
        out.append(f)
    db.flush()
    return out


def _is_from_me(parsed_from: str, folder: Folder, settings: Settings) -> bool:
    return parsed_from.lower() in settings.my_addresses or folder.role == "sent"


def _location_exists(db: Session, folder: Folder, uidvalidity: int, uid: int) -> bool:
    return db.execute(
        select(MessageLocation.id).where(MessageLocation.folder_id == folder.id,
                                         MessageLocation.uidvalidity == uidvalidity,
                                         MessageLocation.uid == uid)
    ).first() is not None


def _nul_free(v):
    """Postgres TEXT/JSONB alanları NUL (0x00) karakterini kabul etmez; PDF metinlerinde sık görülür."""
    if isinstance(v, str):
        return v.replace("\x00", "")
    if isinstance(v, list):
        return [_nul_free(x) for x in v]
    if isinstance(v, dict):
        return {k: _nul_free(x) for k, x in v.items()}
    return v


def _sanitize(p) -> None:
    for f in ("message_id", "in_reply_to", "references", "subject", "from_name", "from_email", "to", "cc",
              "reply_to", "body_text", "body_html"):
        setattr(p, f, _nul_free(getattr(p, f)))
    for a in p.attachments:
        a.filename = _nul_free(a.filename)
        a.content_type = _nul_free(a.content_type)
        a.content_id = _nul_free(a.content_id)


def store_fetched(db: Session, account: Account, folder: Folder, uidvalidity: int, fm: FetchedMessage,
                  settings: Settings) -> str:
    """Tek maili idempotent biçimde yazar. Dönüş: created | duplicate | exists | error"""
    if _location_exists(db, folder, uidvalidity, fm.uid):
        return "exists"
    p = fm.parsed
    if p is not None:
        _sanitize(p)
    if p is None:
        key = f"err:{folder.id}:{uidvalidity}:{fm.uid}"
        msg = db.execute(select(Message).where(Message.account_id == account.id, Message.dedupe_key == key)).scalar_one_or_none()
        if msg is None:
            msg = Message(account_id=account.id, dedupe_key=key, subject="(ayrıştırılamayan mail)",
                          body_text="", snippet=f"Bu mail ayrıştırılamadı ({fm.error}).", server_flags=fm.flags,
                          is_read=True, index_dirty=False)
            db.add(msg)
            db.flush()
        msg.locations.append(MessageLocation(folder=folder, uidvalidity=uidvalidity, uid=fm.uid))
        db.flush()
        return "error"

    key = p.dedupe_key()
    msg = db.execute(select(Message).where(Message.account_id == account.id, Message.dedupe_key == key)).scalar_one_or_none()
    status = "duplicate"
    if msg is None:
        status = "created"
        msg = Message(
            account_id=account.id, dedupe_key=key, message_id_header=p.message_id, in_reply_to=p.in_reply_to,
            references=p.references, subject=p.subject, normalized_subject=p.normalized_subject,
            from_email=p.from_email, from_name=p.from_name, to_addrs=p.to, cc_addrs=p.cc, reply_to=p.reply_to,
            date=p.date, size=p.size, snippet=p.snippet, body_text=p.body_text, body_html=p.body_html,
            body_truncated=p.body_truncated, has_attachments=any(not a.is_inline for a in p.attachments),
            is_from_me=_is_from_me(p.from_email, folder, settings), is_automated=p.is_automated,
            injection_suspected=p.injection_suspected, server_flags=fm.flags,
            is_read=("\\Seen" in fm.flags) or _is_from_me(p.from_email, folder, settings),
        )
        db.add(msg)
        db.flush()
        for a in p.attachments:
            att = Attachment(message_id=msg.id, part_index=a.part_index, imap_section=a.imap_section,
                             filename=a.filename, content_type=a.content_type, size=a.size,
                             content_id=a.content_id, is_inline=a.is_inline, file_kind=a.file_kind, sha256=a.sha256)
            if settings.attachment_text_extraction and a.payload is not None and not a.is_inline:
                txt, st = extract_text(a.payload, a.filename, a.content_type, settings.attachment_extract_max_chars)
                att.extracted_text, att.extraction_status = _nul_free(txt), st
            msg.attachments.append(att)
    else:
        # Aynı mail başka bir klasörde de var (veya Outlook arşivinden içe aktarılıyor)
        if folder.role == "sent" and not msg.is_from_me:
            msg.is_from_me = True
        msg.server_flags = sorted(set(msg.server_flags or []) | set(fm.flags))
        msg.deleted_on_server = False
        msg.index_dirty = True
    msg.locations.append(MessageLocation(folder=folder, uidvalidity=uidvalidity, uid=fm.uid))
    db.flush()
    folder_names = [loc.folder.name for loc in msg.locations if loc.folder is not None]
    msg.doc_kinds = doc_kinds(msg.subject, msg.body_text, [a.filename for a in msg.attachments], folder_names)
    if status == "created" or msg.thread_id is None:
        assign_thread(db, msg, settings.my_addresses)
    else:
        t = db.get(Thread, msg.thread_id)
        if t is not None:
            refresh_thread(db, t, settings.my_addresses)
    return status


# ------------------------------------------------------------------ klasör senkronu


def sync_folder(db: Session, source: MailSource, account: Account, folder: Folder, settings: Settings,
                budget: int, *, deletion_check: bool = False, on_batch: Callable[[], None] | None = None) -> FolderStats:
    stats = FolderStats(folder=folder.name)
    st = source.open_folder(folder.name)
    folder.server_message_count = st.exists
    if folder.uidvalidity is not None and folder.uidvalidity != st.uidvalidity:
        log.warning("UIDVALIDITY değişti klasör_id=%s; konumlar sıfırlanıyor", folder.id)
        db.execute(delete(MessageLocation).where(MessageLocation.folder_id == folder.id))
        folder.last_uid = 0
    folder.uidvalidity = st.uidvalidity
    db.commit()

    since = settings.since_date() if folder.origin == "server" else None
    server_uids = source.search_uids(since)
    known = set(db.execute(select(MessageLocation.uid).where(MessageLocation.folder_id == folder.id,
                                                              MessageLocation.uidvalidity == st.uidvalidity)).scalars())
    cap = max(settings.sync_max_messages_per_folder - len(known), 0)
    new = sorted((u for u in server_uids if u not in known), reverse=True)[:cap]  # önce en yeniler
    stats.remaining = max(len(new) - budget, 0)
    new = new[:budget]

    bs = max(settings.sync_batch_size, 1)
    for i in range(0, len(new), bs):
        chunk = new[i:i + bs]
        for fm in source.fetch(chunk):
            stats.fetched += 1
            try:
                with db.begin_nested():
                    r = store_fetched(db, account, folder, st.uidvalidity, fm, settings)
            except Exception as e:  # beklenmeyen hata tek maili etkiler; tekrar tekrar denenmez
                # Yalnızca hata TÜRÜ loglanır; mesaj/traceback mail içeriği taşıyabilir
                log.error("mail kaydedilemedi klasör_id=%s uid=%s hata=%s", folder.id, fm.uid, type(e).__name__)
                with db.begin_nested():
                    r = store_fetched(db, account, folder, st.uidvalidity,
                                      FetchedMessage(uid=fm.uid, flags=fm.flags, parsed=None,
                                                     error=type(e).__name__), settings)
            if r == "created":
                stats.created += 1
            elif r == "duplicate":
                stats.duplicates += 1
            elif r == "error":
                stats.errors += 1
        folder.last_uid = max(folder.last_uid or 0, max(chunk))
        db.commit()  # kontrol noktası: bu partiye kadar olan her şey kalıcı
        if on_batch:
            on_batch()
        if settings.sync_batch_delay_ms and i + bs < len(new):
            time.sleep(settings.sync_batch_delay_ms / 1000)

    # Son mailler için sunucu bayraklarını güncelle (Outlook'ta okunan/yanıtlanan)
    recent = sorted(known)[-300:]
    if recent:
        flags = source.fetch_flags(recent)
        rows = db.execute(select(MessageLocation).where(MessageLocation.folder_id == folder.id,
                                                        MessageLocation.uidvalidity == st.uidvalidity,
                                                        MessageLocation.uid.in_(list(flags)))).scalars()
        for loc in rows:
            m = loc.message
            new_flags = sorted(set(flags.get(loc.uid, [])))
            if new_flags != sorted(m.server_flags or []):
                if "\\Seen" in new_flags and "\\Seen" not in (m.server_flags or []):
                    m.is_read = True
                m.server_flags = new_flags
                m.index_dirty = True
        db.commit()

    if deletion_check and folder.origin == "server":
        all_uids = set(source.search_uids(None)) if since else set(server_uids)
        gone = known - all_uids
        if gone:
            stats.removed = _remove_locations(db, folder, st.uidvalidity, gone, settings)
            db.commit()
    return stats


def _remove_locations(db: Session, folder: Folder, uidvalidity: int, uids: set[int], settings: Settings) -> int:
    locs = db.execute(select(MessageLocation).where(MessageLocation.folder_id == folder.id,
                                                    MessageLocation.uidvalidity == uidvalidity,
                                                    MessageLocation.uid.in_(list(uids)))).scalars().all()
    touched = set()
    for loc in locs:
        touched.add(loc.message_id)
        db.delete(loc)
    db.flush()
    for mid in touched:
        m = db.get(Message, mid)
        if m is None:
            continue
        remaining = db.execute(select(func.count()).select_from(MessageLocation)
                               .where(MessageLocation.message_id == mid)).scalar_one()
        if remaining == 0:
            m.deleted_on_server = True
        m.index_dirty = True
        if m.thread_id:
            t = db.get(Thread, m.thread_id)
            if t is not None:
                refresh_thread(db, t, settings.my_addresses)
    return len(locs)


# ------------------------------------------------------------------ tüm hesap


def _backoff(attempt: int) -> float:
    return min(2 ** attempt, 60) + random.uniform(0, 1)


@contextmanager
def sync_lock(db: Session) -> Iterator[bool]:
    """Hesap başına tek senkron. Advisory lock PG *oturum* düzeyindedir; ORM oturumu her commit'te
    bağlantıyı havuza iade edebileceği için kilit ayrı ve sabit bir bağlantıda tutulur."""
    conn = db.get_bind().connect()
    got = False
    try:
        got = bool(conn.execute(text("SELECT pg_try_advisory_lock(:k)"), {"k": SYNC_LOCK_KEY}).scalar())
        conn.commit()
        yield got
    finally:
        try:
            if got:
                conn.execute(text("SELECT pg_advisory_unlock(:k)"), {"k": SYNC_LOCK_KEY})
                conn.commit()
        finally:
            conn.close()


def run_sync(db: Session, source_factory: Callable[[], MailSource], settings: Settings, *,
             origin: str = "server", source_path: str | None = None, cycle: int = 0,
             only_folders: list[str] | None = None, sleep: Callable[[float], None] = time.sleep,
             heartbeat: Callable[[], None] | None = None) -> SyncResult:
    result = SyncResult()
    with sync_lock(db) as got:
        if not got:
            result.skipped_locked = True
            return result
        return _run_sync_locked(db, source_factory, settings, result, origin=origin, source_path=source_path,
                                cycle=cycle, only_folders=only_folders, sleep=sleep, heartbeat=heartbeat)


def _run_sync_locked(db: Session, source_factory, settings: Settings, result: SyncResult, *, origin: str,
                     source_path: str | None, cycle: int, only_folders: list[str] | None,
                     sleep: Callable[[float], None], heartbeat: Callable[[], None] | None) -> SyncResult:
    source: MailSource | None = None
    try:
        source = source_factory()
        account = ensure_account(db, settings, source.info.kind, source.info.host, source.info.capabilities)
        folders = discover_folders(db, account, source, settings, origin=origin, source_path=source_path)
        db.commit()
        budget = settings.sync_max_messages_per_cycle
        now = datetime.now(UTC)
        for folder in folders:
            if not folder.sync_enabled or (only_folders and folder.name not in only_folders):
                continue
            if folder.consecutive_failures and folder.last_synced_at:
                wait = timedelta(seconds=min(60 * 2 ** folder.consecutive_failures, 3600))
                if now - folder.last_synced_at < wait:
                    continue  # devre kesici: art arda hata alan klasörü bir süre beklet
            if budget <= 0:
                break
            run = SyncRun(account_id=account.id, folder_id=folder.id)
            db.add(run)
            folder.status = "syncing"
            db.commit()
            attempt = 0
            while True:
                try:
                    stats = sync_folder(db, source, account, folder, settings, budget,
                                        deletion_check=(cycle % max(settings.sync_deletion_check_every, 1) == 0),
                                        on_batch=heartbeat)
                    folder.status, folder.last_error, folder.consecutive_failures = "idle", None, 0
                    break
                except SourceAuthError as e:
                    db.rollback()
                    stats = FolderStats(folder=folder.name, status="error", error=str(e))
                    folder.status, folder.last_error = "error", str(e)
                    folder.consecutive_failures += 1
                    folder.last_synced_at = datetime.now(UTC)
                    db.commit()
                    raise
                except SourceError as e:
                    db.rollback()
                    attempt += 1
                    log.warning("senkron hatası klasör_id=%s deneme=%s hata=%s", folder.id, attempt, e)
                    if attempt > settings.sync_max_retries:
                        stats = FolderStats(folder=folder.name, status="error", error=str(e))
                        folder.status, folder.last_error = "error", str(e)
                        folder.consecutive_failures += 1
                        break
                    sleep(_backoff(attempt))
                    try:
                        source.close()
                    except Exception:  # noqa: S110
                        pass
                    source = source_factory()
            folder.last_synced_at = datetime.now(UTC)
            run.finished_at = datetime.now(UTC)
            run.status = stats.status if stats.remaining == 0 or stats.status != "ok" else "partial"
            run.fetched, run.created, run.duplicates, run.removed = (stats.fetched, stats.created,
                                                                     stats.duplicates, stats.removed)
            run.error = stats.error
            db.commit()
            budget -= stats.fetched
            result.folders.append(stats)
        return result
    finally:
        if source is not None:
            try:
                source.close()
            except Exception:  # noqa: S110
                pass
        db.rollback()
