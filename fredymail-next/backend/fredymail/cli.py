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


def cmd_accept_deletions(a) -> int:
    """Toplu kayıp kilidine takılan klasörde silinmelerin GERÇEK olduğunu onaylar."""
    from sqlalchemy import select

    from .db import new_session
    from .mail.sync import set_mass_delete_allowed
    from .models import Folder

    db = new_session()
    q = select(Folder).where(Folder.status == "anomaly")
    if a.folder:
        q = select(Folder).where(Folder.name == a.folder)
    folders = db.execute(q).scalars().all()
    if not folders:
        print("Toplu kayıp kilidinde bekleyen klasör yok.")
        return 0
    for f in folders:
        print(f"- {f.name}: {f.last_error or ''}")
    if not a.yes:
        print("Bu klasörlerdeki kayıpları onaylamak için --yes ekleyin. (Mailler FredyMail aramasından kalkar; "
              "posta sunucusunda hiçbir şey değişmez.)")
        return 0
    for f in folders:
        set_mass_delete_allowed(db, f.id, True)
    db.commit()
    print("Onaylandı; bir sonraki senkron döngüsünde uygulanacak.")
    return 0


def cmd_reclassify(a) -> int:
    """Kayıtlı mailleri (yeniden indirmeden) güncel kurallarla yeniden sınıflandırır:
    toplu/otomatik mail, imza görselleri, belge türleri; thread özetleri ve arama indeksi yenilenir."""
    import time

    from sqlalchemy import select

    from .config import get_settings
    from .db import new_session
    from .mail.classify import doc_kinds, is_signature_image, looks_bulk
    from .mail.sync import sync_lock
    from .mail.threading import refresh_thread
    from .models import Message, Thread

    if not a.yes:
        print("Tüm mailleri güncel kurallarla yeniden sınıflandırır (posta sunucusuna dokunmaz). --yes ile onaylayın.")
        return 3
    s = get_settings()
    db = new_session()
    for _ in range(60):
        with sync_lock(db) as got:
            if not got:
                time.sleep(5)
                continue
            last_id, changed, n = 0, 0, 0
            while True:
                msgs = db.execute(select(Message).where(Message.id > last_id).order_by(Message.id).limit(500)).scalars().all()
                if not msgs:
                    break
                for m in msgs:
                    n += 1
                    before = (m.is_automated, m.has_attachments, tuple(m.doc_kinds or []))
                    for att in m.attachments:
                        if not att.is_inline and is_signature_image(att.filename, att.content_type, att.size, att.content_id):
                            att.is_inline = True
                    m.has_attachments = any(not x.is_inline for x in m.attachments)
                    if not m.is_automated and not m.is_from_me and looks_bulk(m.from_email, m.subject, m.body_text):
                        m.is_automated = True
                    m.doc_kinds = doc_kinds(m.subject, m.body_text, [x.filename for x in m.attachments if not x.is_inline],
                                            [loc.folder.name for loc in m.locations])
                    if before != (m.is_automated, m.has_attachments, tuple(m.doc_kinds or [])):
                        m.index_dirty = True
                        changed += 1
                last_id = msgs[-1].id
                db.commit()
                print(f"  {n} mail tarandı, {changed} güncellendi…", flush=True)
            for t in db.execute(select(Thread)).scalars():
                refresh_thread(db, t, s.my_addresses)
            db.commit()
            print(f"Bitti: {n} mail, {changed} güncellendi. Arama indeksi worker tarafından arka planda yenilenecek.")
            return 0
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
    uri = pyotp.TOTP(secret).provisioning_uri(name=a.user, issuer_name=get_settings().brand_name)
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


def cmd_hero_yoldaki(a) -> int:
    """Yoldaki Mallar xlsx'ini okur, seçilen ayda stoğa girecekleri listeler (AI yok, ağ yok)."""
    from datetime import date

    from .hero.yoldaki import arriving_in, parse_workbook

    today = date.fromisoformat(a.today) if a.today else date.today()
    if a.month:
        year, month = (int(x) for x in a.month.split("-"))
    else:
        year, month = today.year, today.month
    with open(a.file, "rb") as f:
        items = parse_workbook(f.read(), today)
    result = arriving_in(items, year, month, today)
    if a.json:
        _print({"month": f"{year}-{month:02d}", "today": today.isoformat(), "brands": result})
        return 0
    marks = {"new": "🆕", "uncertain": "❔", "overdue": "⚠️"}
    print(f"{year}-{month:02d} ayında stoğa girmesi beklenenler (bugün {today}) — {len(items)} kalem okundu")
    for brand, rows in result.items():
        print(f"\n{brand} ({len(rows)})")
        for r in rows:
            fl = " ".join(marks[f] for f in r["flags"])
            qty = r["qty"] if r["qty"] is not None else "-"
            sh = r["shipments"]
            st = " + ".join(f"×{x['qty']} {x['status']}" for x in sh) if len(sh) > 1 else f"×{qty} {r['status']}"
            print(f"  {fl:6} {r['name']}  [{st}]")
    return 0


