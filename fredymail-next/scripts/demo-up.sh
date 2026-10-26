#!/usr/bin/env bash
# Tek komutla demo: sahte verilerle FredyMail'i yerelde (127.0.0.1) başlatır.
# .env yoksa rastgele sırlarla oluşturur ve tek seferlik demo parolasını ekrana yazar.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT="${FM_HTTP_PORT:-8088}"

if [[ ! -f .env ]]; then
  echo "• .env oluşturuluyor (demo modu, rastgele sırlar)…"
  rnd() { python3 -c "import secrets;print(secrets.token_urlsafe($1))"; }
  DEMO_PASS="$(rnd 12)"
  cp .env.example .env
  chmod 600 .env
  python3 - "$DEMO_PASS" "$(rnd 24)" "$(rnd 32)" "$(rnd 36)" <<'PY'
import re, sys, pathlib
demo_pass, dbpw, meili, sess = sys.argv[1:5]
p = pathlib.Path(".env")
s = p.read_text()
def put(key, val):
    global s
    s = re.sub(rf"^{key}=.*$", f"{key}={val}", s, flags=re.M)
put("FM_DB_PASSWORD", dbpw)
put("FM_MEILI_MASTER_KEY", meili)
put("FM_SESSION_SECRET", sess)
put("FM_MAIL_SOURCE", "demo")
put("FM_ACCOUNT_EMAIL", "fatih@ornek-ithalat.test")
put("FM_COOKIE_SECURE", "false")
put("FM_AI_PROVIDER", "fake")
put("FM_AI_MODEL", "demo-sahte-model")
put("FM_ATTACHMENT_TEXT_EXTRACTION", "true")
p.write_text(s)
pathlib.Path(".demo-password").write_text(demo_pass + "\n")
PY
  chmod 600 .demo-password
fi

echo "• İmaj derleniyor ve servisler başlatılıyor…"
BUILD_FLAG="--build"; [[ "${FM_DEMO_NO_BUILD:-0}" == "1" ]] && BUILD_FLAG=""   # önceden derlenmiş imaj için
docker compose up -d $BUILD_FLAG postgres meilisearch migrate

# Parola özeti henüz ayarlanmadıysa (ilk kurulum veya yarıda kalmış kurulum) demo parolasından üret
if [[ -f .demo-password ]] && grep -q "ORNEKSAHTE" .env; then
  HASH="$(docker compose run --rm --no-deps -T api python -c \
    "import sys; from fredymail.security.auth import hash_password; print(hash_password(sys.stdin.read().strip()))" \
    < .demo-password)"
  python3 - "$HASH" <<'PY'
import re, sys, pathlib
p = pathlib.Path(".env"); s = p.read_text()
s = re.sub(r"^FM_ADMIN_PASSWORD_HASH=.*$", "FM_ADMIN_PASSWORD_HASH='" + sys.argv[1] + "'", s, flags=re.M)
p.write_text(s)
PY
fi

docker compose up -d api worker

echo -n "• Arayüz bekleniyor"
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1; then echo " ✓"; break; fi
  echo -n "."; sleep 2
done

echo -n "• Demo mailler senkronlanıyor"
for _ in $(seq 1 60); do
  n="$(docker compose exec -T postgres psql -U fredymail -d fredymail -tAc 'select count(*) from messages where index_dirty=false' 2>/dev/null || echo 0)"
  if [[ "${n// /}" -gt 100 ]]; then echo " ✓ (${n// /} mail indekslendi)"; break; fi
  echo -n "."; sleep 3
done

echo
echo "FredyMail demo hazır:  http://127.0.0.1:${PORT}"
echo "Kullanıcı: fatih"
if [[ -f .demo-password ]]; then echo "Parola:    $(cat .demo-password)   (dosya: .demo-password)"; fi
echo "Durdurmak: docker compose down    |  Verileri de silmek: docker compose down -v"
