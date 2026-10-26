# Güvenlik

## Tehdit modeli (tek kullanıcı, iş e-postası)

| Tehdit | Kontrol |
|---|---|
| İnternetten anonim erişim | Varsayılan olarak yalnızca `127.0.0.1` dinlenir. Dışa açma Cloudflare Tunnel ile ve senin onayınla yapılır. Tüm `/api` uçları oturum ister; anonim sağlık ucu ayrıntı vermez. |
| Parola tahmini | argon2id özeti. IP başına 15 dakikada 5, toplamda 30 başarısız deneme sonrası kilit. İsteğe bağlı TOTP (2 adımlı doğrulama). Önerilen ek katman: Cloudflare Access (e-posta OTP). |
| Oturum çalınması | 256-bit rastgele token; veritabanında yalnızca HMAC özeti tutulur. Çerez `HttpOnly; Secure; SameSite=Strict`. 12 saat boşta kalma ve 7 gün mutlak süre sınırı var. Çıkışta oturum sunucuda silinir. |
| CSRF | SameSite=Strict, Origin/Referer aynı site kontrolü ve özel başlık (`X-Requested-With: fredymail`) zorunlu. Bu başlık çapraz sitelerde CORS ön kontrolü gerektirir ve CORS kapalıdır. |
| Kötü niyetli mail HTML'i (XSS, izleme pikseli) | nh3 izin listesi temizliği (script, iframe, form, olay öznitelikleri ve `javascript:` silinir). Uzak görseller varsayılan olarak engelli. Ayrı CSP (`default-src 'none'`, script yok) ve `sandbox` iframe kullanılır. Arama vurgusu HTML olarak değil, metin olarak işlenir. |
| Zararlı ekler | Ekler sunucuda hiçbir zaman çalıştırılmaz ve açılmaz (metin çıkarımı opsiyonel, saf Python, boyut sınırlı). İndirme daima `Content-Disposition: attachment` + `application/octet-stream` + `nosniff` + CSP sandbox ile yapılır. Dosya adı temizlenir, boyut sınırı uygulanır. |
| Prompt injection | Mail içeriği etiketli güvenilmez veri olarak gönderilir. Modelin aracı yoktur (gönderemez, silemez). Kaynak atıfları doğrulanır, uydurma olanlar silinir. Taslak alıcıları modelden değil yazışmadan belirlenir. Yabancı adres, alıcı önerisi ve talimat denemesi için uyarı gösterilir. Taslak asla gönderilmez. Test: `tests/test_ai.py::test_compromised_model_output_is_neutralized`. |
| Posta sunucusunda istenmeyen değişiklik | `ReadOnlyIMAP` sarmalayıcısı yazma metodlarını engeller. Statik test, kodda yazma çağrısı olmadığını doğrular. Gerçek Dovecot'a karşı yapılan testte senkron öncesi ve sonrası tüm bayraklar ve klasörler birebir aynı kaldı. |
| TLS | IMAP bağlantısı daima TLS (SSL/STARTTLS) ve sertifika doğrulaması ile yapılır. Düz metin bağlantı yapılandırılamaz. Kendinden imzalı sertifika testte reddedildi. |
| Sır sızıntısı | Sırlar yalnızca `.env` (chmod 600) veya `*_FILE` ile okunan dosyalarda durur. `.gitignore` bunları dışlar. Ayarlar ekranı sırları `***` olarak gösterir. Log filtresi parola/token/bearer/DB URL kalıplarını maskeler. Mail gövdesi loglanmaz. |
| AI maliyeti / veri gizliliği | [AI-GIZLILIK.md](AI-GIZLILIK.md) |
| Konteyner kaçışı | Root olmayan kullanıcı (uid 10001), salt okunur kök dosya sistemi, `cap_drop: ALL`, `no-new-privileges`. Postgres ve Meilisearch dışa kapalı iç ağda. |
| Sonsuz tekrar / kaynak tüketimi | Sınırlı yeniden deneme, devre kesici, döngü bütçesi, partiler arası bekleme, AI için günde çağrı ve $ sınırı, önbellek |

## Onay gerektiren işlemler

Aşağıdakiler kodda ya **hiç yok** ya da açık onay (`--yes` veya yapılandırma) gerektirir:

- Mail gönderme → **yok** (endpoint yok, `send_enabled: false`)
- Sunucuda silme/taşıma/bayrak değiştirme → **yok** (salt okunur sarmalayıcı)
- Canlı hesaptan senkron → `FM_SYNC_ENABLED=true` (öncesinde `fredymail sync-plan` ile kapsam gösterilir)
- Arama indeksini sıfırlama → `fredymail reindex --yes` (yalnızca FredyMail'in kendi indeksi; eski `emails` indeksine dokunmaz)
- Veritabanı geri yükleme → `scripts/restore.sh <dosya> --yes`
- Silinmiş mailleri kalıcı temizleme → `fredymail purge-deleted --yes`

## Kontrol listesi (canlıya almadan önce)

- [ ] GitHub reposu **private** yapıldı
- [ ] `.env` yalnızca sunucuda, `chmod 600`. `FM_SESSION_SECRET`, `FM_DB_PASSWORD` ve `FM_MEILI_MASTER_KEY` rastgele üretildi.
- [ ] `FM_COOKIE_SECURE=true`, `FM_TRUST_PROXY=cloudflare` (Tunnel varsa)
- [ ] `FM_TOTP_SECRET` ayarlandı ve kimlik doğrulayıcıya eklendi
- [ ] Cloudflare Access politikası (yalnızca senin e-postan) eklendi
- [ ] IMAP için mümkünse uygulama parolası kullanıldı; parola `FM_IMAP_PASSWORD_FILE` ile dosyadan okunuyor
- [ ] `docker compose ps` → `postgres` ve `meilisearch` için port yayını yok
- [ ] İlk yedek alındı ve geri yükleme provası yapıldı ([OPERASYON.md](OPERASYON.md))

## Test edilen güvenlik davranışları

`backend/tests/test_api.py`: anonim erişim reddi, çerez bayrakları, kaba kuvvet kilidi, CSRF (başlıksız, yabancı origin), güvenlik başlıkları, HTML temizliği ve görsel engeli, ek indirmenin dosya olarak sunulması ve başka mailin ekine erişim engeli, gönderme ucunun olmaması.
`backend/tests/test_imap.py`: sunucu durumunun değişmemesi, yazma metodlarının engellenmesi, statik kod kontrolü, TLS doğrulaması, kimlik hatasının raporlanması.
`backend/tests/test_ai.py`: injection içeren mailin etiketlenmesi, "ele geçirilmiş" model çıktısının etkisizleştirilmesi, kişisel veri maskeleme, bağlam sınırları.
