# İçerik Fabrikası — Faz planı (Faz 3–8)

> Kaynak: kullanıcının 7 Kasım 2026'da verdiği devir ve Faz 3 talebi. **Faz sıralaması için bu dosya esastır.**
> `docs/PLAN.md` içindeki eski "Sonraki fazlar" tablosu (Faz 3 = motion, Faz 4 = yayın) bunun yerine geçmiştir.

## Eski plana göre farklar
| Eski (PLAN.md) | Yeni (bu dosya) |
|---|---|
| Faz 3 · Motion & görsel, marka klasörü, `/KOMUT` sözlüğü | Faz 3 · Yerel Stüdyo ve ince kurgu (transkript, sağ panel, zaman çizelgesi) |
| — | Faz 4 · Referanslar, LUT Kütüphanem ve hareket (başlık/logo, storyboard, komut sözlüğü burada) |
| — | Faz 5 · Bağlantılar: Claude, ElevenLabs, fotoğraf/video üretimi |
| (Faz 3'teki marka klasörü) | Faz 6 · Marka, kampanya ve kanal teslimi |
| Faz 4 · Doğrudan Instagram yayını | Faz 7 · Doğrudan yayın (isteğe bağlı) |
| — | Faz 8 · Barındırılan SaaS beta (isteğe bağlı) |

## Ürün yönü
Ürün fotoğrafı ve çekimlerinden birden fazla marka için kampanya materyali üreten, Türkçe sesli komutla yönlendirilebilen yerel fotoğraf ve video çalışma alanı. Hedef ortam: Mac M2, tarayıcıda localhost, gerçek Android telefondan medya aktarımı, küçük ekip.

**Ana akış:** Projeyi aç → kaynakları, referansları ve LUT'ları ekle → Stüdyo'da ana kurgu → isteğe bağlı sesli öneri veya üretim → önizle ve onayla → ince kurgu → kanal varyantları → kalite kontrolü ve teslim. Hızlı Edit aynı proje ve kaynaklarla çalışır.

**Harici API'siz temel kurgu bir ürün şartıdır.** Kurulumdan sonra medya ekleme, kesme, sıralama, kadraj, renk, LUT, ses, yazı ve altyazı, önizleme, kaydetme, yeniden açma, geri alma ve çıktı yerel motorla çalışır. Claude serbest dil yorumu ekler; ElevenLabs, Firefly, Nano Banana 2, Higgsfield yalnız seçilen üretim işlerinde devreye girer. Onaylanıp Mac'e kaydedilmiş medya servis kapansa da kullanılabilir. Yerel medya transkripsiyonu ile komut mikrofonunun çevrimdışı yazıya çevrilmesi ayrı ayrı doğrulanır.

## Faz 3 · Yerel Stüdyo ve ince kurgu
**Arayüz.** Transkript, görüntü ve klip birlikte çalışır. Geniş önizleme ve alttaki zaman çizelgesi sabit omurga.
- **Sol:** Medya ve aranabilir Türkçe Transkript (ileride Referanslar, LUT Kütüphanem, Üret). Cümleye tıklayınca imleç o ana gider, klip vurgulanır. "Transkriptten kes" ile "altyazıyı düzelt" ayrı eylemler. Kaynak klip zamanı ile kurgu zamanı karıştırılmaz.
- **Orta:** Geniş önizleme, oynatma kontrolleri, aktif çıktı oranı, güvenli alanlar; mevcut oran/kadraj kontrolleri korunur.
- **Sağ:** Komut ↔ Seçili öğe. Komut paneli algılanan talebi, önerilen işlemleri, etkilenen klip ve zaman aralığını, varsa çıktı oranı sınırını gösterir. Önizle, Uygula, Vazgeç, Geri Al kolay erişilir. Panel kapanınca önizleme genişler.
- **Alt:** Çok izli zaman çizelgesi; kare hassasiyetinde seçim/kesim, ses dalgası veya seviye, temel ses geçişleri.

**Çalışma sırası.** (1) Testleri çalıştır, farkları kaydet. (2) Harici servisler kapalıyken yerel kurgu ve çıktı akışını dene, engel varsa gider. (3) Transkript–önizleme–zaman çizelgesi senkronu; komutun etki aralığını görünür kıl; önizleme ve geri almayı gerçek örnekle denetle. (4) Gerçek konuşmalı içerikte ince kurgu ve teslim; cihaz erişimi yoksa bekleyen kontrol + kısa test listesi.

**Kabul ölçütleri.**
- İnternet kapalı (kurulumdan sonra): eski projeyi aç, klip ekle, kes, kadraj veya LUT uygula, altyazıyı düzelt, kaydet, yeniden aç; 1080p MP4 ve JPEG çıktı. Önceden kaydedilmiş dış ses oynar ve çıktıda duyulur.
- Transkriptte cümle seçilince önizleme ve zaman çizelgesi aynı anı gösterir; kesimden sonra eşleşme korunur; altyazı düzeltmesi kesimleri değiştirmez.
- Bir sesli komut önerisi hedef klip ve aralığı gösterir; önizleme, onay, vazgeçme, geri alma denenir. Yerel komut yolu ile gerçek Claude anahtarlı yol ayrı raporlanır; anahtara erişmeden gerçek API testi "geçti" sayılmaz.
- Gerçek Android aktarımı ve 4K video çıktısı ayrı doğrulama kalemleri.

## Faz 4 · Referanslar, LUT ve hareket
- **LUT Kütüphanem** sekmesi: 20–30 `.cube` toplu içe aktarma, Mac'te saklama, arama, etiket, favori; aynı karede önce/sonra ve seçenek karşılaştırma; yoğunluk; seçili klibe veya tüm kurguya uygulama. Teknik giriş dönüşümleri görünüm LUT'larından ayrı; uygunsuz girişte doğru dönüşüm doğrulanır.
- Referans görsel/video: "Bu fotoğrafın sıcak rengini al, ikinci videodaki gibi girişte yavaşça yakınlaş". Referanstan kare ve zaman bilgisi; önce yaklaşık renk/kontrast eşleme, sonra yakınlaşma, başlık, logo, kesim ritmi önerileri. Renk, hareket, kesim ayrı önizlenir ve onaylanır. Orijinal LUT'un birebir çıkarılabildiği varsayılmaz.
- Başlık ve logo ayarlanabilir öğeler; dikey ve yatayda güvenli alan ayrı denenir. Storyboard, görsel komut sözlüğü (`/ISOMETRIC`, `/XRAY` …) ve gelişmiş hareket takibi gerçek senaryolara göre.

## Faz 5 · Bağlantılar, görsel üretim ve dış ses
- **Ayarlar → Bağlantılar:** yetenekler, durum, model/ses seçimi, maliyet. Her sağlayıcı resmi API/yetkilendirme/MCP ile; ayrı bağlantı katmanı. Anahtarlar Mac Anahtar Zinciri'nde (mevcut `ayarlar.json`'dan güvenli geçiş); çağrılar yerel arka uçtan; anahtarlar tarayıcıya, proje dosyasına, GitHub'a, loglara düşmez.
- **Claude:** uygulama içi komutlar kullanıcının API bağlantısıyla; Claude Code MCP ile kendi aboneliğiyle. Kimlik ve maliyet ayrı gösterilir; Stüdyo anahtarı Claude Code ortamına eklenmez.
- **ElevenLabs:** Dış Ses izinde metin → marka sesi → kısa örnek → onaylı seslendirme; kredi önceden gösterilir; değişen bölüm yeniden üretilir; müzik modlarıyla birlikte dışa aktarılır.
- **Fotoğraf üretimi:** Firefly veya Nano Banana 2'den biri; ürün, logo, etiket, ambalaj korunarak iki arka plan seçeneği; onaylı sonuç Medya'ya. Firefly Services ve Adobe Express gömme ayrı bağlantılar.
- **Video üretimi:** Higgsfield önce resmi MCP ile; doğrudan API erişimi ayrıca doğrulanır. CapCut yalnız dosya alışverişi; zaman çizelgesi API'sine bağımlılık yok.
- Bulut işinden önce gönderilecek medya ve tahmini kredi; sonuç ve durum kaydı; zaman aşımında önce mevcut işi kontrol (çift üretim yok); onaylı sonuç yerel medya olarak saklanır.

