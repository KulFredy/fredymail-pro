# Devam notları (son güncelleme: 7 Kasım 2026)

## Durum
- **Faz 1 · Instagram Hızlı Edit — tamam.** 8 adım: Ekle (QR ile telefondan) · Biçim (9:16, 4:5, 1:1, 16:9; video/fotoğraf) · Sırala & kısalt · Kadraj (doldur/sığdır, %10–%400 boyut, köşeye) · Renk & ışık (görünümler, ayarlar, .cube LUT, 12 kamera log dönüşümü) · Ses & müzik (3 mod) · Yazı & altyazı (yerel Whisper, kelime düzeltme) · Teslim (720p–4K, doğrulama, müziksiz sürüm, telefona indir, sürümler).
- **Faz 3 · Yerel Stüdyo ve ince kurgu — tamam (8 Kasım, kullanıcının Mac'inde gerçek videoyla doğrulandı: transkript senkronu, altyazı düzeltme + cümle kesme + geri al, çevrimdışı teslim).** Transkript paneli, sağda Komut/Seçili öğe, komut etkisi (klip, aralık, kapsam, yan etkiler), ses dalgası, I/O kesim, S bölme, yumuşak ses geçişleri, internetsiz çalışma testi.
- **Faz 2 · Kurgu Stüdyosu — tamam.** Çok izli zaman çizelgesi (görüntü, üst iz, dış ses, müzik, altyazı, yazı; iz adlarında "+"), sekmeli sol panel (Komut · Medya · Seçili öğe), mikrofon/yazı ile Türkçe komut → plan → önizle/uygula, adaylar zaman koduyla, talimat ≠ dış ses, kişisel stil vs proje notu, tam ekran, render çözünürlüğü.
- **Claude ile komut (isteğe bağlı):** Ayarlar'da "Her komutta" (varsayılan) veya "Yalnız kalıplar anlamazsa"; model Opus 5.5 / Sonnet 5.5 / Haiku 5.5; komut başına maliyet gösterilir; ulaşılamazsa yerel anlayıcı.
- **Testler (son çalıştırma):** birim 50/50 · `npm run e2e` 28/28 · `npm run e2e:studio` 12/12 · `npm run e2e:offline` 13/13 · `npm run e2e:ui` 21/21.
- **Kullanıcının Mac'i:** kurulum yapıldı (`scripts/setup-mac.sh`), güncelleme `bash scripts/guncelle.sh`. Gerçek Türkçe altyazı Mac'te çalıştı. Render için Chrome indirilemediğinde sistem Google Chrome'u kullanılıyor.

## Doğrulanmayanlar (kullanıcıyla kontrol et)
Bulutta yapılamayan kontroller; her biri ayrı bir doğrulama kalemidir:
- **Gerçek Claude anahtarıyla komut** (kullanıcının anahtarı gerekir). Önceki "400" hatasının nedeni görülemedi; artık ayrıntı gösteriliyor ve terminale `[claude] 400: …` yazılıyor. Olası neden: hesapta kredi yok. Yerel komut yolu bulutta test edildi (`e2e:offline`, `e2e:ui`).
- **4K video render'ı** (4K fotoğraf test edildi).
- **Gerçek Android telefondan Wi-Fi ile yükleme** (QR).
- Mac'te sesli komutların gerçek kullanımda doğruluğu.

### Mac'te test listesi (Faz 3, ~15 dk)
Önce güncelle: `bash scripts/guncelle.sh claude/kind-davinci-9kuqyj` (eski betik varsayılan olarak eski dalı indiriyordu; bir kez dal adıyla çalıştırınca yeni betik gelir, sonrasında `bash scripts/guncelle.sh` yeter). Açık uygulamayı Ctrl+C ile kapatıp `npm run fabrika` ile yeniden başlat, tarayıcıda ⌘R.
1. **İnternetsiz:** Wi-Fi'yi kapat. Terminalde `npm run e2e:offline` → sonda "13/13 kontrol geçti" görmelisin. Ardından uygulamada eski bir projeyi aç, bir klip ekle, kes, LUT uygula, altyazıda bir kelimeyi düzelt, uygulamayı kapatıp aç; 1080p MP4 ve bir JPEG al. Dış ses kaydı olan bir projede MP4'te dış sesin duyulduğunu dinle. Wi-Fi'yi aç.
2. **Transkript:** kendi konuşmalı videonu Stüdyo'ya ekle. Transkript sekmesinde bir cümlenin zamanına tıkla → önizleme ve zaman çizelgesi aynı anda mı? Bir kelimeye tıkla → tam o kelimeye mi gitti? Bir cümleyi **Cümleyi kes** ile çıkar, dinle: hece yutuluyor mu, nefes/boşluk doğal mı? Sonraki cümleye tıkla: hâlâ doğru yerde mi? **Altyazıyı düzelt** ile bir kelimeyi değiştir: süre değişmemeli.
3. **İnce kurgu:** I ile giriş, birkaç kez → ile kare kare ilerle, O ile çıkış, ⌫ ile sil. S ile imleçte böl. Seçili klipte "Ses girişi/çıkışı (yumuşak)" ayarla ve dinle. Ses dalgası kliplerde görünüyor mu?
4. **Komut:** "Buradan sonraki üç saniyeyi kes" de veya yaz. Sağ panelde klip, aralık ve kapsam görünüyor mu? Önizle → Vazgeç → tekrar → Uygula → Geri al.
5. **Claude (anahtarın varsa):** aynı komutu Claude açıkken dene; cevap ve maliyet görünüyor mu? Hata olursa terminaldeki `[claude] …` satırını bana gönder.
6. **4K video:** Teslim'de 4K seç, kısa bir video çıktısı al; süreyi not et.
7. **Android:** Mac ile aynı Wi-Fi'de, "Telefondan ekle" QR'ını Android kamerayla okut, bir video yükle; Medya'ya geldi mi?

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

**Sıradaki somut iş:** Faz 4'ün ilk adımı: LUT Kütüphanem sekmesi (toplu `.cube` içe aktarma, arama, etiket, favori, aynı karede önce/sonra).

Sonra: Faz 4 (Referanslar, LUT Kütüphanem, hareket) → Faz 5 (Bağlantılar) → Faz 6 (Marka, kampanya) → Faz 7/8 isteğe bağlı.
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
