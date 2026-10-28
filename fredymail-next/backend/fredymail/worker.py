"""Arka plan worker'ı: senkron + indeksleme + uyarılar.

AI çağrısı YAPMAZ (yalnızca kullanıcı isteğiyle çalışır). Hatalar sonsuz sıkı döngüye
girmez: senkron aralığı + klasör bazlı devre kesici + sınırlı yeniden deneme.
"""

from __future__ import annotations

import logging
import signal
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path

import httpx
from sqlalchemy import func, select

from .config import Settings, get_settings
from .db import new_session
from .logging_setup import setup_logging
from .mail.source import EmlDirSource, ImapSource, SourceAuthError, SourceError
from .mail.sync import run_sync
from .models import Folder, KeyValue
from .notify.webpush import notify_new_mail
from .search.meili import Meili, MeiliError, index_dirty, migrate_index_version

log = logging.getLogger("fredymail.worker")
_stop = False


def _set_kv(db, key: str, value: dict) -> None:
    kv = db.get(KeyValue, key)
    if kv is None:
        db.add(KeyValue(key=key, value=value))
    else:
        kv.value = value
    db.commit()


def source_factory(settings: Settings):
    if settings.mail_source == "demo":
        d = Path(settings.demo_mail_dir)
        if not d.exists() or not any(d.rglob("*.eml")):
            from .demo.generate import generate

            generate(d)
        return lambda: EmlDirSource(d, kind="demo", keep_payload_max=settings.attachment_extract_max_bytes
                                    if settings.attachment_text_extraction else 0,
                                    body_max_chars=settings.sync_body_text_max_chars), "demo", str(d)
    return (lambda: ImapSource(
        host=settings.imap_host, port=settings.imap_port, security=settings.imap_security,
        username=settings.imap_username or settings.account_email, password=settings.imap_password,
        timeout=settings.imap_timeout_seconds, full_fetch_max_bytes=settings.sync_full_fetch_max_bytes,
        body_max_chars=settings.sync_body_text_max_chars,
        keep_payload_max=settings.attachment_extract_max_bytes if settings.attachment_text_extraction else 0,
    )), "server", None


def send_alert(db, settings: Settings, text: str) -> None:
    """Opsiyonel Telegram uyarısı: saatte en fazla 1, mail içeriği İÇERMEZ."""
    if not (settings.alert_telegram_bot_token and settings.alert_telegram_chat_id):
        return
    kv = db.get(KeyValue, "last_alert")
    if kv and kv.value.get("at") and datetime.now(UTC) - datetime.fromisoformat(kv.value["at"]) < timedelta(hours=1):
        return
    try:
        httpx.post(f"https://api.telegram.org/bot{settings.alert_telegram_bot_token}/sendMessage",
                   json={"chat_id": settings.alert_telegram_chat_id, "text": f"{settings.brand_name} ⚠️ {text}"}, timeout=10)
    except httpx.HTTPError:
        log.warning("uyarı gönderilemedi")
    _set_kv(db, "last_alert", {"at": datetime.now(UTC).isoformat(), "text": text})


def run_forever(settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    setup_logging(settings.log_level)
    signal.signal(signal.SIGTERM, lambda *_: globals().__setitem__("_stop", True))
    meili = Meili(settings)
    index_ready = False
    cycle = 0
    last_sync = 0.0
    auth_failed_at = 0.0
    factory, origin, src_path = source_factory(settings)
    live_allowed = settings.mail_source == "demo" or settings.sync_enabled
    if not live_allowed:
        log.info("FM_SYNC_ENABLED=false: canlı posta senkronu kapalı (yalnızca indeksleme çalışır)")
    log.info("worker başladı kaynak=%s", settings.mail_source)
    while not _stop:
        db = new_session()
        try:
            hb = {"at": datetime.now(UTC).isoformat(), "cycle": cycle, "source": settings.mail_source,
                  "sync_enabled": live_allowed}
            if not index_ready:
                try:
                    meili.ensure_index()
                    if migrate_index_version(db, meili):
                        log.info("arama indeksi şeması güncellendi; belgeler arka planda yeniden indeksleniyor")
                    index_ready = True
                except MeiliError as e:
                    log.warning("indeks hazırlanamadı: %s", e)
            requested = db.get(KeyValue, "sync_requested")
            req_at = datetime.fromisoformat(requested.value["at"]).timestamp() if requested and requested.value.get("at") else 0
            due = time.time() - last_sync >= settings.sync_interval_seconds or req_at > last_sync
            # Kimlik hatasından sonra 30 dk bekle (hesabın kilitlenmesini önler)
            if live_allowed and due and time.time() - auth_failed_at > 1800:
                last_sync = time.time()
                try:
                    res = run_sync(db, factory, settings, origin=origin, source_path=src_path, cycle=cycle,
                                   heartbeat=lambda db=db, hb=hb: _set_kv(db, "worker", {**hb, "at": datetime.now(UTC).isoformat(),
                                                                             "state": "syncing"}))
                    hb["last_sync"] = {"at": datetime.now(UTC).isoformat(), "created": res.created,
                                       "folders": len(res.folders), "locked": res.skipped_locked,
                                       "errors": [f.folder for f in res.folders if f.status != "ok"]}
                    cycle += 1
                except SourceAuthError as e:
                    auth_failed_at = time.time()
                    hb["last_error"] = str(e)
                    log.error("IMAP kimlik doğrulama hatası; 30 dk sonra tekrar denenecek")
                    send_alert(db, settings, "IMAP kimlik doğrulaması başarısız. Parolayı/uygulama parolasını kontrol edin.")
                except SourceError as e:
                    hb["last_error"] = str(e)
                    log.warning("senkron başarısız: %s", e)
            try:  # yeni mail bildirimi (Web Push); hata senkronu etkilemez
                sent = notify_new_mail(db, settings)
                if sent:
                    log.info("yeni mail bildirimi adet=%s", sent)
            except Exception as e:  # noqa: BLE001
                db.rollback()
                log.warning("bildirim gönderilemedi: %s", type(e).__name__)
            if index_ready:
                try:
                    n = index_dirty(db, meili)
                    if n:
                        log.info("indekslendi adet=%s", n)
                    hb["search"] = "ok"
                except MeiliError as e:
                    hb["search"] = "down"
                    log.warning("indeksleme ertelendi: %s", e)
            failing = db.execute(select(func.count()).select_from(Folder)
                                 .where(Folder.consecutive_failures >= 3)).scalar_one()
            if failing:
                send_alert(db, settings, f"{failing} klasörde art arda senkron hatası var. Durum: Ayarlar → Senkron.")
            anomalies = db.execute(select(func.count()).select_from(Folder)
                                   .where(Folder.status == "anomaly")).scalar_one()
            if anomalies:
                hb["anomaly_folders"] = anomalies
                send_alert(db, settings, f"{anomalies} klasörde sunucudan toplu mail kaybı görüldü. FredyMail kopyaları "
                                         "koruyor; sunucu sağlayıcısıyla kontrol edin.")
            hb["state"] = "idle"
            _set_kv(db, "worker", hb)
        except Exception:
            log.exception("worker döngü hatası")
            db.rollback()
        finally:
            db.close()
        for _ in range(5):
            if _stop:
                break
            time.sleep(1)
    log.info("worker durdu")
