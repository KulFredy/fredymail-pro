"""FredyMail komut satırı.

Canlı hesaba dokunan komutlar salt okunurdur. Veri silen/sıfırlayan komutlar `--yes` ister.
"""

from __future__ import annotations

import argparse
import getpass
import json
import secrets
import sys

from .config import get_settings


def _print(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=2, default=str))


def cmd_discover(a) -> int:
    from .mail.discover import discover

    res = discover(a.email, a.host or [])
    print(f"\n== {res['email']} için posta sunucusu keşfi ==")
    for n in res["notes"]:
        print("  •", n)
    print("\nAdaylar (giriş YAPILMADAN yoklandı):")
    for p in res["probes"]:
        c = p["candidate"]
        state = "TLS ✓" if p["tls_ok"] else ("ulaşıldı" if p["reachable"] else "ulaşılamadı")
        print(f"  - {c['host']}:{c['port']} [{c['security']}] kaynak={c['source']} → {state} {p['error']}")
        if p["tls_ok"]:
            print(f"      sertifika: {p['cert_subject']} | veren: {p['cert_issuer']} | bitiş: {p['cert_not_after']}")
            print(f"      karşılama: {p['greeting'][:120]}")
            print(f"      AUTH: {', '.join(p['auth_methods']) or '(belirtilmemiş)'}")
    rec = res["recommendation"]
    print("\nÖneri:" if rec else "\nGüvenli (TLS doğrulanmış) bir IMAP sunucusu bulunamadı.")
    if rec:
        _print(rec)
    if a.json:
        _print(res)
    return 0 if rec else 2


def _live_source(s):
    from .mail.source import ImapSource

    return ImapSource(host=s.imap_host, port=s.imap_port, security=s.imap_security,
                      username=s.imap_username or s.account_email, password=s.imap_password,
                      timeout=s.imap_timeout_seconds)


def cmd_sync_plan(a) -> int:
    from .mail.discover import folder_plan

    s = get_settings()
    src = _live_source(s)
    try:
        plan = folder_plan(src, s)
    finally:
        src.close()
    print(f"\nİlk senkron kapsamı (since={s.sync_since}, klasör başına en fazla {s.sync_max_messages_per_folder}):")
    total = 0
    for r in plan:
        mark = "✔" if r["enabled"] else "✘"
        scope = r["in_scope"] if r["in_scope"] is not None else "-"
        total += r["in_scope"] or 0
        print(f"  {mark} {r['name']:<45} rol={r['role'] or '-':<8} toplam={r['total'] if r['total'] is not None else '-':>6} kapsam={scope}")
    print(f"\nToplam alınacak mail (tahmini): {total}")
    print("Sunucuda hiçbir şey değiştirilmez (EXAMINE + BODY.PEEK). Onaylıyorsanız FM_SYNC_ENABLED=true yapın.")
    return 0


def cmd_sync_once(a) -> int:
    from .db import new_session
    from .mail.sync import run_sync
    from .worker import source_factory

    s = get_settings()
    if s.mail_source != "demo" and not s.sync_enabled and not a.yes_live:
        print("Canlı senkron kapalı (FM_SYNC_ENABLED=false). Önce `fredymail sync-plan` çıktısını onaylayın; "
              "tek seferlik çalıştırmak için --yes-live ekleyin.", file=sys.stderr)
        return 3
    factory, origin, path = source_factory(s)
    db = new_session()
    res = run_sync(db, factory, s, origin=origin, source_path=path, only_folders=a.folder or None)
    _print([f.__dict__ for f in res.folders])
    return 0


def _import(source, origin_path: str) -> int:
    from .db import new_session
    from .mail.sync import run_sync

    s = get_settings()
    db = new_session()
    res = run_sync(db, lambda: source, s, origin="import", source_path=origin_path)
    if res.skipped_locked:
        print("Başka bir senkron çalışıyor; daha sonra tekrar deneyin.", file=sys.stderr)
        return 4
    _print([f.__dict__ for f in res.folders])
    print(f"Yeni: {res.created} | zaten var olan (sunucudakiyle eşleşen): {sum(f.duplicates for f in res.folders)}")
    return 0


