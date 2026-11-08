# İçerik Fabrikası

Telefondan ve kameradan gelen çekimleri dakikalar içinde Instagram Story, Reel ve post olarak hazırlayan, Mac'te yerel çalışan Türkçe içerik üretim uygulaması.

- **Faz 1 · Instagram Hızlı Edit** hazır: içe aktar → biçim → sırala/kısalt → kadraj → renk & ışık (LUT dahil) → ses & müzik → Türkçe altyazı & yazı → teslim.
- **Faz 2 · Kurgu Stüdyosu** hazır: yatay video, çok izli zaman çizelgesi, mikrofonla veya yazarak Türkçe kurgu komutları.
- **Faz 3 · Yerel Stüdyo ve ince kurgu** sürüyor: aranabilir Türkçe transkript, transkriptten kesme, komutun etkisini gösteren sağ panel, ses dalgası, I/O ile kare hassasiyetinde kesim, yumuşak ses geçişleri. İnternetsiz çalışır.
- **Faz 4 · Referanslar, LUT ve hareket** başladı: **LUT'larım** kütüphanesi (toplu içe aktarma, .3dl ve zip, arama, etiket, favori, karşılaştırma, teknik LUT uyarıları) **referanstan renk eşleme** **logo / başlık yerleşimi** (güvenli alan, orana özel konum, animasyon) ve **hareket/ritim** (Ken Burns, müzik vuruşu, kesimleri müziğe oturtma) hazır.
- Faz sırası: [docs/FAZLAR.md](docs/FAZLAR.md).

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
2. **Biçim.** Story / Reel (9:16), fotoğraf veya video postu (4:5), kare (1:1), yatay video (16:9). Aynı projeden birden çok oranda çıktı alırsınız; önizlemenin üstündeki **+ Oran ekle** ile her an yeni oran eklenir.
3. **Sırala & kısalt.** Alttaki şeritte sürükleyerek sıralayın, tutamaçlarla kısaltın. "Konuşmaya göre kısalt" tek tıkla konuşulan bölümü seçer.
4. **Kadraj.** Doldur / Sığdır (bulanık) / Sığdır (siyah) yan yana. Önizlemede sürükleyerek kaydırın, tekerlekle yakınlaştırın. Kadraj her çıktı için ayrı saklanır.
5. **Renk & ışık.** Hazır görünümler + yoğunluk, pozlama/kontrast/sıcaklık… ayarları, kendi `.cube` LUT'larınız. Log çekimler için klip başına **kamera dönüşümü**: Sony S-Log3/S-Log2, Panasonic V-Log, Canon Log 2/3, Fujifilm F-Log/F-Log2, Nikon N-Log, DJI D-Log, Apple Log, ARRI LogC3. Sony log çekimleri dosyadan otomatik algılanır.
6. **Ses & müzik.** Üç müzik modu: **Arka planda kısık**, **Konuşmada kıs**, **Sabit**. Klip başına ses seviyesi, susturma, "bu klipte müziği sustur".
7. **Yazı & altyazı.** Türkçe konuşma otomatik çözülür. Kelimeye tıklayınca önizleme o ana gider, çift tıklayınca düzeltilir. Konuşmasız videolara elle yazı eklenir. "Varsayılanım yap" altyazı stilinizi sonraki projelere taşır.
8. **Teslim.** Her çıktı için çözünürlük seçin: **720p · 1080p · 2K · 4K** (ör. 9:16 4K = 2160×3840, 16:9 4K = 3840×2160). Dışa aktar → H.264/AAC MP4 (BT.709) veya JPEG. 2K/4K render yaklaşık 2/4 kat uzun sürer; Instagram yüklerken 1080 genişliğe küçültür, 4K en çok YouTube ve arşiv için. Her çıktı ffprobe ile doğrulanır (çözünürlük, codec, renk, süre). **Müziksiz sürüm** (Instagram'ın müzik kütüphanesi için), **Telefona indir** (QR), açıklamayı kopyala, sürüm kaydet/geri dön.

Geri al / yinele: ⌘Z / ⇧⌘Z.

## Kurgu Stüdyosu (konuşarak kurgu)

Ana ekranda **Kurgu Stüdyosu** yeni bir yatay proje açar; Hızlı Edit'teki her proje de **Stüdyoda aç** ile aynı zaman çizelgesinde açılır.

- **Düzen:** solda **Medya** ve **Transkript**, ortada geniş önizleme, sağda **Komut** ve **Seçili öğe**. Sağ paneli köşedeki düğmeyle kapatınca önizleme genişler.
- **Transkript:** konuşmalı her klibin ve dış sesin Türkçe metni, kurgudaki zamanıyla. Zamana tıklayınca cümlenin başına, kelimeye tıklayınca tam o kelimeye gidilir; klip zaman çizelgesinde seçilir. Arama kutusuyla metinde arayın. Seçili cümlede iki ayrı eylem var: **Cümleyi kes** (kurgudan çıkarır, boşluk kapanır) ve **Altyazıyı düzelt** (yalnız yazıyı değiştirir, kurguya dokunmaz). Kesilen cümleler soluk ve üstü çizili kalır; ⌘Z ile geri gelir.
- **Zaman çizelgesi:** görüntü, üst iz (B-roll), dış ses, müzik, altyazı ve yazı ayrı izlerde; klip ve dış seste ses dalgası görünür. Cetvele tıklayıp sürükleyerek imleci taşıyın; klipleri sürükleyerek sıralayın. İz adlarındaki **+** ile o ize ekleme yapılır.
- **Kısayollar:** boşluk oynat/durdur · ← → bir kare · ⇧← → bir saniye · **I** giriş, **O** çıkış işareti, **⌫** işaretli aralığı sil (Esc temizler) · **S** veya ⌘B imleçte böl · ⌘Z geri al · F tam ekran.
- **Seçili öğe:** zaman çizelgesinde bir öğeye tıklayınca sağda ayarları açılır: kırpma, ses, **yumuşak ses girişi/çıkışı**, kadraj ve boyut, köşeye küçültme.
- **Önizleme:** tam ekran (F), **Kadrajı düzenle** ile görüntüyü sürükleyip tekerlekle boyutlandırma, altta render çözünürlüğü (720p · 1080p · 2K · 4K).
- **Komut:** sağda mikrofona basıp konuşun (bitince tekrar basın) ya da yazıp Enter'a basın. Panel ne anladığını (*Algılanan talep*), hangi işlemi, **hangi klipte ve hangi zaman aralığında** yapacağını ve kapsamını (tüm proje / yalnız bir çıktı / ayrı iz) gösterir; silinecek bir yazı gibi yan etkileri ⚠ ile uyarır. Aralığa tıklayınca o ana gidilir. **Önizle** ile kaydetmeden izleyin, **Uygula** ile kaydedin, **Vazgeç** ile bırakın; uyguladıktan sonra **Geri al** tek tıktır. İki olası yer varsa A/B seçenekleri zaman koduyla gelir.
- **LUT'larım (sol panel):** **Klasör** ile bir klasördeki bütün LUT'ları ya da **Dosya** ile `.cube`, `.3dl`, `.zip` dosyalarını tek seferde ekleyin (panele sürüklemek de olur). Sonunda rapor çıkar: eklendi / zaten vardı / okunamadı ve nedeni. Aynı LUT ikinci kez eklenmez; asıl dosyalarınıza dokunulmaz, kopyası `~/İçerik Fabrikası/kutuphane/luts` içinde saklanır. Her LUT o anki karede küçük resimle görünür (yaklaşık). Arayın, etiketle süzün, ★ ile favorileyin. Bir LUT'a tıklayınca büyük önizlemede kaydetmeden denenir. **Yoğunluk** ayarlanır, **Uygula** ile seçili klibe ya da **Tüm kurgu**ya kaydedilir, ⌘Z ile geri alınır. **Karşılaştır**: aynı karede önce/sonra ayırıcısı ve 4 LUT'a kadar yan yana. LUT'lar **görünüm** (normal video için) ve **teknik** (log, HDR gibi belirli bir giriş bekleyen) diye ayrılır; tür dosya adından tahmin edilir, **Düzenle** ile değiştirilebilir. Log LUT'u normal videoya uygulanınca ya da kamera dönüşümüyle çift dönüşüm olacaksa uyarı ve tek tıkla düzeltme çıkar.
- **Referans (sol panel):** rengini beğendiğiniz bir fotoğraf veya videoyu **Ekle** ile yükleyin (ya da Medya'da bir dosyada **Referans**). Referans videoya girmez. Videoda **Kare** kaydırıcısıyla hangi anın alınacağını seçin. **Rengi eşle**: seçili klibin (veya **Tüm kurgu**nun) rengi referansa yaklaştırılır; ne değişeceği sade Türkçe yazılır (ör. "daha sıcak", "daha kontrastlı"), referans/klip renk örnekleri ve önce/sonra görünür, büyük önizlemede kaydetmeden gösterilir. **Yoğunluk** (varsayılan %80), **Uygula** veya **Vazgeç**; ⌘Z ile geri alınır. Eşleme yaklaşıktır ve aşırı farklarda sınırlanır; sonuç LUT'larım'a "Referans · …" adıyla (#referans) kaydedilir, başka kliplerde de kullanılabilir.
- **Logo ve başlık:** zaman çizelgesindeki **LOGO** izinin **+** düğmesiyle logo yükleyin (saydam PNG veya SVG önerilir; saydamlık korunur) ya da Medya'da bir görselde **Logo**. Logo varsayılan olarak **sağ üstte** ve videonun tamamı boyunca durur. Seçili öğe panelinde: 9 noktalı **konum ızgarası** (sol üst … sağ alt), **boyut**, **saydamlık**, **giriş/çıkış** animasyonu (yok, solma, yukarı, büyüme), istenirse yalnız belirli bir aralık. Izgaradaki konum **her oranın kendi güvenli alanı içinde** hesaplanır: aynı "sağ üst" Story'de Instagram üst bilgisinin altına, yatay videoda köşeye düşer. **Yalnız bu oran** seçiliyken yapılan değişiklik yalnız o orana uygulanır (ör. Story'de logo sol altta, yatayda sağ üstte). Yazılar (başlık) da aynı ızgarayı, renk, yazı tipi, kutu/gölge/kontur ve animasyon seçeneklerini kullanır. Bir yazı veya logo herhangi bir oranda güvenli alanın dışına taşarsa uyarı çıkar; **Güvenli alana al** yalnız o oranı düzeltir (gerekirse küçültür). Dışa aktar penceresi de taşan öğeleri gösterir. Komutla: "logoyu sol alta al", "logoyu küçült", "logoyu biraz saydam yap", "logoyu kaldır". JPEG post çıktısında logo sabit görünür.
- **Hareket ve ritim:** seçili klipte **Hareket** bölümünden yavaşça yakınlaş/uzaklaş veya sola/sağa/yukarı/aşağı kay; **Miktar** ve istenirse **Yalnız girişte** (ör. ilk 1,5 sn). Komutla: "girişte yavaşça yakınlaş", "tüm kliplerde hafif yavaşça uzaklaşsın", "ilk 2 saniyede yavaşça sola kay", "hareketi kaldır". Müzik eklenince **vuruşları ve temposu (BPM)** yerelde bulunur, MÜZİK izinde ince çizgilerle görünür. **"Kesimleri müziğe oturt"** komutu klip geçişlerini en yakın vuruşa kaydırır (en çok 0,3 sn; önce gösterilir, onaylarsınız). Referans sekmesinde **Bölge seç** ile görselin yalnız bir kısmının (ör. yazı bandı dışarıda) rengi alınır.
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
| Altyazıları biraz yukarı kaydır · altyazıyı ortaya al · altyazıları kaydır | Altyazı konumu (yön yoksa seçenek sunar) |
| Görüntüyü %50 küçült · videoyu büyüt · sağ alt köşeye al · ortala · ekranı doldur · tüm klipleri sığdır | Kadraj: boyut (%10–%400) ve yer; küçülünce arkası bulanık dolar |
| Geri al · yinele | Son değişikliği geri alır / yeniden uygular |
| Logoyu sol alta al · logoyu küçült / büyüt · logoyu biraz saydam yap · logoyu kaldır | Logo konumu (her oranın güvenli alanı içinde), boyutu, saydamlığı |
| Girişte yavaşça yakınlaş · ilk 2 saniyede yavaşça sola kay · hareketi kaldır | Ken Burns hareketi (klip boyunca veya girişte) |
| Kesimleri müziğe oturt | Klip geçişlerini müziğin en yakın vuruşuna kaydırır |
| Orijinal haline dön · tüm değişiklikleri sil · projeyi sıfırla | Kesimler geri gelir, renk/LUT ve kadraj sıfırlanır; dış ses, müzik, yazılar ve altyazı düzeltmeleri kalır. Önce ne değişeceği gösterilir; ⌘Z ile geri alınır |
| Müziği konuşurken kıs · müziği arka planda kısık yap · müziği kaldır | Müzik modu |

Komut anlayıcı önce kendi kurallarıyla, tamamen yerel ve ücretsiz çalışır. Yön belirtmediğiniz komutlarda (ör. "altyazıları kaydır") seçenek sunar. "Geri al" / "yinele" de sesle çalışır.

**Komutları Claude ile anla (isteğe bağlı):** Komut panelindeki **Claude** düğmesinden Anthropic API anahtarınızı girin (console.anthropic.com → API Keys; hesapta kredi olmalı). Varsayılan **Her komutta**: söylediğiniz veya yazdığınız her komutu Claude yorumlar, kayıtlı kalıplara bağlı kalmazsınız (yalnız anlık "geri al / yinele" yerelde kalır). İnternet veya kredi sorunu olursa komut yerel anlayıcıyla yine yapılır. Model seçilebilir: Claude Opus 5.5 (en iyi anlama, komut başına ≈ 3–5 sent), Sonnet 5.5 (≈ 1,5–2,5 sent), Haiku 5.5 (≈ 0,1 sent); her komutun gerçek maliyeti komutun altında gösterilir. Anahtar yalnız bu Mac'te, **Anahtar Zinciri**'nde saklanır (eski sürümde `ayarlar.json`'da duran anahtar ilk açılışta otomatik taşınır ve dosyadan silinir). Claude yalnız plan önerir; her işlem uygulamanın kendi kurallarıyla doğrulanır, önizlenir ve onayınızla uygulanır. Claude Code kullanıyorsanız MCP `komut` / `islem_uygula` araçları aynı işi aboneliğinizle yapar.

## Bağlantılar ve üretim (isteğe bağlı, ücretli servisler)

Temel kurgu hiçbir bağlantı gerektirmez. **Ayarlar → Bağlantılar** (ana ekranda veya Stüdyo'da ⚙) dış servisleri gösterir:

| Servis | Ne için | Anahtar nereden |
|---|---|---|
| Claude (Anthropic API) | Serbest Türkçe kurgu komutları | console.anthropic.com → API Keys |
| ElevenLabs | Metinden Türkçe dış ses, kısa örnek, kalan karakter | elevenlabs.io → profil → API Keys |
| Google Gemini · Nano Banana 2 | Ürün fotoğrafına yeni arka plan (ürün/logo/etiket korunur) | aistudio.google.com → Get API key |
| Higgsfield | Görselden video — **doğrulanmadı**: anahtar saklanır, üretim şimdilik Higgsfield sitesinde | cloud.higgsfield.ai → API Keys (`KEY_ID:SECRET`) |
| YouTube | Onaylı paketi kanala yükleme (aşağıda) | Google Cloud → OAuth istemcisi (Masaüstü) |

- Anahtarlar Mac **Anahtar Zinciri**'nde (`icerik-fabrikasi` hizmeti) saklanır; tarayıcıya, proje dosyalarına, GitHub'a ve loglara yazılmaz. Arayüzde yalnız son 4 hanesi görünür. Mac dışında `~/İçerik Fabrikası/gizli.json` (yalnız kullanıcı okuyabilir). Ortam değişkenleri (`ANTHROPIC_API_KEY`, `ELEVENLABS_API_KEY`, `GEMINI_API_KEY`) de okunur.
- Her bağlantıda **Dene**: anahtar geçerli mi, ElevenLabs'te kalan karakter.
- Stüdyo'da sol panel **Üret** sekmesi:
  - **Dış ses:** metin, ses (marka sesleri işaretli) ve model seçilir; göndermeden önce karakter sayısı, tahmini kredi ve kalan kredi görünür. *Örneği dinle* yalnız ilk cümleyi üretir. *Üret ve ekle* sesi imleçteki yere DIŞ SES izine koyar. Aynı metin/ses/model tekrar istenirse kredi harcanmaz. Üretilmiş dış seste *Seçili öğe → Metni düzenle ve yeniden üret*.
  - **Ürün arka planı:** Medya'daki bir ürün fotoğrafı + tarif + oran. Göndermeden önce hangi fotoğrafın gideceği ve kaç görsel üretileceği gösterilir, onayınız istenir. 2 seçenek gelir; **onaylamadan Medya'ya eklenmez**. Onaylananı *Ana ize* veya *Üst ize* koyun.
- Üretilen her şey yerel medya olarak saklanır; servis kapansa da proje açılır. Kayıtlar: `~/İçerik Fabrikası/uretimler.json`.
- Claude kullanımı (uygulama içi komut sayısı ve tahmini maliyet) Claude satırında görünür. Claude Code ise kendi aboneliğinizle MCP üzerinden çalışır.

## Marka, kampanya ve kanal teslimi

**Markalar** (ana ekran) bir markanın her şeyini bir arada tutar: logo (saydam PNG/SVG), yazı/vurgu renkleri ve palet, başlık ve altyazı yazı tipi (Inter, Montserrat, Poppins, Playfair Display), metin tonu, etiketler, LUT favorileri (ilki “marka görünümü”), referans görseller, tercih edilen ElevenLabs sesi, ürünler (ad + kısa not) ve varsayılan kanallar. Kayıt: `~/İçerik Fabrikası/markalar.json`.

- **Marka kampanyası** (ana ekran): marka → ürün → kampanya seçilir; yeni Stüdyo projesi logosu, renkleri, yazı tipleri ve kanallarıyla açılır. Var olan projede üst çubuktaki **Marka seç** etiketinden aynı şey yapılır; ne değişeceği önceden listelenir, ⌘Z ile geri alınır. Ana ekranda projeler markaya göre süzülür, ürün · kampanya başlıklarıyla gruplanır.
- **Kanallar:** YouTube video (16:9 + 1280×720 küçük resim, altyazı ayrı .srt/.vtt dosyası), YouTube Shorts, Instagram Reels, Story, Instagram post, 4:5 reklam. Aynı kurgudan her kanal ayrı çıktıdır: kadraj, yazı/logo konumu, altyazı (aç/kapa, konum) ve kapak kanal başına ayrı.
- **Kanal paketi** (Stüdyo üst çubuğu): her kanal için yayın metni alanları (karakter sayacıyla: YouTube başlık 100, Instagram açıklama 2200 + en çok 30 etiket, reklam başlığı ~40 / metni ~125 önerilen), kapak karesi ve başlığı, teslim öncesi kontrol. **Metinleri yaz**: Claude bağlıysa marka tonu, ürün notu ve konuşmadan yazar; değilse internetsiz şablon.
- **Teslim öncesi kontrol:** ürün/marka adı yazımı (“Kahvemz” → “Kahvemiz”?; Türkçe ekler sorun sayılmaz), onaylanmamış üretilmiş görsel, marka logosu, kanal süre sınırı, güvenli alan ve siyah bant, altyazı (kapalı/emin olunamayan kelimeler), müzik–konuşma dengesi, ses yüksekliği (hedef −14 LUFS ±2, tepe ≤ −1 dBTP; paketten sonra ölçülür), metin sınırları, kapak. Düzeltilebilenlerde tek tıkla düzeltme düğmesi var.
- **Paketi hazırla:** seçilen kanallar render edilir; klasöre `marka_urun_kampanya_kanal.mp4`, kapaklar, `.srt/.vtt`, `metinler.txt` (kopyala-yapıştır), `kontrol.txt`, `paket.json` ve hepsinin `.zip`'i yazılır (`projeler/<id>/exports/paket_…`). **Onayla** ile paket `~/İçerik Fabrikası/teslim/<marka>/<ürün>/<kampanya>/` altına kopyalanır. Orijinaller (kütüphane), varyantlar (exports) ve onaylı sonuçlar ayrı kalır.
- Claude Code (MCP): `marka_listele`, `marka_uygula`, `kanal_ekle`, `teslim_kontrol`, `yayin_metni_yaz`, `kanal_paketi`, `kanal_paketi_onayla`.

Platform süre/metin sınırları yayımlanan değerlerden alınmıştır ve değişebilir; güvenli alanlar yaklaşıktır.

## YouTube'a doğrudan yayın (isteğe bağlı)

Onaylanmış kanal paketindeki YouTube video veya Shorts çıktısı, uygulamadan doğrudan kanalınıza yüklenebilir (küçük resim ve Türkçe altyazıyla).

**Bir kerelik kurulum (~15 dk):**
1. console.cloud.google.com → yeni proje → **YouTube Data API v3**'ü etkinleştirin.
2. **OAuth izin ekranı:** Harici, uygulama adı “İçerik Fabrikası”, kendi Gmail adresinizi **test kullanıcısı** olarak ekleyin.
3. **Kimlik bilgileri → OAuth istemci kimliği → Masaüstü uygulaması.** İstemci kimliği ve gizli anahtarı kopyalayın.
4. Uygulamada ⚙ **Bağlantılar → YouTube → Anahtar ekle**: `İSTEMCİ_KİMLİĞİ:GİZLİ_ANAHTAR` → **Hesabı bağla** → Google'da izin verin. “Kanal: …” görünür. Belirteç Mac Anahtar Zinciri'nde saklanır.

**Yayın:** Kanal paketi → paketi **Onayla** → YouTube satırında **YouTube'a gönder…** → ne gideceğini görün (kanal, dosya, başlık, açıklama, etiketler, kapak, altyazı) → görünürlük (Özel / Liste dışı / Herkese açık ya da zamanlanmış) → “çocuklara yönelik” ve “yapay zekâyla üretilmiş içerik” beyanı (projede üretilmiş görsel veya dış ses varsa önceden işaretli) → onay kutusu → **Yükle**. Durum “YouTube'da işleniyor” → “hazır” olur, bağlantı görünür. Aynı paket ikinci kez yüklenmez. Kontrolde hata olan veya onaylanmamış paket yüklenmez. Reklam ve bütçe kapsam dışıdır.

YouTube'un günlük API kotası ve küçük resim yükleme için kanal doğrulaması (telefon) YouTube tarafındadır. Instagram'a doğrudan yayın yok: Instagram'ın API'si videonun internette herkese açık bir adreste durmasını ister.

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

`durum`, `proje_listele`, `marka_listele`, `marka_uygula`, `kanal_ekle`, `teslim_kontrol`, `yayin_metni_yaz`, `kanal_paketi`, `kanal_paketi_onayla`, `youtube_onizleme`, `youtube_gonder`, `proje_olustur`, `proje_ac`, `medya_ice_aktar`, `komut`, `islem_uygula`, `klip_kirp`, `kadraj_ayarla`, `gorunum_ayarla`, `muzik_ayarla`, `altyazi_getir`, `altyazi_kelime_duzelt`, `geri_al`, `yinele`, `disa_aktar`, `is_durumu`, `ciktilari_listele`.

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
  baglantilar.json       bağlantı ayarları (anahtar yok)
  uretimler.json         dış ses / görsel üretim kayıtları
  kullanim.json          uygulama içi Claude kullanımı
  markalar.json          marka profilleri
  teslim/<marka>/<ürün>/<kampanya>/  onaylanmış kanal paketleri
```

## Geliştirme

```bash
npm run dev        # API (4747) + Vite (5173), dosya değişince yenilenir
npm test           # birim testleri
npm run e2e        # Faz 1 uçtan uca kabul testi (test medyası üretir, render eder, doğrular)
npm run e2e:studio # Faz 2: mikrofon yolundan iki revizyon, render, geri alma
npm run e2e:offline # Faz 3: internetsiz — eski projeyi aç, düzenle, yeniden aç, MP4 + JPEG, dış ses ölçümü
npm run e2e:ui     # Faz 3–4: tarayıcıda transkript/önizleme/zaman çizelgesi senkronu, komut akışı, LUT paneli (Playwright gerekir)
npm run lut-ekle -- ~/Desktop/LUTlarim   # bir klasördeki bütün LUT'ları (alt klasörler dahil) açık uygulamaya ekler
npm run e2e:ritim  # Faz 4.4: vuruş algılama (128 BPM), kesimlerin vuruşa oturması (render'da sahne değişimi), Ken Burns, referans bölgesi
npm run e2e:grafik # Faz 4.3: logo/başlık render'ı — köşe, saydamlık, Story güvenli alanı, animasyon, orana özel yerleşim
npm run e2e:ref    # Faz 4.2: referanstan renk eşleme, render'da renk farkı ölçümü
npm run e2e:lut    # Faz 4: LUT toplu içe aktarma (.cube/.3dl/zip/bozuk), tür tahmini, render'da piksel ölçümü
npm run e2e:yayin  # Faz 7: sahte Google sunucusuyla OAuth (PKCE), YouTube yükleme, küçük resim, altyazı, durum, sızıntı taraması
npm run e2e:marka  # Faz 6: marka → kampanya → kanal paketi (render, kapak, altyazı dosyası, LUFS, zip, onay) + arayüz
npm run e2e:baglanti # Faz 5: sahte ElevenLabs/Gemini/Claude sunucusuyla anahtar güvenliği, taşıma, maliyet, onay, arayüz
npm run typecheck
```

Ortam değişkenleri: `FABRIKA_HOME` (veri klasörü), `FABRIKA_PORT` (4747), `FABRIKA_WHISPER_BIN`, `FABRIKA_WHISPER_MODEL`, `FABRIKA_GL` (render WebGL arka ucu; Mac'te `angle`), `FABRIKA_BROWSER` (Remotion için Chrome yolu, normalde gerekmez).

## Bilinen sınırlar

- RAW fotoğraf (CR3/ARW/NEF/DNG) yok; Lightroom'dan JPEG verin.
- `/KOMUT` görsel komut sözlüğü yok. Doğrudan yayın yalnız YouTube'a (Instagram API'si herkese açık video adresi ister).
- Claude bağlantısı kapalıyken Stüdyo komutları kural tabanlıdır: listedeki kalıplara yakın cümleleri anlar.
- Kaynak oranında (ör. 4:3) çıktı ve Premiere'e aktarım henüz yok; 9:16, 16:9, 4:5 ve 1:1 çıktı verilir.
- Instagram güvenli alan ölçüleri resmi değil, yaklaşıktır.
- Remotion, en çok 3 kişilik ekiplere ücretsizdir; ekip büyürse şirket lisansı gerekir (plan: HyperFrames alternatifi).
