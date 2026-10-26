#!/usr/bin/env bash
# Backend test paketi: geçici Postgres + Meilisearch konteynerleri başlatır, lint + migration + testleri çalıştırır.
# Gerçek IMAP protokol testleri için FM_TEST_IMAP_HOST/PORT (Dovecot/GreenMail) gerekir; yoksa atlanır.
set -euo pipefail
cd "$(dirname "$0")/../backend"

PG=fm-test-pg; MEILI=fm-test-meili
if ! docker ps --format '{{.Names}}' | grep -q "^$PG$"; then
  docker run -d --rm --name $PG -e POSTGRES_PASSWORD=test -e POSTGRES_USER=fm -e POSTGRES_DB=fm_test \
    -p 127.0.0.1:55432:5432 postgres:16.15-alpine >/dev/null
fi
if ! docker ps --format '{{.Names}}' | grep -q "^$MEILI$"; then
  docker run -d --rm --name $MEILI -e MEILI_MASTER_KEY=test-master-key-0123456789abcdef -e MEILI_NO_ANALYTICS=true \
    -p 127.0.0.1:57700:7700 getmeili/meilisearch:v1.15.2 >/dev/null
fi
for _ in $(seq 1 30); do docker exec $PG pg_isready -U fm >/dev/null 2>&1 && break; sleep 1; done

if [[ ! -x .venv/bin/python ]]; then
  python3 -m venv .venv
  .venv/bin/pip install -q -r requirements.lock -e ".[dev]"
fi

echo "== ruff =="
.venv/bin/ruff check fredymail tests
echo "== migration tutarlılığı =="
FM_DATABASE_URL="postgresql+psycopg://fm:test@127.0.0.1:55432/fm_test" .venv/bin/alembic upgrade head
FM_DATABASE_URL="postgresql+psycopg://fm:test@127.0.0.1:55432/fm_test" .venv/bin/alembic check
echo "== pytest =="
.venv/bin/pytest -q "$@"
