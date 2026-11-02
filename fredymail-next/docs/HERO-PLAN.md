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

**"Yeni ürün" tespiti:** (1) tabloda `YENİ ÜRÜN` notu olanlar, (2) mağazada (shop.zoomithalat.com, IdeaSoft)
karşılığı olmayanlar. Worker ayın 15'i ve 25'i (`FM_HERO_RUN_DAYS`), Yoldaki Mallar'dan sonra mağazanın **yalnızca site haritasını** okur
(`/sitemap.xml` → `/xml/sitemap_product_N.xml` → `/urun/<ad>` linkleri; robots.txt `Crawl-delay: 30` gereği istekler
arası 30 sn, toplam birkaç dakika) ve her yoldaki ürünü linklerle eşleştirir (`hero/site.py`): model kodu varsa
(A063Z, B091S…) birebir, yoksa anlamlı kelime örtüşmesi (≥ %75). Birden çok aday çıkarsa "belirsiz" sayılır ve yeni
ürün kabul edilmez. Eşleşen ürünün mağaza linki plana yazılır; tablodaki linksiz ürünler de mağazada bulunursa
linklenir.

Yoldaki listeye ilk kez girmek tek başına yeni ürün sayılmaz: liste döner, depoya giren ürün düşer, yeniden siparişte
geri gelir (ilk kurulumda 219 kalemin 196'sı son 30 günde listeye girmişti, çoğu yıllardır satılan ürünlerdi).

## Komutlar

```bash
DC="docker compose -f docker-compose.yml -f docker-compose.vps.yml"
$DC run --rm worker fredymail hero-sync                    # Yoldaki Mallar'ı şimdi oku (worker ayın 15/25'inde kendisi okur)
$DC run --rm worker fredymail hero-site                    # mağaza kontrolü (birkaç dk); --show-found eşleşmeleri gösterir
$DC run --rm worker fredymail hero-preview --month 2026-12 # öneriyi göster, veritabanına kaydet (tabloya dokunmaz)
$DC run --rm worker fredymail hero-write                   # kuru çalışma: ne yapılacağını gösterir
$DC run --rm worker fredymail hero-write --yes             # arşiv sekmesi + Sayfa1 güncellemesi
```

Planı elle düzenlemek için: `$DC run --rm -T worker fredymail hero-preview --out - > plan.json`, dosyayı düzenle,
`$DC run --rm -T worker fredymail hero-write - --yes < plan.json`. Önizlemeden sonra tablo elle değiştiyse yazma
reddedilir (`--force` ile geçilir).

Plan kuralları: geçen ayın ürünleri devreder; adında `Kampanya (gg.aa-gg.aa)` olan ve ay içinde en az 3 gün sürmeyen
kampanya çıkarılır; ay içinde stoğa girecek "yeni" ürünler markasına eklenir (zaten listede olan ürün tekrar eklenmez),
markası listede yoksa yeni marka satırı açılır; 8 sınırını aşanlar "yer yok" olarak raporlanır. Yazarken yalnızca
hücre değeri, link ve not değişir (renkler korunur); linki olmayan ürüne "link bekleniyor" notu düşülür;
"Toplam Ürün" hücreleri `COUNTA`/`SUM` formülüyle yazılır.

Yerel dosyayla deneme (ağ ve veritabanı gerekmez):

```bash
docker compose run --rm --no-deps -v "$PWD/YOLDAKI.xlsx:/tmp/y.xlsx:ro" worker \
  fredymail hero-yoldaki /tmp/y.xlsx --month 2026-11
```

## Akış

1. **Ayın 15'i ve 25'i, 08:00'den sonra (worker, AI yok):** Yoldaki Mallar okunur ve Postgres'e kopyası alınır, ardından mağaza kontrolü yapılır (~3 dk). Diğer günler hiçbir şey çalışmaz.
2. **Ayın 25'i:** Telegram hatırlatması.
3. **"Hero Planı" ekranı:** geçen ayın listesi + yoldan gelen adaylar + "Kampanyaları maillerden çıkar" düğmesi
   (AI; kaynak mail çipleriyle). Kullanıcı seçer.
4. **"Sheets'e yaz":** mevcut liste `Ekim 2026` gibi bir arşiv sekmesine kopyalanır, `Sayfa1` güncellenir.
5. **Tasarımcı maili:** FredyMail taslak hazırlar; gönderim Outlook'tan.

## AI ve maliyet

| Adım | AI? | Ne zaman | Maliyet |
|---|---|---|---|
| Yoldaki Mallar okuma, mağaza kontrolü, plan, Sheets'e yazma | Hayır (kural tabanlı) | Ayın 15'i ve 25'i + elle | 0 |
| Kampanyaları maillerden çıkarma (yapılacak) | Evet, `FM_AI_MODEL` (hafif model) | Yalnızca kullanıcı düğmeye basınca, ayda ~1 kez | Ayda birkaç sent (aşağıda) |
| Hafif modelin yanıtı geçersiz JSON ise | `FM_AI_MODEL_HEAVY` (varsa), **bir kez** | Nadiren | İhmal edilebilir |

Kampanya çıkarımı tahmini: ayda ~100 aday mail × ≤4.000 karakter (~1.000 token) = ~100 bin girdi tokenı,
15 mail/çağrı → ~7 çağrı, ~7 bin çıktı tokenı. `.env.example`'daki fiyat ayarlarıyla (hafif: 0,10 $/0,40 $ / 1M token)
≈ **0,01–0,02 $/ay**; tamamı güçlü modelle yapılsa (2 $/12 $ / 1M) ≈ **0,30 $/ay**. Gerçek fiyatlar LiteLLM/OpenRouter
panelinden doğrulanmalı. Mevcut günlük bütçe sınırı (`FM_AI_DAILY_BUDGET_USD`) ve önbellek aynen geçerlidir.
VPS yükü: ayda iki kez ~3 dakikalık, 6 HTTP isteklik bir iş.

## Durum

- [x] Yoldaki Mallar okuyucusu (`fredymail/hero/yoldaki.py`) + `hero-yoldaki` komutu + testler
- [x] Google servis hesabı ile Drive'dan okuma ve Sheets'e yazma (`hero/google.py`, `hero/sheet.py`)
- [x] Günlük kopya, "ilk kez görünen" tespiti, ay sonu hatırlatması (`hero/service.py`, worker)
- [x] Plan önerisi ve yazma komutları (`hero-preview`, `hero-write`)
- [x] Mağaza kontrolü ve link eşleştirme (`hero/site.py`, `hero-site`)
- [ ] Kampanya çıkarımı (AI, düğmeyle)
- [ ] Hero Planı ekranı ve tasarımcı taslağı

## Google servis hesabı kurulumu

1. https://console.cloud.google.com → yeni proje (ör. `fredymail-hero`).
2. **APIs & Services → Library:** `Google Sheets API` ve `Google Drive API`'yi etkinleştir.
3. **IAM & Admin → Service Accounts → Create service account:** ad `fredymail-hero`, rol verme, bitir.
4. Servis hesabı → **Keys → Add key → Create new key → JSON**. Dosya bilgisayara iner.
5. Servis hesabının e-posta adresiyle (`fredymail-hero@<proje>.iam.gserviceaccount.com`) paylaş:
   - Hero Ürünler Listesi → **Düzenleyici**
   - YOLDAKİ_MALLAR_GENEL.xlsx → **Düzenleyici** önerilir (dosya sahibi paylaşmalı). Drive sürüm geçmişi
     yalnızca düzenleyicilere açık; kod Drive'a **salt okunur** kapsamla bağlandığı için dosyayı değiştiremez.
     Görüntüleyici de çalışır, yalnızca ilk kurulumdaki "yeni" tespiti zayıflar.
6. Anahtarı VPS'e kopyala. Sohbete veya AI'a **yapıştırma**:
   ```bash
   scp ~/Downloads/<indirilen>.json root@<vps>:/opt/fredymail/fredymail-pro/fredymail-next/secrets/google_sa.json
   ssh root@<vps> 'cd /opt/fredymail/fredymail-pro/fredymail-next && chown 10001:10001 secrets/google_sa.json && chmod 400 secrets/google_sa.json'
   ```
   `secrets/` zaten `/run/secrets` olarak salt okunur bağlanıyor ve git dışında.
7. `.env`'e `FM_HERO_SHEET_ID` ve `FM_HERO_YOLDAKI_FILE_ID` ekle (dosya linklerindeki `/d/<kimlik>/` kısmı), sonra
   `git pull && $DC build && $DC up -d` (migrate servisi `hero_items` tablosunu oluşturur).

## Güvenlik notu

Marketing asset tablosunda bazı portallar için kullanıcı adı ve şifre var. Modül bu tablodan **yalnızca marka adı ve
klasör linkini** okur; şifre sütunları okunmaz, veritabanına, AI'a veya tasarımcı mailine gitmez. Bu repo herkese
açık olduğundan gerçek tablo verileri (adetler, şifreler) repoya konmaz; testler sentetik veri kullanır.
