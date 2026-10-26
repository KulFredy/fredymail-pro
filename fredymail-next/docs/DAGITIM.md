# Dağıtım planı: Hostinger VPS (onay gerektiren adımlar işaretli)

Bu plan **mevcut hiçbir servise dokunmaz**: FredyMail Next ayrı bir dizinde (`/opt/fredymail`), ayrı bir compose projesi
(`fredymail`) olarak çalışır ve kendi volume'larını kullanır. Eski proje dizini
(`/data/.openclaw/workspace/projects/fredymail-pro/`), `meilisearch-fredy` ve OpenClaw olduğu gibi kalır.

> 🔒 = sunucuda kalıcı değişiklik veya dışa açma. **Senin onayınla** yapılır.
> 👀 = salt okunur kontrol.

## Adım 0 — Ön kontrol 👀

```bash
docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'
ss -ltnp | grep -E ':(8088|7700|5432)\b' || echo "port 8088 boş"
docker network ls | grep ai-shared
free -m; df -h /
docker logs --tail 20 meilisearch-fredy 2>&1 | tail -5     # crash-loop hâlâ sürüyor mu?
```
Bu çıktıları paylaş (sır içermez). 8088 doluysa `FM_HTTP_PORT` başka bir değere ayarlanacak.

## Adım 1 — Kurulum, demo modunda 🔒 (yeni dizin + yeni konteynerler, yalnızca 127.0.0.1)

```bash
sudo mkdir -p /opt/fredymail && sudo chown "$USER" /opt/fredymail && cd /opt/fredymail
git clone https://github.com/KulFredy/fredymail-pro.git && cd fredymail-pro/fredymail-next
git checkout claude/amazing-davinci-znjlal
./scripts/demo-up.sh        # .env'i rastgele sırlarla oluşturur, demo verisiyle başlatır
```
Kendi bilgisayarından denemek için (dışa açmadan): `ssh -L 8088:127.0.0.1:8088 <vps>` → tarayıcıda `http://localhost:8088`.

**Geri dönüş:** `docker compose down -v && rm -rf /opt/fredymail` (yalnızca FredyMail Next silinir).

## Adım 2 — Posta sağlayıcısının keşfi 👀 (giriş yapılmaz)

```bash
docker compose run --rm --no-deps worker fredymail discover <iş-e-posta-adresin> \
  --host <webmail-sunucusunun-adı>
```
Araç; MX, SRV (`_imaps._tcp`), autoconfig ve ISPDB kayıtlarını okur, her aday sunucuya **giriş yapmadan** bağlanır ve
TLS sertifikasını, IMAP sunucu yazılımını (beklenen: IceWarp) ve desteklenen kimlik yöntemlerini raporlar.
Sunucu adresi bu çıktıya göre seçilir, tahmin edilmez. Çıktıyı paylaş.

## Adım 3 — Hesap bilgileri ve ilk senkron kapsamı 🔒 + 👀

1. Hesap bilgileri (keşif sonucu: `cmail16.webkontrol.doruk.net.tr:993`, SSL, IceWarp, parola ile giriş).
   Parola `.env`'e değil, yalnızca uygulama kullanıcısının okuyabildiği bir dosyaya yazılır:
   ```bash
   mkdir -p secrets && chmod 700 secrets
   read -rsp "IMAP parolası: " P; echo          # yazarken görünmez, geçmişe kaydedilmez
   printf '%s' "$P" > secrets/imap_password; unset P
   chown 10001:10001 secrets/imap_password && chmod 400 secrets/imap_password
   sed -i 's/^FM_IMAP_HOST=.*/FM_IMAP_HOST=cmail16.webkontrol.doruk.net.tr/; s/^FM_IMAP_PORT=.*/FM_IMAP_PORT=993/; s/^FM_IMAP_SECURITY=.*/FM_IMAP_SECURITY=ssl/; s/^FM_IMAP_USERNAME=.*/FM_IMAP_USERNAME=<iş-e-posta-adresin>/' .env
   ```
   Mümkünse IceWarp'ta FredyMail'e özel bir **uygulama parolası** oluştur. `FM_SYNC_ENABLED=false` kalır.
