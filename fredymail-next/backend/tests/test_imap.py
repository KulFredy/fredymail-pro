"""Gerçek IMAP protokolü testleri (Dovecot/GreenMail gibi bir test sunucusu gerekir).

FM_TEST_IMAP_HOST/PORT/USER/PASS ayarlı değilse veya sunucuya ulaşılamazsa atlanır.
Test sunucusu `scripts/test.sh` içinde açıklanmıştır. Burada IMAP'e yazan komutlar
(APPEND/CREATE) yalnızca *test verisini hazırlamak* için test kodunda kullanılır.
"""

from __future__ import annotations

import imaplib
import os
import re
import socket
import ssl
import time
from pathlib import Path

import pytest
from imapclient.imap_utf7 import encode as utf7

from fredymail.mail.source import FORBIDDEN_IMAP_METHODS, ImapSource, ReadOnlyIMAP
from fredymail.mail.sync import run_sync
from fredymail.models import Attachment, Folder, Message

HOST = os.environ.get("FM_TEST_IMAP_HOST", "127.0.0.1")
PORT = int(os.environ.get("FM_TEST_IMAP_PORT", "51993"))
USER = os.environ.get("FM_TEST_IMAP_USER", "fatih@ornek-ithalat.test")
PASS = os.environ.get("FM_TEST_IMAP_PASS", "testpass")
CTX = ssl._create_unverified_context()  # noqa: S323 - yalnızca test sunucusunun kendinden imzalı sertifikası için


def _reachable() -> bool:
    try:
        socket.create_connection((HOST, PORT), timeout=2).close()
        return True
    except OSError:
        return False


pytestmark = pytest.mark.skipif(not _reachable(), reason="test IMAP sunucusu yok")

FOLDERS = {
    "INBOX": "INBOX",
    "Sent": "Sent",
    "Faturalar": "Faturalar",
    "Müşteriler/Kamera Dünyası": "Müşteriler/Kamera Dünyası",
    "Trash": "Trash",
}


def _admin() -> imaplib.IMAP4_SSL:
    c = imaplib.IMAP4_SSL(HOST, PORT, ssl_context=CTX)
    c.login(USER, PASS)
    return c


def _q(name: str) -> str:
    return '"' + utf7(name).decode() + '"'


@pytest.fixture(scope="module")
def seeded(demo_dir_module):
    c = _admin()
    # temiz başlangıç
    for name in ["Faturalar", "Müşteriler/Kamera Dünyası", "Müşteriler"]:
        c.delete(_q(name))
    for name in ["INBOX", "Sent", "Trash"]:
        typ, data = c.select(_q(name))
        if int(data[0]) > 0:
            c.store("1:*", "+FLAGS.SILENT", "(\\Deleted)")
            c.expunge()
    for name in ["Faturalar", "Müşteriler", "Müşteriler/Kamera Dünyası"]:
        c.create(_q(name))
    src = Path(demo_dir_module)
    plan = {"INBOX": "INBOX", "Sent": "Sent", "Faturalar": "Faturalar", "Aykut": "Müşteriler/Kamera Dünyası"}
    count = 0
    for local, remote in plan.items():
        for f in sorted((src / local).glob("*.eml")):
            raw = f.read_bytes()
            flags = "(\\Seen)" if b"X-FM-Demo-Flags: \\Seen" in raw else "()"
            c.append(_q(remote), flags, imaplib.Time2Internaldate(time.time()), raw)
            count += 1
    # Çöp kutusuna bir mail (senkron dışı kalmalı)
    c.append(_q("Trash"), "()", imaplib.Time2Internaldate(time.time()),
             b"From: x@y.test\r\nTo: fatih@ornek-ithalat.test\r\nSubject: silinmis\r\nMessage-ID: <trash1@y.test>\r\n\r\nsil\r\n")
    c.logout()
    return count


@pytest.fixture(scope="module")
def demo_dir_module(tmp_path_factory):
    from fredymail.demo.generate import generate

    d = tmp_path_factory.mktemp("imap-demo")
    generate(d)
    return d


def _server_state() -> dict:
    c = _admin()
    state = {}
    typ, data = c.list()
    names = sorted(d.decode() for d in data)
    state["folders"] = names
    for name in FOLDERS.values():
        typ, data = c.select(_q(name), readonly=True)
        if int(data[0]) == 0:
            state[name] = []
            continue
        typ, d = c.uid("FETCH", "1:*", "(FLAGS)")
        state[name] = sorted(x.decode() if isinstance(x, bytes) else str(x) for x in d if x)
    c.logout()
    return state


