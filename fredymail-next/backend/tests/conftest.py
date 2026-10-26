"""Test altyapısı: gerçek Postgres + gerçek Meilisearch (docker) kullanılır.

FM_TEST_DATABASE_URL ve FM_TEST_MEILI_URL / FM_TEST_MEILI_KEY ortam değişkenleri ile
yönlendirilir; varsayılanlar `scripts/test.sh`'ın başlattığı konteynerlerdir.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest

TEST_DB = os.environ.get("FM_TEST_DATABASE_URL", "postgresql+psycopg://fm:test@127.0.0.1:55432/fm_test")
TEST_MEILI = os.environ.get("FM_TEST_MEILI_URL", "http://127.0.0.1:57700")
TEST_MEILI_KEY = os.environ.get("FM_TEST_MEILI_KEY", "test-master-key-0123456789abcdef")

os.environ.update({
    "FM_ENV": "test",
    "FM_DATABASE_URL": TEST_DB,
    "FM_MEILI_URL": TEST_MEILI,
    "FM_MEILI_MASTER_KEY": TEST_MEILI_KEY,
    "FM_MEILI_INDEX": f"fm_test_{uuid.uuid4().hex[:8]}",
    "FM_ACCOUNT_EMAIL": "fatih@ornek-ithalat.test",
    "FM_MAIL_SOURCE": "demo",
    "FM_SYNC_BATCH_DELAY_MS": "0",
    "FM_COOKIE_SECURE": "false",
    "FM_SESSION_SECRET": "test-session-secret-0123456789abcdef",
    "FM_AI_PROVIDER": "fake",
    "FM_AI_MODEL": "fake-model",
    "FM_ATTACHMENT_TEXT_EXTRACTION": "true",
})

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from sqlalchemy import text  # noqa: E402

from fredymail.config import get_settings  # noqa: E402
from fredymail.db import get_engine, new_session  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]
NOW = datetime.now(UTC)


def reset_db() -> None:
    eng = get_engine()
    with eng.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "migrations"))
    command.upgrade(cfg, "head")


@pytest.fixture
def settings():
    return get_settings()


@pytest.fixture
def db():
    reset_db()
    s = new_session()
    yield s
    s.rollback()
    s.close()


@pytest.fixture(scope="session")
def demo_dir(tmp_path_factory):
    from fredymail.demo.generate import generate

    d = tmp_path_factory.mktemp("demo-mail")
    generate(d, now=NOW)
    return d


@pytest.fixture
def meili(settings):
    from fredymail.search.meili import Meili

    m = Meili(settings)
    if not m.healthy():
        pytest.skip("Meilisearch erişilemiyor")
    m.delete_index()
    m.ensure_index()
    yield m
    m.delete_index()


@pytest.fixture
def synced(db, settings, demo_dir):
    from fredymail.mail.source import EmlDirSource
    from fredymail.mail.sync import run_sync

    res = run_sync(db, lambda: EmlDirSource(demo_dir, kind="demo", keep_payload_max=5_000_000), settings,
                   origin="demo", source_path=str(demo_dir), sleep=lambda s: None)
    return res
