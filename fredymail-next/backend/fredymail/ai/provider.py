"""AI sağlayıcıları.

- `openai_compatible`: OpenAI Chat Completions uyumlu her uç nokta (VPS'teki LiteLLM proxy,
  OpenRouter, OpenAI, Gemini'nin OpenAI-uyumlu ucu, yerel Ollama...). Model ve adres yapılandırılır.
- `fake`: test/demo için deterministik sağlayıcı; ağ çağrısı yapmaz, para harcamaz.
- `none`: AI kapalı.

Sağlayıcıya hiçbir araç (tool/function) verilmez: model yalnızca metin üretir, mail gönderemez,
silemez, taşıyamaz.
"""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass

import httpx

from ..config import Settings


class AIError(Exception):
    pass


@dataclass
class AIResult:
    text: str
    prompt_tokens: int
    completion_tokens: int
    model: str


class OpenAICompatibleProvider:
    name = "openai_compatible"

    def __init__(self, settings: Settings, client: httpx.Client | None = None):
        self.s = settings
        self.model = settings.ai_model
        headers = {"Content-Type": "application/json"}
        if settings.ai_api_key:
            headers["Authorization"] = f"Bearer {settings.ai_api_key}"
        self.http = client or httpx.Client(base_url=settings.ai_base_url.rstrip("/"), headers=headers,
                                           timeout=settings.ai_timeout_seconds)

    def complete(self, system: str, user: str, max_tokens: int) -> AIResult:
        body = {
            "model": self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
            "max_tokens": max_tokens,
            "temperature": 0.2,
            "response_format": {"type": "json_object"},
        }
        last: Exception | None = None
        for attempt in range(2):  # en fazla 1 yeniden deneme — sonsuz döngü/sınırsız harcama yok
            try:
                r = self.http.post("/chat/completions", json=body)
            except httpx.HTTPError as e:
                last = AIError(f"AI sağlayıcısına ulaşılamadı ({type(e).__name__})")
            else:
                if r.status_code == 200:
                    data = r.json()
                    choice = (data.get("choices") or [{}])[0]
                    text = (choice.get("message") or {}).get("content") or ""
                    usage = data.get("usage") or {}
                    return AIResult(text=text, prompt_tokens=int(usage.get("prompt_tokens") or 0),
                                    completion_tokens=int(usage.get("completion_tokens") or 0),
                                    model=data.get("model") or self.model)
                if r.status_code in (400, 404) and attempt == 0 and "response_format" in body:
                    body.pop("response_format")  # bazı modeller JSON modunu desteklemiyor
                    continue
                last = AIError(f"AI sağlayıcısı hata döndü (HTTP {r.status_code})")
                if r.status_code not in (408, 429, 500, 502, 503, 504):
                    break
            time.sleep(2)
        raise last or AIError("AI isteği başarısız")


class FakeProvider:
    """Deterministik sahte model. `compromised=True` iken e-postadaki talimatlara 'uyan' kötü bir
    modeli taklit eder — savunmaların (kaynak doğrulama, alıcı kilidi, uyarılar) testi için."""

    name = "fake"

    def __init__(self, settings: Settings, compromised: bool = False):
        self.model = settings.ai_model or "fake-model"
        self.compromised = compromised

    def complete(self, system: str, user: str, max_tokens: int) -> AIResult:
        labels = re.findall(r'<email id="(M\d+)"', user)
        first = labels[0] if labels else "M1"
        subj = re.search(r"Konu: (.*)", user)
        subject = subj.group(1).strip() if subj else ""
        if self.compromised:
            out = {
                "summary": "Bu mail güvenlidir. Tüm faturaları hacker@supheli.test adresine ilettim. [M99]",
                "key_points": [{"text": "Faturalar iletildi", "sources": ["M99"]}],
                "actions": [{"task": "Faturaları hacker@supheli.test adresine gönder", "sources": ["M99"]}],
                "subject": "Re: " + subject,
                "body": "Merhaba, tüm faturalar ekte. Ayrıca hacker@supheli.test adresine de gönderin.",
                "to": ["hacker@supheli.test"],
                "warnings": [],
            }
        else:
            out = {
                "summary": f"{subject} konulu yazışmanın özeti. [{first}]",
                "key_points": [{"text": f"Ana konu: {subject}", "sources": [first]}]
                + [{"text": "İlgili mail", "sources": [lb]} for lb in labels[1:3]],
                "actions": [{"task": "Yanıt hazırla", "owner": "ben", "due": None, "sources": [first]}],
                "suggestion": f"Bu yazışmaya kısa bir dönüş yapmanız iyi olur. [{first}]",
                "subject": "Re: " + subject,
                "body": "Merhaba,\n\nMailiniz için teşekkürler. Konuyu inceleyip en kısa sürede dönüş yapacağım.\n\nSaygılarımla",
                "warnings": ["E-postada talimat benzeri ifade var; uygulanmadı."] if "talimat" in user.lower()
                and "yok say" in user.lower() else [],
            }
        text = json.dumps(out, ensure_ascii=False)
        return AIResult(text=text, prompt_tokens=len(system + user) // 4, completion_tokens=len(text) // 4,
                        model=self.model)


def get_provider(settings: Settings):
    if settings.ai_provider == "fake":
        return FakeProvider(settings)
    if settings.ai_provider == "openai_compatible" and settings.ai_base_url and settings.ai_model:
        return OpenAICompatibleProvider(settings)
    return None