def _hero_client(s):
    from .hero.google import GoogleClient

    if not s.hero_sheet_id:
        raise SystemExit("FM_HERO_SHEET_ID tanımlı değil (.env)")
    return GoogleClient.from_file(s.google_sa_file)


def _hero_sheet(s, client):
    from .hero.sheet import parse_grid

    tab = s.hero_sheet_tab
    return parse_grid(client.sheet_grid(s.hero_sheet_id, f"'{tab}'!A1:Z200"), tab)


def cmd_hero_sync(a) -> int:
    from .db import new_session
    from .hero.service import run_sync

    s = get_settings()
    if not s.hero_yoldaki_file_id:
        raise SystemExit("FM_HERO_YOLDAKI_FILE_ID tanımlı değil (.env)")
    db = new_session()
    try:
        _print(run_sync(db, s))
    finally:
        db.close()
    return 0


def cmd_hero_site(a) -> int:
    """Mağaza site haritasını indirip yoldaki ürünlerle eşleştirir; sonuçları marka bazında gösterir."""
    from sqlalchemy import select

    from .db import new_session
    from .hero.service import run_site_check
    from .models import HeroItem

    s = get_settings()
    db = new_session()
    try:
        print(f"{s.hero_shop_url} site haritası okunuyor (istekler arası {s.hero_site_delay:.0f} sn)…", flush=True)
        res = run_site_check(db, s)
        print(f"Mağazada {res['products']} ürün linki. Yoldaki ürünler: {res['found']} eşleşti, "
              f"{res['missing']} sitede yok (yeni sayılır), {res['ambiguous']} belirsiz.")
        rows = db.execute(select(HeroItem).order_by(HeroItem.brand, HeroItem.name)).scalars().all()
        for label, cond in (("SİTEDE YOK → yeni ürün adayı", lambda r: r.on_site is False),
                            ("BELİRSİZ (birden çok aday) → yeni sayılmaz", lambda r: r.on_site is None)):
            sel = [r for r in rows if cond(r)]
            if sel:
                print(f"\n{label} ({len(sel)}):")
                for r in sel[: a.limit]:
                    print(f"  {r.brand:12} {r.name}")
        if a.show_found:
            print("\nEŞLEŞENLER:")
            for r in rows:
                if r.on_site:
                    print(f"  {r.brand:12} {r.name}\n               → {r.site_url}")
    finally:
        db.close()
    return 0


def cmd_hero_preview(a) -> int:
    """Önerilen planı gösterir ve JSON'a yazar. Tabloya dokunmaz."""
    from datetime import date, datetime, timedelta

    from .hero.service import build_plan, load_site_index, local_tz, new_product_keys, site_links
    from .hero.yoldaki import parse_workbook

    s = get_settings()
    today = datetime.now(local_tz(s.hero_timezone)).date()
    if a.month:
        year, month = (int(x) for x in a.month.split("-"))
    else:  # varsayılan: gelecek ay (ayın 25'inde hazırlanır)
        nxt = (today.replace(day=1) + timedelta(days=32)).replace(day=1)
        year, month = nxt.year, nxt.month
    client = _hero_client(s)
    hs = _hero_sheet(s, client)
    if a.file:
        with open(a.file, "rb") as f:
            data = f.read()
    else:
        data, _ = client.download_xlsx(s.hero_yoldaki_file_id)
    items = parse_workbook(data, today)
    if a.today:
        today = date.fromisoformat(a.today)
    from .db import new_session
    from .hero.service import save_plan

    db = new_session()
    try:
        new_keys = new_product_keys(db)
        site = load_site_index(db)
        if site is None:
            print("(uyarı: mağaza kontrolü henüz yapılmadı; `fredymail hero-site` çalıştırın)")
        plan = build_plan(hs, items, new_keys, year, month, today, site=site, links=site_links(db))
        save_plan(db, plan)
    finally:
        db.close()
    if a.out == "-":
        print(json.dumps(plan, ensure_ascii=False, indent=2))
        return 0
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(json.dumps(plan, ensure_ascii=False, indent=2))
    print(f"Plan: {plan['period']} (önceki: {plan['previous_period']} → arşiv sekmesi '{plan['archive_title']}')")
    for b in plan["brands"]:
        tag = " [YENİ MARKA]" if b.get("new_brand") else ""
        print(f"\n{b['brand']}{tag} ({len(b['products'])})")
        for p in b["products"]:
            mark = "🆕" if p["source"] == "yeni" else "  "
            link = "" if p.get("link") else "  (link yok)"
            extra = f"  [{p['status']}]" if p.get("status") and p["source"] == "yeni" else ""
            print(f"  {mark} {p['text']}{extra}{link}")
    for d in plan["dropped"]:
        print(f"\n✂️  çıkarıldı: {d['brand']} · {d['text']} ({d['reason']})")
    for o in plan["overflow"]:
        print(f"\n➕ yer yok (8 sınırı): {o['brand']} · {o['text']}")
    if plan.get("other_brands"):
        print("\nℹ️  marketing listesinde olmayan markaların yeni ürünleri (tabloya eklenmedi):")
        for o in plan["other_brands"]:
            print(f"   {o['brand']} · {o['text']}")
    print(f"\nToplam {plan['total']} ürün. Plan kaydedildi; yazmak için: fredymail hero-write --yes")
    return 0


