# İçerik Fabrikası · Ürün Planı v0.1

> Durum: **onay bekliyor**. Bu belge kod yazılmadan önceki öneridir. Onaydan sonra yalnızca **Faz 1 (Instagram Hızlı Edit)** uçtan uca geliştirilir.
>
> Başlangıç varsayımları (değiştirilebilir): tek kullanıcı · Mac'te yerel çalışma · arayüz Türkçe · çalışma anında ücretli servis yok.

---

## 1. Günlük kullanım akışı

### Ana ekran
```
┌───────────────────────────────────────────────────────────────┐
│  İçerik Fabrikası                              Marka ⚙  Kütüphane │
│                                                               │
│  ▶ Devam et:  "Kafe Story · 6 Kas"   (son düzenleme 14:32)     │
│                                                               │
│  ┌──────────────────────┐   ┌──────────────────────┐          │
│  │ ⚡ Instagram Hızlı Edit │   │ 🎬 Kurgu Stüdyosu       │          │
│  │ Story · Reel · Post   │   │ 16:9 · kaynak oranı   │          │
│  └──────────────────────┘   └──────────────────────┘          │
│                                                               │
│  Son projeler ▸ kartlar (küçük önizleme, çıktı rozetleri)      │
└───────────────────────────────────────────────────────────────┘
```
Uygulama her açılışta son projeyi, son adımı ve oynatma imlecini geri yükler.

### Instagram Hızlı Edit (tek ekran, solda adımlar, sağda canlı telefon önizlemesi)

| # | Adım | Ne yaparım | Otomatik olan |
|---|---|---|---|
| 1 | **Ekle** | Mac'e sürükle-bırak **veya** "Telefondan ekle" → QR'ı okut → telefon galerisinden çoklu seçim | Yön düzeltme, iPhone HDR→SDR, HEIC→JPEG, önizleme kopyası (proxy), dalga formu, Türkçe çözümleme arka planda başlar. Orijinal dosyaya dokunulmaz. |
| 2 | **Biçim** | Story / Reel / Post. "+ Aynı projeden 4:5 post da ver" | 9:16 → 1080×1920, 4:5 → 1080×1350 |
| 3 | **Sırala & kısalt** | Klipleri sürükle, uç tutamaçlarıyla kısalt | Hedef süre göstergesi (ör. 15,0 sn) |
| 4 | **Kadraj** | Her klip için **Sığdır** (bulanık arka plan) ve **Doldur** (kırp) yan yana; Doldur'da kadrajı sürükle | Instagram arayüz güvenli alanı aç/kapat. Kadraj **çıktı başına** saklanır (post kadrajı Story'yi bozmaz) |
| 5 | **Renk** | Görünüm seç (Doğal, Sıcak, Soğuk, Canlı, Film, S/B) + yoğunluk | Tüm projeye veya tek klibe |
| 6 | **Müzik** *(fotoğraf postunda gizli)* | Kendi ses dosyam, seviye | "Konuşmada kıs" açık: −14 dB, 0,3 sn iniş, 0,6 sn dönüş |
| 7 | **Altyazı** *(fotoğraf postunda gizli)* | Önizlemede kelimeye tıkla → düzelt | Sadece konuşma olan bölümde; sessiz klipte "Konuşma bulunamadı, altyazı atlandı" |
| 8 | **Teslim** | Her çıktı kartında: Telefona indir (QR) · Klasörde göster · Açıklamayı kopyala · Müziksiz sürüm | Çözünürlük, codec, süre ffprobe ile doğrulanır, kartta ✓ görünür |

**Stüdyoda aç:** Hızlı Edit zaten tek bir zaman çizelgesi üretir. Stüdyo aynı projeyi açar; kesmeler, müzik, konuşma ve altyazı ayrı izlerde görünür (Faz 2).

---

## 2. İlk sürümün (Faz 1) kapsamı

**Var:**
- Proje oluştur / otomatik kaydet / yeniden aç, son konumdan devam
- Çoklu içe aktarma (Mac sürükle-bırak + aynı Wi-Fi üzerinden telefondan QR ile yükleme)
- iPhone/Android yön, HEIC, HDR (HLG/Dolby Vision) → SDR normalize; orijinaller salt-okunur arşivde
- Story / Reel (9:16) ve akış postu (4:5); bir projede birden çok çıktı
- Kırpma, sıralama, Sığdır/Doldur, elle kadraj kaydırma, güvenli alan katmanı
- 6 renk görünümü + yoğunluk (önizleme ve çıktıda birebir aynı formül)
- Kendi müziğim + konuşmada otomatik kısma (ducking)
- Yerel Whisper ile Türkçe çözümleme, kelime zamanlı altyazı, kelime düzeltme, videoya gömme
- Teslim: H.264/AAC MP4, JPEG, müziksiz sürüm, açıklama metni kopyalama, telefona indirme
- Geri al / yinele (her değişiklik bir işlem kaydı)
- **MCP sunucusu:** Claude Code / Claude Desktop aynı işlemleri araç olarak çağırabilir