def _source(settings):
    return ImapSource(host=HOST, port=PORT, security="ssl", username=USER, password=PASS,
                      full_fetch_max_bytes=3000,  # küçük eşik: ekli mailler kısmi çekim yolunu kullanır
                      _ssl_context=CTX)


def test_imap_sync_is_read_only_and_complete(db, settings, seeded):
    before = _server_state()
    s = settings.model_copy(update={"sync_since": "all"})
    res = run_sync(db, lambda: _source(s), s, sleep=lambda x: None)
    after = _server_state()
    # 1) Sunucu tarafında HİÇBİR şey değişmedi: klasörler ve tüm bayraklar aynı (\Seen dahil)
    assert before == after
    # 2) Türkçe klasör adı doğru çözüldü, Trash senkron dışı
    folders = {f.name: f for f in db.query(Folder).all()}
    assert "Müşteriler/Kamera Dünyası" in folders
    assert folders["Müşteriler/Kamera Dünyası"].sync_enabled
    assert not folders["Trash"].sync_enabled
    assert folders["Sent"].role == "sent"
    # 3) Tüm mailler alındı, kopya yok
    assert sum(f.fetched for f in res.folders) == seeded
    assert db.query(Message).filter(Message.subject == "silinmis").count() == 0
    inv = db.query(Message).filter(Message.subject.like("e-Fatura:%")).all()
    assert len(inv) == 3 and all(len(m.locations) == 2 for m in inv)


def test_partial_fetch_and_attachment_download(db, settings, seeded):
    s = settings.model_copy(update={"sync_since": "all"})
    run_sync(db, lambda: _source(s), s, sleep=lambda x: None)
    pl = db.query(Message).filter(Message.subject == "Nordlicht Imaging – Price List Q3 2026").one()
    assert pl.body_truncated  # büyük mail → kısmi çekim yolu
    assert "dealer price list" in pl.body_text
    att = db.query(Attachment).filter(Attachment.message_id == pl.id).one()
    assert att.filename == "Nordlicht_PriceList_Q3_2026.xlsx" and att.imap_section == "2"
    loc = pl.locations[0]
    src = _source(s)
    data, ctype = src.fetch_section(loc.folder.name, loc.uidvalidity, loc.uid, att.imap_section)
    src.close()
    assert data[:2] == b"PK" and ctype.endswith("spreadsheetml.sheet")


def test_incremental_second_run_fetches_nothing(db, settings, seeded):
    s = settings.model_copy(update={"sync_since": "all"})
    run_sync(db, lambda: _source(s), s, sleep=lambda x: None)
    res = run_sync(db, lambda: _source(s), s, sleep=lambda x: None)
    assert sum(f.fetched for f in res.folders) == 0


def test_readonly_wrapper_blocks_mutations(seeded):
    src = ImapSource(host=HOST, port=PORT, security="ssl", username=USER, password=PASS, _ssl_context=CTX)
    try:
        for name in ["move", "copy", "add_flags", "set_flags", "expunge", "append", "create_folder",
                     "delete_folder", "rename_folder", "delete_messages", "select_folder", "_raw_command"]:
            with pytest.raises(PermissionError):
                getattr(src.client, name)
        assert isinstance(src.client, ReadOnlyIMAP)
    finally:
        src.close()


def test_source_code_never_calls_mutating_imap_methods():
    """Statik kontrol: uygulama kodu IMAP'e yazan bir metodu doğrudan çağırmıyor."""
    root = Path(__file__).resolve().parents[1] / "fredymail"
    offenders = []
    for py in root.rglob("*.py"):
        text = py.read_text(encoding="utf-8")
        for name in FORBIDDEN_IMAP_METHODS - {"select_folder"}:
            # IMAP istemci nesneleri: client / _c / raw / imap / conn
            if re.search(rf"\b(client|_c|raw|imap|conn)\.{re.escape(name)}\(", text):
                offenders.append(f"{py.name}: {name}")
        if ".select_folder(" in text and "readonly=True" not in text:
            offenders.append(f"{py.name}: select_folder without readonly")
    assert offenders == []


def test_auth_failure_is_reported_not_retried(db, settings, seeded):
    from fredymail.mail.source import SourceAuthError

    with pytest.raises(SourceAuthError):
        ImapSource(host=HOST, port=PORT, security="ssl", username=USER, password="yanlis", _ssl_context=CTX)


def test_tls_verification_is_on_by_default(seeded):
    from fredymail.mail.source import SourceError

    # Kendinden imzalı test sertifikası varsayılan bağlamda REDDEDİLMELİ
    with pytest.raises(SourceError):
        ImapSource(host=HOST, port=PORT, security="ssl", username=USER, password=PASS)
