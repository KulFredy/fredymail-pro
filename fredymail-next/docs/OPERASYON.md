# Operasyon

Tüm komutlar `fredymail-next/` dizininde çalıştırılır. VPS'te `docker-compose.vps.yml` kullanılıyorsa
`docker compose` yerine `docker compose -f docker-compose.yml -f docker-compose.vps.yml` yazın
(kısaltma için: `alias fmc='docker compose -f docker-compose.yml -f docker-compose.vps.yml'`).

## Sağlık ve izleme

| Uç / komut | Ne gösterir | Erişim |
|---|---|---|
| `GET /api/health` | Süreç ayakta mı | anonim |
| `GET /api/health/ready` | Veritabanı ve arama motoru erişilebilir mi (ayrıntısız) | anonim |
| `GET /api/sync/status` | Worker kalp atışı, son senkronlar, klasör hataları, indeks kuyruğu | oturum |
| `GET /api/metrics` | Prometheus metni: mail sayısı, indeks kuyruğu, hatalı klasör, worker yaşı, günlük AI maliyeti, arama durumu | oturum veya sunucunun kendisi (127.0.0.1) |
| `docker compose ps` | Konteyner sağlık durumları (api, worker, postgres, meilisearch) | sunucu |
| `docker compose logs -f worker` | JSON loglar: yalnızca kimlik ve sayılar; mail içeriği veya sır yok | sunucu |

Arayüzde **Ayarlar → Senkron** sayfası aynı bilgileri gösterir. Worker 10 dakikadan uzun süre sessiz kalırsa uyarı şeridi çıkar.

**Uyarılar (opsiyonel):** `FM_ALERT_TELEGRAM_BOT_TOKEN` ve `FM_ALERT_TELEGRAM_CHAT_ID` ayarlanırsa IMAP kimlik hatası ya da
art arda 3 kez senkronu başarısız olan klasör olduğunda saatte en fazla 1 mesaj gönderilir. Mesajda mail içeriği yer almaz.

## Yedekleme

```bash
./scripts/backup.sh                 # ./backups/fredymail-<zaman>.dump (+ .sha256), son 14 yedek tutulur
FM_BACKUP_GPG_RECIPIENT=fatih@... ./scripts/backup.sh   # şifreli (sunucu dışına kopyalanacaksa)
```

Önerilen cron (her gece 03:15):
```
15 3 * * * cd /opt/fredymail/fredymail-pro/fredymail-next && ./scripts/backup.sh >> backups/backup.log 2>&1
```
Yedekte etiket, not, erteleme, taslak, AI kayıtları ve senkron kontrol noktaları dahil her şey bulunur.
Meilisearch yedeklenmez çünkü Postgres'ten yeniden üretilir.

## Geri yükleme (ve prova)

```bash
./scripts/restore.sh backups/fredymail-20261026T031500Z.dump --yes
```
Adımlar: api ve worker durdurulur → DB silinip yedekten kurulur → migration kontrol edilir → **arama indeksi Postgres'ten yeniden
üretilir** → servisler başlatılır. Posta sunucusuna dokunulmaz. Geri yüklenen kontrol noktaları sayesinde senkron kaldığı yerden devam eder;
yedekten sonra gelen mailler bir sonraki döngüde alınır.

**Prova (ayda bir önerilir):** Yedek al → bir etiket ekle → geri yükle → etiketin kaybolduğunu, mail sayısının aynı kaldığını
ve aramanın çalıştığını doğrula. Bu oturumda yapılan provanın sonucu README'deki test raporunda.

## Arama indeksini yeniden üretme

```bash
docker compose run --rm --no-deps worker fredymail reindex --yes
```
Yalnızca FredyMail'in `fm_messages` indeksini siler ve kurar (eski `emails` indeksine dokunmaz). Bu sırada arama Postgres
yedek aramasıyla çalışmaya devam eder.

## Veri saklama ve silme

- Sunucudan silinen/taşınan mailler: konum kaldırılır. Hiç konumu kalmayan mail aramadan çıkar.
  Kalıcı temizlik: `docker compose run --rm --no-deps worker fredymail purge-deleted --days 30 --yes`
- Senkron kapsamı: `FM_SYNC_SINCE`, `FM_SYNC_MAX_MESSAGES_PER_FOLDER`. Kapsamı daraltmak eski kayıtları silmez.
- Tamamen kaldırma: `docker compose --profile tunnel down -v` (yalnızca `fredymail_*` volume'ları silinir) + `.env` ve `backups/` silinir.

## Güncelleme

```bash
git pull
docker compose build
docker compose up -d          # migrate servisi şema değişikliklerini otomatik uygular
```
Geri dönüş: `git checkout <önceki commit> && docker compose build && docker compose up -d`. Şema geri alınması gerekirse
önce yedekten geri yükleyin (migration'lar ileri yönlü test edilir).

## Sorun giderme

| Belirti | Olası neden | Çözüm |
|---|---|---|
| Arayüzde "Arama motoru erişilemiyor" şeridi | Meilisearch kapalı | `docker compose ps meilisearch`, `logs meilisearch`. Arama bu sırada basit modda çalışır. |
| Senkron "kimlik doğrulaması başarısız" | Parola değişti / uygulama parolası gerekli | `.env` → `FM_IMAP_PASSWORD`, sonra `docker compose up -d worker`. Kilitlenmeyi önlemek için 30 dk beklenir. |
| Bir klasör sürekli `error` | Sunucu tarafı sorun / izin | Ayarlar → Senkron'da hata metni. Klasörü kapatıp açmak devre kesiciyi sıfırlar. |
| Worker sağlıksız | DB bağlantısı / çökme | `docker compose logs --tail 100 worker` |
| AI 409 "bütçe doldu" | Günlük sınır | Ertesi gün sıfırlanır veya `FM_AI_DAILY_BUDGET_USD` artırılır |
| Ayarlar'da "ayrıştırılamayan mail" kayıtları | Kayıt sırasında hata (ör. düzeltilmiş bir hata) | Güncellemeden sonra `docker compose run --rm --no-deps worker fredymail retry-failed --yes` |
| Port çakışması | 8088 kullanımda | `.env` → `FM_HTTP_PORT=8090` |
