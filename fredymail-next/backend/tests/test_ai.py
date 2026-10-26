"""Prompt-injection ve kaynak doğrulama testleri (ağ çağrısı yok)."""

from __future__ import annotations

import dataclasses

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


def _tiered(settings, **kw):
    return settings.model_copy(update={"ai_provider": "fake", "ai_model": "hafif", "ai_model_heavy": "guclu",
                                       "ai_price_input_per_mtok": 0.1, "ai_price_output_per_mtok": 0.4,
                                       "ai_price_input_per_mtok_heavy": 2.0, "ai_price_output_per_mtok_heavy": 12.0,
                                       **kw})


def test_tier_choice(settings):
    s = _tiered(settings)
    assert service.choose_tier(s, "summary", 2000, "auto") == "light"
    assert service.choose_tier(s, "draft", 2000, "auto") == "heavy"  # taslak her zaman güçlü
    assert service.choose_tier(s, "thread_summary", 20000, "auto") == "heavy"  # uzun bağlam
    assert service.choose_tier(s, "draft", 20000, "fast") == "light"
    assert service.choose_tier(s, "summary", 10, "best") == "heavy"
    # güçlü model tanımlı değilse her şey tek modelle
    assert service.choose_tier(settings.model_copy(update={"ai_model_heavy": ""}), "draft", 99999, "best") == "light"


def test_auto_routing_and_cost_per_tier(db, synced, settings):
    s = _tiered(settings)
    m = _msg(db, "SJ-500%")
    out = service.run(db, s, "summary", [m])
    assert out["meta"]["tier"] == "light" and out["meta"]["model"] == "hafif" and out["meta"]["heavy_available"]
    light_cost = out["meta"]["cost_usd"]
    out = service.run(db, s, "summary", [m], quality="best")
    assert out["meta"]["tier"] == "heavy" and out["meta"]["model"] == "guclu" and not out["meta"]["cached"]
    assert out["meta"]["cost_usd"] > light_cost * 10
    assert service.run(db, s, "draft", [m])["meta"]["tier"] == "heavy"


def test_invalid_light_output_escalates_once(db, synced, settings, monkeypatch):
    from fredymail.ai import provider as prov

    s = _tiered(settings)
    calls = []

    class Broken(FakeProvider):
        def complete(self, system, user, max_tokens):
            calls.append(self.tier)
            r = super().complete(system, user, max_tokens)
            return dataclasses.replace(r, text="bu JSON değil") if self.tier == "light" or bad_heavy else r

    def fake_get(settings, tier="light"):
        return Broken(settings, model=settings.ai_model_heavy if tier == "heavy" else settings.ai_model, tier=tier)

    monkeypatch.setattr(service, "get_provider", fake_get)
    m = _msg(db, "SJ-500%")
    bad_heavy = False
    out = service.run(db, s, "summary", [m])
    assert calls == ["light", "heavy"] and out["meta"]["escalated"] and out["meta"]["tier"] == "heavy"
    assert out["summary"]
    # güçlü model de bozuk dönerse hata verir — üçüncü deneme yok
    calls.clear()
    bad_heavy = True
    try:
        service.run(db, s, "actions", [m])
        raise AssertionError("hata bekleniyordu")
    except prov.AIError:
        pass
    assert calls == ["light", "heavy"]


def test_heavy_request_limits_reasoning_and_falls_back(settings):
    """Güçlü modele düşünme sınırı + geniş çıktı payı gider; sağlayıcı bu ayarı tanımazsa ayarsız bir kez denenir."""
    import json

    import httpx

    from fredymail.ai.provider import OpenAICompatibleProvider

    s = _tiered(settings, ai_provider="openai_compatible", ai_base_url="http://llm.test/v1")
    seen = []

    def handler(req):
        body = json.loads(req.content)
        seen.append(body)
        if "reasoning_effort" in body:
            return httpx.Response(400, json={"error": "unsupported"})
        return httpx.Response(200, json={"choices": [{"message": {"content": '{"summary": "ok"}'}}],
                                         "usage": {"prompt_tokens": 10, "completion_tokens": 5}})

    client = httpx.Client(base_url="http://llm.test/v1", transport=httpx.MockTransport(handler))
    p = OpenAICompatibleProvider(s, client=client, model="guclu", tier="heavy")
    res = p.complete("sys", "user", service._max_tokens(s, p))
    assert res.text == '{"summary": "ok"}' and len(seen) == 2
    assert seen[0]["reasoning_effort"] == "low" and seen[0]["max_tokens"] == 8000
    light = OpenAICompatibleProvider(s, client=client, model="hafif", tier="light")
    light.complete("sys", "user", service._max_tokens(s, light))
    assert "reasoning_effort" not in seen[-1] and seen[-1]["max_tokens"] == s.ai_max_output_tokens