def cmd_hero_write(a) -> int:
    """Planı tabloya yazar: önce mevcut sekme arşive kopyalanır, sonra sabit sekme güncellenir."""
    from .hero.sheet import build_write_requests

    s = get_settings()
    if a.plan == "-":
        plan = json.load(sys.stdin)
    elif a.plan:
        with open(a.plan, encoding="utf-8") as f:
            plan = json.load(f)
    else:
        from .db import new_session
        from .hero.service import load_plan

        db = new_session()
        try:
            plan = load_plan(db)
        finally:
            db.close()
        if plan is None:
            raise SystemExit("Kayıtlı plan yok; önce hero-preview çalıştırın.")
    client = _hero_client(s)
    hs = _hero_sheet(s, client)
    if plan.get("previous_period") != hs.period and not a.force:
        print(f"Tablo önizlemeden sonra değişmiş görünüyor (şu an: {hs.period}, plan: {plan.get('previous_period')}). "
              "Yeniden hero-preview çalıştırın ya da --force kullanın.")
        return 1
    titles = [t["title"] for t in client.sheet_titles(s.hero_sheet_id)]
    reqs = build_write_requests(hs, plan, titles)
    n = sum(len(b["products"]) for b in plan["brands"])
    print(f"{len(plan['brands'])} marka, {n} ürün, {len(reqs)} işlem → '{hs.title}'"
          + (f"; arşiv: '{plan.get('archive_title')}'" if any("duplicateSheet" in r for r in reqs) else ""))
    if not a.yes:
        print("Kuru çalışma: tabloya yazılmadı. Yazmak için --yes ekleyin.")
        return 0
    client.batch_update(s.hero_sheet_id, reqs)
    print("Yazıldı. Link değişmedi.")
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

    rc = sp.add_parser("reclassify", help="Kayıtlı mailleri güncel kurallarla yeniden sınıflandır")
    rc.add_argument("--yes", action="store_true")
    rc.set_defaults(fn=cmd_reclassify)

    ad = sp.add_parser("accept-deletions", help="Toplu kayıp kilidindeki silinmeleri onayla")
    ad.add_argument("--folder")
    ad.add_argument("--yes", action="store_true")
    ad.set_defaults(fn=cmd_accept_deletions)

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
    hy = sp.add_parser("hero-yoldaki", help="Yoldaki Mallar xlsx'inden ay içinde stoğa girecekleri listele")
    hy.add_argument("file", help="YOLDAKİ_MALLAR_GENEL.xlsx yolu")
    hy.add_argument("--month", help="YYYY-AA (varsayılan: bu ay)")
    hy.add_argument("--today", help="YYYY-AA-GG (test için; varsayılan: bugün)")
    hy.add_argument("--json", action="store_true")
    hy.set_defaults(fn=cmd_hero_yoldaki)
    sp.add_parser("hero-sync", help="Yoldaki Mallar'ı Drive'dan şimdi oku (günlük kopya)").set_defaults(fn=cmd_hero_sync)
    hs_ = sp.add_parser("hero-site", help="Mağaza (shop.zoomithalat.com) kontrolü: ürün sitede var mı, linki ne")
    hs_.add_argument("--limit", type=int, default=200)
    hs_.add_argument("--show-found", action="store_true", help="eşleşen ürünleri linkleriyle göster")
    hs_.set_defaults(fn=cmd_hero_site)
    hp = sp.add_parser("hero-preview", help="Aylık Hero planı önerisini göster ve JSON'a yaz (tabloya dokunmaz)")
    hp.add_argument("--month", help="YYYY-AA (varsayılan: gelecek ay)")
    hp.add_argument("--file", help="Drive yerine yerel Yoldaki Mallar xlsx'i")
    hp.add_argument("--out", help="planı ayrıca dosyaya yaz ('-' = yalnızca JSON'u stdout'a bas)")
    hp.add_argument("--today", help=argparse.SUPPRESS)
    hp.set_defaults(fn=cmd_hero_preview)
    hw = sp.add_parser("hero-write", help="Onaylanan planı Hero tablosuna yaz (arşiv + güncelleme)")
    hw.add_argument("plan", nargs="?", help="plan JSON dosyası ('-' = stdin); boşsa son hero-preview planı")
    hw.add_argument("--yes", action="store_true", help="gerçekten yaz (yoksa kuru çalışma)")
    hw.add_argument("--force", action="store_true", help="tablo önizlemeden sonra değişmiş olsa da yaz")
    hw.set_defaults(fn=cmd_hero_write)

    a = p.parse_args(argv)
    return a.fn(a)


if __name__ == "__main__":
    sys.exit(main())
