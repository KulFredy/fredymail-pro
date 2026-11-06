import { useState, useEffect } from 'react';
import { continueRender, delayRender } from 'remotion';
import '@fontsource/inter/latin-600.css';
import '@fontsource/inter/latin-ext-600.css';
import '@fontsource/inter/latin-800.css';
import '@fontsource/inter/latin-ext-800.css';
import '@fontsource/montserrat/latin-800.css';
import '@fontsource/montserrat/latin-ext-800.css';

let ready: Promise<unknown> | null = null;

/** Türkçe karakterler (ç ğ ı İ ö ş ü) latin-ext alt kümesindedir; render öncesi yüklenir. */
export const useFonts = () => {
  const [handle] = useState(() => delayRender('Yazı tipleri'));
  useEffect(() => {
    if (!ready) {
      const sample = 'ÇçĞğİıÖöŞşÜü Aa';
      ready = Promise.all([
        document.fonts.load(`800 48px Inter`, sample),
        document.fonts.load(`600 48px Inter`, sample),
        document.fonts.load(`800 48px Montserrat`, sample),
      ]).catch(() => undefined);
    }
    ready.then(() => continueRender(handle));
  }, [handle]);
};