def cmd_import_eml(a) -> int:
    from .mail.source import EmlDirSource

    prefix = a.prefix.strip("/") + "/" if a.prefix else ""
    return _import(EmlDirSource(a.directory, folder_prefix=prefix, kind="import"), a.directory)


def cmd_import_mbox(a) -> int:
    from .mail.source import MboxSource

    name = (a.prefix.strip("/") + "/" if a.prefix else "") + a.folder
    return _import(MboxSource(a.file, name), a.file)


def cmd_reindex(a) -> int:
    from .db import new_session
    from .search.meili import Meili, rebuild

    if not a.yes:
        print("Bu komut FredyMail'in kendi arama indeksini silip Postgres'ten yeniden kurar. --yes ile onaylayın.")
        return 3
    s = get_settings()
    n = rebuild(new_session(), Meili(s))
    print(f"{n} mail yeniden indekslendi ({s.meili_index}).")
    return 0


def cmd_purge_deleted(a) -> int:
    from datetime import UTC, datetime, timedelta

    from sqlalchemy import delete

    from .db import new_session
    from .models import Message

    if not a.yes:
        print("Sunucudan silinmiş ve FredyMail'de bekleyen mailleri kalıcı siler. --yes ile onaylayın.")
        return 3
    db = new_session()
    cutoff = datetime.now(UTC) - timedelta(days=a.days)
    r = db.execute(delete(Message).where(Message.deleted_on_server.is_(True), Message.updated_at < cutoff))
    db.commit()
    print(f"{r.rowcount} mail kalıcı silindi.")
    return 0


def cmd_retry_failed(a) -> int:
    """Kaydı başarısız olmuş (hata kaydı tutulan) mailleri siler; bir sonraki senkronda yeniden çekilirler."""
    import time

    from sqlalchemy import delete, func, select

    from .db import new_session
    from .mail.sync import sync_lock
    from .models import Message

    db = new_session()
    n = db.execute(select(func.count()).select_from(Message).where(Message.dedupe_key.startswith("err:"))).scalar_one()
    print(f"Hata kaydı olan mail: {n}")
    if not n or not a.yes:
        if n:
            print("Yeniden denemek için --yes ekleyin (posta sunucusunda hiçbir şey değişmez).")
        return 0
    for _ in range(60):  # çalışan senkronun bitmesini bekle (en fazla ~5 dk)
        with sync_lock(db) as got:
            if got:
                r = db.execute(delete(Message).where(Message.dedupe_key.startswith("err:")))
                db.commit()
                print(f"{r.rowcount} hata kaydı silindi; bir sonraki senkron döngüsünde yeniden çekilecek.")
                return 0
        time.sleep(5)
    print("Senkron kilidi alınamadı; daha sonra tekrar deneyin.", file=sys.stderr)
    return 4


def cmd_hash_password(a) -> int:
    from .security.auth import hash_password

    pw = getpass.getpass("Yeni parola: ")
    if len(pw) < 12:
        print("Parola en az 12 karakter olmalı.", file=sys.stderr)
        return 2
    if getpass.getpass("Tekrar: ") != pw:
        print("Parolalar eşleşmiyor.", file=sys.stderr)
        return 2
    print(hash_password(pw))
    return 0


def cmd_gen_secret(a) -> int:
    print(secrets.token_urlsafe(a.bytes))
    return 0


def cmd_totp_setup(a) -> int:
    import pyotp

    secret = pyotp.random_base32()
    uri = pyotp.TOTP(secret).provisioning_uri(name=a.user, issuer_name="FredyMail")
    print("FM_TOTP_SECRET =", secret)
    print("Kimlik doğrulayıcı uygulamasına eklemek için URI:", uri)
    return 0


