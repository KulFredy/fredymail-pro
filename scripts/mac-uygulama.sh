#!/bin/bash
# İçerik Fabrikası'nı tek tıkla açılan bir Mac uygulamasına dönüştürür.
#   bash scripts/mac-uygulama.sh
# Sonuç: /Applications/İçerik Fabrikası.app (yazılamıyorsa ~/Applications); Launchpad, Spotlight ve Dock'tan açılır.
# Tıklayınca: sunucu çalışmıyorsa arka planda başlatır, uygulamayı adres çubuğu olmayan
# ayrı bir pencerede açar (Chrome/Edge/Brave “uygulama modu”; yoksa varsayılan tarayıcı).
# Kapatmak için uygulamada ana sayfa → “Kapat”. Kayıt: ~/Library/Logs/IcerikFabrikasi.log
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
# Asıl Uygulamalar klasörü (Finder, Launchpad, Spotlight'ta görünür); yazılamıyorsa kullanıcının ~/Applications'ı
if [ -n "${FABRIKA_APP_DIR:-}" ]; then HEDEF="$FABRIKA_APP_DIR"
elif [ -w /Applications ]; then HEDEF="/Applications"
else HEDEF="$HOME/Applications"; fi
APP="$HEDEF/İçerik Fabrikası.app"
# Eski konumdaki kopya kalmasın (iki simge olmasın)
if [ "$HEDEF" = "/Applications" ] && [ -d "$HOME/Applications/İçerik Fabrikası.app" ]; then rm -rf "$HOME/Applications/İçerik Fabrikası.app"; fi

mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>İçerik Fabrikası</string>
  <key>CFBundleDisplayName</key><string>İçerik Fabrikası</string>
  <key>CFBundleIdentifier</key><string>com.icerikfabrikasi.baslatici</string>
  <key>CFBundleVersion</key><string>1.0</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleExecutable</key><string>baslat</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
PLIST

# Sunucu hizmeti (launchd): uygulama başlatıcısı kapanınca macOS onu da kapatıyordu; hizmet olarak bağımsız çalışır.
# Girişte kendiliğinden başlamaz (RunAtLoad yok); uygulama simgesi başlatır, ⏻ ile durur.
LABEL="com.icerikfabrikasi.sunucu"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
xml() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }
KOMUT='export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:/usr/bin:/bin:$PATH"; [ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1; echo "--- $(date) hizmet başlatılıyor"; exec ./node_modules/.bin/tsx src/server/index.ts'
cat > "$AGENT" <<AGENTPLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>-c</string><string>$(xml "$KOMUT")</string></array>
  <key>WorkingDirectory</key><string>$(xml "$REPO")</string>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/IcerikFabrikasi.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/IcerikFabrikasi.log</string>
  <key>ProcessType</key><string>Interactive</string>
</dict>
</plist>
AGENTPLIST

# Başlatıcı: REPO yolu pakete yazılır (klasör taşınırsa betiği yeniden çalıştırın)
cat > "$APP/Contents/MacOS/baslat" <<LAUNCH
#!/bin/bash
REPO="$REPO"
LAUNCH
cat >> "$APP/Contents/MacOS/baslat" <<'LAUNCH'
PORT="${FABRIKA_PORT:-4747}"
URL="http://localhost:$PORT"
LOG="$HOME/Library/Logs/IcerikFabrikasi.log"
mkdir -p "$HOME/Library/Logs"
# Uygulamalar Terminal'in PATH'ini görmez: Node'u bilinen yerlerde ara
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.local/bin:/usr/bin:/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
saglikli() { curl -sf -m 2 "$URL/api/health" >/dev/null 2>&1; }
uyari() { osascript -e "display alert \"İçerik Fabrikası\" message \"$1\"" >/dev/null 2>&1; }