2. Kapsam raporu (salt okunur; klasörleri listeler ve sayar, mail indirmez):
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.vps.yml run --rm --no-deps worker fredymail sync-plan
   ```
   Çıktıda her klasör için ✔/✘, toplam ve kapsamdaki mail sayısı görünür. Varsayılan kapsam: son 365 gün, klasör başına en fazla
   5.000 mail. Hariç tutulanlar: Trash, Spam, Junk, Deleted Messages, Karantina, Drafts.
3. **Onayın** gelince (gerekirse `FM_SYNC_SINCE` ve klasör listesi ayarlanır):
   ```bash
   docker compose down -v                    # 🔒 yalnızca DEMO verisini siler (fredymail_* volume'ları)
   sed -i 's/^FM_SYNC_ENABLED=.*/FM_SYNC_ENABLED=true/' .env
   docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d
   docker compose logs -f worker             # ilerleme: klasör, adet; mail içeriği loglanmaz
   ```
   Senkron sunucuda hiçbir değişiklik yapmaz (EXAMINE + BODY.PEEK). Kesilirse kaldığı yerden devam eder.

**Geri dönüş:** `FM_SYNC_ENABLED=false` + `docker compose up -d worker`. Veriyi tamamen silmek için `down -v`.

## Adım 4 — Outlook'taki güncel klasör yapısını içe aktarma (opsiyonel) 🔒

Outlook kuralları istemci tarafında çalışıyorsa, Outlook'taki klasör düzeni sunucudakinden daha günceldir. Bu düzeni aktarmak için:
1. Mac Outlook'ta bir klasördeki tüm mailleri seç (⌘A) ve Finder'da aynı adlı bir klasöre sürükle. Her mail bir `.eml` dosyası olur.
   Klasör ağacını koru, örneğin `Outlook-Export/Faturalar/*.eml`, `Outlook-Export/Fiyat Listeleri/*.eml`.
   (Windows Outlook: `.pst` dışa aktar → `readpst -e -o Outlook-Export dosya.pst`.)
2. VPS'e kopyala: `scp -r Outlook-Export <vps>:/opt/fredymail/fredymail-pro/fredymail-next/imports/`
3. İçe aktar:
   ```bash
   docker compose run --rm --no-deps worker fredymail import-eml /data/imports/Outlook-Export --prefix Outlook
   ```
   Sunucuda zaten bulunan mailler Message-ID ile eşleşir; kopya oluşmaz, yalnızca `Outlook/Faturalar` gibi ek bir konum eklenir.

## Adım 5 — AI bağlantısı (LiteLLM) 🔒

`.env`: `FM_AI_PROVIDER=openai_compatible`, `FM_AI_BASE_URL=http://litellm-litellm-1:4000/v1`, `FM_AI_MODEL=flash-lite`
(veya litellm `config.yaml`'daki başka bir model adı), `FM_AI_API_KEY=<LiteLLM anahtarı, varsa>`. Sonra
`docker compose -f docker-compose.yml -f docker-compose.vps.yml up -d api`.
LiteLLM yapılandırmasına dokunulmaz; mevcut modeller kullanılır.

**Geri dönüş:** `FM_AI_PROVIDER=none`.

## Adım 6 — Dışa açma 🔒 (DNS değişikliği)

İki seçenek var (ön kontrolde Tunnel'ın çalışmadığı, Hostinger Traefik'inin çalıştığı görüldü):
- **6A — Cloudflare Tunnel + Cloudflare Access (önerilen):** Alan adı Cloudflare'deyse. VPS'te port açılmaz, giriş ekranından
  önce Cloudflare'in e-posta doğrulaması ikinci kapı olur.
- **6B — Mevcut Traefik:** Ek bileşen yok, Let's Encrypt sertifikası Traefik'ten gelir. Koruma yalnızca FredyMail girişi + TOTP olur.

### 6A — Cloudflare Tunnel

Önerilen yeni alt alan adı örneği: `mail.<senin-alan-adın>`. `fredymailsearchonline.com` şu an çözümlenmiyor; tekrar kullanılacaksa
önce alan adının durumu kontrol edilmeli.
1. Cloudflare Zero Trust → Networks → Tunnels → **Create tunnel** (cloudflared) → token'ı kopyala.
2. Public hostname: `mail.<alan-adı>` → Service: `http://api:8080`.
3. **Access → Applications → Self-hosted**: aynı hostname, politika = yalnızca senin e-posta adresin (One-time PIN). Bu, FredyMail
   girişinden önce ikinci bir kapı oluşturur.
4. `.env`: `FM_CLOUDFLARE_TUNNEL_TOKEN=...`, `FM_COOKIE_SECURE=true`, `FM_TRUST_PROXY=cloudflare`, `FM_TOTP_SECRET=...`
   (`docker compose run --rm --no-deps api fredymail totp-setup`).
5. `docker compose -f docker-compose.yml -f docker-compose.vps.yml --profile tunnel up -d`

Mac, Windows PC ve telefondan aynı adresle erişirsin; cihazlara kurulum gerekmez.

**Geri dönüş:** `docker compose ... --profile tunnel stop cloudflared` + Cloudflare'de public hostname'i sil (DNS kaydı kalkar).
Veriler etkilenmez.

## Adım 7 — Yedekleme cron'u ve prova 🔒

[OPERASYON.md](OPERASYON.md) → Yedekleme. İlk gece yedeğinden sonra bir geri yükleme provası yap.

## Adım 8 — (Opsiyonel, ayrı onay) Eski sistemin temizliği 🔒

- `meilisearch-fredy` crash-loop'ta. Başka bir servisin onu kullanmadığı doğrulanırsa `docker stop meilisearch-fredy &&
  docker update --restart=no meilisearch-fredy`. Silinmez, dilediğin zaman geri açılabilir.
- Eski proje dizini arşiv olarak kalır.
