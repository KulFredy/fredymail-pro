# İçerik Fabrikası

Telefondan ve kameradan gelen çekimleri dakikalar içinde Instagram Story, Reel ve post olarak hazırlayan, Mac'te yerel çalışan Türkçe içerik üretim uygulaması.

- **Faz 1 · Instagram Hızlı Edit** hazır: içe aktar → biçim → sırala/kısalt → kadraj → renk & ışık (LUT dahil) → ses & müzik → Türkçe altyazı & yazı → teslim.
- **Faz 2 · Kurgu Stüdyosu** hazır: yatay video, çok izli zaman çizelgesi, mikrofonla veya yazarak Türkçe kurgu komutları.
- Hareketli grafik ve doğrudan yayın sonraki fazlarda; plan: [docs/PLAN.md](docs/PLAN.md).

Güncellemek için (proje klasöründe): `bash scripts/guncelle.sh`

## Kurulum (Mac, Apple Silicon)

```bash
bash scripts/setup-mac.sh
```

Betik Homebrew ile Node.js, FFmpeg ve whisper.cpp'yi kurar, Türkçe konuşma modelini (~550 MB, bir kez) indirir ve arayüzü derler. Homebrew yoksa önce https://brew.sh.

```bash
npm run fabrika
```

Tarayıcıda **http://localhost:4747** açılır. Veriler `~/İçerik Fabrikası/` klasöründe durur; uygulamayı kapatıp açınca son proje ve son adım "Devam et" kartında gelir.

Çalışma anında hiçbir hesap, abonelik veya API ücreti gerekmez. Konuşma çözümü (Whisper), renk, render ve doğrulama tamamen Mac'te çalışır.

## Günlük kullanım

