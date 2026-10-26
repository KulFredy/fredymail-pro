# Mimari

## Bileşenler

| Servis | Görev | Ağ |
|---|---|---|
| `api` | FastAPI: oturum, arama, iş akışı, AI uçları. Derlenmiş React arayüzünü de sunar (tek origin → CORS gerekmez). | internal + egress (AI için) · yalnızca `127.0.0.1:8088` |
| `worker` | IMAP senkronu, indeksleme (outbox), uyarılar. AI çağırmaz. | internal + egress (IMAP için) |
| `postgres` | Doğruluk kaynağı: mailler, thread'ler, konumlar, kullanıcı durumu, kontrol noktaları | yalnızca internal |
| `meilisearch` | Tam metin arama indeksi (yeniden üretilebilir) | yalnızca internal |
| `migrate` | Tek seferlik `alembic upgrade head` | internal |
| `cloudflared` *(opsiyonel profil)* | Cloudflare Tunnel ile HTTPS erişimi | egress |

## Veri akışı

```
IMAP (EXAMINE, UID SEARCH, FETCH BODY.PEEK) ─┐
Outlook .eml / mbox içe aktarma ─────────────┼─► parse (MIME, charset, ek meta) ─► classify (belge/dosya türü,
Demo fixture'ları ───────────────────────────┘        bülten, injection şüphesi)
                                                          │
                                   ┌──────────────────────▼──────────────────────┐
                                   │ Postgres (tek transaction / parti)          │
                                   │  messages ◄── dedupe_key (Message-ID/özet)  │
                                   │  message_locations (klasör, UIDVALIDITY,UID)│
                                   │  threads  ◄── In-Reply-To/References/konu   │
                                   │  index_dirty = true  (outbox)               │
                                   └──────────────────────┬──────────────────────┘
                                                          │ worker: partiler halinde
                                                          ▼
                                               Meilisearch `fm_messages`
                                                          │
Tarayıcı ── /api/search ── metin varsa Meili, yoksa PG ───┘ ── kayıtlar daima PG'den okunur
        └── /api/ai/* ── kullanıcı tıklayınca: sınırlı bağlam → LiteLLM → doğrulanmış JSON
```

## Senkron algoritması (klasör başına)

1. Klasörü `EXAMINE` ile aç → `UIDVALIDITY`, `EXISTS`. UIDVALIDITY değiştiyse o klasörün konumlarını sıfırla. Mailler dedupe ile yeniden eşleşir, kopya oluşmaz.
2. `UID SEARCH SINCE <tarih>` → sunucudaki UID'ler. Bilinmeyen UID'leri en yeniden başlayarak klasör sınırı (`SYNC_MAX_MESSAGES_PER_FOLDER`) ve döngü bütçesi (`SYNC_MAX_MESSAGES_PER_CYCLE`) dahilinde al.
3. 25'lik partiler: `RFC822.SIZE FLAGS BODYSTRUCTURE`. ≤2 MB ise `BODY.PEEK[]`, büyükse `BODY.PEEK[HEADER]` ile metin bölümleri. Her mail kendi savepoint'inde yazılır, her parti commit'lenir (kontrol noktası). Partiler arasında bekleme (rate limit) yapılır.
4. Son 300 mailin bayrakları okunur: Outlook'ta okunan mail FredyMail'de de okundu olur, `\Answered` bilgisi "yanıtlamam gerekenler"den düşürülür.
5. Her N döngüde bir silinme kontrolü yapılır. Sunucuda artık olmayan konumlar kaldırılır; hiç konumu kalmayan mail `deleted_on_server` olarak işaretlenir ve aramadan çıkar (`purge-deleted` ile kalıcı silinir).

Hata davranışı: bağlantı hatasında en fazla 4 yeniden deneme yapılır (2, 4, 8, 16 sn + jitter). Sonra klasör `error` durumuna geçer ve devre kesici (1 dk → 1 saat üstel) devreye girer. Kimlik hatası yeniden denenmez; 30 dk beklenir ve uyarı gönderilir (hesap kilitlenmesin diye). Ayrıştırılamayan mail için "hata kaydı" tutulur ve aynı mail tekrar denenmez. Eşzamanlı iki senkron, ayrı bağlantıda tutulan bir PG advisory lock ile engellenir.

