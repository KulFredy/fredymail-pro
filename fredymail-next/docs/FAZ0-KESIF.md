# Faz 0 — Keşif raporu

Tarih: 26 Ekim 2026 · Ortam: Claude Code bulut oturumu (VPS'e ve Mac'e doğrudan erişim yok)

## 1. Doğrulanabilenler

| Konu | Bulgu | Kaynak / yöntem |
|---|---|---|
| GitHub `fredymail-pro` reposu | Neredeyse boş: tek commit'te eklenip sonra silinmiş `SearchBox.tsx` (tarayıcıdan doğrudan `localhost:7700` Meilisearch'e anahtarsız istek atan bir bileşen). **Repo herkese açık (public).** | `git log`, GitHub |
| Eski kod (`backend/app.py`, `frontend/index.html`, `scripts/mail_otonom.py`) | Bu ortamda **yok**. VPS'te `/data/.openclaw/workspace/projects/fredymail-pro/` ve Mac'te `Masaüstü/fredymail-pro` (5,1 MB, 22 öğe) altında duruyor. Windows PC'de de parça kalmış olabilir. Okunamadı → içeriği hakkında varsayım yapılmadı. | Dosya sistemi taraması |
| VPS'teki Meilisearch | Hafıza notlarına göre konteyner adı `meilisearch-fredy`. **Master key 14 bayt olduğu için (en az 16 gerekli) crash-loop'ta.** Eski `emails` indeksi bu durumda kullanılamıyor. | `claude-remote` reposu: `memory/project_resume_point.md`, `project_mimari_temizlik_24eyl.md` |
| VPS AI altyapısı | `ai-shared` Docker ağı üzerinde LiteLLM proxy var (`litellm-litellm-1:4000`), OpenRouter'a bağlı, ucuz bir `flash-lite` katmanı tanımlı. Önceden yaşanmış bir ders: periyodik "heartbeat" çağrıları günde ~3 $ kredi yakmış. | `memory/project_openclaw_fredy.md` |
| Eski alan adı | `fredymailsearchonline.com` şu an **DNS'te çözümlenmiyor** (ENOTFOUND). Alan adının süresi dolmuş ya da Tunnel/DNS kaydı silinmiş olabilir. | WebFetch |
| Posta sağlayıcısı | Ekran görüntüsünde webmail `cmail16.webkontrol.doruk.net.tr` adresinde. Arayüz **IceWarp WebClient** (Karantina, Kara/Beyaz liste, Ertele, 2 adımlı doğrulama kapalı). Kota: **10 GB'ın 9 GB'ı dolu**. | Kullanıcının ekran görüntüsü |
| Klasör yapısı | Sunucuda İngilizce sistem klasörleri (`Sent`, `Trash`, `Spam`, `Archive`, `Drafts`), çok sayıda kişi/firma adıyla açılmış klasör (yüzlerce maillik olanlar dahil), alt klasörler (`Sent/Adobe`, `Süzgeçler/…`). Outlook ayrıca `Junk`, `Deleted Messages`, `Cevaplanması gerekenler`, `Faturalar`, `Fiyat Listeleri` klasörlerini gösteriyor. | Ekran görüntüleri |
| Outlook kuralları | Kullanıcı ifadesi: güncel kurallı klasör yapısı **Outlook'ta**; sunucu tam senkron değil. Bu durum, kuralların büyük ihtimalle istemci tarafında (Outlook açıkken) çalıştığını gösteriyor. | Kullanıcı |

## 2. Doğrulanamayanlar (VPS'te yapılmalı)

Aşağıdakiler bu bulut ortamından erişilemediği için **doğrulanmadı**. `docs/DAGITIM.md` → "Ön kontrol" bölümündeki komutlarla VPS'te salt okunur olarak kontrol edilmeli:

- Çalışan konteynerler, kullanılan portlar (`docker ps`, `ss -ltnp`), `ai-shared` ağı
- `meilisearch-fredy` konteynerinin güncel durumu ve eski `emails` indeksindeki veri hacmi
- Eski FastAPI servisinin hâlâ çalışıp çalışmadığı, Cloudflare Tunnel yapılandırması
- `zoomithalat.com` için MX/SRV/autoconfig kayıtları ve IMAP sunucusunun gerçek adı/TLS sertifikası. Bu ortamdan DNS sorgusu yapılamadı. VPS'te `fredymail discover` komutu bunu **giriş yapmadan** raporlar.

## 3. Eski projeden korunacak işlevler

| Eski deneme | Yeni sistemde |
|---|---|
| IMAP ile mail çekme | ✅ Salt okunur, artımlı, UID/UIDVALIDITY tabanlı, kaldığı yerden devam eden senkron |
| Meilisearch `emails` indeksi | ✅ Yeni, ayrı `fm_messages` indeksi. Postgres'ten yeniden üretilebilir. Eski konteynere dokunulmaz. |
| FastAPI arama/AI uçları | ✅ Yeniden yazıldı: kimlik doğrulamalı, CSRF korumalı, testli |
| Gemini ile özet/taslak | ✅ Sağlayıcı bağımsız (OpenAI uyumlu uç = LiteLLM → Gemini/Claude/GPT…), kaynak gösteren, bütçe sınırlı |
| Tarih/klasör/gönderen/ek/fatura/fiyat listesi filtreleri | ✅ Hepsi var. Belge türü sınıflandırması eklendi (fatura, proforma, fiyat listesi, teklif, sipariş, ekstre, sözleşme, sevkiyat). |
| Yanıt bekleyen mailler | ✅ İki ayrı görünüm: "Yanıtlamam gerekenler" ve "Yanıt bekliyorum" |
| Etiket/not/snooze | ✅ Postgres'te kalıcı, aranabilir |
| Web arayüzü | ✅ Mobil + masaüstü, Türkçe, klavye kısayollu React arayüzü |

## 4. Sıfırdan tasarımda değişenler (ve nedenleri)

1. **Tarayıcı → Meilisearch doğrudan erişimi kaldırıldı.** Eski `SearchBox.tsx` arama motoruna anahtarsız/doğrudan gidiyordu; bu durum tüm mail içeriğini korumasız bırakır. Artık arama yalnızca oturumlu API üzerinden yapılıyor ve Meilisearch iç ağda kalıyor.
2. **Postgres doğruluk kaynağı.** Etiket, not, erteleme ve senkron kontrol noktaları kalıcı olarak Postgres'te tutuluyor. İndeks silinse bile tek komutla yeniden üretilir.
3. **Sunucuya yazmayan senkron.** `EXAMINE` ve `BODY.PEEK` kullanılıyor, yazma komutları kod seviyesinde engelli. Kurallı klasör yapın ve okundu bilgilerin değişmez. Bu davranış gerçek bir IMAP sunucusuna (Dovecot) karşı testle kanıtlandı.
4. **Aynı mail tek kayıt.** Aynı mail INBOX'ta ve `Faturalar`'da, ya da hem sunucuda hem Outlook arşivinde olsa bile bir kez saklanıyor; tüm konumları gösteriliyor.
5. **Outlook'taki güncel yapı için içe aktarma.** `.eml` klasör ağacı veya mbox içe aktarılabiliyor (`Outlook/...` önekiyle). Sunucudaki kopyalarla otomatik eşleşiyor.
6. **Akıllı klasörler.** Kurallar çalışmasa bile "Faturalar", "Fiyat listeleri" gibi görünümler belge türüne göre otomatik dolar. Bunlar sanal görünümler; sunucuya dokunmaz.
7. **Büyük mailde kısmi indirme.** 9 GB'lık kutuda ekleri indirmemek için 2 MB üzeri maillerin yalnızca metin parçaları çekiliyor. Ekler gerektiğinde tek tek, istek üzerine indiriliyor.
8. **Arka planda AI çağrısı yok.** Heartbeat dersinden çıkan kural: AI yalnızca kullanıcı tıkladığında çalışır. Günlük bütçe ve çağrı sınırı var.
9. **Gönderme yok.** MVP'de SMTP kodu bulunmuyor. Taslak kopyalanıp Outlook'tan gönderiliyor.

