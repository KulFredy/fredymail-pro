import React, { useCallback, useEffect, useRef, useState } from 'react';
import { OffthreadVideo, continueRender, delayRender, cancelRender } from 'remotion';
import { parseCube, type Lut3D } from '../core/lut';
import type { Box } from '../core/timeline';
import type { Look } from '../core/schema';
import { Grader } from './gl';

const lutCache = new Map<string, Promise<Lut3D>>();
const loadLut = (url: string) => {
  let p = lutCache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`LUT yüklenemedi: ${url}`);
      return parseCube(await r.text());
    });
    lutCache.set(url, p);
  }
  return p;
};

const useLut = (url: string | null) => {
  const [lut, setLut] = useState<Lut3D | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!url) {
      setLut(null);
      setLoadedUrl(null);
      return;
    }
    let alive = true;
    loadLut(url)
      .then((l) => {
        if (!alive) return;
        setLut(l);
        setLoadedUrl(url);
      })
      .catch((e) => cancelRender(e));
    return () => {
      alive = false;
    };
  }, [url]);
  return { lut: url ? lut : null, ready: !url || loadedUrl === url };
};

export type GradedMediaProps = {
  kind: 'video' | 'image';
  src: string;
  srcW: number;
  srcH: number;
  box: Box;
  /** Bulanık arka plan (Sığdır modu) için kaplama kutusu */
  bgBox?: Box | null;
  look: Look;
  camLutUrl: string | null;
  lutUrl: string | null;
  trimBefore?: number;
  volume?: number | ((f: number) => number);
  muted?: boolean;
};

export const GradedMedia: React.FC<GradedMediaProps> = (props) => {
  const { kind, src, srcW, srcH, box, bgBox, look, camLutUrl, lutUrl } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const grader = useRef<Grader | null>(null);
  const lastSrc = useRef<TexImageSource | null>(null);
  const cam = useLut(camLutUrl);
  const lut = useLut(lutUrl);
  const input = useRef({ look, camLut: cam.lut, lut: lut.lut });
  input.current = { look, camLut: cam.lut, lut: lut.lut };

  // LUT'lar yüklenene kadar render beklesin
  const [lutHandle] = useState(() => (camLutUrl || lutUrl ? delayRender('LUT yükleniyor') : null));
  const lutHandleDone = useRef(false);

  // Çizim çözünürlüğü: çıktıda görünen boyut (kaynaktan büyük olmaz)
  const cw = Math.max(2, Math.round(Math.min(box.width, srcW || box.width, 4096)));
  const ch = Math.max(2, Math.round((cw * box.height) / box.width));

  const draw = useCallback(
    (source: TexImageSource) => {
      lastSrc.current = source;
      const c = canvasRef.current;
      if (!c) return;
      try {
        if (!grader.current) grader.current = new Grader(c);
        grader.current.draw(source, srcW, srcH, input.current);
        const bg = bgRef.current;
        if (bg) bg.getContext('2d')?.drawImage(c, 0, 0, bg.width, bg.height);
      } catch (e) {
        cancelRender(e as Error);
      }
    },
    [srcW, srcH],
  );

  useEffect(() => {
    if (lastSrc.current) draw(lastSrc.current);
    if (lutHandle !== null && cam.ready && lut.ready && !lutHandleDone.current) {
      lutHandleDone.current = true;
      continueRender(lutHandle);
    }
  }, [look, cam.lut, lut.lut, cam.ready, lut.ready, draw, lutHandle, cw, ch]);

  // Fotoğraf
  useEffect(() => {
    if (kind !== 'image') return;
    const handle = delayRender(`Görsel: ${src}`);
    let done = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      draw(img);
      if (!done) continueRender(handle);
      done = true;
    };
    img.onerror = () => cancelRender(new Error(`Görsel yüklenemedi: ${src}`));
    img.src = src;
    return () => {
      if (!done) continueRender(handle);
      done = true;
    };
  }, [kind, src, draw]);

  // WebGL bağlamını bırak (çok klipte bağlam sınırına takılmamak için)
  useEffect(
    () => () => {
      const gl = canvasRef.current?.getContext('webgl2');
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      grader.current = null;
    },
    [],
  );

  const bgAspectW = 48;
  const bgAspectH = Math.max(2, Math.round((48 * (bgBox?.height ?? 1)) / (bgBox?.width ?? 1)));

  return (
    <>
      {bgBox ? (
        <canvas
          ref={bgRef}
          width={bgAspectW}
          height={bgAspectH}
          style={{
            position: 'absolute',
            left: bgBox.left,
            top: bgBox.top,
            width: bgBox.width,
            height: bgBox.height,
            filter: 'blur(36px) brightness(0.72) saturate(1.1)',
            transform: 'scale(1.12)',
          }}
        />
      ) : null}
      <div style={{ position: 'absolute', left: box.left, top: box.top, width: box.width, height: box.height, overflow: 'hidden' }}>
        {kind === 'video' ? (
          <OffthreadVideo
            src={src}
            trimBefore={props.trimBefore}
            volume={props.volume}
            muted={props.muted}
            onVideoFrame={(f) => draw(f as TexImageSource)}
            toneMapped
            pauseWhenBuffering
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0 }}
          />
        ) : null}
        <canvas ref={canvasRef} width={cw} height={ch} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      </div>
    </>
  );
};
