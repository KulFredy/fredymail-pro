from __future__ import annotations

from datetime import date

from sqlalchemy import func, select

from fredymail.mail.source import EmlDirSource, FetchedMessage, FolderStatus, SourceError
from fredymail.mail.sync import run_sync
from fredymail.models import Attachment, Folder, Message, MessageLocation, SyncRun, Thread


def count(db, model):
    return db.execute(select(func.count()).select_from(model)).scalar_one()


def test_demo_sync_dedupes_across_folders(db, synced):
    # Faturalar + INBOX'ta aynı 3 fatura ve fiyat listesi var → tek mail, iki konum
    inv = db.execute(select(Message).where(Message.subject.like("e-Fatura:%"))).scalars().all()
    assert len(inv) == 3
    for m in inv:
        names = sorted(loc.folder.name for loc in m.locations)
        assert names == ["Faturalar", "INBOX"]
        assert "invoice" in m.doc_kinds
    assert sum(f.duplicates for f in synced.folders) >= 4
    assert sum(f.errors for f in synced.folders) == 0


def test_second_sync_is_idempotent(db, settings, synced, demo_dir):
    before = count(db, Message), count(db, MessageLocation), count(db, Attachment)
    res = run_sync(db, lambda: EmlDirSource(demo_dir, kind="demo"), settings, origin="demo", sleep=lambda s: None)
    assert res.created == 0
    assert sum(f.fetched for f in res.folders) == 0
    assert (count(db, Message), count(db, MessageLocation), count(db, Attachment)) == before


def test_threads_by_headers_and_turkish_reply_prefix(db, synced):
    pl = db.execute(select(Message).where(Message.subject == "Nordlicht Imaging – Price List Q3 2026")).scalar_one()
    t = db.get(Thread, pl.thread_id)
    assert t.message_count == 3
    # "YNT:" öneki + başlık yok → konu ve katılımcı üzerinden aynı thread
    lm = db.execute(select(Message).where(Message.subject.like("%Lumora 50mm%"))).scalars().all()
    assert len(lm) == 2 and len({m.thread_id for m in lm}) == 1


def test_classification_and_attachments(db, synced):
    pl = db.execute(select(Message).where(Message.subject == "Nordlicht Imaging – Price List Q3 2026")).scalar_one()
    assert "pricelist" in pl.doc_kinds
    att = pl.attachments[0]
    assert att.file_kind == "spreadsheet" and att.imap_section == "2"
    assert "NL-85" in (att.extracted_text or "")
    bulletin = db.execute(select(Message).where(Message.subject.like("Haftalık teknoloji%"))).scalar_one()
    assert bulletin.is_automated
    inj = db.execute(select(Message).where(Message.subject == "Acil: hesap güncelleme")).scalar_one()
    assert inj.injection_suspected


def test_windows_1254_decoding(db, synced):
    m = db.execute(select(Message).where(Message.subject.like("Şirket içi toplantı%"))).scalar_one()
    assert "İstanbul mağaza açılışı" in m.body_text
    assert "ışık ekipmanı" in m.body_text


def test_sent_folder_marks_from_me_and_folder_roles(db, synced):
    roles = dict(db.execute(select(Folder.name, Folder.role)).all())
    assert roles["INBOX"] == "inbox" and roles["Sent"] == "sent"
    sent = db.execute(select(Message).where(Message.subject == "Fiyat teklifi: Fuar standı ekipmanları")).scalar_one()
    assert sent.is_from_me and sent.is_read


class FlakySource(EmlDirSource):
    """İlk N fetch çağrısında bağlantı kopması simüle eder."""

    fail_times = 0

    def fetch(self, uids):
        if FlakySource.fail_times > 0:
            FlakySource.fail_times -= 1
            raise SourceError("bağlantı koptu (simülasyon)")
        yield from super().fetch(uids)


def test_retry_after_disconnect(db, settings, demo_dir):
    FlakySource.fail_times = 2
    sleeps = []
    res = run_sync(db, lambda: FlakySource(demo_dir, kind="demo"), settings, origin="demo", sleep=sleeps.append)
    assert len(sleeps) == 2  # iki yeniden deneme, sonra başarı
    assert all(f.status == "ok" for f in res.folders)
    assert count(db, Message) > 100


class InterruptingSource(EmlDirSource):
    """Belirli sayıda mailden sonra kalıcı hata verir (kesilen senkron)."""

    budget = 0

    def fetch(self, uids):
        for fm in super().fetch(uids):
            if InterruptingSource.budget <= 0:
                raise SourceError("kesildi")
            InterruptingSource.budget -= 1
            yield fm


