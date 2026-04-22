/**
 * APEX-Q Chart Generator
 *
 * Generates a dark-theme candlestick chart PNG with Elliott Wave labels,
 * key levels (invalidation, TPs, entry), and current price marker.
 *
 * Requires the `canvas` npm package (native binding for Cairo):
 *   Ubuntu/Debian: sudo apt-get install build-essential libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
 *   CentOS/RHEL  : sudo yum install gcc-c++ cairo-devel pango-devel libjpeg-turbo-devel giflib-devel
 *   Then         : npm install canvas
 *
 * If canvas is not installed the module exports null and the scanner falls
 * back to text-only Telegram messages automatically.
 */

let createCanvas;
try {
  ({ createCanvas } = require('canvas'));
} catch {
  createCanvas = null;
}

if (!createCanvas) {
  console.warn('[Chart] canvas paketi yok — grafik devre dışı, metin mesajı kullanılacak.');
  module.exports = { generateChart: () => null };
  return;
}

// ─── Colour palette (TradingView dark) ───────────────────────────────────────
const C = {
  bg:          '#131722',
  bgInner:     '#1e222d',
  grid:        '#2a2e39',
  text:        '#d1d4dc',
  textDim:     '#787b86',
  green:       '#26a69a',
  greenFill:   '#1a6b66',
  red:         '#ef5350',
  redFill:     '#8b1c1a',
  yellow:      '#ffd700',
  orange:      '#f5a623',
  white:       '#ffffff',
  tp:          '#4caf50',
  inv:         '#ef5350',
  entry:       '#ffd700',
  waveColors: ['#ffffff', '#38bdf8', '#818cf8', '#fb923c', '#a78bfa', '#34d399'],
};

// ─── Canvas dimensions ────────────────────────────────────────────────────────
const W = 1000, H = 560;
const PAD = { top: 48, right: 90, bottom: 44, left: 14 };
const CW  = W - PAD.left - PAD.right;
const CH  = H - PAD.top  - PAD.bottom;

// ─── Scale helpers ────────────────────────────────────────────────────────────
function makeScales(candles) {
  const highs  = candles.map(c => c[2]);
  const lows   = candles.map(c => c[3]);
  const minP   = Math.min(...lows)  * 0.9985;
  const maxP   = Math.max(...highs) * 1.0015;
  const range  = maxP - minP;
  const n      = candles.length;

  const xOf  = i  => PAD.left + (i / (n - 1)) * CW;
  const yOf  = p  => PAD.top  + CH - ((p - minP) / range) * CH;
  const pOf  = y  => minP + ((PAD.top + CH - y) / CH) * range;

  return { xOf, yOf, pOf, minP, maxP, n };
}

// ─── Drawing primitives ───────────────────────────────────────────────────────
function dashedHLine(ctx, y, color, label, labelSide = 'right', dash = [6, 4]) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth   = 1;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(PAD.left, y);
  ctx.lineTo(W - PAD.right, y);
  ctx.stroke();
  ctx.restore();

  if (label) {
    ctx.save();
    ctx.font      = 'bold 11px monospace';
    ctx.fillStyle = color;
    const x = labelSide === 'right' ? W - PAD.right + 4 : PAD.left + 4;
    ctx.fillText(label, x, y + 4);
    ctx.restore();
  }
}

function candleBar(ctx, x, barW, open, close, high, low, { xOf, yOf }) {
  const isGreen  = close >= open;
  const bodyTop  = yOf(Math.max(open, close));
  const bodyBot  = yOf(Math.min(open, close));
  const bodyH    = Math.max(bodyBot - bodyTop, 1);

  ctx.strokeStyle = isGreen ? C.green : C.red;
  ctx.fillStyle   = isGreen ? C.greenFill : C.redFill;
  ctx.lineWidth   = 1;

  // Wick
  ctx.beginPath();
  ctx.moveTo(x, yOf(high));
  ctx.lineTo(x, yOf(low));
  ctx.stroke();

  // Body
  ctx.strokeStyle = isGreen ? C.green : C.red;
  ctx.fillRect(x - barW / 2, bodyTop, barW, bodyH);
  ctx.strokeRect(x - barW / 2, bodyTop, barW, bodyH);
}

