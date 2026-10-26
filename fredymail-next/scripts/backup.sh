#!/usr/bin/env bash
# Postgres yedeği (Meilisearch yedeklenmez: Postgres'ten `fredymail reindex --yes` ile yeniden üretilir).
# Kullanım: ./scripts/backup.sh [hedef_dizin]     (varsayılan ./backups, 14 yedek saklanır)
# FM_BACKUP_GPG_RECIPIENT tanımlıysa yedek GPG ile şifrelenir (sunucu dışına kopyalamadan önce önerilir).
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${1:-./backups}"
KEEP="${FM_BACKUP_KEEP:-14}"
mkdir -p "$DEST"
chmod 700 "$DEST"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
FILE="$DEST/fredymail-$TS.dump"

docker compose exec -T postgres pg_dump -U fredymail -d fredymail -Fc --no-owner > "$FILE.partial"
# Bütünlük kontrolü: arşiv okunabiliyor mu?
docker compose exec -T postgres pg_restore --list < "$FILE.partial" > /dev/null
mv "$FILE.partial" "$FILE"

if [[ -n "${FM_BACKUP_GPG_RECIPIENT:-}" ]]; then
  gpg --batch --yes --encrypt --recipient "$FM_BACKUP_GPG_RECIPIENT" --output "$FILE.gpg" "$FILE"
  rm -f "$FILE"
  FILE="$FILE.gpg"
fi
chmod 600 "$FILE"
sha256sum "$FILE" > "$FILE.sha256"

# Eski yedekleri temizle
ls -1t "$DEST"/fredymail-*.dump* 2>/dev/null | grep -v '\.sha256$' | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old" "$old.sha256"
done

echo "Yedek alındı: $FILE ($(du -h "$FILE" | cut -f1))"