if ! saglikli; then
  if ! command -v node >/dev/null 2>&1; then
    uyari "Node.js bulunamadı. Terminal'de bir kez çalıştırın: bash scripts/setup-mac.sh"
    exit 1
  fi
  cd "$REPO" || { uyari "Proje klasörü bulunamadı: $REPO. Klasörü taşıdıysanız: bash scripts/mac-uygulama.sh"; exit 1; }
  echo "--- $(date) başlatılıyor" >>"$LOG"
  if [ ! -f web/dist/index.html ]; then npm run build:web >>"$LOG" 2>&1; fi
  # macOS hizmeti olarak başlat (uygulamaya bağlı değil: başlatıcı kapanınca sunucu kapanmaz)
  LABEL="com.icerikfabrikasi.sunucu"
  AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"
  ALAN="gui/$(id -u)"
  log() { echo "    [başlatıcı] $*" >>"$LOG"; }
  bekle() { for _ in $(seq 1 "$1"); do saglikli && return 0; sleep 0.5; done; saglikli; }
  yuklu() { launchctl print "$ALAN/$LABEL" >/dev/null 2>&1; }
  yukle() {
    launchctl bootstrap "$ALAN" "$AGENT" >>"$LOG" 2>&1 && return 0
    log "bootstrap olmadı; load deneniyor"
    launchctl load "$AGENT" >>"$LOG" 2>&1
  }
  durum() {
    launchctl print "$ALAN/$LABEL" 2>/dev/null | grep -E '^[[:space:]]*(state|pid|last exit code|runs) =' | sed 's/^[[:space:]]*/    [hizmet] /' >>"$LOG" || true
    if command -v lsof >/dev/null 2>&1; then
      lsof -nP -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null | sed 's/^/    [port] /' >>"$LOG" || true
    fi
  }
  YEDEK=""
  if command -v launchctl >/dev/null 2>&1 && [ -f "$AGENT" ]; then
    # 1) Hizmet zaten yüklüyse yalnız (yeniden) başlat — kaldırıp hemen yüklemek macOS'ta bazen reddediliyor
    if yuklu; then
      log "hizmet yüklü; başlatılıyor"
      launchctl kickstart -k "$ALAN/$LABEL" >>"$LOG" 2>&1 || log "kickstart hata verdi ($?)"
    else
      log "hizmet yükleniyor"
      yukle || log "yüklenemedi"
      launchctl kickstart "$ALAN/$LABEL" >>"$LOG" 2>&1 || launchctl start "$LABEL" >>"$LOG" 2>&1 || log "başlatma komutu hata verdi"
    fi
    # 2) Yanıt yoksa hizmeti tamamen kaldır, kalkmasını bekle, yeniden yükle
    if ! bekle 40; then
      log "20 sn içinde yanıt yok; hizmet sıfırlanıyor"
      durum
      launchctl bootout "$ALAN/$LABEL" >>"$LOG" 2>&1 || true
      for _ in $(seq 1 20); do yuklu || break; sleep 0.5; done
      yukle || log "yeniden yüklenemedi"
      launchctl kickstart -k "$ALAN/$LABEL" >>"$LOG" 2>&1 || log "kickstart hata verdi ($?)"
      bekle 60 || { log "hizmet yine yanıt vermedi"; durum; }
    fi
  fi
  # 3) Son çare: doğrudan başlat; başlatıcı açık kalır ki macOS sunucuyu kapatmasın
  if ! saglikli; then
    log "doğrudan başlatılıyor (yedek yol)"
    nohup ./node_modules/.bin/tsx src/server/index.ts >>"$LOG" 2>&1 < /dev/null &
    YEDEK=$!
    bekle 120 || true
  fi
  if ! saglikli; then
    durum
    uyari "Başlatılamadı. Ayrıntı: ~/Library/Logs/IcerikFabrikasi.log"
    exit 1
  fi
fi

# Ayrı uygulama penceresi (adres çubuğu, sekme yok)
for B in "Google Chrome" "Microsoft Edge" "Brave Browser" "Chromium" "Arc"; do
  if [ -d "/Applications/$B.app" ] || [ -d "$HOME/Applications/$B.app" ]; then
    open -na "$B" --args --app="$URL" --window-size=1512,945
    B_ACILDI=1
    break
  fi
done
[ -z "${B_ACILDI:-}" ] && open "$URL"
# Yedek yolla başlatıldıysa başlatıcı sunucu kapanana kadar açık kalır (kapanırsa macOS sunucuyu da kapatır)
if [ -n "${YEDEK:-}" ]; then wait "$YEDEK"; fi
LAUNCH
chmod +x "$APP/Contents/MacOS/baslat"

# Simge (yalnız Mac araçlarıyla: sips + iconutil)
IKON="$REPO/assets/uygulama-ikon.png"
if command -v sips >/dev/null 2>&1 && command -v iconutil >/dev/null 2>&1 && [ -f "$IKON" ]; then
  SET="$(mktemp -d)/AppIcon.iconset"
  mkdir -p "$SET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$IKON" --out "$SET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s * 2)) $((s * 2)) "$IKON" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns"
  touch "$APP"
fi

# macOS'a tanıt: Launchpad ve Spotlight hemen görsün
LSREG="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
[ -x "$LSREG" ] && "$LSREG" -f "$APP" >/dev/null 2>&1 || true
command -v mdimport >/dev/null 2>&1 && mdimport "$APP" >/dev/null 2>&1 || true

echo "✓ Hazır: $APP"
echo "  Launchpad'den, Spotlight'tan (⌘ Boşluk → “İçerik”) veya Finder → Uygulamalar'dan açın."
echo "  Dock'ta tutmak için: açıkken Dock'taki simgeye sağ tık → Seçenekler → Dock'ta Tut."
