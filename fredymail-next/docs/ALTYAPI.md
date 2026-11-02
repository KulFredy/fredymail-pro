# Altyapı notu (Zoom İthalat · FredyMail · Hero) — 2.11.2026

Gelecekteki projeler için mevcut altyapının özeti. **Repo herkese açık:** şifre, anahtar, IP, dosya kimliği ve kişisel
e-posta buraya yazılmaz; nerede durdukları yazılır.

## Sunucu (Hostinger VPS)

- KVM 2, Frankfurt, Ubuntu 24.04. ~8 GB RAM (kullanım %75–83 civarı; yeni konteyner eklemeden önce düşün), 100 GB disk
  (~%45 dolu), haftalık Hostinger yedeği. Erişim: hPanel web terminali veya SSH (root).
- Çalışan konteynerler:
  - **FredyMail Next** (`fredymail-*`): `api`, `worker`, `postgres` (16), `meilisearch` (1.15), `cloudflared` (tünel),
    `migrate` (tek seferlik).
  - **LiteLLM** (`litellm-litellm-1`): AI proxy, `ai-shared` Docker ağı. FredyMail AI çağrıları buradan geçer.
  - **OpenClaw** (`openclaw-hi03-openclaw-1`): "Fredy" Telegram botu.
  - **apex-q** (bot, frontend, postgres, redis), **traefik**, **docker-proxy**: ayrı projeler, FredyMail'den bağımsız.
- FredyMail kodu: `/opt/fredymail/fredymail-pro` (git; şu an `claude/practical-gates-x34281` dalı).
  Komut kalıbı (`fredymail-next/` içinde):
  ```bash
  DC="docker compose -f docker-compose.yml -f docker-compose.vps.yml"
  $DC build && $DC --profile tunnel up -d          # güncelleme (migrate şemayı kendisi uygular)
  $DC run --rm worker fredymail <komut>            # CLI
  ```
- Sırlar VPS'te: `fredymail-next/secrets/` (IMAP parolası, AI anahtarı, `google_sa.json`; uid 10001, chmod 400) ve
  `fredymail-next/.env` (dosya kimlikleri, ayarlar).

## FredyMail Next (bkz. MIMARI.md, AI-GIZLILIK.md, DAGITIM.md)

