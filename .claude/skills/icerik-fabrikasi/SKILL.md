---
name: icerik-fabrikasi
description: İçerik Fabrikası uygulamasında (yerel video kurgu, Instagram/YouTube teslim) MCP araçlarıyla proje açma, Türkçe kurgu komutu, renk/LUT, marka uygulama, teslim kontrolü, kanal paketi, Premiere/Resolve XML ve YouTube yayını. Kullanıcı bir projede kurgu, teslim, yayın veya “uygulamada şunu yap” dediğinde kullan.
---

# İçerik Fabrikası ile çalışma (MCP: `icerik-fabrikasi`)

Uygulama açık olmalı (Uygulamalar → İçerik Fabrikası, ya da `npm run fabrika`). Araçlar uygulamanın yerel API'sini çağırır; her değişiklik geri alınabilir bir işlemdir ve açık arayüze anında yansır.

## Akış
1. **Durum ve proje:** `durum` → `proje_listele` → `proje_ac` (ya da `proje_olustur`). Kullanıcı proje adı söylediyse adla eşleştir; emin değilsen sor.
2. **Kurgu:** Önce `komut` ile Türkçe talimatı plana çevir (yerel anlayıcı, ücretsiz). Plan doğruysa `islem_uygula`. Ayrıntılı ayar için `klip_kirp`, `kadraj_ayarla`, `gorunum_ayarla`, `muzik_ayarla`, `altyazi_kelime_duzelt`. Yanlışsa `geri_al`.
3. **Marka:** `marka_listele` → `marka_uygula` (logo, renk, yazı tipi, kanallar). `gorunum=true` yalnız kullanıcı marka LUT'unu isterse.
4. **Teslim:** `kanal_ekle` → `yayin_metni_yaz` (önce öneri; `uygula=true` kullanıcı onaylarsa) → `teslim_kontrol` (hataları düzelt: kontroldeki `fix.ops` → `islem_uygula`) → `kanal_paketi` → kullanıcı onaylarsa `kanal_paketi_onayla`.
4b. **Altyazı çevirisi:** `altyazi_ceviri_satirlari` → satırları çevir (satır sayısı ve zamanlar aynı; marka/ürün adları aynen) → `islem_uygula` ile `captions.setTranslation`. Transkript yanlış dildeyse (anlamsız kelimeler) önce kullanıcıya uygulamada Transcript → dil seçip yeniden çözmesini söyle; bozuk metni çevirme.
5. **Dış kurgu programı:** Premiere/Resolve için `premiere_xml` (kurgu iskeleti; renk/yazı taşınmaz). CapCut'a proje aktarılamaz: Deliver'daki video + .srt verilir.
6. **YouTube:** `youtube_onizleme` sonucunu kullanıcıya göster; görünürlüğü ve yüklemeyi **açıkça onaylamadan** `youtube_gonder` çağırma (`kullanici_onayladi=true` yalnız bu konuşmadaki açık onayla).

## Kurallar
- Ücretli servis (ElevenLabs, Gemini) ve yayın işlerinde önce ne gönderileceğini ve maliyeti söyle, onay al.
- Anahtarları asla isteme, yazma veya loglama; anahtarlar uygulamanın Ayarlar → Bağlantılar penceresinden ve Mac Anahtar Zinciri'nden gelir.
- Kullanıcı yazılım uzmanı değil: sonuçları sade Türkçe ve kısa anlat; dosya yollarını tam ver.
- Orijinal dosyalar salt-okunurdur; silme yerine projeden çıkar.
