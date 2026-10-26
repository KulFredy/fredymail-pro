"""Kalıcı veri modeli (Postgres = doğruluk kaynağı; Meilisearch yeniden üretilebilir).

Temel tasarım:
- `messages` mantıksal mail; aynı mail birden çok klasörde olsa bile tek satırdır
  (dedupe_key = Message-ID, yoksa başlık özetinin sha256'sı).
- `message_locations` mailin sunucudaki (klasör, UIDVALIDITY, UID) konumları.
- Kullanıcı iş akışı alanları (etiket, not, okundu, önemli, erteleme) yalnızca
  FredyMail'de tutulur; IMAP sunucusuna yazılmaz (salt okunur ilke).
"""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Account(Base):
    __tablename__ = "accounts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(320), unique=True)
    source_kind: Mapped[str] = mapped_column(String(20), default="imap")  # imap | demo | import
    imap_host: Mapped[str | None] = mapped_column(String(255))
    capabilities: Mapped[list | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Folder(Base):
    __tablename__ = "folders"
    __table_args__ = (UniqueConstraint("account_id", "name"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    name: Mapped[str] = mapped_column(String(512))  # sunucudaki tam ad (UTF-8'e çözülmüş)
    display_name: Mapped[str] = mapped_column(String(512))
    delimiter: Mapped[str | None] = mapped_column(String(4))
    parent_name: Mapped[str | None] = mapped_column(String(512))
    flags: Mapped[list] = mapped_column(JSONB, default=list)
    role: Mapped[str | None] = mapped_column(String(20))  # inbox|sent|drafts|trash|junk|archive
    origin: Mapped[str] = mapped_column(String(20), default="server")  # server | import | demo
    source_path: Mapped[str | None] = mapped_column(Text)  # içe aktarılan klasörün dosya yolu
    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    uidvalidity: Mapped[int | None] = mapped_column(BigInteger)
    last_uid: Mapped[int] = mapped_column(BigInteger, default=0)
    oldest_uid_synced: Mapped[int | None] = mapped_column(BigInteger)
    server_message_count: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="idle")  # idle|syncing|error|disabled
    last_error: Mapped[str | None] = mapped_column(Text)
    consecutive_failures: Mapped[int] = mapped_column(Integer, default=0)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Thread(Base):
    __tablename__ = "threads"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    subject: Mapped[str] = mapped_column(Text, default="")
    normalized_subject: Mapped[str] = mapped_column(Text, default="", index=True)
    first_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    message_count: Mapped[int] = mapped_column(Integer, default=0)
    participants: Mapped[list] = mapped_column(JSONB, default=list)
    last_from_me: Mapped[bool] = mapped_column(Boolean, default=False)
    last_inbound_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_outbound_date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    has_human_inbound: Mapped[bool] = mapped_column(Boolean, default=False)
    followup_dismissed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Message(Base):
    __tablename__ = "messages"
    __table_args__ = (
        UniqueConstraint("account_id", "dedupe_key"),
        Index("ix_messages_date", "date"),
        Index("ix_messages_thread", "thread_id"),
        Index("ix_messages_index_dirty", "index_dirty"),
        Index("ix_messages_msgid", "account_id", "message_id_header"),
        Index("ix_messages_refs", "references", postgresql_using="gin"),
        Index("ix_messages_inreplyto", "in_reply_to"),
    )
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    thread_id: Mapped[int | None] = mapped_column(ForeignKey("threads.id", ondelete="SET NULL"))
    dedupe_key: Mapped[str] = mapped_column(String(600))
    message_id_header: Mapped[str | None] = mapped_column(String(998))
    in_reply_to: Mapped[str | None] = mapped_column(String(998))
    references: Mapped[list] = mapped_column(ARRAY(Text), default=list)
    subject: Mapped[str] = mapped_column(Text, default="")
    normalized_subject: Mapped[str] = mapped_column(Text, default="")
    from_email: Mapped[str] = mapped_column(String(320), default="")
    from_name: Mapped[str] = mapped_column(String(320), default="")
    to_addrs: Mapped[list] = mapped_column(JSONB, default=list)  # [{"name","email"}]
    cc_addrs: Mapped[list] = mapped_column(JSONB, default=list)
    reply_to: Mapped[list] = mapped_column(JSONB, default=list)
    date: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    size: Mapped[int | None] = mapped_column(Integer)
    snippet: Mapped[str] = mapped_column(Text, default="")
    body_text: Mapped[str] = mapped_column(Text, default="")
    body_html: Mapped[str | None] = mapped_column(Text)  # ham HTML; gösterimde sanitize edilir
    body_truncated: Mapped[bool] = mapped_column(Boolean, default=False)
    has_attachments: Mapped[bool] = mapped_column(Boolean, default=False)
    is_from_me: Mapped[bool] = mapped_column(Boolean, default=False)
    is_automated: Mapped[bool] = mapped_column(Boolean, default=False)  # bülten/no-reply
    doc_kinds: Mapped[list] = mapped_column(JSONB, default=list)  # invoice|pricelist|quote|order|...
    server_flags: Mapped[list] = mapped_column(JSONB, default=list)
    injection_suspected: Mapped[bool] = mapped_column(Boolean, default=False)
    deleted_on_server: Mapped[bool] = mapped_column(Boolean, default=False)
    # kullanıcı durumu (yalnızca FredyMail'de)
    is_read: Mapped[bool] = mapped_column(Boolean, default=False)
    is_important: Mapped[bool] = mapped_column(Boolean, default=False)
    snoozed_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # indeks çıkış kutusu
    index_dirty: Mapped[bool] = mapped_column(Boolean, default=True)
    indexed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    locations: Mapped[list[MessageLocation]] = relationship(
        back_populates="message", cascade="all, delete-orphan", lazy="selectin"
    )
    attachments: Mapped[list[Attachment]] = relationship(
        back_populates="message", cascade="all, delete-orphan", lazy="selectin",
        order_by="Attachment.part_index",
    )


class MessageLocation(Base):
    __tablename__ = "message_locations"
    __table_args__ = (UniqueConstraint("folder_id", "uidvalidity", "uid"),)
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    folder_id: Mapped[int] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"), index=True)
    uidvalidity: Mapped[int] = mapped_column(BigInteger)
    uid: Mapped[int] = mapped_column(BigInteger)
    message: Mapped[Message] = relationship(back_populates="locations")
    folder: Mapped[Folder] = relationship(lazy="joined")


class Attachment(Base):
    __tablename__ = "attachments"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    part_index: Mapped[int] = mapped_column(Integer)  # MIME walk sırası (indirme için)
    imap_section: Mapped[str | None] = mapped_column(String(64))  # BODYSTRUCTURE bölümü, örn "2"
    filename: Mapped[str] = mapped_column(String(512), default="")
    content_type: Mapped[str] = mapped_column(String(255), default="application/octet-stream")
    size: Mapped[int | None] = mapped_column(Integer)
    content_id: Mapped[str | None] = mapped_column(String(512))
    is_inline: Mapped[bool] = mapped_column(Boolean, default=False)
    file_kind: Mapped[str] = mapped_column(String(20), default="other")  # pdf|spreadsheet|document|image|archive|other
    sha256: Mapped[str | None] = mapped_column(String(64))
    extracted_text: Mapped[str | None] = mapped_column(Text)
    extraction_status: Mapped[str] = mapped_column(String(20), default="skipped")
    message: Mapped[Message] = relationship(back_populates="attachments")


class Tag(Base):
    __tablename__ = "tags"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    color: Mapped[str] = mapped_column(String(16), default="#5b6ee1")


class MessageTag(Base):
    __tablename__ = "message_tags"
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)


class Note(Base):
    __tablename__ = "notes"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int] = mapped_column(ForeignKey("messages.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class SavedSearch(Base):
    """Akıllı klasör: sunucuya dokunmadan, kural gibi çalışan kayıtlı filtre."""

    __tablename__ = "saved_searches"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True)
    query: Mapped[str] = mapped_column(Text, default="")
    filters: Mapped[dict] = mapped_column(JSONB, default=dict)
    position: Mapped[int] = mapped_column(Integer, default=0)


class Draft(Base):
    """Yalnızca taslak. Gönderme özelliği MVP'de yoktur."""

    __tablename__ = "drafts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    thread_id: Mapped[int | None] = mapped_column(ForeignKey("threads.id", ondelete="SET NULL"))
    reply_to_message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"))
    to_addrs: Mapped[list] = mapped_column(JSONB, default=list)
    subject: Mapped[str] = mapped_column(Text, default="")
    body: Mapped[str] = mapped_column(Text, default="")
    source: Mapped[str] = mapped_column(String(10), default="user")  # user | ai
    ai_run_id: Mapped[int | None] = mapped_column(ForeignKey("ai_runs.id", ondelete="SET NULL"))
    reviewed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Task(Base):
    """Yapılacaklar: elle ya da AI'ın çıkardığı eylemlerden eklenir; kaynak maile bağlıdır."""

    __tablename__ = "tasks"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    message_id: Mapped[int | None] = mapped_column(ForeignKey("messages.id", ondelete="SET NULL"), index=True)
    thread_id: Mapped[int | None] = mapped_column(ForeignKey("threads.id", ondelete="SET NULL"), index=True)
    text: Mapped[str] = mapped_column(Text)
    due: Mapped[date | None] = mapped_column(Date)
    done: Mapped[bool] = mapped_column(Boolean, default=False, index=True)
    source: Mapped[str] = mapped_column(String(10), default="user")  # user | ai
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    done_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AiRun(Base):
    __tablename__ = "ai_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(30))  # summary|thread_summary|search_summary|actions|draft
    cache_key: Mapped[str] = mapped_column(String(64), index=True)
    provider: Mapped[str] = mapped_column(String(40))
    model: Mapped[str] = mapped_column(String(120))
    message_ids: Mapped[list] = mapped_column(JSONB, default=list)
    chars_sent: Mapped[int] = mapped_column(Integer, default=0)
    prompt_tokens: Mapped[int] = mapped_column(Integer, default=0)
    completion_tokens: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    latency_ms: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(20))  # ok|error|blocked
    error: Mapped[str | None] = mapped_column(Text)
    output: Mapped[dict | None] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class SyncRun(Base):
    __tablename__ = "sync_runs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[int] = mapped_column(ForeignKey("accounts.id", ondelete="CASCADE"))
    folder_id: Mapped[int | None] = mapped_column(ForeignKey("folders.id", ondelete="CASCADE"))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[str] = mapped_column(String(20), default="running")  # running|ok|error|partial
    fetched: Mapped[int] = mapped_column(Integer, default=0)
    created: Mapped[int] = mapped_column(Integer, default=0)
    duplicates: Mapped[int] = mapped_column(Integer, default=0)
    removed: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(Text)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))


class LoginAttempt(Base):
    __tablename__ = "login_attempts"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ip: Mapped[str] = mapped_column(String(64), index=True)
    success: Mapped[bool] = mapped_column(Boolean)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)


class PushSubscription(Base):
    """Bu cihaza/tarayıcıya yeni mail bildirimi (Web Push). Uç nokta yalnızca bilinen push servisleridir."""

    __tablename__ = "push_subscriptions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    endpoint: Mapped[str] = mapped_column(Text, unique=True)
    p256dh: Mapped[str] = mapped_column(String(200))
    auth: Mapped[str] = mapped_column(String(64))
    label: Mapped[str] = mapped_column(String(120), default="")
    failures: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    last_success_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class KeyValue(Base):
    """Küçük uygulama durumları: worker kalp atışı, AI açık/kapalı anahtarı vb."""

    __tablename__ = "kv"
    key: Mapped[str] = mapped_column(String(80), primary_key=True)
    value: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
