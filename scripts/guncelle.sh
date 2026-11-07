#!/usr/bin/env bash
# İçerik Fabrikası'nı en son sürüme günceller. Projeleriniz (~/İçerik Fabrikası) etkilenmez.
# Çalıştırma: bash scripts/guncelle.sh
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="${1:-claude/hopeful-thompson-lgey2c}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "▸ En son sürüm indiriliyor…"
curl -L --fail --progress-bar -o "$TMP/surum.zip" "https://codeload.github.com/kulfredy/fredymail-pro/zip/refs/heads/$BRANCH"
unzip -q "$TMP/surum.zip" -d "$TMP/acik"
SRC="$(find "$TMP/acik" -mindepth 1 -maxdepth 1 -type d | head -1)"

echo "▸ Dosyalar güncelleniyor…"
rsync -a --delete --exclude node_modules --exclude web/dist "$SRC"/ ./

echo "▸ Bağımlılıklar ve arayüz…"
npm install --no-fund --no-audit
npm run build:web

echo
echo "Güncellendi. Başlatmak için: npm run fabrika"
