# FredyMail Pro — Claude Code Master Context

## ⚠️ GÜVENLİK
- `Gemini Api Key.txt` repodan sil, key'i rotate et
- `.env` dosyasını `.gitignore`'a ekle (IMAP şifresi var)

---

## SİSTEM MİMARİSİ

```
[Windows PC - Ofis]
  Meilisearch  :7700  ← 14.000+ mail, master-key: 700m_2026_Mail
  FastAPI      :8000  ← app.py (618 satır)
  mail_otonom  ←      IMAP polling (3dk / son 7 gün)
  cloudflared  →      fredymailsearch.online → :8000

[IMAP - Doruk.net]
  mail.zoomithalat.com:993 (SSL)
  fatih@zoomithalat.com
  Klasörler: INBOX(11413), Sent(120), Aykut(2515), Viltrox(42)...
```

## DOSYA YAPISI

```
D:\Mail_Arama Motoru\
  meilisearch.exe      (--master-key 700m_2026_Mail --db-path data.ms)
  cloudflared.exe
  mail_otonom.py

D:\msi\Desktop\fredymail-pro\
  backend\
    app.py             ← FastAPI 618 satır
    .env               ← GEMINI_API_KEY, IMAP creds
    requirements.txt
    fm_tags.json       {mail_id: ["acil","favori"]}
    fm_notes.json      {mail_id: "not"}
    fm_snooze.json     {mail_id: unix_ts}
    fm_reads.json      {mail_id: true}
  frontend\
    index.html         ← 3918 satır vanilla JS
  FredyMail_Baslat.bat
```

## ⚠️ BAT HATASI — --db-path eksik
Meilisearch data.ms'i kaybedeblir. Düzeltme:
```
meilisearch.exe --master-key 700m_2026_Mail --db-path "D:\Mail_Arama Motoru\data.ms"
```

---

## BACKEND API (app.py)

```
GET  /health
GET  /folders          → IMAP klasörleri + sayılar
POST /search           → SearchQuery → hits + AI summary + pagination
POST /move             → {id, target_folder}
POST /move_bulk        → {ids:[], target_folder}
POST /reindex          → IMAP'tan yeniden indexle
POST /ai_chat          → Intent-based AI: search/move/summarize/answer
POST /ai_action        → Seçili mail AI aksiyon
GET|POST|DELETE /tags
GET|POST|DELETE /notes
GET|POST|DELETE /snooze
GET  /snooze/due
GET|POST /reads
GET  /awaiting_reply
```

### SearchQuery
```python
class SearchQuery(BaseModel):
    q: str
    limit: int = 50
    offset: int = 0
    folder: Optional[str] = None
    year: Optional[str] = None   # "2025"|"2026"|"all"
    sort: str = "timestamp:desc"
    filter_type: Optional[str] = None
    ai_mode: bool = False
```

### Search Response
```json
{
  "summary": "AI özeti",
  "hits": [...],
  "facets": {"sender":{}, "folder":{}},
  "estimatedTotal": 14000,
  "hasMore": true,
  "nextOffset": 50
}
```

### /ai_chat Intent System (Gemini JSON)
```json
{
  "intent": "search|move|summarize|answer",
  "reply": "Türkçe yanıt",
  "search_query": "meilisearch sorgusu",
  "search_filters": {"folder":null, "sender":null, "year":null},
  "move_action": {"filter_sender":null, "filter_folder":null, "target_folder":""}
}
```

### Gemini Dual SDK (satır 31-65)
```python
try:
    from google import genai as _gn   # yeni SDK
    _gemini_new = _gn.Client(api_key=GEMINI_API_KEY)
except:
    import google.generativeai as _gl  # fallback
    _gemini_legacy = _gl.GenerativeModel("gemini-2.5-flash")
```

---

## FRONTEND (index.html)

### Tech
- Vanilla JS, CSS Variables, dark/light tema
- Syne + DM Sans + DM Mono font
- `const API = 'https://fredymailsearch.online'`

### State
```javascript
const state = {
  results: [],        // ham hits
  grouped: [],        // thread grupları
  folder: null,       // aktif IMAP klasörü
  year: 'all',
  filterType: null,   // 'pdf'|'excel'|'image'|'attachments'
  tagFilter: null,
  currentGroup: null,
  currentHit: null,
  totalHits: 0,
};
```