def test_interrupted_sync_resumes_without_duplicates(db, settings, demo_dir):
    settings_small = settings.model_copy(update={"sync_batch_size": 10, "sync_max_retries": 0})
    InterruptingSource.budget = 35
    run_sync(db, lambda: InterruptingSource(demo_dir, kind="demo"), settings_small, origin="demo", sleep=lambda s: None)
    partial_locs = count(db, MessageLocation)
    assert 0 < partial_locs < 200
    assert db.execute(select(func.count()).select_from(SyncRun).where(SyncRun.status == "error")).scalar_one() >= 1
    # devre kesiciyi sıfırla ve kaldığı yerden devam et
    for f in db.execute(select(Folder)).scalars():
        f.consecutive_failures = 0
    db.commit()
    res = run_sync(db, lambda: EmlDirSource(demo_dir, kind="demo"), settings, origin="demo", sleep=lambda s: None)
    full = run_sync(db, lambda: EmlDirSource(demo_dir, kind="demo"), settings, origin="demo", sleep=lambda s: None)
    assert full.created == 0 and sum(f.fetched for f in full.folders) == 0
    assert res.created > 0
    # konum sayısı = dosya sayısı
    files = sum(1 for _ in demo_dir.rglob("*.eml"))
    assert count(db, MessageLocation) == files


class ChangingUidValiditySource(EmlDirSource):
    uv = 1

    def open_folder(self, name):
        st = super().open_folder(name)
        return FolderStatus(uidvalidity=ChangingUidValiditySource.uv, exists=st.exists)


def test_uidvalidity_change_resyncs_without_duplicates(db, settings, demo_dir):
    run_sync(db, lambda: ChangingUidValiditySource(demo_dir, kind="demo"), settings, origin="demo", sleep=lambda s: None)
    msgs = count(db, Message)
    ChangingUidValiditySource.uv = 2
    res = run_sync(db, lambda: ChangingUidValiditySource(demo_dir, kind="demo"), settings, origin="demo",
                   sleep=lambda s: None)
    assert res.created == 0  # tüm mailler dedupe ile eşleşti
    assert count(db, Message) == msgs
    assert set(db.execute(select(MessageLocation.uidvalidity)).scalars()) == {2}


class BrokenParseSource(EmlDirSource):
    def fetch(self, uids):
        for fm in super().fetch(uids):
            if fm.uid == 1:
                yield FetchedMessage(uid=1, flags=[], parsed=None, error="ValueError")
            else:
                yield fm


def test_unparseable_message_not_retried_forever(db, settings, demo_dir):
    run_sync(db, lambda: BrokenParseSource(demo_dir, kind="demo"), settings, origin="demo", sleep=lambda s: None)
    errs = db.execute(select(Message).where(Message.dedupe_key.startswith("err:"))).scalars().all()
    assert len(errs) >= 1
    again = run_sync(db, lambda: BrokenParseSource(demo_dir, kind="demo"), settings, origin="demo", sleep=lambda s: None)
    assert sum(f.fetched for f in again.folders) == 0


def test_folder_scope_limits(db, settings, demo_dir):
    s = settings.model_copy(update={"sync_max_messages_per_folder": 5})
    run_sync(db, lambda: EmlDirSource(demo_dir, kind="demo"), s, origin="demo", sleep=lambda x: None)
    inbox = db.execute(select(Folder).where(Folder.name == "INBOX")).scalar_one()
    n = db.execute(select(func.count()).select_from(MessageLocation).where(MessageLocation.folder_id == inbox.id)).scalar_one()
    assert n == 5
    # en yeniler alınır
    newest = db.execute(select(func.max(MessageLocation.uid)).where(MessageLocation.folder_id == inbox.id)).scalar_one()
    assert newest == inbox.server_message_count


def test_since_parsing(settings):
    s = settings.model_copy(update={"sync_since": "2025-01-01"})
    assert s.since_date() == date(2025, 1, 1)
    s = settings.model_copy(update={"sync_since": "all"})
    assert s.since_date() is None


def test_sync_lock_is_released_and_exclusive(db, settings, demo_dir):
    from fredymail.db import new_session
    from fredymail.mail.sync import sync_lock

    other = new_session()
    with sync_lock(other) as got:
        assert got
        res = run_sync(db, lambda: EmlDirSource(demo_dir, kind="demo"), settings, origin="demo", sleep=lambda s: None)
        assert res.skipped_locked  # ikinci senkron aynı anda çalışamaz
    other.close()
    for _ in range(3):  # kilit her seferinde serbest bırakılır
        res = run_sync(db, lambda: EmlDirSource(demo_dir, kind="demo"), settings, origin="demo", sleep=lambda s: None)
        assert not res.skipped_locked