function waveMarker(ctx, x, y, label, colorIdx) {
  const color = C.waveColors[colorIdx % C.waveColors.length];
  const r = 9;

  // Circle
  ctx.beginPath();
  ctx.arc(x, y - r - 2, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // Vertical line from x-axis to marker
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(x, PAD.top + CH);
  ctx.lineTo(x, y - r - 2 + r);
  ctx.stroke();
  ctx.restore();

  // Label
  ctx.font      = 'bold 10px monospace';
  ctx.fillStyle = C.bg;
  ctx.textAlign = 'center';
  ctx.fillText(label, x, y - r - 2 + 4);
}

// ─── Main generator ───────────────────────────────────────────────────────────

/**
 * @param {number[][]}  candles     OHLCV array (last N)
 * @param {object}      wavePoints  { W0, W1, W2, W3, W4, W5 } prices
 * @param {object}      levels      { invalidation, tp1, tp2, tp3, entryLow, entryHigh, currentPrice }
 * @param {string}      symbol
 * @param {string}      timeframe
 * @param {string}      direction   LONG | SHORT
 * @param {object}      confidence  { total, interpretation }
 * @returns {Buffer|null}
 */
function generateChart(candles, wavePoints, levels, symbol, timeframe, direction, confidence) {
  if (!createCanvas) return null;

  const display = candles.slice(-50); // show last 50 candles
  const sc = makeScales(display);

  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  // ── Background ────────────────────────────────────────────────────────────
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = C.bgInner;
  ctx.fillRect(PAD.left, PAD.top, CW, CH);

  // ── Price grid (5 levels) ─────────────────────────────────────────────────
  for (let i = 0; i <= 4; i++) {
    const price = sc.minP + (sc.maxP - sc.minP) * (i / 4);
    const y     = sc.yOf(price);
    ctx.save();
    ctx.strokeStyle = C.grid;
    ctx.lineWidth   = 1;
    ctx.setLineDash([2, 4]);
    ctx.beginPath(); ctx.moveTo(PAD.left, y); ctx.lineTo(W - PAD.right, y); ctx.stroke();
    ctx.restore();
    ctx.font = '10px monospace'; ctx.fillStyle = C.textDim; ctx.textAlign = 'right';
    ctx.fillText(price.toFixed(price > 1000 ? 0 : 4), W - PAD.right + 86, y + 4);
  }

  // ── Candles ───────────────────────────────────────────────────────────────
  const barW = Math.max(4, Math.min(10, CW / display.length * 0.6));
  display.forEach((c, i) => {
    const x = sc.xOf(i);
    candleBar(ctx, x, barW, c[1], c[4], c[2], c[3], sc);
  });

  // ── Key horizontal levels ─────────────────────────────────────────────────
  if (levels.entryLow && levels.entryHigh) {
    // Entry zone band
    const y1 = sc.yOf(levels.entryHigh);
    const y2 = sc.yOf(levels.entryLow);
    ctx.save();
    ctx.fillStyle = 'rgba(255,215,0,0.08)';
    ctx.fillRect(PAD.left, y1, CW, y2 - y1);
    ctx.restore();
    dashedHLine(ctx, sc.yOf(levels.entryHigh), C.entry, '', 'right', [2, 2]);
    dashedHLine(ctx, sc.yOf(levels.entryLow),  C.entry, `GİRİŞ ${levels.entryLow}–${levels.entryHigh}`, 'right', [2, 2]);
  }

  if (levels.tp3) dashedHLine(ctx, sc.yOf(levels.tp3), C.tp, `TP3 ${levels.tp3}`);
  if (levels.tp2) dashedHLine(ctx, sc.yOf(levels.tp2), C.tp, `TP2 ${levels.tp2}`);
  if (levels.tp1) dashedHLine(ctx, sc.yOf(levels.tp1), C.tp, `TP1 ${levels.tp1}`, 'right', [6, 3]);

  if (levels.invalidation) dashedHLine(ctx, sc.yOf(levels.invalidation), C.inv, `İNVALİDASYON ${levels.invalidation}`);
  if (levels.currentPrice) dashedHLine(ctx, sc.yOf(levels.currentPrice), C.white, `${levels.currentPrice}`, 'right', [1, 0]);

  // ── Wave point markers ────────────────────────────────────────────────────
  // Map each wave price to the candle closest in price to find its x-position
  const waveLabels = ['W0', 'W1', 'W2', 'W3', 'W4', 'W5'];
  waveLabels.forEach((lbl, idx) => {
    const price = wavePoints?.[lbl];
    if (!price) return;

    // Find candle index in display whose close is closest to this wave price
    let best = 0, bestDist = Infinity;
    display.forEach((c, i) => {
      const d = Math.abs(c[4] - price);
      if (d < bestDist) { bestDist = d; best = i; }
    });

    const x = sc.xOf(best);
    const y = sc.yOf(price);
    waveMarker(ctx, x, y, lbl, idx);
  });

  // ── Title bar ─────────────────────────────────────────────────────────────
  ctx.font      = 'bold 15px sans-serif';
  ctx.fillStyle = C.text;
  ctx.textAlign = 'left';
  ctx.fillText(`${symbol}  ${timeframe}`, PAD.left, 30);

  const dirLabel = direction === 'LONG' ? '▲ LONG' : '▼ SHORT';
  const dirColor = direction === 'LONG' ? C.green : C.red;
  ctx.font = 'bold 13px sans-serif'; ctx.fillStyle = dirColor;
  ctx.textAlign = 'center';
  ctx.fillText(dirLabel, W / 2, 30);

  if (confidence) {
    const confColor = confidence.interpretation === 'GÜÇLÜ' ? C.green
                    : confidence.interpretation === 'ORTA'   ? C.yellow : C.red;
    ctx.font = '12px sans-serif'; ctx.fillStyle = confColor; ctx.textAlign = 'right';
    ctx.fillText(`Güven: %${confidence.total} (${confidence.interpretation})`, W - PAD.right, 30);
  }

  // ── Footer ────────────────────────────────────────────────────────────────
  const ts = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });
  ctx.font = '10px monospace'; ctx.fillStyle = C.textDim; ctx.textAlign = 'left';
  ctx.fillText(`APEX-Q v2 · ${ts}`, PAD.left, H - 10);

  return canvas.toBuffer('image/png');
}

module.exports = { generateChart };
