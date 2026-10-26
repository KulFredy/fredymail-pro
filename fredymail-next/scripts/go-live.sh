#!/usr/bin/env bash
# Demo → canlı hesap geçişi (VPS).
#   - DEMO verisini siler (yalnızca fredymail_* volume'ları; mevcut diğer servislere dokunmaz)
#   - Canlı, SALT OKUNUR IMAP senkronunu başlatır (sunucuda hiçbir şey değişmez)
#   - Bundan sonra `docker compose` komutları VPS eklentisini otomatik kullanır (COMPOSE_FILE)
#
# Kullanım: ./scripts/go-live.sh [--since 365d|2020-01-01|all] [--exclude "CV ler"] ...
set -euo pipefail
cd "$(dirname "$0")/.."

SINCE="365d"; EXCLUDE=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --since) SINCE="$2"; shift 2 ;;
    --exclude) EXCLUDE+=("$2"); shift 2 ;;
    *) echo "Bilinmeyen seçenek: $1" >&2; exit 2 ;;
  esac
done

getenv() { { grep -E "^$1=" .env || true; } | tail -1 | cut -d= -f2- | sed -E "s/[[:space:]]+#.*$//; s/^'//; s/'$//"; }

# ---- ön koşullar
[[ -f .env ]] || { echo ".env yok" >&2; exit 2; }
[[ -s secrets/imap_password ]] || { echo "secrets/imap_password yok (DAGITIM.md Adım 3)" >&2; exit 2; }
[[ -n "$(getenv FM_IMAP_HOST)" && -n "$(getenv FM_IMAP_USERNAME)" ]] || { echo "FM_IMAP_HOST / FM_IMAP_USERNAME boş" >&2; exit 2; }
if [[ -f .demo-password ]] || grep -q "ORNEKSAHTE" .env; then
  echo "Önce gerçek giriş parolanı belirle: ./scripts/set-password.sh" >&2; exit 2
fi
docker network inspect ai-shared >/dev/null 2>&1 || { echo "ai-shared Docker ağı bulunamadı" >&2; exit 2; }

ACCOUNT="$(getenv FM_IMAP_USERNAME)"
EXCL="$(getenv FM_SYNC_EXCLUDE_FOLDERS)"   # varsayılan hariç liste (Çöp/Spam/...) uygulamada her zaman geçerli
for e in "${EXCLUDE[@]}"; do EXCL="${EXCL:+$EXCL,}$e"; done

echo "──────────────── CANLI GEÇİŞ ────────────────"
echo " Hesap            : $ACCOUNT  ($(getenv FM_IMAP_HOST):$(getenv FM_IMAP_PORT), salt okunur)"
echo " Kapsam           : $SINCE"
echo " Ek hariç klasör  : ${EXCLUDE[*]:-(yok)}"
echo " AI               : kapalı (Adım 5'te açılacak)"
echo " DİKKAT           : demo verisi (sahte mailler, etiket/notlar) SİLİNECEK"
echo "──────────────────────────────────────────────"
read -rp "Onaylıyorsan büyük harfle EVET yaz: " A
[[ "$A" == "EVET" ]] || { echo "İptal edildi."; exit 3; }

echo "• Demo durduruluyor ve demo verisi siliniyor…"
docker compose -f docker-compose.yml down -v --remove-orphans

python3 - "$ACCOUNT" "$SINCE" "$EXCL" <<'PY'
import re, sys, pathlib
account, since, excl = sys.argv[1:4]
p = pathlib.Path(".env"); s = p.read_text()
vals = {
    "COMPOSE_FILE": "docker-compose.yml:docker-compose.vps.yml",
    "FM_MAIL_SOURCE": "imap",
    "FM_ACCOUNT_EMAIL": account,
    "FM_SYNC_ENABLED": "true",
    "FM_SYNC_SINCE": since,
    "FM_SYNC_MAX_MESSAGES_PER_FOLDER": "20000",
    "FM_SYNC_EXCLUDE_FOLDERS": excl,
    "FM_AI_PROVIDER": "none",
    "FM_IMAP_PASSWORD": "",
}
for k, v in vals.items():
    line = f"{k}={v}"
    if re.search(rf"^{k}=", s, re.M):
        s = re.sub(rf"^{k}=.*$", lambda m: line, s, flags=re.M)
    else:
        s += f"\n{line}\n"
p.write_text(s)
PY

echo "• Canlı sistem derleniyor ve başlatılıyor…"
docker compose up -d --build
PORT="$(getenv FM_HTTP_PORT)"; PORT="${PORT:-8088}"
for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 && break; sleep 2; done
echo
echo "Canlı senkron başladı. İlerlemeyi izlemek için:"
echo "  docker compose logs -f worker        (çıkmak: Ctrl+C — senkron durmaz)"
echo "  docker compose exec -T postgres psql -U fredymail -d fredymail -tAc 'select count(*) from messages'"
echo "Arayüz: SSH tüneliyle http://localhost:${PORT}  (Ayarlar → Senkron sayfası da ilerlemeyi gösterir)"
