# Devam notları (son güncelleme: 8 Kasım 2026)

## Durum
- **Faz 1 · Instagram Hızlı Edit — tamam.** 8 adım: Ekle (QR ile telefondan) · Biçim (9:16, 4:5, 1:1, 16:9; video/fotoğraf) · Sırala & kısalt · Kadraj (doldur/sığdır, %10–%400 boyut, köşeye) · Renk & ışık (görünümler, ayarlar, .cube LUT, 12 kamera log dönüşümü) · Ses & müzik (3 mod) · Yazı & altyazı (yerel Whisper, kelime düzeltme) · Teslim (720p–4K, doğrulama, müziksiz sürüm, telefona indir, sürümler).
- **Claude ile komut — Mac'te doğrulandı (8 Kasım):** kullanıcının anahtarı ve 5 $ krediyle “Bu klibe TealOrangePlusContrast uygula, yoğunluk yüzde 70” doğru anlaşıldı (Opus 5.5, 8631 token ≈ 2,09 sent). Önceki 400 hatasının nedeni kredi yokluğuydu.
- **Faz 3 · Yerel Stüdyo ve ince kurgu — tamam (8 Kasım, kullanıcının Mac'inde gerçek videoyla doğrulandı: transkript senkronu, altyazı düzeltme + cümle kesme + geri al, çevrimdışı teslim).** Transkript paneli, sağda Komut/Seçili öğe, komut etkisi (klip, aralık, kapsam, yan etkiler), ses dalgası, I/O kesim, S bölme, yumuşak ses geçişleri, internetsiz çalışma testi.
- **Faz 2 · Kurgu Stüdyosu — tamam.** Çok izli zaman çizelgesi (görüntü, üst iz, dış ses, müzik, altyazı, yazı; iz adlarında "+"), sekmeli sol panel (Komut · Medya · Seçili öğe), mikrofon/yazı ile Türkçe komut → plan → önizle/uygula, adaylar zaman koduyla, talimat ≠ dış ses, kişisel stil vs proje notu, tam ekran, render çözünürlüğü.
- **Claude ile komut (isteğe bağlı):** Ayarlar'da "Her komutta" (varsayılan) veya "Yalnız kalıplar anlamazsa"; model Opus 5.5 / Sonnet 5.5 / Haiku 5.5; komut başına maliyet gösterilir; ulaşılamazsa yerel anlayıcı.
- **Faz 4 · Referanslar, LUT ve hareket — tamam** (LUT'lar Mac'te doğrulandı; logo/hareket/müziğe oturtma Mac'te denenmedi).
- **Faz 5 · Bağlantılar — tamam (bulutta sahte servislerle doğrulandı; gerçek ElevenLabs/Gemini anahtarıyla doğrulanmadı).**
- **Testler (son çalıştırma):** birim 87/87 · `npm run e2e` 28/28 · `npm run e2e:studio` 12/12 · `npm run e2e:offline` 13/13 · `npm run e2e:ui` 40/40 · `npm run e2e:lut` 16/16 · `npm run e2e:ref` 8/8 · `npm run e2e:grafik` 9/9 · `npm run e2e:ritim` 6/6 · `npm run e2e:baglanti` 23/23.
- **Kullanıcının Mac'i:** kurulum yapıldı (`scripts/setup-mac.sh`), güncelleme `bash scripts/guncelle.sh`. Gerçek Türkçe altyazı Mac'te çalıştı. Render için Chrome indirilemediğinde sistem Google Chrome'u kullanılıyor.

## Doğrulanmayanlar (kullanıcıyla kontrol et)
Bulutta yapılamayan kontroller; her biri ayrı bir doğrulama kalemidir:
- **4K video render'ı** (4K fotoğraf test edildi).
- **Gerçek Android telefondan Wi-Fi ile yükleme** (QR).
- Mac'te sesli komutların gerçek kullanımda doğruluğu.
- **Gerçek ElevenLabs ve Gemini çağrıları** (anahtar gerekir; sahte sunucuyla API biçimi resmi SDK kaynaklarından birebir alındı). Gemini görsel fiyatı doğrulanmadı.
- **Mac Anahtar Zinciri** (`security` komutu) gerçek Mac'te denenmedi; bulutta gizli dosya kullanıldı.
- **Higgsfield** uç noktaları doğrulanmadı (belgelere erişilemedi); yalnız anahtar saklanıyor.

### Mac'te test listesi (Faz 4–5, ~20 dk)
Önce güncelle: `bash scripts/guncelle.sh`, uygulamayı Ctrl+C ile kapatıp `npm run fabrika`, tarayıcıda ⌘R. (Faz 3 listesi 8 Kasım'da tamamlandı.)
1. **Anahtar taşıma:** ⚙ → Bağlantılar. Claude satırında “Anahtar: ••••xxxx · Mac Anahtar Zinciri” yazmalı (Mac bir kez izin isteyebilir → *Her Zaman İzin Ver*). Terminalde `grep -c anthropicApiKey ~/İçerik\ Fabrikası/ayarlar.json` → `0` olmalı. Bir Claude komutu dene: çalışmalı.
2. **Logo:** Medya'dan saydam PNG logo yükle → LOGO izine ekle; “logoyu sol alta al”, Story sekmesinde ızgaradan sağ üst; Dışa aktar'da uyarı çıkıyor mu?
3. **Hareket ve ritim:** bir fotoğrafa “girişte yavaşça yakınlaş”; müzik ekleyip “kesimleri müziğe oturt”. MÜZİK izinde vuruş çizgileri ve BPM görünüyor mu, kesimler vuruşta mı?
4. **ElevenLabs (anahtar varsa):** Bağlantılar → ElevenLabs → Anahtar ekle → kalan karakter görünmeli. Üret → Dış ses: kısa bir Türkçe metin, *Örneği dinle*, sonra *Üret ve ekle*. Türkçe telaffuz nasıl? Aynı metni tekrar üret: kredi düşmemeli.
5. **Gemini (anahtar varsa):** aistudio.google.com'dan anahtar, Üret → Ürün arka planı: bir ürün fotoğrafı + “mermer tezgah, yumuşak ışık”. Onay kutusunu oku → üret. 2 seçenekte ürün/etiket bozulmuş mu? Birini onayla → Ana ize.
6. Hata olursa terminaldeki satırı bana gönder (anahtar loglara yazılmaz).

## Sıradaki işler
Faz sırası `docs/FAZLAR.md` dosyasındadır (esas). **Faz 3 · Yerel Stüdyo ve ince kurgu** (tamamlandı):
0. ✅ Belgelerde yeni faz sırası.
1. ✅ Çevrimdışı kabul testi (`npm run e2e:offline`, 12/12; Linux'ta ağsız ad alanında, Mac'te Wi-Fi kapalıyken), gerçek eski projeler (`tests/fixtures/eski-ev`, Faz 1 + Faz 2 koduyla üretildi; `scripts/eski-proje-uret.ts`), dış sesin çıktıda duyulduğunun ölçümü.
2. ✅ Çekirdekte kaynak ↔ kurgu zaman eşlemesi, transkript, "cümleyi kes" ve "altyazıyı düzelt" işlemleri (`src/core/transcript.ts`).
3. ✅ Yerleşim: solda Medya + Transkript, ortada geniş önizleme, sağda Komut + Seçili öğe (kapanabilir; tercih tarayıcıda hatırlanır).
4. ✅ Transkript paneli (`web/src/TranscriptPanel.tsx`): arama, zaman etiketi → cümle başı, kelime → o kelime, oynatırken etkin cümle/kelime, kesilenler soluk, "Cümleyi kes" ≠ "Altyazıyı düzelt". Arayüz testi `npm run e2e:ui` 21/21 (Playwright gerekir; bulutta hazır).
5. ✅ Komut paneli (`src/core/impact.ts`): algılanan talep, işlem listesi (klip no + ad, kurgu aralığı → tıklayınca o ana gider, kapsam: tüm proje / yalnız bir çıktı / ayrı iz), yan etki uyarıları (silinecek yazı/üst iz, dış ses çakışması); Önizle / Uygula / Vazgeç ve uygulandıktan sonra tek tıkla Geri al.
6. ✅ Zaman çizelgesi: ses dalgası (klip + dış ses), I/O ile kare hassasiyetinde aralık silme, S / ⌘B ile imleçte bölme, klip ve dış seste ayarlanabilir yumuşak ses girişi/çıkışı (`edgeGain`).
7. ✅ Konuşmalı içerikte uçtan uca deneme (bulutta sentetik ses) + Mac/Android test listesi (yukarıda).

**Faz 4 · Referanslar, LUT ve hareket** (tamamlandı):
1. ✅ LUT Kütüphanem (`src/core/lutlib.ts`, `web/src/LutPanel.tsx`): toplu içe aktarma (.cube, .3dl → .cube, .zip; klasör seçimi; sürükle-bırak), dosya başına rapor, aynı içerik tekrar eklenmez, dosya adından görünüm/teknik + giriş tahmini, etiket/favori/ad düzenleme, silme (kullanım sayısıyla uyarı), küçük önizlemeler (kamera dönüşümü dahil, yaklaşık), ana önizlemede kaydetmeden deneme, yoğunluk, seçili klip / tüm kurgu, önce/sonra + 4'e kadar karşılaştırma, teknik LUT uyuşmazlık uyarıları ve tek tıkla düzeltme. Testler: `e2e:lut`, `e2e:ui`. Kullanıcının LUT kaynakları: Photoshop 3DLUTs (.cube + .3DL), Magic Bullet LUTs, DaVinci Resolve LUT (çoğu teknik).
2. ✅ Referanstan renk eşleme (`src/core/colormatch.ts`, `web/src/ReferencePanel.tsx`): proje referansları (kurguya girmez; `reference.*` işlemleri), video referansta kare seçimi, Lab istatistikleriyle sınırlı (±20) Reinhard eşleme LUT'u (siyah/beyaz korunur), log klipte kamera dönüşümünden sonra ölçüm, Türkçe özet + renk örnekleri, önce/sonra, yoğunluk (%80), önizle/uygula/vazgeç. LUT'larım'a #referans. Testler: `e2e:ref` (render'da referansa uzaklık 43.7 → 19.1), `e2e:ui`. Ayrıca yerel komut "orijinal haline dön" (`project.restoreOriginal`).
3. ✅ Başlık ve logo (`src/core/graphics.ts`, `web/src/ElementInspector.tsx`): saydam PNG/SVG içe aktarma (alpha korunur), logolar (`logo.*`), yazı/logoda 9 noktalı yerleşim her oranın güvenli alanı içinde, orana özel yerleşim (`element.place`), giriş/çıkış animasyonu, güvenli alan uyarıları + “güvenli alana al” (Stüdyo ve Dışa aktar), JPEG post'ta logo, LOGO izi, yerel logo komutları, Claude/MCP'ye tanıtıldı. Testler: `e2e:grafik` (piksel ölçümü), `e2e:ui`. Zaman çizelgesinde iz adlarının kayması düzeltildi.
4. ✅ Hareket ve ritim (`src/core/beats.ts`, `motionFraming`): klip başına Ken Burns (yakınlaş/uzaklaş/kaydır, klip boyunca veya girişte), müzik vuruşu ve BPM algılama (enerji artışı → otokorelasyon → darbe izleme + doğrusal uydurma; 128 BPM WAV'da 19 ms), “kesimleri müziğe oturt” (≤0,3 sn), MÜZİK izinde vuruş çizgileri, referansta bölge seçme. Testler: `e2e:ritim` (render'da kesimler vuruşa 8–11 ms), `e2e:ui`. Storyboard ve görsel komut sözlüğü (/ISOMETRIC …) üretim servisi gerektirdiği için Faz 5'e bağlı.

Mac'te gerçek LUT'larla doğrulandı (8 Kasım): Photoshop .cube + .3DL, Magic Bullet, Resolve Sony; `npm run lut-ekle` ile toplu ekleme, küçük resimler ve canlı deneme.

**Faz 5 · Bağlantılar** (tamamlandı, gerçek servislerle doğrulanmadı):
1. ✅ Anahtar kasası (`src/server/secrets.ts`): Mac'te Anahtar Zinciri (`security`, hizmet `icerik-fabrikasi`), diğerlerinde `gizli.json` (600). Eski `ayarlar.json` Claude anahtarı geri okunup doğrulandıktan sonra taşınır. Anahtarlar tarayıcıya/projeye/loglara gitmez (e2e'de bütün yanıtlar ve dosyalar taranır).
2. ✅ Ayarlar → Bağlantılar (`src/server/connections.ts`, `web/src/Connections.tsx`): durum, Dene, ekle/değiştir/kaldır, Claude kullanım özeti (`kullanim.json`), Gemini model seçimi, ElevenLabs varsayılan ses/model.
3. ✅ ElevenLabs dış ses (`src/server/providers.ts`, `generate.ts`): ses/model kataloğu (Türkçe destekleyen model varsayılan), karakter ve kredi tahmini + kalan kredi, ilk cümleyle örnek, aynı istek tekrarında kredi harcamama (içerik anahtarı), çift tıklamaya karşı kilit, `voice.add` ile DIŞ SES izine ekleme, “Metni düzenle ve yeniden üret” (`voice.setAsset`).
4. ✅ Gemini (Nano Banana 2) ürün arka planı: göndermeden önce fotoğraf ve görsel sayısı onayı, 2 seçenek, `uretim` rolünde bekler; onaylanınca Medya'ya geçer. Model seçilebilir (Nano Banana 2 / 2 Lite / Pro).
5. ⚠ Higgsfield: anahtar saklanır, “doğrulanmadı” rozetiyle; uygulama içi üretim yok.
Testler: `e2e:baglanti` 23/23 (sahte servis: sızıntı taraması, taşıma, eşzamanlı istek, 402 kredi hatası, Gemini istek gövdesi, onay, tarayıcıda Bağlantılar + Üret akışı).

**Sıradaki somut iş:** Faz 6 · Marka, kampanya ve kanal teslimi (`docs/FAZLAR.md`). Kullanıcı Mac'te Faz 4–5 listesini dener; ElevenLabs/Gemini anahtarlarını ekler.

Sonra: Faz 6 → Faz 7 (doğrudan yayın, isteğe bağlı) → Faz 8 (SaaS beta, isteğe bağlı).
Küçükler (uygun fazda): RAW fotoğraf (LibRaw), kaynak oranında çıktı (ör. 4:3), Premiere'e aktarım (OpenTimelineIO / FCP XML), telefonda düzenleme ekranı, depoyu `main` dalına birleştirme.

## Bulut oturumu notları
- Çalışma dalı: `claude/kind-davinci-9kuqyj` (`claude/hopeful-thompson-lgey2c` üzerine devam eder). **Dal değişirse `scripts/guncelle.sh` içindeki varsayılan `BRANCH` da değiştirilmeli**, yoksa kullanıcının Mac'ine eski sürüm iner.
- `npm run e2e` için `espeak-ng` gerekir (`apt-get update && apt-get install -y espeak-ng`); yoksa test sesi bip olur ve "Story süresi ≈15 sn" kontrolü düşer (11.8 sn).

## Yeni oturum için başlangıç komutu
```
İçerik Fabrikası projesine devam ediyoruz. Önce CLAUDE.md, docs/DEVAM.md ve README.md'yi oku;
son çalışma dalı claude/kind-davinci-9kuqyj (main'e birleştirilmediyse bu daldan devam et).
Bulut ortamındaysan npm install yap, testleri çalıştır (npm test, sonra gerekirse npm run e2e)
ve durumu bana 5 satırda özetle. Sonra [BURAYA BU OTURUMDA İSTEDİĞİNİ YAZ] ile devam edelim.
Kodu değiştirmeden önce kısa bir plan göster; her adımı test edip commit/push et.
```