1. **Ekle.** Dosyaları sürükle-bırak yapın ya da **Telefondan ekle** QR kodunu okutup galeriden seçin (telefon ve Mac aynı Wi-Fi'de olmalı). Seçim sırası klip sırası olur. Orijinaller salt-okunur arşive kopyalanır, hiç değiştirilmez.
2. **Biçim.** Story / Reel (9:16), fotoğraf veya video postu (4:5), yatay video (16:9). Aynı projeden birden çok çıktı alırsınız.
3. **Sırala & kısalt.** Alttaki şeritte sürükleyerek sıralayın, tutamaçlarla kısaltın. "Konuşmaya göre kısalt" tek tıkla konuşulan bölümü seçer.
4. **Kadraj.** Doldur / Sığdır (bulanık) / Sığdır (siyah) yan yana. Önizlemede sürükleyerek kaydırın, tekerlekle yakınlaştırın. Kadraj her çıktı için ayrı saklanır.
5. **Renk & ışık.** Hazır görünümler + yoğunluk, pozlama/kontrast/sıcaklık… ayarları, kendi `.cube` LUT'larınız. Log çekimler için klip başına **kamera dönüşümü**: Sony S-Log3/S-Log2, Panasonic V-Log, Canon Log 2/3, Fujifilm F-Log/F-Log2, Nikon N-Log, DJI D-Log, Apple Log, ARRI LogC3. Sony log çekimleri dosyadan otomatik algılanır.
6. **Ses & müzik.** Üç müzik modu: **Arka planda kısık**, **Konuşmada kıs**, **Sabit**. Klip başına ses seviyesi, susturma, "bu klipte müziği sustur".
7. **Yazı & altyazı.** Türkçe konuşma otomatik çözülür. Kelimeye tıklayınca önizleme o ana gider, çift tıklayınca düzeltilir. Konuşmasız videolara elle yazı eklenir. "Varsayılanım yap" altyazı stilinizi sonraki projelere taşır.
8. **Teslim.** Dışa aktar → H.264/AAC MP4 (BT.709) veya JPEG. Her çıktı ffprobe ile doğrulanır (çözünürlük, codec, renk, süre). **Müziksiz sürüm** (Instagram'ın müzik kütüphanesi için), **Telefona indir** (QR), açıklamayı kopyala, sürüm kaydet/geri dön.

Geri al / yinele: ⌘Z / ⇧⌘Z.

## Kurgu Stüdyosu (konuşarak kurgu)

Ana ekranda **Kurgu Stüdyosu** yeni bir yatay proje açar; Hızlı Edit'teki her proje de **Stüdyoda aç** ile aynı zaman çizelgesinde açılır.

- **Zaman çizelgesi:** görüntü, üst iz (B-roll), dış ses, müzik, altyazı ve yazı ayrı izlerde. Cetvele tıklayıp sürükleyerek imleci taşıyın; klipleri sürükleyerek sıralayın.
- **Komut:** solda mikrofona basıp konuşun (bitince tekrar basın) ya da yazıp Enter'a basın. Komut önce zaman çizelgesinde işaretlenir (kırmızı: kesilecek, mavi: eklenecek). **Önizle** ile kaydetmeden izleyin, **Uygula** ile kaydedin. İki olası yer varsa A/B seçenekleri zaman koduyla gelir.
- **Talimat / Dış ses kaydı:** *Talimat* modunda söyledikleriniz yalnız komut olur, videoya girmez. *Dış ses kaydı* modunda kayıt oynatma imlecinden itibaren videoya ses olarak eklenir ve altyazısı çıkarılır.
- **Kişisel stil / bu proje:** "Bundan sonra…", "her zaman…" ile başlayan altyazı tercihleri kişisel stilinize kaydedilir; "bu sefer…" yalnız bu projeye not olarak kalır.
- Her komut tek bir geri alma adımıdır: ⌘Z, ya da Teslim'de kaydettiğiniz sürüme dönün.

Anlaşılan komutlar (örnekler):

| Söyleyin / yazın | Ne olur |
|---|---|
| Buradan sonraki üç saniyeyi kes | İmleçten sonraki 3 sn çıkar, sonrası kayar |
| İlk iki saniyeyi kes · son 1,5 saniyeyi sil | Baştan / sondan keser |
| İkinci kez söylediğim cümleyi çıkar | Tekrarlanan cümlenin ikincisini bulur ve çıkarır |
| “Bu kahve çok güzel” cümlesini sil | Tırnaklı cümleyi bulur |
| Ürünün adını söylediğim yerde yüklediğim yakın planı iki saniye göster, sesim devam etsin | Son yüklenen ve projede olmayan görüntüyü üst ize koyar; ürün adını bilmiyorsa adayları sunar |
| “Kahvemiz” dediğim yerde yakın planı göster | Kelimenin geçtiği yere koyar |
| Klibi buradan ikiye böl | İmleçte böler |
| Bu sefer siyah beyaz yap · biraz sıcak yap · bu klibi film yap | Renk görünümü (projeye veya seçili klibe) |
| Bundan sonra altyazılarımı beyaz ve iki satır yap | Altyazı stili + kişisel stile kaydet |
| Müziği konuşurken kıs · müziği arka planda kısık yap · müziği kaldır | Müzik modu |

Komut anlayıcı kural tabanlıdır ve tamamen yerel çalışır (ücretsiz). Anlamadığı cümlede örnek önerir. Daha serbest anlatım için Claude Code'dan MCP `komut` / `islem_uygula` araçlarını kullanabilirsiniz.

## Kendi dosyalarınızla kabul testi

Telefondan bir fotoğraf, kısa bir yatay ortam videosu ve Türkçe konuştuğunuz dikey bir klip, bir de müzik dosyası seçin.

1. `npm run fabrika` → **Instagram Hızlı Edit** → *Story* + *Fotoğraf postu* → Oluştur.
2. **Telefondan ekle** → QR → üç dosyayı tek seferde seçin. ✓ Klipler doğru yönde; konuşma klibinde mikrofon simgesi çıkar.
3. Sırala: fotoğraf (3 sn) → ortam (~3 sn) → konuşma. ✓ Toplam ≈15 sn.
4. Kadraj: ortam klibinde Doldur ile Sığdır'ı yan yana görün, birini seçin, gerekirse sürükleyin.
5. Renk: **Sıcak**, yoğunluk ~%35, tüm proje.
6. Müzik ekleyin. Konuşma algılandığı için **Konuşmada kıs** önerilir. ✓ Önizlemede fotoğraf ve ortamda müzik duyulur, konuşmada kısılır.
7. Altyazı: bir kelimeyi çift tıklayıp düzeltin. ✓ "Instagram alanları" açıkken altyazı yanıt alanının üstünde kalır.
8. Önizlemenin üstünden **Akış postu** sekmesine geçin, Kadraj'da fotoğrafı kaydırın. ✓ Story sekmesindeki açılış kadrajı değişmez.
9. Tarayıcı sekmesini kapatın, terminalde uygulamayı durdurup yeniden başlatın. ✓ "Devam et" kartı, son adım ve düzeltilmiş kelime yerinde.
10. **Teslim** → Story (*Müziksiz sürümü de ver* açık) ve post için **Dışa aktar**. ✓ Kartlarda yeşil kontroller: 1080×1920 H.264/AAC ≈15 sn, 1080×1350 JPEG.
11. **Telefona indir** → QR → dosyaları telefona alın, açıklamayı kopyalayın.
12. Sessiz bir klip deneyin. ✓ "Konuşma bulunamadı, altyazı atlandı", çıktı yine üretilir.

Aynı senaryonun otomatik sürümü: `npm run e2e` (üretilmiş test medyasıyla; çözünürlük, codec, süre, müzik kısma, LUT ve yeniden açmayı ölçerek doğrular).

## Claude ile kullanım (MCP)

Bu klasörde Claude Code açıldığında `.mcp.json` sayesinde **icerik-fabrikasi** MCP sunucusu otomatik tanınır. Uygulama açıkken (`npm run fabrika`) Claude şunları yapabilir:

`durum`, `proje_listele`, `proje_olustur`, `proje_ac`, `medya_ice_aktar`, `komut`, `islem_uygula`, `klip_kirp`, `kadraj_ayarla`, `gorunum_ayarla`, `muzik_ayarla`, `altyazi_getir`, `altyazi_kelime_duzelt`, `geri_al`, `yinele`, `disa_aktar`, `is_durumu`, `ciktilari_listele`.

Örnek: *"Kafe Story projesinde rengi film görünümüne al, yoğunluk %50; müziği arka planda kısık yap ve Story'yi dışa aktar."* Değişiklikler açık olan arayüze anında yansır ve arayüzden geri alınabilir.

Claude Desktop için `claude_desktop_config.json` içine:

```json
{
  "mcpServers": {
    "icerik-fabrikasi": {
      "command": "npx",
      "args": ["tsx", "/TAM/YOL/fredymail-pro/src/mcp/server.ts"],
      "env": { "FABRIKA_URL": "http://127.0.0.1:4747" }
    }
  }
}
```

## Mimari

```
Arayüz (React)   MCP (Claude)   [Faz 2] ses/yazı komutu
        └──────── işlem (op) ────────┘
                     ▼
        src/core: şema, işlemler, zaman çizelgesi (saf TS)
                     ▼
             project.json + history.json
          ┌──────────┴──────────┐
  Remotion Player (önizleme)   Remotion render (son çıktı)
          └── aynı kompozisyon: src/remotion ──┘
```

| Klasör | Görev |
|---|---|
| `src/core` | Proje şeması (zod), kurgu işlemleri, zaman çizelgesi, müzik eğrisi, altyazı sayfaları, LUT okuma |
| `src/media` | ffprobe/ffmpeg içe aktarma (yön, HEIC, HDR→SDR, 1080p önizleme kopyası), kamera/log algılama, whisper.cpp, çıktı doğrulama |
| `src/remotion` | Kompozisyon: WebGL2 renk motoru (kamera LUT → ayarlar → görünüm → yaratıcı LUT), kadraj, altyazı, yazılar, müzik |
| `src/server` | Fastify: yerel API, iş kuyruğu, render, telefon sayfaları (QR + anahtar) |
| `src/mcp` | MCP sunucusu |
| `web` | Arayüz |
| `assets/luts/kamera` | Kamera log → Rec.709 LUT'ları (`scripts/gen-luts.py` ile colour-science'tan üretildi) |

İlkeler: orijinaller değişmez; kurgu kararları kaynak zamanlarıyla JSON'da tutulur; önizleme ve son render aynı kompozisyonu aynı JSON ile çalıştırır; her değişiklik geri alınabilir bir işlemdir.

## Veri klasörü

```
~/İçerik Fabrikası/
  kutuphane/originals/   salt-okunur orijinaller (aynı dosya bir kez saklanır)
  kutuphane/cache/       önizleme kopyaları, kapaklar, dalga formları
  kutuphane/luts/        yüklediğiniz .cube LUT'lar
  kutuphane/library.json kaynak listesi ve konuşma çözümleri
  projeler/<id>/         project.json, history.json, ops.jsonl, versions/, exports/
  modeller/              Whisper modelleri
  stil/kisisel.json      kalıcı kişisel tercihler (altyazı stili)
```

## Geliştirme

```bash
npm run dev        # API (4747) + Vite (5173), dosya değişince yenilenir
npm test           # birim testleri
npm run e2e        # Faz 1 uçtan uca kabul testi (test medyası üretir, render eder, doğrular)
npm run e2e:studio # Faz 2: mikrofon yolundan iki revizyon, render, geri alma
npm run typecheck
```

Ortam değişkenleri: `FABRIKA_HOME` (veri klasörü), `FABRIKA_PORT` (4747), `FABRIKA_WHISPER_BIN`, `FABRIKA_WHISPER_MODEL`, `FABRIKA_GL` (render WebGL arka ucu; Mac'te `angle`), `FABRIKA_BROWSER` (Remotion için Chrome yolu, normalde gerekmez).

## Faz 1 sınırları

- RAW fotoğraf (CR3/ARW/NEF/DNG) yok; Lightroom'dan JPEG verin.
- Hareketli grafik, `/KOMUT` sözlüğü ve doğrudan Instagram yayını sonraki fazlarda.
- Stüdyo komutları kural tabanlıdır: listedeki kalıplara yakın cümleleri anlar; serbest anlatım için Claude bağlantısı sonraki adım.
- Kaynak oranında (ör. 4:3) çıktı ve Premiere'e aktarım henüz yok; Stüdyo 16:9, 9:16 ve 4:5 çıktı verir.
- Instagram güvenli alan ölçüleri resmi değil, yaklaşıktır.
- Remotion, en çok 3 kişilik ekiplere ücretsizdir; ekip büyürse şirket lisansı gerekir (plan: HyperFrames alternatifi).