- İş e-postası (Doruk.net / IceWarp IMAP) salt okunur senkron; Postgres + Meilisearch arama; etiket/not/erteleme,
  "yanıt bekliyorum" görünümleri; mail gönderimi yok (taslak üretir, Outlook'tan gönderilir).
- AI yalnızca kullanıcı düğmeye basınca çalışır (worker/zamanlayıcıda AI yok). LiteLLM → OpenRouter, hafif model
  `flash-lite`, günlük bütçe 1 $, önbellek, kaynak doğrulaması.
- Dışarıdan erişim Cloudflare Tunnel ile (alan adı Cloudflare panelinde / `.env`'de).

## Hero modülü (bkz. HERO-PLAN.md)

- Aylık Hero Ürünler Listesi'ni hazırlar ve Google Sheets'e yazar; AI kullanmaz.
- Worker ayın 15'i ve 25'i (08:00 sonrası) Yoldaki Mallar'ı okur ve mağaza site haritasını kontrol eder; 25'inde
  Telegram hatırlatması (FM_ALERT_TELEGRAM_* tanımlıysa).
- Ayın başında: `hero-preview --month YYYY-AA` → onay → `hero-write --yes`.
- Tablo: canlı sekme kimliğiyle (`#gid=0`) bulunur, adı her ay o ayın adı olur ("Kasım 2026"); önceki ay arşiv
  sekmesine kopyalanır. Renkler: kırmızı ilk kez giren, kahverengi devam eden + bu ay stoğa girecek, mavi devreden.
  3 ay kuralı, marka başına 8 ürün, sığmayanlar sayfa altında bilgi notu.
- Postgres tabloları: `hero_items` (yoldaki geçmişi, mağaza eşleşmesi), `kv` (`hero_sync`, `hero_site`, `hero_plan`).

## Google

- GCP projesi `zoom-hero-products` (Zoom reklam Google hesabı altında). Servis hesabı aynı adla; yetki kapsamı Drive
  salt okunur + Sheets. Anahtar yalnızca VPS'te (`secrets/google_sa.json`); eski sızan anahtar silindi.
- Servis hesabıyla paylaşılan dosyalar: Hero Ürünler Listesi (Düzenleyen), Yoldaki Mallar (sahibi Sinan Bey).
- Bu Claude oturumlarındaki Google Drive bağlantısı kullanıcının kişisel hesabına bağlı (Hero tablosunun sahibi).

## Veri kaynakları

| Kaynak | Nerede / biçim | Not |
|---|---|---|
| Hero Ürünler Listesi | Google Sheets | Tasarımcıya link ile gider ("bağlantıya sahip herkes görüntüler") |
| Yoldaki Mallar | Drive'da `.xlsx`, marka başına sekme | Sahibi Sinan Bey; durum yazıları: TAHMİNİ VARIŞ gg.aa.yyyy, KASIM SONU, GÜMRÜKTE, PAKETLENDİ… |
| Marketing Asset Links | `.xlsx` (13.08.2026) | Marka → web sitesi / marketing klasörü linkleri. **Düz metin şifreler içerir: kodda, AI'da, repoda kullanılmaz** |
| Mağaza | `shop.zoomithalat.com` (IdeaSoft) | `/sitemap.xml` → `/xml/sitemap_product_N.xml` (5 dosya, ~2020 ürün) → `/urun/<ad>-<no>`; robots.txt `Crawl-delay: 30` |
| Kurumsal site | `zoomithalat.com` | WordPress + Rank Math (ürün listesi yok) |
| Marka dosyaları | Drive (marka paylaşımları) | Ör. Zhiyun Marketing Media Kit, ZOOM ITHALAT&ZHIYUN Marketing Plan |
| E-posta arşivi | FredyMail (Postgres) | 14.000+ mail; marka/tedarikçi yazışmaları, proforma, fiyat listeleri |

## Kullanıcının yerel otomasyonu (Mac)

- `~/Desktop/Site Kontrol/`: `yoldaki_kontrol.py`, `site_ürün_kontrol_.xlsx`, `Kontrolü Başlat.command`, `Raporlar/`.
  Yoldaki Mallar'daki ürünlerden mağazada sayfası açılmamış olanları tarar. Hero modülünün mağaza kontrolüyle benzer
  iş yapar; ikisi birleştirilebilir.

## Çalışma şekli (Claude)

- **Bulut Claude Code oturumu:** kodu yazar, test eder, GitHub'a iter. Ağ politikası gereği mağazaya ve VPS'e erişemez
  (Google API'leri ve GitHub açık). Mağaza erişimini başka servislerle (ör. Apify) dolanmaz.
- **Chrome'daki Claude (Mac):** hPanel web terminalinde komut çalıştırır, Google Sheets/Drive'da işlem yapar. Mac
  Terminal'ine erişimi yok. Akış: bulut oturumu komutu/metni hazırlar → kullanıcı Chrome'daki Claude'a verir → çıktı
  bulut oturumuna geri getirilir.
- Bağlı servisler (bulut oturumu): Google Drive, Apify (ücretsiz plan), GitHub (`KulFredy/fredymail-pro`, herkese açık).

## Açık işler / dikkat

- Marketing Asset tablosundaki şifreler bir parola yöneticisine taşınmalı.
- Hero tablosu "bağlantıya sahip herkes görüntüleyebilir" ayarında.
- `claude/practical-gates-x34281` dalı ana dala birleştirilmedi; VPS bu daldan çalışıyor.
- Mağaza eşleştirmesinin bilinen zayıflığı: mağazada kodu geçmeyen model adları (ör. MKONEVA-500X) benzer bir ilana
  bağlanabiliyor. Önizlemede gözle kontrol edilir.
- Telegram uyarı ayarlarının (FM_ALERT_TELEGRAM_*) VPS'te tanımlı olup olmadığı doğrulanmadı.

## Gelecek fikirleri (2.11.2026, henüz başlanmadı)

| Fikir | Özet | Ek kaynak |
|---|---|---|
| Lansman makinesi | Yeni ürün tespit edilince ürün sayfası taslağı (Türkçe açıklama, özellikler, SEO), marketing görselleri, bayi duyurusu, sosyal medya metni | Üretici sitesi/PDF'ler (AI) |
| Bayi ön sipariş portalı | Yoldaki malları bayilere açıp gelmeden rezervasyon/ön sipariş; kıt ürün dağıtımı | Bayi listesi |
| Kanal ve fiyat denetimi | Pazaryeri/bayi fiyatları, liste fiyatı altı satış, paralel ithalat tespiti | Pazaryeri tarama (kullanım koşullarına dikkat) |
| Tedarikçi karnesi + sipariş asistanı | Yoldaki geçmişinden marka bazında teslim süresi ve söz-gerçek farkı; satışla birleşince sipariş önerisi | IdeaSoft API / ERP |
| Markalara otomatik aylık rapor | Stok, yoldakiler, Hero yerleşimleri, kampanyalar; MDF/co-op fon takibi | Sosyal medya, kampanya verisi |
| Fredy şirket hafızası | Mail + Drive + yoldaki + mağaza üzerinde kaynaklı soru-cevap (Telegram'daki Fredy botu) | — |
| Küçük eklentiler | Tasarımcı brifi taslağı (marketing klasör linkleriyle), yoldaki gecikme uyarısı, "geldi, satışa hazır mı" kontrolü, kampanya çıkarımı (FredyMail, AI düğmeyle) | — |
