"""
FredyMail Pro — index.html yama scripti
Kullanım: python patch_index.py
index.html ile aynı klasörde çalıştır.
"""
import re, shutil, sys
from pathlib import Path

SRC = Path("index.html")
if not SRC.exists():
    print("HATA: index.html bulunamadı. Script ile aynı klasöre koy.")
    sys.exit(1)

shutil.copy(SRC, "index.html.bak")
print("✓ Yedek oluşturuldu: index.html.bak")

html = SRC.read_text(encoding="utf-8")
original = html

# ─────────────────────────────────────────────
# PATCH 1a — .sort-btn seçicisi eksik
# ─────────────────────────────────────────────
OLD = """.folder-badge { font-size:10px; font-family:var(--font-m); color:var(--text3); background:var(--bg3); padding:1px 6px; border-radius:10px; margin-left:auto; }


  padding: 4px 10px; border-radius: var(--r-sm);
  border: 1px solid var(--border); background: var(--bg3);
  color: var(--text3); font-size: 11px; cursor: pointer;
  font-family: var(--font-b); white-space: nowrap;
  transition: all var(--transition);
}"""
NEW = """.folder-badge { font-size:10px; font-family:var(--font-m); color:var(--text3); background:var(--bg3); padding:1px 6px; border-radius:10px; margin-left:auto; }

.sort-btn {
  padding: 4px 10px; border-radius: var(--r-sm);
  border: 1px solid var(--border); background: var(--bg3);
  color: var(--text3); font-size: 11px; cursor: pointer;
  font-family: var(--font-b); white-space: nowrap;
  transition: all var(--transition);
}"""
if OLD in html:
    html = html.replace(OLD, NEW, 1)
    print("✓ PATCH 1a — .sort-btn seçicisi eklendi")
else:
    print("⚠ PATCH 1a — kalıp bulunamadı, atlandı")

# ─────────────────────────────────────────────
# PATCH 1b — .ctx-menu seçicisi eksik
# ─────────────────────────────────────────────
OLD = """.ctx-has-sub { position: relative; }

  position: fixed; z-index: 999;
  background: var(--bg2); border: 1px solid var(--border2);
  border-radius: var(--r); box-shadow: var(--shadow);
  padding: 4px 0; min-width: 210px;
  animation: popIn .15s ease;
}"""
NEW = """.ctx-has-sub { position: relative; }
.ctx-menu {
  position: fixed; z-index: 999;
  background: var(--bg2); border: 1px solid var(--border2);
  border-radius: var(--r); box-shadow: var(--shadow);
  padding: 4px 0; min-width: 210px;
  animation: popIn .15s ease;
}"""
if OLD in html:
    html = html.replace(OLD, NEW, 1)
    print("✓ PATCH 1b — .ctx-menu seçicisi eklendi")
else:
    print("⚠ PATCH 1b — kalıp bulunamadı, atlandı")

# ─────────────────────────────────────────────
# PATCH 1c — .aib-head seçicisi eksik
# ─────────────────────────────────────────────
OLD = """/* AI SOR POPUP backdrop close */
  background: linear-gradient(135deg, var(--primary-dim), var(--accent-dim));
  border-bottom: 1px solid rgba(108,99,255,.2);
  padding: 10px 18px;
  flex-shrink: 0;
}"""
NEW = """/* AI SOR POPUP backdrop close */
.aib-head {
  background: linear-gradient(135deg, var(--primary-dim), var(--accent-dim));
  border-bottom: 1px solid rgba(108,99,255,.2);
  padding: 10px 18px;
  flex-shrink: 0;
}"""
if OLD in html:
    html = html.replace(OLD, NEW, 1)
    print("✓ PATCH 1c — .aib-head seçicisi eklendi")
else:
    print("⚠ PATCH 1c — kalıp bulunamadı, atlandı")

# ─────────────────────────────────────────────
# PATCH 2 — Çift toggleAIBar — ikincisini sil
# ─────────────────────────────────────────────
OLD = """// ── AI INLINE BAR (legacy toggle kept) ──
function toggleAIBar() { toggleAISorPopup(); }

// ── AI SOR POPUP ─────────────────
function toggleAIBar() {
  const bar = document.getElementById('aiInlineBar');
  const btn = document.getElementById('aiBtnToggle');
  const isOpen = bar.style.display !== 'none';
  bar.style.display = isOpen ? 'none' : 'block';
  btn.style.background = isOpen ? '' : 'var(--primary-dim)';
  btn.style.color = isOpen ? '' : 'var(--primary)';
  btn.style.borderColor = isOpen ? '' : 'rgba(108,99,255,.3)';
  if (!isOpen) setTimeout(() => document.getElementById('aibInput').focus(), 50);
}"""
NEW = """// ── AI INLINE BAR ──
function toggleAIBar() { toggleAISorPopup(); }"""
if OLD in html:
    html = html.replace(OLD, NEW, 1)
    print("✓ PATCH 2  — çift toggleAIBar düzeltildi")
