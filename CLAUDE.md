# İçerik Fabrikası · Claude Code notları

Türkçe, Mac'te yerel çalışan içerik üretim ve video kurgu uygulaması. Kullanıcı Türkçe konuşur, yazılım uzmanı değildir (CapCut/Premiere/Lightroom kullanır); açıklamaları sade Türkçe yap, komutları kopyalanabilir ver. Ürün ileride SaaS olacak şekilde tasarlanıyor.

Durum, sıradaki işler ve doğrulanmayanlar: `docs/DEVAM.md`. Faz sırası (Faz 3–8, esas): `docs/FAZLAR.md`. SaaS kararları: `docs/SAAS.md`. İlk ürün planı ve mimari: `docs/PLAN.md`. Kullanım: `README.md`.

## Mimari (tek kural: her değişiklik bir işlem)
- `src/core` — saf TS, tarayıcı ve sunucu ortak: `schema.ts` (zod), `ops.ts` (`applyOp`: proje + işlem → yeni proje), `timeline.ts` (yerleşim, kadraj `computeBox`/`scaleFraming`, altyazı sayfaları, müzik eğrisi `musicGainAt`), `commands.ts` (Türkçe kural tabanlı komut → `Plan`), `formats.ts`, `looks.ts`, `lut.ts`, `refs.ts`, `channels.ts` (kanal profilleri, `captionsFor`), `brand.ts` (marka profili, `brandPlan`), `delivery.ts` (teslim kontrolleri, SRT/VTT).
- `src/remotion` — tek kompozisyon (`Main.tsx`): önizleme (Player) ve render aynı kod. Renk: `gl.ts` WebGL2 gölgelendirici (kamera LUT → ayarlar → görünüm → yaratıcı LUT). `GradedMedia.tsx` video/fotoğrafı tuvale çizer.
- `src/media` — ffprobe/ffmpeg içe aktarma (`ingest.ts`), kamera log algılama, `whisper.ts` (whisper.cpp), `verify.ts`.
- `src/server` — Fastify: `index.ts` (rotalar), `store.ts` (JSON proje + geçmiş), `service.ts` (içe aktarma/render işleri), `render.ts` (Remotion; Chrome indirilemezse sistem Chrome'u), `ai.ts` (isteğe bağlı Claude komut planlayıcı, `@anthropic-ai/sdk`), `mobile.ts` (QR telefon sayfaları), `secrets.ts`/`connections.ts` (anahtar kasası: Mac'te Anahtar Zinciri), `providers.ts`/`generate.ts` (ElevenLabs, Gemini), `brands.ts`, `delivery.ts` (kanal paketi), `copywriter.ts` (yayın metni), `youtube.ts`/`publish.ts` (YouTube'a yayın, OAuth PKCE).
- `src/mcp/server.ts` — MCP araçları (`.mcp.json`), uygulamanın HTTP API'sini çağırır.
- `web/` — Vite + React arayüz: `QuickEdit.tsx` (8 adım), `Studio.tsx` (komut paneli, medya, seçili öğe), `Timeline.tsx`, `Preview.tsx`, `steps/*`.

Veri: `~/İçerik Fabrikası/` (`FABRIKA_HOME`): `markalar.json`, `teslim/<marka>/<ürün>/<kampanya>/`, `kutuphane/` (salt-okunur orijinaller, önizleme kopyaları, library.json), `projeler/<id>/` (project.json, history.json, ops.jsonl, exports/), `modeller/`, `ayarlar.json` (model ayarları; anahtarlar kasada — anahtarı asla dosyaya/loga yazma).

## Kurallar ve tuzaklar
- Yeni özellik = önce `core/schema.ts` + `core/ops.ts` işlemi + birim testi, sonra arayüz/MCP. Arayüz, MCP ve komutlar aynı işlemleri kullanır.
- **zod v4'te `.partial()` varsayılanları doldurur** → kısmi güncellemelerde `patchOf(...)` kullan (`core/ops.ts`), asla `.partial()` değil.
- Kompozisyon 1080 tabanlı tasarlanır; çözünürlük render'da `scale` ile (720/1080/1440/2160). Önizlemede DPR kullanma (yalnız `getRemotionEnvironment().isRendering`).
- Remotion Player'a boş `src` verme (çöker); hazır olmayan kaynakta yer tutucu göster.
- Arayüz metinleri Türkçe; Stüdyo'da panel/iz adları kullanıcının isteğiyle kurgu programlarındaki İngilizce terimler (Media, Transcript, Color, Gallery, AI Tools, Command, Inspector, Deliver, Export; izler V1/V2/A1/A2/ST/T1/G1). Commit mesajları Türkçe; `Co-Authored-By` satırları korunur.
- CSS: genel sınıf adları (`.action`, `.target`, `.menu`) çakışır; yeni bileşenlerde önekli ad kullan. Tasarım belirteçleri `styles.css` sonundaki “Tasarım sistemi v2” bölümünde.
- Claude API kodu: varsayılan model `claude-opus-5-5`, kullanıcı ayarlardan Sonnet/Haiku seçebilir; zorunlu `tool_choice` yok (auto); Haiku'da `fallbacks` gönderme.
- Remotion lisansı: ≤3 kişilik ekip ücretsiz; büyürse şirket lisansı (alternatif: HyperFrames).

## Komutlar
```
npm run fabrika        # derle + başlat → http://localhost:4747
bash scripts/mac-uygulama.sh  # ~/Applications/İçerik Fabrikası.app (tek tıkla açılış)
npm run dev            # API 4747 + Vite 5173
npm test               # vitest (core, komutlar)
npm run typecheck
npm run e2e            # Faz 1 kabul testi (gerçek render + ölçüm)
npm run e2e:studio     # Faz 2 kabul testi
npm run e2e:marka      # Faz 6 (marka → kanal paketi)
npm run e2e:yayin      # Faz 7 (YouTube, sahte Google)
npm run e2e:anasayfa   # ana sayfa, telefon hedefi, yardım, üretim hattı/XML
npm run e2e:disses     # A1 dış ses: çakışanlar alt alta, seç/taşı/sil/geri al
npm run e2e:surukle    # kütüphaneden sürükle-bırak, zaman çizelgesi tutamağı, klip sil
```

## Bulut oturumunda (Linux konteyner) test
- Konuşma modeli indirilemeyebilir: `FABRIKA_TRANSCRIBER=fixture FABRIKA_FIXTURES=<medya klasörü>` (kelime zamanları `<dosya>.words.json`). Gerçek Whisper için "fredymail-pro" ortamı Hugging Face erişimli.
- Render tarayıcısı: `FABRIKA_BROWSER=/opt/pw-browsers/chromium_headless_shell-*/chrome-headless-shell-linux64/chrome-headless-shell` (veya sistem `google-chrome` otomatik bulunur). GL: `swangle` (Linux varsayılanı).
- Türkçe test sesi: `espeak-ng` (apt). Arayüz ekran görüntüsü: Playwright (`require('playwright')`, `--use-angle=swiftshader`).
- Port 4747'de eski süreç kalırsa: `lsof -ti tcp:4747 | xargs kill -9`.
