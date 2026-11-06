import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Home } from './Home';
import { QuickEdit } from './QuickEdit';
import { AppProvider, ProjectProvider, useApp } from './state';
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

const App = () => {
  const hash = useHash();
  const m = /^#\/proje\/([\w-]+)/.exec(hash);
  return (
    <>
      {m ? (
        <ProjectProvider id={m[1]} key={m[1]}>
          <QuickEdit />
        </ProjectProvider>
      ) : (
        <Home />
      )}
      <Toasts />
    </>
  );
};

createRoot(document.getElementById('root')!).render(
  <AppProvider>
    <App />
  </AppProvider>,
);
