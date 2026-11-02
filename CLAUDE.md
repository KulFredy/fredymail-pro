# CLAUDE.md — KulFredy/fredymail-pro

Zoom İthalat için FredyMail Next (iş e-postası çalışma masası) ve Aylık Hero Ürünler Listesi otomasyonu.

**Önce oku:** `fredymail-next/docs/ALTYAPI.md` (sunucu, veri kaynakları, çalışma şekli, açık işler, gelecek fikirleri),
`fredymail-next/docs/HERO-PLAN.md` (Hero modülü), `fredymail-next/docs/MIMARI.md`, `fredymail-next/docs/AI-GIZLILIK.md`.

## Kurallar

- Kullanıcıyla Türkçe konuş. Kullanıcı yazılımcı değil: komutları kopyala-yapıştır hazır ver, nerede çalışacağını
  (VPS / Mac / Chrome'daki Claude) açıkça yaz.
- **Repo herkese açık:** şifre, anahtar, IP, Drive dosya kimliği, kişisel e-posta commit etme. Testlerde sentetik veri.
- AI yalnızca kullanıcı düğmeye basınca çalışır; worker/zamanlayıcıda AI çağrısı ekleme.
- VPS'i yorma (RAM ~%80): yeni konteyner yerine mevcut worker; periyodik işler seyrek (Hero: ayın 15'i ve 25'i).
- Mağaza (shop.zoomithalat.com) robots.txt `Crawl-delay: 30`: yalnızca site haritası, istekler arası 30 sn.
- Bu bulut ortamı mağazaya ve VPS'e erişemez; erişimi başka servislerle dolanma. VPS komutlarını kullanıcı (veya
  Chrome'daki Claude) hPanel terminalinde çalıştırır.

## Geliştirme

```bash
cd fredymail-next/backend
python3 -m venv .venv && .venv/bin/pip install -e '.[dev]'
.venv/bin/ruff check fredymail tests
.venv/bin/pytest -q tests/test_hero_*.py        # Hero testleri (bazıları Postgres ister: FM_TEST_DATABASE_URL)
```
Tam paket: `scripts/test.sh` (Docker ile Postgres + Meilisearch).
