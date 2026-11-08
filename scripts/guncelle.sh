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
# Mac uygulaması (tek tıkla açılış) yoksa oluştur; varsa simge ve başlatıcıyı tazele
if [ "$(uname)" = "Darwin" ]; then
  bash scripts/mac-uygulama.sh | sed -n 1p
fi
if curl -sf -m 2 http://localhost:4747/api/health >/dev/null 2>&1; then
  # Eski sürüm açıksa durdur: yeni sürüm bir sonraki açılışta başlar
  curl -sf -m 3 -X POST http://localhost:4747/api/kapat >/dev/null 2>&1 || true
  sleep 1
fi
if lsof -ti tcp:4747 >/dev/null 2>&1; then
  echo "⚠ Uygulama hâlâ ESKİ sürümle açık (Terminal'den başlatılmış olabilir)."
  echo "  O Terminal penceresinde Ctrl+C'ye basın, sonra İçerik Fabrikası uygulamasını açın."
else
  echo "Güncellendi. Launchpad / Spotlight'tan “İçerik Fabrikası”nı açın"
  echo "(ya da Terminal'den: npm run fabrika)."
fi
