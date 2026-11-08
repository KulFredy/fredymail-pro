# Faz 8 · Barındırılan SaaS beta — tasarım ve karar belgesi

Durum: **taslak, karar bekliyor.** Bu faz isteğe bağlıdır (`docs/FAZLAR.md`). Kod yazılmadı; çünkü önce aşağıdaki kararlar (barındırma, maliyet, lisans, hukuk) verilmeli. Mac'teki yerel sürüm her durumda kalır.

## 1. Neyi yeniden kullanıyoruz

| Parça | Bugün | SaaS'ta |
|---|---|---|
| `src/core` (şema, işlemler, komutlar, kanallar, marka, kontroller) | saf TS | **aynen** — tarayıcı ve sunucu ortak |
| `src/remotion` kompozisyonu | önizleme + yerel render | **aynen**; render sunucuda (iş kuyruğu) |
| Proje biçimi (`project.json` + işlem geçmişi) | dosya | veritabanı satırı (JSON sütun) + işlem günlüğü tablosu |
| `web/` arayüz | localhost | aynı arayüz, oturum açma + çalışma alanı seçici eklenir |
| MCP sunucusu | yerel HTTP | aynı araçlar, kişisel erişim belirteciyle uzak HTTP |

Kural değişmez: **her değişiklik bir işlem** (`applyOp`). Bu sayede çok kullanıcılı düzenlemede çakışma çözümü “işlem sırası” üzerinden yapılır.

## 2. Çekirdeğin dışında kalan yeni parçalar

1. **Hesaplar ve ekip:** e-posta + şifre/Google ile giriş; çalışma alanı (ajans) → üyeler → roller (sahip, editör, onaylayıcı, izleyici). Marka erişimi rol × marka matrisiyle.
2. **Depolama:** orijinaller ve çıktılar S3 uyumlu nesne deposunda (müşteri başına önek, imzalı URL). Önizleme kopyaları ve dalga formları aynı depoda. Kütüphane meta verisi veritabanında.
3. **İşler:** içe aktarma (ffmpeg), konuşma çözümü (whisper.cpp, CPU/GPU), render (Remotion + Chrome), paket. Her biri kuyruktan iş alan ayrı işçi. Render için iki seçenek:
   - kendi işçilerimiz (öngörülebilir maliyet, GPU'suz CPU render),
   - Remotion Lambda (ölçeklenir, AWS'ye bağlar).
4. **Anahtarlar:** çalışma alanı başına şifreli sır deposu (KMS ile zarf şifreleme). Bugünkü kural aynen: anahtar tarayıcıya, proje dosyasına, loga gitmez. İki mod: “kendi anahtarını getir” (BYOK) veya bizim hesabımız + kullanım faturası.
5. **Faturalandırma:** abonelik + kullanım (render dakikası, depolama GB, Claude/ElevenLabs/Gemini harcaması). Ödeme sağlayıcısı karar bekliyor.
6. **Yayın:** YouTube OAuth istemcisi bizim doğrulanmış Google projemiz olur (kullanıcı kendi istemcisini kurmaz). Google'ın uygulama doğrulaması ve YouTube API denetimi gerekir.
7. **Gözlem ve güvenlik:** işlem günlüğü zaten var; erişim günlüğü, oran sınırlama, yedekleme, silme talepleri.

## 3. Kritik kararlar (kullanıcıdan)

| Karar | Seçenekler | Not |
|---|---|---|
| Remotion lisansı | Remotion şirket lisansı · HyperFrames'e geçiş | SaaS'ta ücretsiz lisans (≤3 kişi) yetmeyebilir; lisans şartları satın almadan önce Remotion ile netleştirilmeli. |
| Barındırma | Hetzner/OVH (ucuz CPU) · AWS (Lambda render) · Fly/Render | Veri konumu (KVKK) için AB/Türkiye bölgesi tercih. |
| Hedef müşteri | küçük ajans (3–10 kişi) · tek içerik üreticisi | Ekip rolleri ve onay akışının derinliğini belirler. |
| Dış servis modeli | BYOK · bizim hesabımız + kâr marjı | BYOK beta için daha basit ve risksiz. |
| Hukuk | KVKK aydınlatma, açık rıza, veri işleme sözleşmesi, kullanım şartları | Müşteri medyası kişisel veri içerir (yüz, ses). |

## 4. Önerilen beta yolu (karar sonrası)

1. **8.1 Çok kullanıcılı depo:** `Store` arayüzünü soyutla (dosya / Postgres + S3). Yerel sürüm dosyada kalır; testler iki arka uçta da çalışır.
2. **8.2 Hesap + çalışma alanı + marka erişimi**, imzalı dosya URL'leri.
3. **8.3 İş kuyruğu + işçiler** (içe aktarma, Whisper, render, paket); mevcut `Jobs` sınıfının dağıtık sürümü.
4. **8.4 Sır deposu (BYOK)**; mevcut `Secrets` arayüzüne üçüncü uygulama.
5. **8.5 Faturalandırma ve kota**, kullanım kayıtları (`kullanim.json` → tablo).
6. **8.6 Kapalı beta:** 3–5 ajans, gerçek kampanya paketi, ölçüm (render süresi, hata oranı, maliyet/çıktı).

Her adımın kabul testi mevcut e2e betiklerinin “uzak” sürümüdür (aynı senaryo, HTTP üzerinden).

## 5. Bilerek yapılmayanlar (beta kapsamı dışı)

- Gerçek zamanlı ortak düzenleme (aynı anda iki kişinin aynı zaman çizelgesi): işlem günlüğü buna hazırlıklı, ama beta sonrası.
- Reklam yayını ve bütçe yönetimi (Faz 7'de de kapsam dışıydı).
- Mobil uygulama (telefon şimdilik QR ile yükleme ve indirme için).
