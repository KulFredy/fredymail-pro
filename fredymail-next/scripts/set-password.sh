#!/usr/bin/env bash
# FredyMail giriş parolasını belirler (argon2id özeti .env'e yazılır; düz parola hiçbir yere kaydedilmez).
# Kullanım: ./scripts/set-password.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f .env ]] || { echo ".env bulunamadı (önce demo-up.sh veya .env.example)" >&2; exit 2; }

read -rsp "Yeni FredyMail parolası (en az 12 karakter): " P1; echo
read -rsp "Tekrar: " P2; echo
if [[ "$P1" != "$P2" ]]; then echo "Parolalar eşleşmiyor." >&2; exit 2; fi
if (( ${#P1} < 12 )); then echo "Parola en az 12 karakter olmalı." >&2; exit 2; fi

HASH="$(printf '%s' "$P1" | docker compose run --rm --no-deps -T api python -c \
  "import sys; from fredymail.security.auth import hash_password; print(hash_password(sys.stdin.read()))")"
unset P1 P2
[[ "$HASH" == \$argon2id\$* ]] || { echo "Özet üretilemedi." >&2; exit 1; }

python3 - "$HASH" <<'PY'
import re, sys, pathlib
p = pathlib.Path(".env"); s = p.read_text()
line = "FM_ADMIN_PASSWORD_HASH='" + sys.argv[1] + "'"
s = re.sub(r"^FM_ADMIN_PASSWORD_HASH=.*$", lambda m: line, s, flags=re.M) if re.search(r"^FM_ADMIN_PASSWORD_HASH=", s, re.M) else s + "\n" + line + "\n"
p.write_text(s)
PY
rm -f .demo-password
echo "Parola güncellendi. Etkinleşmesi için api yeniden başlatılmalı: docker compose up -d api"
