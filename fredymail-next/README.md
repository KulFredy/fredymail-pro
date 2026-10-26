# FredyMail Next

İş e-postası için **akıllı posta çalışma masası**. IMAP hesabındaki mailleri **yalnızca okuyarak** artımlı çeker,
saniyeler içinde aranabilir hale getirir (müşteri/tedarikçi yazışmaları, faturalar, fiyat listeleri, ekler, cevapsız yazışmalar).
Kaynak göstererek özetler, yapılacakları çıkarır ve **yalnızca taslak** yanıt hazırlar. Etiket, not, okundu, önemli ve erteleme gibi
kişisel iş akışlarını destekler. Tarayıcıdan (Mac, Windows, telefon) erişilen bir web uygulamasıdır; Outlook gönderim istemcisi olarak kalır.

> ⚠️ Bu GitHub reposu şu an **herkese açık (public)**. Kodda sır yok, ama repoyu private yapmanı öneririm.

## Tek komutla demo

Gereksinim: Docker + Docker Compose v2.

```bash
cd fredymail-next
./scripts/demo-up.sh
```
Betik `.env` dosyasını rastgele sırlarla oluşturur, sentetik demo mailleriyle (hayali firmalar) başlatır ve giriş bilgisini
yazdırır. Arayüz yalnızca `http://127.0.0.1:8088` adresinden açılır; dışarıya kapalıdır.

## Neler var?

- **Güvenilir, salt okunur senkron:** `EXAMINE` + `BODY.PEEK`. Sunucuda hiçbir bayrak, klasör veya kural değişmez (testle kanıtlı).
  UID/UIDVALIDITY tabanlı artımlı çekim, kaldığı yerden devam, sınırlı yeniden deneme, devre kesici, rate limit.
  Klasör/tarih/adet kapsamı ayarlanabilir. 2 MB üzeri maillerde yalnızca metin parçaları indirilir.
- **Tekilleştirme:** Aynı mail birden fazla klasörde (INBOX + Faturalar) ya da hem sunucuda hem Outlook arşivinde olsa bile tek kayıttır.
- **Outlook içe aktarma:** `.eml` klasör ağacı veya mbox. Outlook'taki güncel kurallı klasör yapısı korunur.
- **Arama:** Türkçe/İngilizce (İ/ı doğru), eş anlamlılar (fatura↔invoice, fiyat listesi↔price list), yazım toleransı, vurgulama.
  Filtreler: gönderen, alıcı, tarih, klasör, ek var/yok, dosya türü, belge türü (fatura/proforma/fiyat listesi/teklif/sipariş/ekstre/
  sözleşme/sevkiyat), etiket, okunmamış, önemli. Ek içinde arama opsiyonel (PDF/XLSX/CSV). Meilisearch kapalıyken Postgres yedek araması devreye girer.
- **Akıllı klasörler:** Kurallar çalışmasa bile "Faturalar", "Fiyat listeleri" vb. görünümler otomatik dolar. Kendi kayıtlı aramalarını da ekleyebilirsin.
- **İş akışı:** Etiket, not, okundu/okunmadı, önemli, erteleme. "Yanıtlamam gerekenler" ve "Yanıt bekliyorum" görünümleri.
- **AI asistanı:** Mail, yazışma ve arama sonucu özeti, yapılacaklar, yanıt taslağı. Her madde kaynak maile bağlıdır, uydurma atıflar silinir.
  Prompt-injection savunmaları, günlük bütçe, önbellek ve maliyet/gizlilik görünürlüğü var. AI kapalıyken her şey çalışır.
- **Güvenlik:** Tek kullanıcı girişi (argon2 + opsiyonel TOTP), kaba kuvvet kilidi, CSRF koruması, sıkı CSP, sandbox'lı mail HTML'i,
  uzak görseller varsayılan kapalı, ekler yalnızca indirilir, root olmayan salt okunur konteynerler, iç ağdaki veritabanı/arama.
- **Gönderme yok:** MVP'de SMTP kodu bulunmuyor. Taslak kopyalanıp Outlook'tan gönderilir.

## Dizinler

```
fredymail-next/
├── backend/            FastAPI + worker + CLI (Python 3.12)
│   ├── fredymail/      mail/ (kaynak, ayrıştırma, senkron, thread, keşif) · search/ · ai/ · api/ · security/
│   ├── migrations/     Alembic
│   └── tests/          gerçek Postgres + Meilisearch + IMAP (Dovecot) testleri
├── frontend/           Vite + React + TypeScript arayüz
├── docs/               keşif, mimari, güvenlik, AI gizlilik, operasyon, dağıtım
├── scripts/            demo-up, backup, restore, test
├── docker-compose.yml  varsayılan (dışa kapalı)
└── docker-compose.vps.yml  VPS: ai-shared (LiteLLM) + opsiyonel Cloudflare Tunnel
```

## Komutlar (`docker compose run --rm --no-deps worker fredymail <komut>`)

| Komut | Ne yapar |
|---|---|
| `discover <adres> [--host H]` | Posta sağlayıcısını ve güvenli IMAP ayarlarını tespit eder (**giriş yapmaz**) |
| `sync-plan` | Canlı hesapta ilk senkron kapsamını gösterir (salt okunur, mail indirmez) |
| `sync-once [--folder X] [--yes-live]` | Tek senkron döngüsü |
| `import-eml <dizin> [--prefix Outlook]` · `import-mbox <dosya> --folder X` | Outlook arşivini içe aktarır |
| `reindex --yes` | Arama indeksini Postgres'ten yeniden üretir |
| `purge-deleted --days 30 --yes` | Sunucudan silinmiş mailleri kalıcı temizler |
| `hash-password` · `totp-setup` · `gen-secret` | Giriş ayarları |

## Belgeler

- [Faz 0 keşif raporu](docs/FAZ0-KESIF.md): mevcut durum, korunan ve değişen işlevler, riskler, maliyet
- [Mimari](docs/MIMARI.md): bileşenler, veri akışı, senkron algoritması, saklama politikası, teknoloji kararları
- [Güvenlik](docs/GUVENLIK.md) · [AI gizlilik ve maliyet](docs/AI-GIZLILIK.md)
- [Operasyon](docs/OPERASYON.md): izleme, yedek/geri yükleme, yeniden indeksleme, saklama, sorun giderme
- [Dağıtım planı](docs/DAGITIM.md): VPS'e adım adım kurulum, onay noktaları ve her adım için geri dönüş planı

## Test

```bash
./scripts/test.sh          # ruff + migration tutarlılığı + pytest (Docker ile Postgres/Meilisearch başlatır)
```
IMAP protokol testleri için yerel bir test sunucusu (Dovecot/GreenMail) `FM_TEST_IMAP_HOST/PORT` ile verilir; yoksa bu testler atlanır.
