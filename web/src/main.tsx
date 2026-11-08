import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Home } from './Home';
import { QuickEdit } from './QuickEdit';
import { Studio } from './Studio';
import { AppProvider, ProjectProvider, useApp } from './state';
import { api } from './api';
import './styles.css';

const useHash = () => {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return hash;
};

const Toasts = () => {
  const { toasts } = useApp();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          {t.msg}
        </div>
      ))}
    </div>
  );
};

/**
 * Sunucu izleme: uygulama kapatılınca/güncellenince açık pencere bunu söyler;
 * sunucu yeni sürümle geri gelince sayfa kendiliğinden yenilenir (eski arayüzle kalmaz).
 */
const ServerWatch = () => {
  const [down, setDown] = useState(false);
  const build = useRef<string | null>(null);
  useEffect(() => {
    let fails = 0;
    const tick = async () => {
      try {
        const r = await fetch('/api/health', { cache: 'no-store' });
        if (!r.ok) throw new Error(String(r.status));
        const h = (await r.json()) as { build?: string };
        if (build.current && h.build && h.build !== build.current) {
          location.reload();
          return;
        }
        build.current ??= h.build ?? null;
        fails = 0;
        setDown(false);
      } catch {
        fails++;
        if (fails >= 2) setDown(true);
      }
    };
    void tick();
    const t = setInterval(tick, 3000);
    return () => clearInterval(t);
  }, []);
  if (!down) return null;
  return (
    <div className="server-down" role="alert" data-testid="server-down">
      <div>
        <b>Uygulama sunucusu kapalı</b>
        <p>Güncelleme sonrasında ya da ⏻ ile kapatıldıysa normaldir. Spotlight'tan (⌘ Boşluk) “İçerik Fabrikası”nı açın; bu pencere sunucu geri gelince kendiliğinden yenilenir.</p>
        <button className="btn ghost" onClick={() => location.reload()}>
          Şimdi yenile
        </button>
      </div>
    </div>
  );
};

const App = () => {
  const hash = useHash();
  const m = /^#\/(proje|studyo)\/([\w-]+)/.exec(hash);
  // Hangi düzenleyicide açıldığını kaydet: ana sayfadaki “Son projeye dön” aynı yere götürür
  useEffect(() => {
    if (m) void api.projectOpened(m[2], m[1] === 'studyo' ? 'studio' : 'quick').catch(() => undefined);
  }, [m?.[1], m?.[2]]);
  return (
    <>
      {m ? (
        <ProjectProvider id={m[2]} key={m[2]}>
          {m[1] === 'studyo' ? <Studio /> : <QuickEdit />}
        </ProjectProvider>
      ) : (
        <Home />
      )}
      <Toasts />
      <ServerWatch />
    </>
  );
};

createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <App />
  </AppProvider>,
);
