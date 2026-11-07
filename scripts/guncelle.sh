#!/usr/bin/env bash
# İçerik Fabrikası'nı en son sürüme günceller. Projeleriniz (~/İçerik Fabrikası) etkilenmez.
# Çalıştırma: bash scripts/guncelle.sh            (varsayılan çalışma dalı)
#             bash scripts/guncelle.sh <dal-adı>  (belirli bir dal)
set -euo pipefail
cd "$(dirname "$0")/.."
BRANCH="${1:-claude/kind-davinci-9kuqyj}"
REPO="kulfredy/fredymail-pro"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "▸ Dal: $BRANCH"
# Hangi sürüm kuruluyor? (yalnız bilgi; ulaşılamazsa geçilir)
LAST="$(curl -s --max-time 10 "https://api.github.com/repos/$REPO/commits/$BRANCH" | sed -n 's/^    "message": "\(.*\)",$/\1/p' | head -1 | sed "s/\\\\n.*//" | cut -c1-90 || true)"
[ -n "$LAST" ] && echo "▸ En son değişiklik: $LAST"

echo "▸ En son sürüm indiriliyor…"
curl -L --fail --progress-bar -o "$TMP/surum.zip" "https://codeload.github.com/$REPO/zip/refs/heads/$BRANCH"
unzip -q "$TMP/surum.zip" -d "$TMP/acik"
SRC="$(find "$TMP/acik" -mindepth 1 -maxdepth 1 -type d | head -1)"

echo "▸ Dosyalar güncelleniyor…"
rsync -a --delete --exclude node_modules --exclude web/dist "$SRC"/ ./

echo "▸ Bağımlılıklar ve arayüz…"
npm install --no-fund --no-audit
npm run build:web

echo
if lsof -ti tcp:4747 >/dev/null 2>&1; then
  echo "⚠ Uygulama şu an açık ve ESKİ sürümle çalışıyor."
  echo "  Açık olan Terminal penceresinde Ctrl+C'ye basın, sonra: npm run fabrika"
  echo "  Tarayıcıda sayfayı yenileyin (⌘R)."
else
  echo "Güncellendi. Başlatmak için: npm run fabrika"
fi
