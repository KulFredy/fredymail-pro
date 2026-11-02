# Aylık Hero Ürünler Listesi otomasyonu

Her ayın başında sosyal medya tasarımcısına gönderilen "Zoom Aylık Hero Ürünler Listesi" (Google Sheets,
`Sayfa1`, link sabit) bugüne kadar elle güncelleniyordu. Bu modül listeyi hazırlar; son kararı kullanıcı verir.

## Kaynaklar

| Kaynak | Ne verir | AI? |
|---|---|---|
| **Yoldaki Mallar** (Drive'da `.xlsx`, marka başına sekme) | Yeni ürünler ve ay içinde stoğa girecekler | Hayır, kural tabanlı |
| **FredyMail mailleri** | Kampanyalar ve marka lansman duyuruları | Evet, yalnızca kullanıcı düğmeye basınca |
| **Geçen ayın Hero listesi** | Devreden ürünler | Hayır |
| **zoomithalat.com** | Ürün linkleri, "sitede var mı" kontrolü | Hayır |
| **Marketing asset tablosu** | Marka başına marketing klasörü linki (tasarımcı için) | Hayır |

AI kuralı (`AI-GIZLILIK.md`) değişmez: worker'da ve zamanlayıcıda AI çağrısı yoktur.

## Seçim kuralları

- **Yeni ürün:** Ay içinde stoğa girecek **ve** şunlardan biri doğru: tabloda `YENİ ÜRÜN` notu var,
  ürün yoldaki mallar listesinde ilk kez görünüyor, ürün zoomithalat.com'da henüz yok.
  Sitede sayfası olmayan ürün de listeye girer; hücreye "🔗 link bekleniyor" yazılır.
- **Kampanya:** Tarihi ayla kesişen kampanyalar, `Marka Kampanya (gg.aa-gg.aa)` biçiminde.
- **Devreden:** Geçen ayın ürünleri; kampanyası biten düşer. Marka başına en fazla 8 ürün.

## Yoldaki Mallar durum yazıları

| Yazı | Tahmini varış |
|---|---|
| `TAHMİNİ VARIŞ 20.11.2026` | o gün |
| `KASIM İLK HAFTA` / `ORTASI` / `SONU` / (yalnız ay) | 1–7 / 10–20 / 21–ay sonu / tüm ay |
| `GÜMRÜKTE` | bugün – 14 gün |
| `PAKETLENDİ UÇUŞ BİLGİSİ BEKLENİYOR` | 10–45 gün, **belirsiz** |
| Tarihi geçmiş (`EKİM SONU`, Kasım'da) | **⚠️ durum güncel değil** uyarısı |

Aynı ürün birden çok sevkiyatta ise adetler toplanır, sevkiyatlar ayrı ayrı gösterilir, en erken varış esas alınır.
Fatura başlık satırları ve yedek parçalar atlanır. Marka; sekme adından (`KODAK SD` → Kodak), çok markalı
sekmelerde (`BT-TECH`, `VIDENDUM`) satırdaki marka hücresinden veya ürün adından bulunur (`hero/brands.py`).

Elle deneme (ağ ve veritabanı gerekmez):

```bash
docker compose run --rm --no-deps -v "$PWD/YOLDAKI.xlsx:/tmp/y.xlsx:ro" worker \
  fredymail hero-yoldaki /tmp/y.xlsx --month 2026-11
```

## Akış

1. **Her gün (worker, AI yok):** Yoldaki Mallar okunur, Postgres'e kopyası alınır, ilk kez görünen ürünler
   işaretlenir, sitedeki linkler kontrol edilir.
2. **Ayın 25'i:** Telegram hatırlatması.
3. **"Hero Planı" ekranı:** geçen ayın listesi + yoldan gelen adaylar + "Kampanyaları maillerden çıkar" düğmesi
   (AI; kaynak mail çipleriyle). Kullanıcı seçer.
4. **"Sheets'e yaz":** mevcut liste `Ekim 2026` gibi bir arşiv sekmesine kopyalanır, `Sayfa1` güncellenir.
5. **Tasarımcı maili:** FredyMail taslak hazırlar; gönderim Outlook'tan.

## Durum

- [x] Yoldaki Mallar okuyucusu (`fredymail/hero/yoldaki.py`) + `hero-yoldaki` komutu + testler
- [ ] Google servis hesabı ile Drive'dan okuma ve Sheets'e yazma
- [ ] Günlük kopya ve "ilk kez görünen" tespiti (Postgres)
- [ ] zoomithalat.com link eşleştirme
- [ ] Kampanya çıkarımı (AI, düğmeyle)
- [ ] Hero Planı ekranı ve tasarımcı taslağı

## Google servis hesabı kurulumu

1. https://console.cloud.google.com → yeni proje (ör. `fredymail-hero`).
2. **APIs & Services → Library:** `Google Sheets API` ve `Google Drive API`'yi etkinleştir.
3. **IAM & Admin → Service Accounts → Create service account:** ad `fredymail-hero`, rol verme, bitir.
4. Servis hesabı → **Keys → Add key → Create new key → JSON**. Dosya bilgisayara iner.
5. Servis hesabının e-posta adresiyle (`fredymail-hero@<proje>.iam.gserviceaccount.com`) paylaş:
   - Hero Ürünler Listesi → **Düzenleyici**
   - YOLDAKİ_MALLAR_GENEL.xlsx → **Görüntüleyici** (dosya sahibi paylaşmalı)
6. Anahtarı VPS'e kopyala. Sohbete veya AI'a **yapıştırma**:
   ```bash
   scp ~/Downloads/<indirilen>.json root@<vps>:/opt/fredymail/fredymail-pro/fredymail-next/secrets/google_sa.json
   ssh root@<vps> 'cd /opt/fredymail/fredymail-pro/fredymail-next && chown 10001:10001 secrets/google_sa.json && chmod 400 secrets/google_sa.json'
   ```
   `secrets/` zaten `/run/secrets` olarak salt okunur bağlanıyor ve git dışında.

## Güvenlik notu

Marketing asset tablosunda bazı portallar için kullanıcı adı ve şifre var. Modül bu tablodan **yalnızca marka adı ve
klasör linkini** okur; şifre sütunları okunmaz, veritabanına, AI'a veya tasarımcı mailine gitmez. Bu repo herkese
açık olduğundan gerçek tablo verileri (adetler, şifreler) repoya konmaz; testler sentetik veri kullanır.