def cmd_demo_generate(a) -> int:
    from .demo.generate import generate

    print(f"{generate(a.directory)} demo mail üretildi → {a.directory}")
    return 0


def cmd_worker_health(a) -> int:
    from datetime import UTC, datetime

    from .db import new_session
    from .models import KeyValue

    db = new_session()
    try:
        kv = db.get(KeyValue, "worker")
        if kv is None or not kv.value.get("at"):
            return 1
        age = (datetime.now(UTC) - datetime.fromisoformat(kv.value["at"])).total_seconds()
        return 0 if age < a.max_age else 1
    finally:
        db.close()


def cmd_worker(a) -> int:
    from .worker import run_forever

    run_forever()
    return 0


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="fredymail", description="FredyMail yönetim komutları")
    sp = p.add_subparsers(dest="cmd", required=True)

    d = sp.add_parser("discover", help="Posta sağlayıcısını ve güvenli IMAP ayarlarını keşfet (giriş yapmaz)")
    d.add_argument("email")
    d.add_argument("--host", action="append", help="Ek aday sunucu (ör. webmail adresindeki sunucu)")
    d.add_argument("--json", action="store_true")
    d.set_defaults(fn=cmd_discover)

    sp.add_parser("sync-plan", help="Canlı hesapta ilk senkron kapsamını göster (salt okunur)").set_defaults(fn=cmd_sync_plan)

    so = sp.add_parser("sync-once", help="Tek senkron döngüsü çalıştır")
    so.add_argument("--folder", action="append")
    so.add_argument("--yes-live", action="store_true")
    so.set_defaults(fn=cmd_sync_once)

    ie = sp.add_parser("import-eml", help="Outlook'tan sürüklenen .eml klasör ağacını içe aktar")
    ie.add_argument("directory")
    ie.add_argument("--prefix", default="Outlook")
    ie.set_defaults(fn=cmd_import_eml)

    im = sp.add_parser("import-mbox", help="mbox dosyasını içe aktar")
    im.add_argument("file")
    im.add_argument("--folder", required=True)
    im.add_argument("--prefix", default="Outlook")
    im.set_defaults(fn=cmd_import_mbox)

    r = sp.add_parser("reindex", help="Arama indeksini Postgres'ten yeniden üret")
    r.add_argument("--yes", action="store_true")
    r.set_defaults(fn=cmd_reindex)

    pd = sp.add_parser("purge-deleted", help="Sunucudan silinmiş mailleri kalıcı temizle")
    pd.add_argument("--days", type=int, default=30)
    pd.add_argument("--yes", action="store_true")
    pd.set_defaults(fn=cmd_purge_deleted)

    rf = sp.add_parser("retry-failed", help="Kaydedilemeyen mailleri yeniden çektir")
    rf.add_argument("--yes", action="store_true")
    rf.set_defaults(fn=cmd_retry_failed)

    sp.add_parser("hash-password", help="Giriş parolası için argon2 özeti üret").set_defaults(fn=cmd_hash_password)
    gs = sp.add_parser("gen-secret", help="Rastgele gizli anahtar üret")
    gs.add_argument("--bytes", type=int, default=48)
    gs.set_defaults(fn=cmd_gen_secret)
    ts = sp.add_parser("totp-setup", help="İki adımlı doğrulama (TOTP) sırrı üret")
    ts.add_argument("--user", default="fatih")
    ts.set_defaults(fn=cmd_totp_setup)
    dg = sp.add_parser("demo-generate", help="Sentetik demo mailleri üret")
    dg.add_argument("directory")
    dg.set_defaults(fn=cmd_demo_generate)
    sp.add_parser("worker", help="Arka plan worker'ını çalıştır").set_defaults(fn=cmd_worker)
    wh = sp.add_parser("worker-health", help="Worker kalp atışı taze mi (Docker healthcheck)")
    wh.add_argument("--max-age", type=int, default=900)
    wh.set_defaults(fn=cmd_worker_health)

    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
