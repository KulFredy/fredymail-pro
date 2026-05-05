# FredyMail Pro

Zoom İthalat için AI destekli mail arama ve yönetim arayüzü.

## Özellikler

- 14.000+ mail Meilisearch'te indexli
- Fredy AI chat (intent-based: arama, taşıma, özetleme)
- Sağ tık → Klasöre Taşı, Etiketle, Snooze
- 6 etiket kategorisi (Acil, Influencer, İçerik, Toplantı, Favori, Yolda)
- Dinamik IMAP klasör listesi
- Özel akıllı klasörler
- Yıl ve tür filtresi
- Sürükle-bırak klasöre taşı
- Dark/Light tema

## Mimari

```
Meilisearch :7700  ←  mail_otonom.py (IMAP polling)
FastAPI     :8000  ←  app.py
Cloudflare  tunnel →  fredymailsearch.online
```

## Kurulum

```bash
# 1. Repoyu klonla
git clone https://github.com/KulFredy/fredymail-pro
cd fredymail-pro

# 2. .env oluştur
cp .env.example .env
# .env dosyasını düzenle (Gemini key + IMAP şifresi)

# 3. Python bağımlılıkları
cd backend
pip install -r requirements.txt

# 4. Başlat
FredyMail_Baslat.bat
```

## Başlatma Sırası

`FredyMail_Baslat.bat` çalıştır — 5 adım otomatik yapar:
1. pip install
2. Meilisearch başlat
3. Uvicorn (backend) başlat
4. /reindex çağır
5. mail_otonom.py başlat
6. Cloudflare tunnel başlat

## API

`http://localhost:8000/health` → sağlık kontrolü
`https://fredymailsearch.online` → dışarıdan erişim

## Geliştirme

CLAUDE.md dosyasını oku — Claude Code için tam context.