## Veri modeli (özet)

`accounts` · `folders` (ad, rol, köken: server/import/demo, UIDVALIDITY, kontrol noktası, durum, hata sayacı) · `messages` (başlıklar, metin, ham HTML, belge türleri, bayraklar, okundu/önemli/erteleme, `index_dirty`) · `message_locations` · `threads` (son yön, son gelen/giden tarih, insan mı) · `attachments` (ad, MIME, boyut, IMAP bölümü, sha256, isteğe bağlı çıkarılmış metin) · `tags`/`message_tags` · `notes` · `saved_searches` (akıllı klasörler) · `drafts` · `ai_runs` (maliyet/token/gecikme/önbellek) · `sync_runs` · `auth_sessions` · `login_attempts` · `kv`.

## Saklama politikası (depolama ve güvenlik dengesi)

| Veri | Tutuluyor mu? | Gerekçe |
|---|---|---|
| Başlıklar, düz metin gövde (≤200 bin karakter) | Evet | Arama ve AI için gerekli; küçük |
| HTML gövde | Evet (ham hali) | Gösterimde her seferinde temizlenir; temizleyici güncellenince eski mailler de korunur |
| **Ham MIME** | **Hayır** | Kaynak zaten IMAP sunucusu; gereksiz kopya ve saldırı yüzeyi |
| **Ek içerikleri** | **Hayır** | Yalnızca meta veri tutulur (ad, tür, boyut, sha256). İndirme isteğinde IMAP'ten o bölüm çekilir. Kutu 9 GB, büyük kısmı ek. |
| Ek metni (PDF/XLSX/CSV) | Opsiyonel (varsayılan kapalı) | ≤5 MB, ≤50 bin karakter. Saf Python ile çıkarılır, dosya çalıştırılmaz. |
| Sunucudan silinen mail | İşaretlenir, aramadan çıkar | `fredymail purge-deleted --days 30 --yes` ile kalıcı silinir |
| AI çıktıları | Evet (`ai_runs`) | Önbellek + maliyet denetimi. İstenirse tablo temizlenebilir. |

## Teknoloji kararları

- **FastAPI + SQLAlchemy 2 (senkron) + psycopg 3.** Tek kullanıcı için async karmaşıklığına gerek yok; thread havuzu yeterli.
- **Ayrı worker, kuyruk sistemi yok.** Redis/Celery yerine Postgres advisory lock, `kv` tablosu ve outbox (`index_dirty`). Daha az parça, daha az bakım.
- **Arayüz: Vite + React + TypeScript (Next.js değil).** SSR/SEO gerekmiyor (tek kullanıcı, giriş arkasında). Derlenmiş statik dosyaları API sunuyor: ayrı Node sunucusu yok, tek origin, sıkı CSP ve CORS'suz çerez oturumu mümkün. Next.js, ek bir çalışan süreç ve daha geniş saldırı yüzeyi demek olurdu.
- **Meilisearch v1.15.** Türkçe yerelleştirme (`localizedAttributes: tur, eng`), eş anlamlılar (fatura↔invoice, fiyat listesi↔price list), yazım toleransı. Vurgulama için HTML yerine özel işaretler kullanılıyor; istemci bunları güvenle `<mark>`a çeviriyor (XSS yok).
- **AI: OpenAI uyumlu tek arayüz.** VPS'teki LiteLLM üzerinden Gemini/Claude/GPT seçilebilir. Sağlayıcı değişince kod değişmez.

## İleride (MVP dışı)

- IMAP IDLE ile anlık bildirim (CONDSTORE/QRESYNC destekleniyorsa)
- Okundu/etiket bilgisini sunucuya geri yazma (ayrı onay gerektirir, varsayılan kapalı)
- SMTP ile gönderim (ayrı faz, açık onay, gönderim öncesi önizleme)
- Outlook `.olm`/`.pst` doğrudan içe aktarma (şimdilik `readpst` veya Finder'a sürükleme → .eml)
- Çoklu hesap (veri modeli `account_id` ile hazır)
