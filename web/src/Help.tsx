import React, { useState } from 'react';
import { Modal } from './ui';

/**
 * Uygulama içi yardım (internet gerekmez): görev bazlı kısa kılavuz ve Stüdyo kısayolları.
 * Düğme adları arayüzdekiyle aynıdır; kısayollar Studio.tsx ve Transport.tsx'teki gerçek tuşlardır.
 */

type GuideSection = { id: string; title: string; steps: React.ReactNode[]; note?: React.ReactNode };

const B: React.FC<{ children: React.ReactNode }> = ({ children }) => <b className="ui-name">{children}</b>;

export const GUIDE: GuideSection[] = [
  {
    id: 'telefon',
    title: 'Telefondan medya ekleme',
    steps: [
      <>Ana sayfada <B>Telefondan ekle</B>’ye basın; hedef olarak son projeyi, başka bir projeyi veya yeni projeyi seçip <B>QR kodu göster</B> deyin.</>,
      <>Telefon ile Mac aynı Wi-Fi ağında olsun. Telefonun kamerasıyla QR kodu okutun.</>,
      <>Telefonda açılan sayfada <B>Galeriden seç</B> ile fotoğraf, video ve müziği bir kerede seçin.</>,
      <>Mac’teki pencerede gelen dosya sayısı görünür; bitince <B>Projeyi aç</B>.</>,
    ],
    note: <>Proje içindeyken de Hızlı Edit’te <B>Telefondan ekle</B> düğmesi aynı işi yapar.</>,
  },
  {
    id: 'hizli',
    title: 'Instagram Hızlı Edit ile çıktı alma',
    steps: [
      <>Ana sayfada <B>Yeni proje</B> kutusundaki <B>Instagram Hızlı Edit</B>; Story, Reel veya post biçimini seçip <B>Oluştur</B>.</>,
      <>Soldaki adımları sırayla izleyin: <B>Ekle</B>, <B>Biçim</B>, <B>Sırala & kısalt</B>, <B>Kadraj</B>, <B>Renk & ışık</B>, <B>Ses & müzik</B>, <B>Yazı & altyazı</B>.</>,
      <><B>Teslim</B> adımında çözünürlüğü seçip <B>Dışa aktar</B>; yeşil kontroller dosyanın doğru çıktığını gösterir.</>,
      <>Dosyayı telefona almak için <B>Telefona indir</B>.</>,
    ],
  },
  {
    id: 'komut',
    title: 'Stüdyo’da sesli komutu önizleyip uygulama',
    steps: [
      <>Sağ panelde <B>Command</B> sekmesi ve <B>Talimat</B> seçili olsun (Dış ses değil).</>,
      <>Mikrofon düğmesine basıp konuşun (“Buradan sonraki üç saniyeyi kes”), bitince yeniden basın; ya da yazıp Enter.</>,
      <>Panel hangi klibin, hangi aralığın değişeceğini gösterir. <B>Önizle</B> ile deneyin; beğenirseniz <B>Uygula</B>, beğenmezseniz <B>Vazgeç</B>.</>,
      <>Uyguladıktan sonra fikriniz değişirse <B>Geri al</B> (⌘Z).</>,
    ],
  },
  {
    id: 'transkript',
    title: 'Cümleyi kes ile Altyazıyı düzelt farkı',
    steps: [
      <>Soldaki panel rayında <B>Transcript</B>’i açın; bir cümleye tıklayınca imleç oraya gider.</>,
      <><B>Cümleyi kes</B>: o cümleyi videodan çıkarır, sonrası kayar. Görüntü ve ses kısalır.</>,
      <><B>Altyazıyı düzelt</B>: yalnız ekrandaki yazıyı değiştirir (yanlış duyulan kelime). Video süresi değişmez.</>,
    ],
    note: <>Kısaca: kurguyu değiştirmek için kes, yazım hatası için düzelt.</>,
  },
  {
    id: 'lut',
    title: 'LUT seçip karşılaştırma',
    steps: [
      <>Stüdyo’da soldaki panel rayında <B>Color</B>’ı açın (LUT Library); LUT’larınızı <B>Klasör</B> veya <B>Dosya</B> ile ekleyin.</>,
      <>Bir LUT’a tıklayın: ana önizlemede hemen denenir, kaydedilmez. <B>Yoğunluk</B> ile ayarlayın.</>,
      <><B>Karşılaştır</B> ile aynı karede önce/sonra ve en çok 4 LUT’u yan yana görün.</>,
      <>Hedefi seçin (<B>Seçili klip</B> veya <B>Tüm kurgu</B>) ve <B>Uygula</B>.</>,
    ],
  },
];

