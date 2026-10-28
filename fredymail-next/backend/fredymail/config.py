"""Uygulama yapılandırması.

Tüm ayarlar ortam değişkenlerinden (FM_ öneki) okunur. Sırlar için `*_FILE`
varyantı desteklenir (Docker secret / chmod 600 dosya): örn. FM_IMAP_PASSWORD_FILE.
Kaynak kodda hiçbir gerçek sır bulunmaz.
"""

from __future__ import annotations

import os
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from pathlib import Path

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

SECRET_FIELDS = (
    "imap_password",
    "meili_master_key",
    "admin_password_hash",
    "totp_secret",
    "ai_api_key",
    "session_secret",
    "alert_telegram_bot_token",
)

# Varsayılan olarak senkron dışı tutulan klasörler (özel kullanım bayrağı veya ad eşleşmesi).
DEFAULT_EXCLUDED_FOLDERS = (
    "Trash",
    "Deleted Messages",
    "Deleted Items",
    "Silinmiş Öğeler",
    "Spam",
    "Junk",
    "Junk E-mail",
    "Gereksiz E-posta",
    "Karantina",
    "Quarantine",
    "Drafts",
    "Taslaklar",
)


PUBLIC_MAIL_DOMAINS = frozenset({"gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "msn.com",
                                 "yahoo.com", "icloud.com", "me.com", "yandex.com", "yandex.com.tr", "proton.me",
                                 "protonmail.com", "mail.com", "aol.com"})


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FM_", env_file=None, extra="ignore")

    env: str = "production"  # production | development | test
    log_level: str = "INFO"

    database_url: str = "postgresql+psycopg://fredymail:fredymail@postgres:5432/fredymail"
    meili_url: str = "http://meilisearch:7700"
    meili_master_key: str = ""
    meili_index: str = "fm_messages"

    # --- Kimlik doğrulama / oturum ---
    admin_user: str = "fatih"
    admin_password_hash: str = ""  # argon2id; `fredymail hash-password` ile üretilir
    totp_secret: str = ""  # boş değilse giriş için TOTP zorunlu
    session_secret: str = ""  # oturum token'larının HMAC'i için
    session_idle_minutes: int = 12 * 60
    session_absolute_hours: int = 7 * 24
    cookie_secure: bool = True
    allowed_origins: str = ""  # virgülle ayrılmış; boşsa yalnızca aynı origin
    trust_proxy: str = "none"  # none | cloudflare
    login_max_failures: int = 5
    login_window_minutes: int = 15

    # --- Posta kaynağı ---
    mail_source: str = "imap"  # imap | demo
    account_email: str = ""
    account_aliases: str = ""  # virgülle ayrılmış ek "benim" adreslerim
    imap_host: str = ""
    imap_port: int = 993
    imap_security: str = "ssl"  # ssl | starttls  (düz metin desteklenmez)
    imap_username: str = ""
    imap_password: str = ""
    imap_timeout_seconds: int = 60
    demo_mail_dir: str = "/app/demo-mail"

    sync_enabled: bool = False  # canlı hesap için açık onaydan sonra true yapılır
    sync_interval_seconds: int = 180
    sync_folders: str = "auto"  # auto | "INBOX,Sent,Faturalar"
    sync_exclude_folders: str = ""  # varsayılan listeye EK olarak hariç tutulacak klasörler
    sync_since: str = "365d"  # "365d" veya "2025-01-01"
    sync_max_messages_per_folder: int = 5000
    sync_max_messages_per_cycle: int = 1000
    sync_batch_size: int = 25
    sync_batch_delay_ms: int = 250
    sync_full_fetch_max_bytes: int = 2 * 1024 * 1024
    sync_body_text_max_chars: int = 200_000
    sync_max_retries: int = 4
    sync_deletion_check_every: int = 10  # her N döngüde sunucudan silinenleri kontrol et
    # Toplu kayıp kilidi: bir klasörde bir anda bu orandan ve adetten fazla mail kaybolursa (sunucu arızası,
    # yedekten dönüş...) silmeler UYGULANMAZ, FredyMail'deki kopyalar korunur ve uyarı verilir.
    sync_mass_delete_ratio: float = 0.2
    sync_mass_delete_min: int = 50

    # --- Ekler ---
    attachment_text_extraction: bool = False
    attachment_extract_max_bytes: int = 5 * 1024 * 1024
    attachment_extract_max_chars: int = 50_000
    attachment_download_max_bytes: int = 30 * 1024 * 1024

    # --- AI ---
    ai_provider: str = "none"  # none | openai_compatible | fake
    ai_base_url: str = ""  # örn. http://litellm-litellm-1:4000/v1
    ai_api_key: str = ""
    ai_model: str = ""
    ai_timeout_seconds: int = 60
    ai_max_messages: int = 15
    ai_max_chars_per_message: int = 4000
    ai_max_total_chars: int = 30_000
    ai_max_output_tokens: int = 1200
    ai_daily_budget_usd: float = 1.0
    ai_max_calls_per_day: int = 100
    ai_price_input_per_mtok: float = 0.0
    ai_price_output_per_mtok: float = 0.0
    # İki kademe: ağır işlerde (taslak, uzun yazışma) veya hafif modelin çıktısı geçersizse güçlü model.
    ai_model_heavy: str = ""  # boşsa tek model kullanılır
    ai_price_input_per_mtok_heavy: float = 0.0
    ai_price_output_per_mtok_heavy: float = 0.0
    ai_heavy_kinds: str = "draft"  # her zaman güçlü modelle yapılacak işlemler
    ai_heavy_min_chars: int = 15000  # bu kadar karakterden uzun bağlamda güçlü model
    # Güçlü modeller (Gemini Pro vb.) yazmadan önce "düşünür"; düşünme token'ları çıktı sınırından yer.
    ai_max_output_tokens_heavy: int = 8000
    ai_reasoning_effort_heavy: str = "low"  # low|medium|high; boş = gönderme
    ai_timeout_seconds_heavy: int = 120
    ai_redact_pii: bool = True

    awaiting_reply_days: int = 3
    needs_reply_days: int = 2
    needs_reply_window_days: int = 30  # bundan eski yanıtsız mailler "yanıtlamam gereken"de gösterilmez
    awaiting_window_days: int = 45
    # Ekip içi sayılan alan adları (virgülle). Boşsa hesap adreslerinin alan adı (gmail vb. hariç) kullanılır.
    team_domains: str = ""

    # --- Uyarılar (opsiyonel) ---
    alert_telegram_bot_token: str = ""
    alert_telegram_chat_id: str = ""

    static_dir: str = "/app/static"

    # --- Marka (arayüzde ve bildirimlerde görünen ad; kod genel kalır) ---
    brand_name: str = "FredyMail"
    brand_tagline: str = "Intelligence"

    @field_validator("imap_security")
    @classmethod
    def _security(cls, v: str) -> str:
        v = v.lower()
        if v not in ("ssl", "starttls"):
            raise ValueError("FM_IMAP_SECURITY yalnızca 'ssl' veya 'starttls' olabilir")
        return v

    # ---- türetilmiş değerler ----
    @property
    def my_addresses(self) -> set[str]:
        addrs = {a.strip().lower() for a in self.account_aliases.split(",") if a.strip()}
        if self.account_email:
            addrs.add(self.account_email.strip().lower())
        return addrs

    @property
    def team_domain_set(self) -> frozenset[str]:
        explicit = {d.strip().lower().lstrip("@") for d in self.team_domains.split(",") if d.strip()}
        if explicit:
            return frozenset(explicit)
        return frozenset(a.split("@", 1)[1] for a in self.my_addresses
                         if "@" in a and a.split("@", 1)[1] not in PUBLIC_MAIL_DOMAINS)

    @property
    def excluded_folders(self) -> set[str]:
        """Varsayılan hariç klasörler (Çöp/Spam/Taslak/Karantina...) her zaman geçerlidir; ayar yalnızca ekler."""
        extra = {f.strip().lower() for f in self.sync_exclude_folders.split(",") if f.strip()}
        return {f.lower() for f in DEFAULT_EXCLUDED_FOLDERS} | extra

    @property
    def origins(self) -> list[str]:
        return [o.strip().rstrip("/") for o in self.allowed_origins.split(",") if o.strip()]

    def since_date(self) -> date | None:
        v = self.sync_since.strip().lower()
        if not v or v == "all":
            return None
        if v.endswith("d") and v[:-1].isdigit():
            return (datetime.now(UTC) - timedelta(days=int(v[:-1]))).date()
        return date.fromisoformat(v)

    @property
    def ai_enabled_by_config(self) -> bool:
        if self.ai_provider == "fake":
            return True
        return self.ai_provider == "openai_compatible" and bool(self.ai_base_url and self.ai_model)

    def redacted(self) -> dict:
        """Ayarlar ekranı ve loglar için sırları gizlenmiş görünüm."""
        out = {}
        for k, v in self.model_dump().items():
            if k in SECRET_FIELDS:
                out[k] = "***" if v else ""
            elif k == "database_url":
                out[k] = _mask_url(str(v))
            else:
                out[k] = v
        return out


def _mask_url(url: str) -> str:
    if "@" in url and "://" in url:
        scheme, rest = url.split("://", 1)
        creds, host = rest.rsplit("@", 1)
        user = creds.split(":", 1)[0]
        return f"{scheme}://{user}:***@{host}"
    return url


def _load_file_secrets() -> None:
    """FM_X_FILE tanımlıysa dosyadan okuyup FM_X'e koyar (FM_X zaten yoksa)."""
    for field in SECRET_FIELDS:
        env_name = f"FM_{field.upper()}"
        file_var = os.environ.get(f"{env_name}_FILE")
        if file_var and not os.environ.get(env_name):
            p = Path(file_var)
            if p.is_file():
                os.environ[env_name] = p.read_text(encoding="utf-8").strip()


@lru_cache
def get_settings() -> Settings:
    _load_file_secrets()
    return Settings()