else:
    print("⚠ PATCH 2  — kalıp bulunamadı, atlandı")

# ─────────────────────────────────────────────
# PATCH 3 — ctxMoveToFolder → backend /move
# ─────────────────────────────────────────────
OLD = """function ctxMoveToFolder(folderName) {
  if (ctxTargetGroup === null) return;
  const group = state.grouped[ctxTargetGroup] || [];

  // Check if it's a custom smart folder
  const customFolders = getCustomFolders();
  const custom = customFolders.find(f => f.name === folderName);

  if (custom) {
    // Tag all mails with folder name as tag
    group.forEach(async h => {
      const tags = LS.tags();
      const ex = tags[h.id] || [];
      const folderTag = folderName.toLowerCase().replace(/\\s+/g,'_').slice(0,20);
      if (!ex.includes(folderTag)) await LS.saveTag(h.id, [...ex, folderTag]);
    });
    toast(`📁 ${group.length} mail "${folderName}" klasörüne taşındı`, 'ok');
  } else {
    // It's an IMAP folder — just filter to show it
    toast(`📁 "${folderName}" klasörüne gidiliyor...`, 'info');
    state.folder = folderName;
    state.filterType = null;
    document.getElementById('listTitle').textContent = folderName;
    document.querySelectorAll('.nav-item, .dyn-folder').forEach(n => n.classList.remove('active'));
    performSearch();
  }
  removeContextMenu();
}"""
NEW = """async function ctxMoveToFolder(folderName) {
  if (ctxTargetGroup === null) return;
  const group = state.grouped[ctxTargetGroup] || [];

  const customFolders = getCustomFolders();
  const custom = customFolders.find(f => f.name === folderName);

  if (custom) {
    group.forEach(async h => {
      const tags = LS.tags();
      const ex = tags[h.id] || [];
      const folderTag = folderName.toLowerCase().replace(/\\s+/g,'_').slice(0,20);
      if (!ex.includes(folderTag)) await LS.saveTag(h.id, [...ex, folderTag]);
    });
    toast(`📁 ${group.length} mail "${folderName}" klasörüne taşındı`, 'ok');
  } else {
    const primary = group[0];
    if (!primary?.id) { toast('Mail ID bulunamadı', 'err'); removeContextMenu(); return; }
    try {
      const res = await fetch(`${API}/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: primary.id, target_folder: folderName }),
      });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      primary.folder = folderName;
      toast(`📁 Mail "${folderName}" klasörüne taşındı`, 'ok');
      performSearch();
    } catch (e) {
      toast('Taşıma hatası: ' + e.message, 'err');
    }
  }
  removeContextMenu();
}"""
if OLD in html:
    html = html.replace(OLD, NEW, 1)
    print("✓ PATCH 3  — ctxMoveToFolder backend'e bağlandı")
else:
    print("⚠ PATCH 3  — kalıp bulunamadı, atlandı")

# ─────────────────────────────────────────────
# PATCH 4 — .tag-pill.t-favori CSS
# ─────────────────────────────────────────────
OLD = """.tag-pill.t-fatura { color: var(--green); border-color: rgba(74,222,128,.25); background: var(--green-dim); }"""
NEW = """.tag-pill.t-fatura  { color: var(--green);  border-color: rgba(74,222,128,.25);  background: var(--green-dim); }
.tag-pill.t-favori  { color: var(--warn);   border-color: rgba(255,179,71,.25);  background: var(--warn-dim); }
.tag-pill.t-onemli  { color: var(--danger); border-color: rgba(255,77,109,.25);  background: var(--danger-dim); }
.tag-pill.t-bekliyor{ color: var(--purple); border-color: rgba(168,85,247,.25);  background: var(--purple-dim); }"""
if OLD in html:
    html = html.replace(OLD, NEW, 1)
    print("✓ PATCH 4  — .tag-pill.t-favori CSS eklendi")
else:
    print("⚠ PATCH 4  — kalıp bulunamadı, atlandı")

# ─────────────────────────────────────────────
# Kaydet
# ─────────────────────────────────────────────
if html != original:
    SRC.write_text(html, encoding="utf-8")
    print("\n✅ index.html güncellendi.")
else:
    print("\n⚠ Hiçbir değişiklik yapılmadı — kalıplar eşleşmedi.")