### Cache
```javascript
const Cache = {
  tags: {}, notes: {}, snoozes: {}, reads: {},
  _folderFacets: {}   // /folders API'den
};
```

### Local Storage
```
fm_custom_folders → [{name, query, icon, imapFolder}]
fm_meetings       → [{id, title, date, time, note, mailId}]
```

### Kritik Fonksiyonlar
```javascript
performSearch()            // arama + server yıl filtresi
renderGrouped()            // DOM render + drag-drop
showHit(gi, hi, el)        // mail detayı
quickAsk(preset)           // AI popup (mode: list|ai|action)
parseAndExecuteAction(msg) // 10 AI intent
buildSearchQuery(raw)      // OR/AND/exact normalize
loadDynamicFolders()       // /folders → sidebar
showContextMenu(e, gi)     // sağ tık (event delegation)
ctxMoveToFolder(name)      // /move endpoint
toggleFavorite()           // ⭐ favori
```

### Etiket Sistemi
```
acil       🔴 danger    influencer  💜 purple
icerik     🔵 blue      toplanti    📅 cyan
favori     ⭐ warn      yolda       🟢 green
```

### AI Mode/Match
```javascript
let aiMode = 'list';   // 'list'|'ai'|'action'
let aiMatch = 'any';   // 'any'(OR)|'all'(AND)|'exact'
```

---

## BİLİNEN SORUNLAR (ÖNCELİK SIRASI)

### 1. 🔴 KRİTİK — Bat'ta --db-path eksik
Meilisearch data.ms'i yanlış yerde açabilir → index kaybolur

### 2. 🔴 KRİTİK — Fredy AI /ai_chat'e bağlı değil
`quickAsk()` hâlâ `/search` kullanıyor. `/ai_chat` endpoint'i çok daha akıllı
(intent: search/move/summarize/answer) — frontend'i buna bağla

### 3. 🟡 ORTA — Context menü pozisyon
Sağ üst köşede açılıyor. Fix:
```javascript
const finalY = (e.clientY + 350 > window.innerHeight)
  ? e.clientY - 350 : e.clientY;
```

### 4. 🟡 ORTA — Klasöre Taşı submenu boş
`Cache._folderFacets` henüz dolu olmayabiliyor. Fix:
```javascript
async function showContextMenu(e, gi) {
  if (!Object.keys(Cache._folderFacets || {}).length)
    await loadDynamicFolders();
  // ...
}
```

### 5. 🟡 ORTA — Drag-drop data-folder eksik
`loadDynamicFolders()`'da her `.dyn-folder` elementine `data-folder="${name}"` ekle

### 6. 🟢 DÜŞÜK — timestamp=0 mailler
Bazı maillerde `timestamp: 0` → yıl filtresi yanlış. Fix: date string'den parse et

---

## CLAUDE CODE ÇALIŞMA KURALLARI

```
1. Dosyayı değiştirmeden önce oku
2. index.html'de { } brace balance = 0 olmalı
3. CSS'de selector satırını unutma (.class-name { şeklinde)
4. app.py değişince uvicorn --reload ile otomatik yenilenir
5. Test: curl http://localhost:8000/health
6. AI test: curl -X POST http://localhost:8000/ai_chat \
     -H "Content-Type: application/json" \
     -d '{"message":"viltrox sipariş maillerini listele"}'
7. Token: haiku=rutin, sonnet=karmaşık, opus=kritik bug
```

## MEİLİSEARCH POWERSHELL AYARLARI

```powershell
$h = @{'Authorization'='Bearer 700m_2026_Mail'}

# maxTotalHits
Invoke-RestMethod -Uri 'http://127.0.0.1:7700/indexes/emails/settings' `
  -Method Patch -Headers $h -ContentType 'application/json' `
  -Body '{"pagination":{"maxTotalHits":50000}}'

# Filterable + sortable
Invoke-RestMethod -Uri 'http://127.0.0.1:7700/indexes/emails/settings' `
  -Method Patch -Headers $h -ContentType 'application/json' `
  -Body '{"filterableAttributes":["sender","date","timestamp","size","folder"],"sortableAttributes":["timestamp","size","sender"]}'
```
