# index.html — Hedefli Yamalar

Bu dosyayı `index.html` üzerinde uygula. Her patch bağımsız olarak uygulanabilir.

---

## PATCH 1 — Eksik CSS Seçicileri (`.sort-btn`, `.ctx-menu`, `.aib-head`)

CSS bölümünde, seçicisiz "yetim" property blokları var. Örnek aranan pattern:

```css
/* YANLIŞ — seçici yok */
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
```

Bu üç bloğun hemen ÖNCESİNE doğru seçiciyi ekle:

### `.sort-btn` için:
Sıralama düğmeleri bloğunu bul (display:flex, cursor:pointer, gap:6px içeren ve sort ile ilgili):
```css
/* ÖNCE: */
  display: flex; align-items: center; gap: 6px; cursor: pointer;

/* SONRA: */
.sort-btn { display: flex; align-items: center; gap: 6px; cursor: pointer; }
```

### `.ctx-menu` için:
Bağlam menüsü bloğunu bul (position:absolute, background, border-radius, box-shadow, z-index:1000):
```css
/* ÖNCE: */
  position: absolute;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.35);
  z-index: 1000;

/* SONRA: */
.ctx-menu {
  position: absolute;
  background: var(--bg-secondary);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0,0,0,.35);
  z-index: 1000;
}
```

### `.aib-head` için:
AI bar başlığı bloğunu bul (display:flex, justify-content:space-between, font-weight:600):
```css
/* ÖNCE: */
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;

/* SONRA: */
.aib-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-weight: 600;
}
```

---

## PATCH 2 — Çift `toggleAIBar()` Tanımı

`function toggleAIBar()` iki kez tanımlı. İkincisi birincisini eziyor.

Arama: `function toggleAIBar(`

**İLK** tanımı koru (daha kapsamlı olan — `classList.toggle` veya `style.display` mantığı içeren).  
**İKİNCİ** tanımı tamamen sil (closing `}` dahil).

Nasıl ayırt edersin: genellikle ikincisi daha kısa / basittir.

---

## PATCH 3 — Nav-item'lara `data-folder` Ekle

Statik `<li>` / `<div>` nav öğeleri `data-folder` attribute'u eksik, bu yüzden drag-drop çalışmıyor.

Şu pattern'i ara:
```html
<li class="nav-item" onclick="setFolder('INBOX')">
```

Her birini şu şekilde güncelle (folder adını onclick'ten al):
```html
<li class="nav-item" data-folder="INBOX" onclick="setFolder('INBOX')">
```

Aynısını şu klasörler için yap: `Sent`, `Sent Messages`, `Drafts`, `Trash`, `Junk`, `Tüm Mailler`, `Increworks` ve diğer tüm statik nav-item'lar.

---

## PATCH 4 — `ctxMoveToFolder()` Backend'e Bağla

Mevcut hatalı kod:
```js
function ctxMoveToFolder(folder) {
  // sadece lokal tag ekliyor, backend'e gitmiyor
  addTag(state.currentHit.id, 'klasor:' + folder);
  closeCtxMenu();
}
```

Bunu şununla değiştir:
```js
async function ctxMoveToFolder(folder) {
  const id = state.currentHit?.id;
  if (!id) return;
  try {
    const res = await fetch(API + '/move', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, target_folder: folder }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    // UI'da anında güncelle
    state.currentHit.folder = folder;
    showToast('Taşındı: ' + folder);
    // Listeyi yenile
    await doSearch();
  } catch (e) {
    showToast('Taşıma hatası: ' + e.message, 'error');
  }
  closeCtxMenu();
}
```

---

## PATCH 5 — `.tag-pill.t-favori` CSS Ekle

CSS dosyasında `.tag-pill` tanımından sonra şunu ekle:
```css
.tag-pill.t-favori {
  background: #f59e0b22;
  color: #f59e0b;
  border-color: #f59e0b44;
}
.tag-pill.t-onemli {
  background: #ef444422;
  color: #ef4444;
  border-color: #ef444444;
}
.tag-pill.t-bekliyor {
  background: #8b5cf622;
  color: #8b5cf6;
  border-color: #8b5cf644;
}
```

---

## PATCH 6 — `showToast` yardımcı fonksiyon (eğer yoksa)

`ctxMoveToFolder`'da `showToast` kullanıldı. Eğer tanımlı değilse JS'ye ekle:
```js
function showToast(msg, type = 'success') {
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}
```

Ve CSS'e:
```css
.toast {
  position: fixed; bottom: 24px; right: 24px;
  padding: 10px 18px; border-radius: 8px;
  background: #22c55e; color: #fff; font-size: 14px;
  z-index: 9999; box-shadow: 0 4px 12px rgba(0,0,0,.3);
  animation: fadeIn .2s ease;
}
.toast-error { background: #ef4444; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; } }
```