def test_extra_excludes_keep_defaults(settings):
    from fredymail.mail.source import FolderInfo
    from fredymail.mail.sync import folder_is_default_enabled

    s = settings.model_copy(update={"sync_exclude_folders": "CV ler"})
    assert not folder_is_default_enabled(FolderInfo("CV ler", "/", []), s)
    assert not folder_is_default_enabled(FolderInfo("Karantina", "/", []), s)  # varsayılan hâlâ geçerli
    assert not folder_is_default_enabled(FolderInfo("Trash/Adsız Klasör", "/", []), s)
    assert folder_is_default_enabled(FolderInfo("Müşteriler/Kamera Dünyası", "/", []), s)


def test_nul_bytes_are_stripped_not_rejected(db, settings, demo_dir, tmp_path):
    """PDF metinlerinde sık görülen NUL (0x00) karakteri kaydı engellememeli."""
    from fredymail.demo.generate import tiny_pdf

    d = tmp_path / "nul" / "INBOX"
    d.mkdir(parents=True)
    raw = (b"From: a@b.test\r\nTo: fatih@ornek-ithalat.test\r\nSubject: Fatura\x00 NUL\r\n"
           b"Message-ID: <nul1@b.test>\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=X\r\n\r\n"
           b"--X\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nTutar\x00 1.000 TL\r\n"
           b"--X\r\nContent-Type: application/pdf\r\nContent-Disposition: attachment; filename=\"f\x00.pdf\"\r\n"
           b"Content-Transfer-Encoding: base64\r\n\r\n"
           + __import__("base64").encodebytes(tiny_pdf(["FATURA", "Toplam"])) + b"--X--\r\n")
    (d / "00001.eml").write_bytes(raw)
    res = run_sync(db, lambda: EmlDirSource(d.parent, kind="demo", keep_payload_max=5_000_000), settings,
                   origin="demo", sleep=lambda s: None)
    assert res.created == 1 and sum(f.errors for f in res.folders) == 0
    m = db.execute(select(Message).where(Message.message_id_header == "nul1@b.test")).scalar_one()
    assert "\x00" not in m.subject + m.body_text and "Tutar" in m.body_text


def test_store_errors_never_log_mail_content(db, settings, demo_dir, caplog, monkeypatch):
    from fredymail.db import get_engine
    from fredymail.mail import sync as sync_mod

    assert get_engine().hide_parameters  # SQL hatalarında parametre (mail içeriği) gösterilmez
    real = sync_mod.store_fetched

    def boom(db_, account, folder, uv, fm, s):
        if fm.parsed is not None and "SJ-500" in fm.parsed.subject:
            raise RuntimeError("GIZLI-ICERIK " + fm.parsed.body_text)
        return real(db_, account, folder, uv, fm, s)

    monkeypatch.setattr(sync_mod, "store_fetched", boom)
    with caplog.at_level("DEBUG"):
        run_sync(db, lambda: EmlDirSource(demo_dir, kind="demo"), settings, origin="demo", sleep=lambda s: None)
    assert "mail kaydedilemedi" in caplog.text
    assert "GIZLI-ICERIK" not in caplog.text and "stok durumu" not in caplog.text


def test_retry_failed_refetches(db, settings, demo_dir):
    from fredymail.cli import main

    run_sync(db, lambda: BrokenParseSource(demo_dir, kind="demo"), settings, origin="demo", sleep=lambda s: None)
    assert db.execute(select(func.count()).select_from(Message).where(Message.dedupe_key.startswith("err:"))).scalar_one()
    assert main(["retry-failed", "--yes"]) == 0
    res = run_sync(db, lambda: EmlDirSource(demo_dir, kind="demo"), settings, origin="demo", sleep=lambda s: None)
    assert res.created >= 1
    db.expire_all()
    assert db.execute(select(func.count()).select_from(Message).where(Message.dedupe_key.startswith("err:"))).scalar_one() == 0


class ShrinkingSource(EmlDirSource):
    """Sunucu arızası: klasör bir anda boş / eksik görünür."""

    keep = None  # None = hepsi; sayı = yalnızca ilk N UID görünür

    def search_uids(self, since):
        uids = super().search_uids(since)
        return uids if ShrinkingSource.keep is None else uids[:ShrinkingSource.keep]