## Faz 6 · Marka, kampanya ve kanal teslimi
- Marka profili: logo, palet, yazı tipi, metin tonu, LUT favorileri, referanslar, tercih edilen dış ses. Marka → ürün → kampanya → teslim; orijinal, varyant ve onaylı sonuç ayrı.
- Aynı projeden YouTube 16:9 + küçük resim, 9:16 Shorts/Reels, Story, 4:5 reklam; kadraj, altyazı, yazı konumu, kapak her profilde ayrı. Başlık/açıklama/reklam metni ve altyazı dosyası paketlenir.
- Bir ürünle gerçek kampanya paketi; sonra ikinci markada aynı akış. Teslimden önce ürün doğruluğu, ses dengesi, altyazı, kadraj kontrolü.

## Faz 7 ve 8 · İsteğe bağlı
- **Faz 7 · Doğrudan yayın:** tek platformla başla; hesap bağlantısı, önizleme, açık yayın onayı, yayın durumu ayrı. Reklam yayını ve bütçe ayrı kapsam.
- **Faz 8 · SaaS beta:** proje biçimi ve işlemler yeniden kullanılır; hesaplar, ekip/marka erişimi, depolama, sunucu render, faturalandırma çekirdeğin dışında. Mac localhost sürümü kalır.

İlk tahmin: Faz 3–6 için 8–12 hafta; Faz 3 için ~3–4 çalışma oturumu (Faz 3 sonunda güncellenecek).
