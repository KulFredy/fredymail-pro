# Devam notları (son güncelleme: 7 Kasım 2026)

## Durum
- **Faz 1 · Instagram Hızlı Edit — tamam.** 8 adım: Ekle (QR ile telefondan) · Biçim (9:16, 4:5, 1:1, 16:9; video/fotoğraf) · Sırala & kısalt · Kadraj (doldur/sığdır, %10–%400 boyut, köşeye) · Renk & ışık (görünümler, ayarlar, .cube LUT, 12 kamera log dönüşümü) · Ses & müzik (3 mod) · Yazı & altyazı (yerel Whisper, kelime düzeltme) · Teslim (720p–4K, doğrulama, müziksiz sürüm, telefona indir, sürümler).
- **Faz 2 · Kurgu Stüdyosu — tamam.** Çok izli zaman çizelgesi (görüntü, üst iz, dış ses, müzik, altyazı, yazı; iz adlarında "+"), sekmeli sol panel (Komut · Medya · Seçili öğe), mikrofon/yazı ile Türkçe komut → plan → önizle/uygula, adaylar zaman koduyla, talimat ≠ dış ses, kişisel stil vs proje notu, tam ekran, render çözünürlüğü.
- **Claude ile komut (isteğe bağlı):** Ayarlar'da "Her komutta" (varsayılan) veya "Yalnız kalıplar anlamazsa"; model Opus 5.5 / Sonnet 5.5 / Haiku 5.5; komut başına maliyet gösterilir; ulaşılamazsa yerel anlayıcı.
- **Testler (son çalıştırma):** birim 46/46 · `npm run e2e` 28/28 · `npm run e2e:studio` 12/12 · `npm run e2e:offline` 12/12 · `npm run e2e:ui` 9/9.
- **Kullanıcının Mac'i:** kurulum yapıldı (`scripts/setup-mac.sh`), güncelleme `bash scripts/guncelle.sh`. Gerçek Türkçe altyazı Mac'te çalıştı. Render için Chrome indirilemediğinde sistem Google Chrome'u kullanılıyor.

## Doğrulanmayanlar (kullanıcıyla kontrol et)
- Claude'un gerçek yanıtları (kullanıcının anahtarıyla). Önceki "400" hatasının nedeni görülemedi; artık ayrıntı gösteriliyor ve terminale `[claude] 400: …` yazılıyor. Olası neden: hesapta kredi yok.
- 4K **video** render'ı (4K fotoğraf test edildi).
- Telefondan Wi-Fi ile gerçek yükleme.
- Mac'te sesli komutların gerçek kullanımda doğruluğu.

## Sıradaki işler
Faz sırası `docs/FAZLAR.md` dosyasındadır (esas). Şu an **Faz 3 · Yerel Stüdyo ve ince kurgu** sürüyor:
0. ✅ Belgelerde yeni faz sırası.
1. ✅ Çevrimdışı kabul testi (`npm run e2e:offline`, 12/12; Linux'ta ağsız ad alanında, Mac'te Wi-Fi kapalıyken), gerçek eski projeler (`tests/fixtures/eski-ev`, Faz 1 + Faz 2 koduyla üretildi; `scripts/eski-proje-uret.ts`), dış sesin çıktıda duyulduğunun ölçümü.
2. ✅ Çekirdekte kaynak ↔ kurgu zaman eşlemesi, transkript, "cümleyi kes" ve "altyazıyı düzelt" işlemleri (`src/core/transcript.ts`).
3. ✅ Yerleşim: solda Medya + Transkript, ortada geniş önizleme, sağda Komut + Seçili öğe (kapanabilir; tercih tarayıcıda hatırlanır).
4. ✅ Transkript paneli (`web/src/TranscriptPanel.tsx`): arama, zaman etiketi → cümle başı, kelime → o kelime, oynatırken etkin cümle/kelime, kesilenler soluk, "Cümleyi kes" ≠ "Altyazıyı düzelt". Arayüz testi `npm run e2e:ui` 9/9 (Playwright gerekir; bulutta hazır).
5. Komut paneli: hedef klip, aralık, çıktı oranı etiketi; Önizle / Uygula / Vazgeç / Geri Al.
6. Zaman çizelgesi: ses dalgası, kare hassasiyeti, ses geçişleri.
7. Konuşmalı içerikte uçtan uca deneme + Mac/Android test listesi.

Sonra: Faz 4 (Referanslar, LUT Kütüphanem, hareket) → Faz 5 (Bağlantılar) → Faz 6 (Marka, kampanya) → Faz 7/8 isteğe bağlı.
Küçükler (uygun fazda): RAW fotoğraf (LibRaw), kaynak oranında çıktı (ör. 4:3), Premiere'e aktarım (OpenTimelineIO / FCP XML), telefonda düzenleme ekranı, depoyu `main` dalına birleştirme.

## Bulut oturumu notları
- Çalışma dalı adı oturuma göre değişebilir (ör. `claude/kind-davinci-9kuqyj`); içerik `claude/hopeful-thompson-lgey2c` üzerinden devam eder.
- `npm run e2e` için `espeak-ng` gerekir (`apt-get update && apt-get install -y espeak-ng`); yoksa test sesi bip olur ve "Story süresi ≈15 sn" kontrolü düşer (11.8 sn).

## Yeni oturum için başlangıç komutu
```
İçerik Fabrikası projesine devam ediyoruz. Önce CLAUDE.md, docs/DEVAM.md ve README.md'yi oku;
son çalışma dalı claude/kind-davinci-9kuqyj (main'e birleştirilmediyse bu daldan devam et).
Bulut ortamındaysan npm install yap, testleri çalıştır (npm test, sonra gerekirse npm run e2e)
ve durumu bana 5 satırda özetle. Sonra [BURAYA BU OTURUMDA İSTEDİĞİNİ YAZ] ile devam edelim.
Kodu değiştirmeden önce kısa bir plan göster; her adımı test edip commit/push et.
```
