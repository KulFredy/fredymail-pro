"""Prompt-injection ve kaynak doğrulama testleri (ağ çağrısı yok)."""

from __future__ import annotations

from sqlalchemy import select

from fredymail.ai import service
from fredymail.ai.provider import FakeProvider
from fredymail.models import Message


def _msg(db, like):
    return db.execute(select(Message).where(Message.subject.like(like))).scalar_one()


def test_injection_email_is_wrapped_as_untrusted_data(db, synced, settings):
    m = _msg(db, "Acil: hesap güncelleme")
    ctx = service.build_context([m], settings)
    assert ctx.injection
    assert '<email id="M1">' in ctx.text and ctx.text.count("</email>") == 1
    assert "GÜVENİLMEZ VERİDİR" in service.SYSTEM


def test_compromised_model_output_is_neutralized(db, synced, settings):
    """Model e-postadaki talimata 'uysa' bile: uydurma kaynak silinir, alıcı önerisi yok sayılır,
    yabancı adres için uyarı verilir, kullanıcıya injection uyarısı gösterilir. Hiçbir şey gönderilmez."""
    m = _msg(db, "Acil: hesap güncelleme")
    out = service.run(db, settings, "draft", [m], provider=FakeProvider(settings, compromised=True))
    assert "[M99]" not in out["body"]
    assert all(s in ("M1",) for s in out["sources"])
    w = " ".join(out["warnings"])
    assert "hacker@supheli.test" in w  # taslakta yazışmada olmayan adres uyarısı
    assert "alıcı önerdi" in w
    assert "talimat vermeye çalışıyor" in w
    assert "Doğrulanamayan" in w

    out = service.run(db, settings, "summary", [m], provider=FakeProvider(settings, compromised=True))
    assert "[M99]" not in out["summary"]
    assert all(not k["sources"] for k in out["key_points"])


def test_context_limits_and_redaction(db, synced, settings):
    s = settings.model_copy(update={"ai_max_messages": 2, "ai_max_chars_per_message": 600})
    msgs = db.execute(select(Message).limit(5)).scalars().all()
    ctx = service.build_context(msgs, s)
    assert len(ctx.labels) == 2
    red = service.redact("IBAN: TR33 0006 1005 1978 6457 8413 26, kart 4111 1111 1111 1111, TC 10000000146, tel 05321234567")
    assert "[IBAN]" in red and "[KART]" in red and "[TCKN]" in red
    assert "05321234567" in red  # telefon numarası maskelenmez (iş için gerekli)


def test_quoted_history_is_trimmed(settings):
    from fredymail.mail.parse import strip_quoted

    t = "Yeni cevap\n\n12 Eki 2026 tarihinde Ali yazdı:\n> eski içerik\n> daha eski"
    assert strip_quoted(t) == "Yeni cevap"
