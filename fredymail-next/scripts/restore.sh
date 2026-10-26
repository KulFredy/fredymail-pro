#!/usr/bin/env bash
# Postgres yedeğini geri yükler ve arama indeksini yeniden üretir.
# Kullanım: ./scripts/restore.sh backups/fredymail-XXXX.dump --yes
# DİKKAT: mevcut FredyMail veritabanının (etiket/not/taslak dahil) yerini alır. Posta sunucusuna dokunmaz.
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then echo "Yedek dosyası bulunamadı: $FILE" >&2; exit 2; fi
if [[ "${2:-}" != "--yes" ]]; then
  echo "Bu işlem mevcut FredyMail veritabanını SİLİP yedekle değiştirir. Onay için --yes ekleyin." >&2
  exit 3
fi
if [[ -f "$FILE.sha256" ]]; then sha256sum -c "$FILE.sha256"; fi

SRC="$FILE"
if [[ "$FILE" == *.gpg ]]; then
  SRC="$(mktemp)"; trap 'rm -f "$SRC"' EXIT
  gpg --batch --decrypt --output "$SRC" "$FILE"
fi

echo "• Uygulama durduruluyor (api, worker)…"
docker compose stop api worker

echo "• Veritabanı geri yükleniyor…"
docker compose exec -T postgres psql -U fredymail -d postgres -v ON_ERROR_STOP=1 -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='fredymail' AND pid<>pg_backend_pid();" >/dev/null
docker compose exec -T postgres dropdb -U fredymail --if-exists fredymail
docker compose exec -T postgres createdb -U fredymail fredymail
docker compose exec -T postgres pg_restore -U fredymail -d fredymail --no-owner --exit-on-error < "$SRC"

echo "• Şema güncel mi kontrol ediliyor…"
docker compose run --rm migrate

echo "• Arama indeksi Postgres'ten yeniden üretiliyor…"
docker compose run --rm --no-deps worker fredymail reindex --yes

docker compose up -d api worker
echo "Geri yükleme tamam."