## 5. Mimari özet

Ayrıntı: [MIMARI.md](MIMARI.md).

```
 Tarayıcı (Mac / Windows / telefon)
        │ HTTPS
        ▼
 Cloudflare Tunnel (+ önerilen Cloudflare Access)      ← opsiyonel, onaydan sonra
        │
        ▼
 ┌──────────────── VPS: docker compose "fredymail" ─────────────────┐
 │  api (FastAPI + React arayüz, 127.0.0.1:8088)                     │
 │    ├── Postgres (iç ağ)      ← doğruluk kaynağı                    │
 │    ├── Meilisearch (iç ağ)   ← yeniden üretilebilir arama indeksi  │
 │    └── LiteLLM (ai-shared)   ← yalnızca kullanıcı tıklayınca       │
 │  worker ── IMAPS (salt okunur) ──► Doruk.net / IceWarp            │
 └───────────────────────────────────────────────────────────────────┘
```

## 6. Riskler

| Risk | Etki | Önlem |
|---|---|---|
| Repo herkese açık | Kod herkes tarafından görülebilir (sır yok, ama iş bilgisi sızabilir) | Sırlar yalnızca `.env`'de ve testlerde sahte veriler kullanılıyor. **Repoyu private yapmanı öneririm.** |
| IMAP sunucu adı/kimlik yöntemi doğrulanmadı | Bağlantı kurulamaz | `fredymail discover` aracıyla (giriş yapmadan) tespit edilecek |
| 2FA kapalı ve IMAP parolası = webmail parolası | Parola sızarsa hesap ele geçer | IceWarp'ta uygulama parolası destekleniyorsa ayrı parola kullan. Parola dosyada `chmod 600`. |
| Kota %90 dolu | Yeni mailler reddedilebilir (FredyMail'den bağımsız iş riski) | FredyMail yalnızca okur; büyük ekleri bulmak için "PDF ekleri / Excel ekleri" görünümleri kullanılabilir |
| Outlook istemci kuralları | Sunucu ile Outlook farklı görünür | Akıllı klasörler + Outlook içe aktarma. Kalıcı çözüm: kuralları IceWarp "Süzgeçler"e taşımak (senin onayınla, ayrı iş). |
| Eski Meilisearch crash-loop | Kaynak tüketimi, log gürültüsü | Yeni sistem ona bağlı değil. Durdurma kararı sende (onaysız dokunulmadı). |
| AI maliyeti | Beklenmedik harcama | Günlük $/çağrı sınırı, önbellek, arka plan çağrısı yok, LiteLLM tarafında ek limit |

## 7. Tahmini maliyet ve efor

- **Altyapı:** Mevcut VPS. Ek RAM yaklaşık 600–900 MB (Postgres ~150 MB, Meilisearch ~200–400 MB, API+worker ~250 MB). Disk: yalnızca metin ve meta veri tutulduğu için 9 GB'lık kutu için tahminen 0,5–1,5 GB.
- **AI:** `flash-lite` sınıfı modelle tipik bir yazışma özeti ~3–6 bin token, yani yaklaşık 0,001 $. 1 $/gün varsayılan bütçe, günde yüzlerce özete yeter.
- **Geliştirme:** Bu oturumda MVP'nin backend'i, arayüzü, testleri ve dokümanları tamamlandı. Kalan iş canlı geçişten ibaret: keşif, kapsam onayı, ilk senkron ve Tunnel. Senin onaylarınla tahminen 1–2 saatlik bir oturum.