**Yok (sonraki fazlar):** serbest dil ve mikrofonla komut (Faz 2), çok izli Stüdyo arayüzü (Faz 2), hareketli grafik ve `/KOMUT` sözlüğü (Faz 3), doğrudan Instagram yayını (Faz 4), Premiere'e zaman çizelgesi aktarımı (ayrı öneri).

---

## 3. En sade mimari

### Temel ilke: tek gerçek kaynağı = proje JSON'u
```
  Arayüz (React)      MCP sunucusu (Claude)     [Faz 2] Ses/yazı komutu
        │                     │                          │
        └──────────── İşlem (operation) ─────────────────┘
                              │   { type: "clip.trim", payload… }
                              ▼
                 @fabrika/core  ── doğrular, uygular, geçmişe yazar
                              │
                     project.json (zaman çizelgesi)
                     ┌────────┴─────────┐
                     ▼                  ▼
          Önizleme: Remotion Player   Son render: Remotion renderMedia/renderStill
          (tarayıcıda, anında)         (aynı React kompozisyonu, aynı JSON)
                                              │
                                      ffprobe ile çıktı doğrulama
```
- **Kurgu kararları kaynaktan ayrı:** JSON yalnızca `assetId + kaynak giriş/çıkış zamanı + kadraj + efekt` tutar. Kaynak dosyalar değişmez.
- **Her değişiklik bir işlem:** arayüz, MCP ve ileride sesli komut aynı işlem fonksiyonlarını çağırır. Geri al, yinele, "önceki sürüme dön" bu kayıttan gelir.
- **Önizleme = render:** ikisi aynı kompozisyonu aynı JSON ile çalıştırır; renk, altyazı, ducking ve kadraj farklı kodla iki kez yazılmaz.

### Bileşenler (tek repo, npm workspaces, TypeScript)
| Paket | Görev |
|---|---|
| `packages/core` | Proje şeması (zod), işlemler, geçmiş, zaman hesapları. Saf TS, test edilebilir. |
| `packages/media` | ffprobe/ffmpeg: içe aktarma, normalize, proxy, ses çıkarma, whisper.cpp çağrısı, çıktı doğrulama |
| `packages/compositions` | Remotion kompozisyonları: Story/Reel/Post, renk matrisi, altyazı, ducking |
| `apps/server` | Fastify: yerel HTTP API, iş kuyruğu (render/çözümleme), telefondan yükleme, dosya servisi |
| `apps/web` | Vite + React arayüzü (Türkçe), Remotion Player önizleme |
| `apps/mcp` | MCP sunucusu (stdio). Sunucunun API'sini araç olarak açar. Repodaki `.mcp.json` ile her Claude Code oturumunda otomatik yüklenir |