def test_mass_disappearance_is_not_applied(db, settings, demo_dir):
    """Sunucu arızasında mailler aramadan kaybolmamalı; onay sonrası gerçek silinme uygulanmalı."""
    from fredymail.cli import main
    from fredymail.search.query import SearchParams, search

    s = settings.model_copy(update={"sync_deletion_check_every": 1})
    ShrinkingSource.keep = None
    run_sync(db, lambda: ShrinkingSource(demo_dir, kind="demo"), s, origin="server", sleep=lambda x: None)
    db.execute(Folder.__table__.update().values(origin="server"))
    db.commit()
    before = search(db, None, SearchParams(view="inbox"))["total"]

    ShrinkingSource.keep = 0  # sunucu INBOX'ı (ve tüm klasörleri) boş döndürüyor
    run_sync(db, lambda: ShrinkingSource(demo_dir, kind="demo"), s, origin="server", sleep=lambda x: None)
    db.expire_all()
    inbox = db.execute(select(Folder).where(Folder.name == "INBOX")).scalar_one()
    assert inbox.status == "anomaly" and "accept-deletions" in inbox.last_error
    assert search(db, None, SearchParams(view="inbox"))["total"] == before  # kopyalar korundu

    # sunucu düzelince kilit kendiliğinden kalkar
    ShrinkingSource.keep = None
    run_sync(db, lambda: ShrinkingSource(demo_dir, kind="demo"), s, origin="server", sleep=lambda x: None)
    db.expire_all()
    assert db.execute(select(Folder).where(Folder.name == "INBOX")).scalar_one().status == "idle"

    # kullanıcı onaylarsa toplu silinme uygulanır
    ShrinkingSource.keep = 0
    run_sync(db, lambda: ShrinkingSource(demo_dir, kind="demo"), s, origin="server", sleep=lambda x: None)
    assert main(["accept-deletions", "--folder", "INBOX", "--yes"]) == 0
    run_sync(db, lambda: ShrinkingSource(demo_dir, kind="demo"), s, origin="server", sleep=lambda x: None)
    db.expire_all()
    assert search(db, None, SearchParams(view="inbox"))["total"] == 0
    ShrinkingSource.keep = None


def test_server_restore_with_new_uidvalidity_keeps_user_state(db, settings, demo_dir):
    """Sunucu yedekten dönünce (yeni UIDVALIDITY) mailler kopyalanmaz; etiket/not/önemli korunur."""
    from fredymail.models import MessageTag, Note, Tag

    ChangingUidValiditySource.uv = 1
    run_sync(db, lambda: ChangingUidValiditySource(demo_dir, kind="demo"), settings, origin="demo", sleep=lambda s: None)
    m = db.execute(select(Message).where(Message.subject.like("SJ-500%"))).scalar_one()
    t = Tag(name="Bayi")
    db.add(t)
    db.flush()
    db.add_all([MessageTag(message_id=m.id, tag_id=t.id), Note(message_id=m.id, body="stok perşembe")])
    m.is_important = True
    db.commit()
    total = count(db, Message)

    ChangingUidValiditySource.uv = 777  # sağlayıcı kutuyu yedekten geri yükledi
    res = run_sync(db, lambda: ChangingUidValiditySource(demo_dir, kind="demo"), settings, origin="demo",
                   sleep=lambda s: None)
    db.expire_all()
    assert res.created == 0 and count(db, Message) == total
    m2 = db.get(Message, m.id)
    assert m2.is_important and len(m2.locations) == 1
    assert db.execute(select(func.count()).select_from(Note).where(Note.message_id == m.id)).scalar_one() == 1
    ChangingUidValiditySource.uv = 1


def test_real_world_noise_classification(db, synced):
    """Gerçek veride görülen gürültü: başlıksız bülten, imza görseli, 'teşekkürler' maili."""
    rev = db.execute(select(Message).where(Message.from_email == "info@revotas-ornek.test")).scalar_one()
    assert rev.is_automated  # List-Unsubscribe yok ama gövde kalıbı tanındı
    kiy = db.execute(select(Message).where(Message.subject == "RE: SJCAM online satış iş birliği")).scalar_one()
    assert not kiy.has_attachments and all(a.is_inline for a in kiy.attachments)  # image001.png ek sayılmaz
    assert "invoice" not in kiy.doc_kinds  # metinde 'fatura' geçiyor ama belge eki yok


def test_reclassify_fixes_existing_rows(db, synced):
    from fredymail.cli import main
    from fredymail.models import Attachment

    rev = db.execute(select(Message).where(Message.from_email == "info@revotas-ornek.test")).scalar_one()
    kiy = db.execute(select(Message).where(Message.subject == "RE: SJCAM online satış iş birliği")).scalar_one()
    # eski kurallarla kaydedilmiş gibi boz
    rev.is_automated = False
    kiy.has_attachments, kiy.doc_kinds = True, ["invoice"]
    for a in kiy.attachments:
        a.is_inline = False
    db.commit()
    assert main(["reclassify", "--yes"]) == 0
    db.expire_all()
    assert db.get(Message, rev.id).is_automated
    k = db.get(Message, kiy.id)
    assert not k.has_attachments and k.doc_kinds == [] and k.index_dirty
    assert all(a.is_inline for a in db.execute(select(Attachment).where(Attachment.message_id == k.id)).scalars())
