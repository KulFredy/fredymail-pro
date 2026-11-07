import os from 'node:os';
import { randomBytes } from 'node:crypto';

/** Telefondan erişim için oturum anahtarı (sunucu her açıldığında yenilenir) */
export const MOBILE_TOKEN = process.env.FABRIKA_MOBILE_TOKEN ?? randomBytes(9).toString('base64url');

export const lanAddress = () => {
  const nets = os.networkInterfaces();
  const cands: string[] = [];
  for (const list of Object.values(nets)) {
    for (const n of list ?? []) if (n.family === 'IPv4' && !n.internal) cands.push(n.address);
  }
  // Ev ağları genelde 192.168.x / 10.x
  return cands.find((a) => a.startsWith('192.168.')) ?? cands.find((a) => a.startsWith('10.')) ?? cands[0] ?? null;
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const shell = (title: string, body: string) => `<!doctype html>
<html lang="tr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
:root{color-scheme:dark;--bg:#0d0e12;--card:#171920;--line:#262a35;--text:#f2f3f5;--muted:#9aa1ad;--accent:#ff7a3d}
*{box-sizing:border-box}body{margin:0;font:16px/1.45 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;background:var(--bg);color:var(--text);padding:20px 16px 40px}
h1{font-size:22px;margin:4px 0 4px}p{color:var(--muted);margin:0 0 18px}
.btn{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:18px;border-radius:14px;border:0;background:var(--accent);color:#1a0d06;font-weight:700;font-size:18px;text-decoration:none}
.card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px;margin:12px 0}
.bar{height:8px;background:var(--line);border-radius:6px;overflow:hidden;margin-top:10px}.bar>i{display:block;height:100%;width:0;background:var(--accent);transition:width .2s}
.row{display:flex;justify-content:space-between;align-items:center;gap:10px}.small{font-size:13px;color:var(--muted)}
.ok{color:#5ad18a}
</style></head><body>${body}</body></html>`;

export const uploadPage = (projectName: string | null) =>
  shell(
    'İçerik Fabrikası · Telefondan ekle',
    `<h1>Telefondan ekle</h1>
<p>${projectName ? `“${esc(projectName)}” projesine eklenecek.` : 'Kütüphaneye eklenecek.'} Fotoğraf, video ve müziği bir kerede seçebilirsiniz.</p>
<label class="btn" for="f">Galeriden seç</label>
<input id="f" type="file" multiple accept="image/*,video/*,audio/*" hidden>
<div id="list"></div>
<script>
const qs=new URLSearchParams(location.search);const f=document.getElementById('f');const list=document.getElementById('list');
f.onchange=()=>{const files=[...f.files];if(!files.length)return;
const card=document.createElement('div');card.className='card';
const total=files.reduce((s,x)=>s+x.size,0);
card.innerHTML='<div class="row"><b>'+files.length+' dosya gönderiliyor</b><span class="small" id="pct">%0</span></div><div class="small">'+(total/1048576).toFixed(1)+' MB</div><div class="bar"><i></i></div>';
list.prepend(card);
const fd=new FormData();files.forEach(x=>fd.append('files',x,x.name));
const xhr=new XMLHttpRequest();xhr.open('POST',location.pathname.replace('/m/','/api/m/')+'/upload'+(qs.get('p')?'?p='+qs.get('p'):''));
xhr.upload.onprogress=e=>{if(e.lengthComputable){const p=Math.round(e.loaded/e.total*100);card.querySelector('i').style.width=p+'%';card.querySelector('#pct').textContent='%'+p}};
xhr.onload=()=>{if(xhr.status<300){card.querySelector('b').innerHTML='<span class="ok">✓</span> '+files.length+' dosya eklendi';card.querySelector('#pct').textContent='Mac’te hazırlanıyor'}else{card.querySelector('b').textContent='Gönderilemedi: '+xhr.responseText}};
xhr.onerror=()=>{card.querySelector('b').textContent='Bağlantı koptu. Mac ile aynı Wi-Fi’de misiniz?'};
xhr.send(fd);f.value='';};
</script>`,
  );

export const downloadsPage = (
  token: string,
  projectName: string,
  items: { name: string; label: string; size: number; url: string }[],
  description: string,
) =>
  shell(
    'İçerik Fabrikası · Telefona indir',
    `<h1>Telefona indir</h1><p>${esc(projectName)}</p>
${items.length ? '' : '<div class="card">Henüz dışa aktarılmış dosya yok.</div>'}
${items
  .map(
    (i) => `<div class="card"><div class="row"><div><b>${esc(i.label)}</b><div class="small">${esc(i.name)} · ${(i.size / 1048576).toFixed(1)} MB</div></div></div>
<div style="height:10px"></div><a class="btn" href="${i.url}" download="${esc(i.name)}">İndir</a></div>`,
  )
  .join('')}
${
  description
    ? `<div class="card"><b>Açıklama</b><p style="white-space:pre-wrap;margin:8px 0 12px;color:var(--text)" id="d">${esc(description)}</p>
<button class="btn" onclick="navigator.clipboard.writeText(document.getElementById('d').textContent).then(()=>this.textContent='Kopyalandı ✓')">Açıklamayı kopyala</button></div>`
    : ''
}
<p class="small">Android: dosya “İndirilenler”e kaydedilir, Galeri’de görünür. iPhone: indirdikten sonra Paylaş → “Videoyu Kaydet”.</p>
<script>void ${JSON.stringify(token)}</script>`,
  );