Tek komutla başlar: `npm run fabrika` → `http://localhost:4747` (ve aynı Wi-Fi'deki telefon için QR).

### Teknik kararlar
| Konu | Karar | Neden |
|---|---|---|
| Renderer | **Remotion** (Faz 1–3) | Aynı kompozisyonla hem canlı önizleme (Player) hem H.264/AAC render; altyazı ve ses eğrileri hazır; olgun. Renderer bir arayüz arkasında, gerekirse değiştirilebilir. |
| HyperFrames | Faz 3'te tekrar değerlendir | HTML tabanlı, ajan dostu, açık lisanslı. Ticarileşmede Remotion şirket lisansı gerekirse alternatif. |
| Renk | SVG `feColorMatrix` + yoğunluk ile birim matris arası geçiş | Tarayıcı önizlemesi ve Chrome tabanlı render birebir aynı sonucu verir |
| Konuşma | **whisper.cpp** (Metal hızlandırma), `large-v3-turbo` modeli, DTW kelime zamanlaması | Yerel, ücretsiz, Türkçe iyi; Homebrew ile kurulur |
| Konuşma algılama (ducking) | Whisper segmentleri + enerji eşiği | Ek model gerekmez; sessiz klipte altyazı atlanır |
| Medya | FFmpeg/ffprobe | Normalize (yön, HDR→SDR, sabit kare hızı), proxy, doğrulama |
| Depolama | Proje klasörü + JSON + SQLite (kütüphane dizini, iş kuyruğu) | Yerel, taşınabilir, yedeklenebilir. SaaS'ta Postgres + S3'e aynı arayüzle geçer |
| Premiere | OpenTimelineIO ile FCP XML aktarımı (sonra) | Abonelik önkoşul değil, isteğe bağlı |

### Disk düzeni
```
~/İçerik Fabrikası/
  kutuphane/originals/<sha256>.<uzantı>   # salt-okunur orijinaller (tekilleştirilmiş)
  kutuphane/cache/<sha256>/               # proxy, dalga formu, transcript.json, poster
  marka/brand.json                        # yazı tipi, renkler, altyazı stili, logo
  stil/kisisel.json                       # kalıcı kişisel tercihler ("altyazı beyaz, iki satır")
  projeler/<proje-id>/
    project.json                          # zaman çizelgesi + çıktılar
    history.jsonl                         # işlem kaydı (geri al / sürümler)
    exports/                              # MP4/JPEG çıktılar
```

### Proje JSON taslağı (özet)
```jsonc
{
  "id": "p_2026_11_06_kafe",
  "assets": ["a_foto", "a_ortam", "a_konusma", "a_muzik"],
  "timeline": {
    "clips": [
      { "id": "c1", "asset": "a_foto",    "in": 0,   "out": 3.0, "look": "inherit" },
      { "id": "c2", "asset": "a_ortam",   "in": 4.2, "out": 7.2 },
      { "id": "c3", "asset": "a_konusma", "in": 1.1, "out": 10.1 }
    ],
    "music":    { "asset": "a_muzik", "gainDb": -6, "duck": { "depthDb": -14, "attack": 0.3, "release": 0.6 } },
    "captions": { "source": "c3", "words": [ { "t0": 1.32, "t1": 1.71, "text": "Merhaba", "edited": false } ] },
    "look":     { "preset": "sicak", "intensity": 0.35 }
  },
  "outputs": [
    { "id": "o_story", "format": "story", "size": [1080, 1920],
      "framing": { "c1": { "mode": "fill", "x": 0.42, "y": 0.5, "zoom": 1 },
                   "c2": { "mode": "fit-blur" } } },
    { "id": "o_post", "format": "post", "size": [1080, 1350], "still": { "clip": "c1", "at": 0 },
      "framing": { "c1": { "mode": "fill", "x": 0.55, "y": 0.48, "zoom": 1 } } }
  ]
}
```

### MCP araçları (Faz 1)
`proje_listele`, `proje_ac`, `proje_olustur`, `medya_ice_aktar`, `bicim_ekle`, `klip_sirala`, `klip_kirp`, `kadraj_ayarla`, `gorunum_ayarla`, `muzik_ekle`, `altyazi_getir`, `altyazi_kelime_duzelt`, `geri_al`, `render_baslat`, `render_durumu`, `cikti_dogrula`.
Hepsi `core` işlemlerini çağırır; arayüzde yapılabilen her şey Claude'dan da yapılabilir.

### SaaS'a giden yol (şimdi bedava, sonra kolay)
- `core` ve `compositions` ortamdan bağımsız; depolama, kuyruk ve kimlik birer arayüz.
- Yerel → bulut: SQLite→Postgres, klasör→S3/R2, yerel render→render işçileri (veya Remotion Lambda), tek kullanıcı→hesap/ekip.
- İşlem kaydı sayesinde ileride çok kullanıcılı düzenleme ve denetim izi hazır olur.

---

## 4. Kabul testi (senin dosyalarınla, Faz 1 sonunda)

**Hazırlık:** Telefondan 1 fotoğraf, 1 kısa yatay ortam videosu, Türkçe konuştuğun 1 dikey klip; 1 müzik dosyası (kullanım hakkın olan).

1. `npm run fabrika` → ana ekran → **Instagram Hızlı Edit** → **Telefondan ekle** → QR → üç dosyayı tek seferde seç.
   ✓ Üçü kütüphanede, yönleri doğru, konuşma klibinde "Çözümleniyor…" sonra "Altyazı hazır".
2. Biçim: **Story** + "4:5 post da ver" işaretli.
3. Sıra: fotoğraf (3 sn) → ortam videosundan ~3 sn → konuşma cümlesi. ✓ Süre göstergesi ≈15 sn.
4. Ortam klibinde **Sığdır** ile **Doldur**'u yan yana gör; Doldur'u seç, kadrajı kaydır.
5. Renk: **Sıcak**, yoğunluk ~%35, tümüne.
6. Müzik ekle. ✓ Önizlemede fotoğraf ve ortam bölümünde müzik duyuluyor, konuşmada belirgin kısılıyor, sonra yumuşakça dönüyor.
7. Altyazı: bir kelimeyi önizlemede düzelt. ✓ Güvenli alan açıkken altyazı Instagram düğmelerinin altında kalmıyor.
8. Post çıktısı: fotoğrafın kadrajını kaydır. ✓ Story'deki açılış kadrajı değişmedi.
9. **Uygulamayı kapat, yeniden aç.** ✓ "Devam et" kartı, son adım ve düzeltilmiş kelime yerinde.
10. **Dışa aktar** → ✓ kartlarda:
    - `story.mp4`: 1080×1920, H.264 + AAC, ~15 sn, altyazı gömülü, sıcak ton
    - `post.jpg`: 1080×1350, aynı renk ayarı
    - `story_muziksiz.mp4`: konuşma ve altyazı korunmuş, müzik yok
11. **Telefona indir** (QR) → telefonda oynat. **Açıklamayı kopyala** çalışıyor.
12. **Sessiz klip testi:** konuşma klibini sessiz bir klip ile değiştir → ✓ "Konuşma bulunamadı, altyazı atlandı", çıktı yine üretiliyor.

Otomatik karşılığı: aynı senaryo, üretilmiş test medyasıyla (`npm test -- e2e`) çalışır ve ffprobe ile çözünürlük, codec ve süreyi doğrular.

---

## 5. Sonraki fazlar (özet)

| Faz | İçerik | Bitiş ölçütü | Çalışma anı maliyeti |
|---|---|---|---|
| 2 · Konuşarak kurgu | Stüdyo izleri, mikrofon (yerel Whisper) → komut → işlem planı; etkilenecek aralığı çizelgede göster, belirsizlikte iki aday zaman koduyla; geri al / sürüme dön; kişisel stil vs proje talimatı ayrımı; dış ses kaydı komuttan ayrı | Yatay videoda iki sesli revizyon + geri alma | Komut yorumlama için LLM: **MCP üzerinden Claude aboneliğinle ek ücretsiz**, uygulama içi bağımsız kullanımda Claude API anahtarı (komut başına çok düşük) |
| 3 · Motion & görsel | Marka klasörü, logo/başlık animasyonu (müzik vuruşu algılama), storyboard, `/KOMUT` sözlüğü + ekran görüntüsünden komut okuma; her komut için "gerekli girdi / yöntem / bu kurulumda kullanılabilir mi" tablosu | Ürün görselinden sabit post + kısa animasyon; aynı istek ekran görüntüsünden | Görsel üretim servisi (ücretli, önce önizleme + tahmini maliyet) veya Blender + 3B model (ücretsiz, yerel) |
| 4 · Doğrudan yayın | Resmi Meta API, hesap türü ve izinler resmi belgelerden doğrulanır; idempotent yayın (çift tıklama/zaman aşımında tek gönderi); yayın kimliği | Onaylı test yayını, kimlik döner | API ücretsiz; Profesyonel (İşletme/İçerik üreticisi) hesap + Meta uygulaması + medyanın herkese açık geçici URL'si gerekir (doğrulanacak) |

---

## 6. Değiştirilebilir varsayımlar
- Ducking: −14 dB, 0,3 sn iniş, 0,6 sn dönüş
- Altyazı: marka yazı tipi (yoksa Türkçe karakter destekli Inter Bold), beyaz + ince gölge, en çok 2 satır, alt güvenli alanın hemen üstü
- Fotoğraf klibi varsayılan 3 sn; Story hedefi 15 sn
- Whisper modeli `large-v3-turbo` (~1,6 GB, bir kez indirilir); düşük RAM'de `small`
- Telefondan yükleme yalnız aynı Wi-Fi, QR bağlantısında tek kullanımlık anahtar

## 7. Bilinen riskler
- iPhone HDR/Dolby Vision klipleri SDR'a çevrilirken ton biraz değişebilir; dönüşüm ayarı Faz 1'de gerçek iPhone dosyasıyla ayarlanacak.
- Whisper kelime zamanlaması ±100 ms sapabilir; kelime düzenleyicide zaman da ince ayarlanabilir.
- Instagram güvenli alan ölçüleri resmi değil, yaklaşık; ayarlanabilir katman olarak sunulur.
- Remotion render süresi Chrome tabanlıdır; 15 sn Story için Apple Silicon'da ~1 dk mertebesi beklenir (ölçülecek).
- Geliştirme bu bulut ortamında (Linux) yapılır; nihai kabul testi Mac'te.