export const GuideModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const [open, setOpen] = useState(GUIDE[0].id);
  return (
    <Modal title="Kullanım kılavuzu" onClose={onClose} width={760} testid="guide">
      <div className="guide">
        <nav className="guide-nav" aria-label="Bölümler">
          {GUIDE.map((g) => (
            <button key={g.id} className={`guide-tab ${open === g.id ? 'on' : ''}`} aria-current={open === g.id} onClick={() => setOpen(g.id)}>
              {g.title}
            </button>
          ))}
        </nav>
        {GUIDE.filter((g) => g.id === open).map((g) => (
          <section key={g.id} className="guide-body" aria-label={g.title}>
            <h4>{g.title}</h4>
            <ol>
              {g.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
            {g.note ? <p className="hint">{g.note}</p> : null}
          </section>
        ))}
      </div>
    </Modal>
  );
};

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const CMD = isMac ? '⌘' : 'Ctrl';

/** Stüdyo kısayolları — Studio.tsx (I/O, S, ⌘B, ⌫, Esc, ⌘Z), Timeline.tsx sağ tık menüleri ve Transport.tsx (boşluk, oklar, Home/End, F) ile birebir */
export const SHORTCUTS: { group: string; items: { keys: string[]; what: string }[] }[] = [
  {
    group: 'Oynatma ve gezinme',
    items: [
      { keys: ['Boşluk'], what: 'Oynat / durdur' },
      { keys: ['←', '→'], what: 'Bir kare geri / ileri' },
      { keys: ['⇧ ←', '⇧ →'], what: 'Bir saniye geri / ileri' },
      { keys: ['Home', 'End'], what: 'Başa / sona git' },
      { keys: ['F'], what: 'Tam ekran önizleme' },
    ],
  },
  {
    group: 'Kesme',
    items: [
      { keys: ['I'], what: 'Giriş işareti (imleçte)' },
      { keys: ['O'], what: 'Çıkış işareti (imleçte)' },
      { keys: ['⌫', 'Delete'], what: 'İşaretli aralığı sil (giriş ve çıkış varsa)' },
      { keys: ['Esc'], what: 'İşaretleri temizle' },
      { keys: ['S'], what: 'İmleçte böl' },
      { keys: [`${CMD} B`], what: 'İmleçte böl' },
    ],
  },
  {
    group: 'Öğeler',
    items: [
      { keys: ['Sağ tık'], what: 'Klip, ses, yazı, logo, kart: oynat, böl, çoğalt, taşı, düzenle, sil' },
      { keys: ['⌫', 'Delete'], what: 'Seçili öğeyi sil (işaret yoksa)' },
    ],
  },
  {
    group: 'Geçmiş',
    items: [
      { keys: [`${CMD} Z`], what: 'Geri al' },
      { keys: [`⇧ ${CMD} Z`], what: 'Yinele' },
    ],
  },
  {
    group: 'Komut kutusu',
    items: [{ keys: ['Enter'], what: 'Yazılı komutu gönder' }],
  },
];

export const ShortcutsModal: React.FC<{ onClose: () => void }> = ({ onClose }) => (
  <Modal title="Stüdyo kısayolları" onClose={onClose} width={560} testid="shortcuts">
    <p className="hint">Yazı alanındayken kısayollar çalışmaz; önce boş bir yere tıklayın. Bu pencereyi ana sayfada <kbd>?</kbd> ile de açabilirsiniz.</p>
    <div className="shortcuts">
      {SHORTCUTS.map((g) => (
        <section key={g.group}>
          <h4>{g.group}</h4>
          <dl>
            {g.items.map((it) => (
              <div key={it.what + it.keys.join()} className="sc-row">
                <dt>
                  {it.keys.map((k, i) => (
                    <React.Fragment key={k}>
                      {i ? <span className="muted"> / </span> : null}
                      <kbd>{k}</kbd>
                    </React.Fragment>
                  ))}
                </dt>
                <dd>{it.what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  </Modal>
);
