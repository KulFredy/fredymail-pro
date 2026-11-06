#!/usr/bin/env bash
# İçerik Fabrikası · Mac kurulumu (Apple Silicon, M1/M2/M3)
# Çalıştırma: bash scripts/setup-mac.sh
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf "\n\033[1;33m▸ %s\033[0m\n" "$1"; }

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew gerekli. Kurulum: https://brew.sh — sonra bu betiği yeniden çalıştırın."
  exit 1
fi

say "Araçlar kuruluyor: Node.js, FFmpeg, whisper.cpp"
brew list node >/dev/null 2>&1 || brew install node
brew list ffmpeg >/dev/null 2>&1 || brew install ffmpeg
brew list whisper-cpp >/dev/null 2>&1 || brew install whisper-cpp

say "Uygulama bağımlılıkları (npm)"
npm install

DATA="${FABRIKA_HOME:-$HOME/İçerik Fabrikası}"
MODELS="$DATA/modeller"
mkdir -p "$MODELS"

MODEL="$MODELS/ggml-large-v3-turbo-q5_0.bin"
if [ ! -f "$MODEL" ]; then
  say "Türkçe konuşma modeli indiriliyor (~550 MB, bir kez)"
  curl -L --fail --progress-bar -o "$MODEL.part" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin"
  mv "$MODEL.part" "$MODEL"
fi

VAD="$MODELS/ggml-silero-v5.1.2.bin"
if [ ! -f "$VAD" ]; then
  say "Konuşma algılama modeli (isteğe bağlı, ~1 MB)"
  curl -L --fail --progress-bar -o "$VAD" \
    "https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin" || echo "İndirilemedi; uygulama bunsuz da çalışır."
fi

say "Arayüz derleniyor"
npm run build:web

say "Kontroller"
ffmpeg -hide_banner -filters 2>/dev/null | grep -q zscale && echo "✓ HDR → SDR ton eşleme (zscale) var" || echo "• zscale yok: HDR önizleme kopyaları biraz soluk görünebilir; son çıktı etkilenmez"
command -v whisper-cli >/dev/null && echo "✓ whisper-cli: $(command -v whisper-cli)"
echo "✓ Model: $MODEL"

cat <<MSG

Hazır. Başlatmak için:
  npm run fabrika
Sonra tarayıcıda: http://localhost:4747

Claude Code bu klasörde açıldığında MCP sunucusu (.mcp.json) otomatik tanınır;
araçların çalışması için uygulamanın açık olması gerekir.
MSG
