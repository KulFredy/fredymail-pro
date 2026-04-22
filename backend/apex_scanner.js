/**
 * APEX-Q Headless Scanner v2
 *
 * Architecture:
 *   elliott_engine  →  candidate hypotheses  (math)
 *   claude_analyst  →  picks best count, states invalidation  (AI)
 *   Telegram        →  delivers the detective-style signal  (courier)
 *
 * The engine never makes the final call. Claude does, acting as a detective:
 *   "Most likely we are in W4. Target $X. WRONG if price closes below $Y."
 *
 * Env vars (copy .env.example → .env):
 *   ANTHROPIC_API_KEY    Claude API key
 *   TELEGRAM_BOT_TOKEN   Telegram bot token
 *   TELEGRAM_CHAT_ID     Target chat ID (use -100... for channels)
 *   SCAN_INTERVAL_MIN    Minutes between sweeps (default 30)
 *   MIN_CONFIDENCE       Confidence threshold: YÜKSEK|ORTA|DÜŞÜK (default ORTA)
 *   SCAN_TIMEFRAMES      Comma-sep timeframes (default 1h,4h)
 *   SCAN_COINS           Comma-sep override (default: top 20)
 */

require('dotenv').config();
const https  = require('https');
const ccxt   = require('ccxt');
const { RSI } = require('technicalindicators');
const { findAllCandidateWaves, calculateMomentumScore, calculateVolumeScore, toFuturesSymbol } = require('./elliott_engine');
const { analyzeWithClaude } = require('./claude_analyst');

// ─── Config ──────────────────────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const SCAN_INTERVAL_MIN  = parseInt(process.env.SCAN_INTERVAL_MIN || '30');
const MIN_CONFIDENCE_LVL = (process.env.MIN_CONFIDENCE || 'ORTA').toUpperCase();
const SCAN_TIMEFRAMES    = (process.env.SCAN_TIMEFRAMES || '1h,4h').split(',').map(s => s.trim());

// Confidence gate — skip weaker signals if server resources are limited
const CONFIDENCE_RANK = { 'YÜKSEK': 3, 'ORTA': 2, 'DÜŞÜK': 1 };
const MIN_RANK = CONFIDENCE_RANK[MIN_CONFIDENCE_LVL] || 2;

const DEFAULT_COINS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT',
  'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'DOT/USDT',
  'MATIC/USDT', 'UNI/USDT', 'LTC/USDT', 'ATOM/USDT', 'APT/USDT',
  'ARB/USDT', 'OP/USDT', 'INJ/USDT', 'SUI/USDT', 'FIL/USDT',
];

const SCAN_COINS = process.env.SCAN_COINS
  ? process.env.SCAN_COINS.split(',').map(s => s.trim())
  : DEFAULT_COINS;

const exchange = new ccxt.binanceusdm({ enableRateLimit: true });

// ─── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('\n[DRY-RUN] ─── Telegram mesajı ───\n' + text + '\n──────────────────────');
    return;
  }
  const body = Buffer.from(JSON.stringify({
    chat_id: TELEGRAM_CHAT_ID,
    text,
    parse_mode: 'HTML',
  }));
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': body.length },
      },
      res => { res.resume(); res.on('end', resolve); }
    );
    req.on('error', e => { console.warn('[Telegram]', e.message); resolve(); });
    req.write(body);
    req.end();
  });
}

// ─── Data fetcher ────────────────────────────────────────────────────────────

async function fetchData(symbol, timeframe, limit = 200) {
  const futuresSym = toFuturesSymbol(symbol);
  const candles = await exchange.fetchOHLCV(futuresSym, timeframe, undefined, limit);
  if (!candles || candles.length < 60) throw new Error('Yetersiz veri');

  const closes = candles.map(c => parseFloat(c[4]));
  const rsiValues = RSI.calculate({ values: closes, period: 14 });
  const rsi = parseFloat(rsiValues[rsiValues.length - 1]?.toFixed(1));

  const currentPrice = closes[closes.length - 1];
  return { candles, closes, rsi, currentPrice };
}

// ─── Signal formatter ────────────────────────────────────────────────────────

function formatSignal(symbol, timeframe, currentPrice, analysis) {
  const pc = analysis.primaryCount;
  const alt = analysis.alternative;
  const an = analysis.analysis || {};
  const dir = pc.direction === 'LONG' ? '📈 LONG' : '📉 SHORT';
  const ts  = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

  const targetLines = (pc.targets || [])
    .map(t => `  • <b>${t.label}</b>: ${t.price} <i>(${t.fib})</i>`)
    .join('\n');

  const lines = [
    `🔔 <b>APEX-Q SİNYAL</b>  |  <b>${symbol}</b>  |  ${timeframe}`,
    ``,
    `<b>Sayım:</b> ${pc.label || pc.currentPosition || '—'}`,
    `<b>Yön:</b> ${dir}   <b>Güven:</b> ${analysis.confidence}`,
    ``,
    `<b>Giriş:</b> ${pc.tradeSetup?.entry || '—'}`,
    `<b>Stop Loss:</b> <code>${pc.tradeSetup?.stopLoss ?? '—'}</code>  (${pc.tradeSetup?.riskNote || ''})`,
    `<b>⚠ İnvalidasyon:</b> <code>${pc.invalidation?.price ?? '—'}</code>`,
    `  └ ${pc.invalidation?.condition || ''}`,
    ``,
    targetLines,
    ``,
    `<b>Teyit sinyali:</b> ${pc.confirmation || '—'}`,
    ``,
    `<b>— Claude Analizi —</b>`,
    `<i>${analysis.reasoning || ''}</i>`,
    an.fibonacci ? `\n📐 Fibonacci: ${an.fibonacci}` : '',
    an.volume    ? `📊 Hacim: ${an.volume}` : '',
    an.momentum  ? `⚡ Momentum: ${an.momentum}` : '',
    ``,
    alt ? `<b>Alternatif (%${alt.probability}):</b> ${alt.label || alt.description || '—'} → trigger: <code>${alt.triggerPrice || '?'}</code>` : '',
    ``,
    `<i>${ts} | APEX-Q v2 | claude-sonnet-4-6</i>`,
  ].filter(l => l !== null).join('\n');

  return lines;
}

// ─── Core scan logic ─────────────────────────────────────────────────────────

const sentThisCycle = new Set();

async function scanSymbol(symbol, timeframe) {
  const key = `${symbol}_${timeframe}`;

  const { candles, rsi, currentPrice } = await fetchData(symbol, timeframe);

  // Engine: generate up to 5 candidate wave counts
  const candidates = findAllCandidateWaves(candles, 5);

  // Skip if no candidates at all and don't burn Claude tokens
  if (candidates.length === 0) {
    console.log(`[APEX-Q] ${symbol} ${timeframe} — motor aday bulamadı, atlıyorum.`);
    return;
  }

  // Claude: detective analysis
  const momentumData = calculateMomentumScore(candles);
  const volumeScore  = calculateVolumeScore(candles, candidates[0]?.waveIndices);

  const analysis = await analyzeWithClaude({
    symbol, timeframe, currentPrice, candles, candidates,
    rsi,
    rsiDivergence: momentumData.divergence,
    volumeScore,
    mtf: null, // MTF data skipped in scanner to save API latency; add if needed
  });

  if (!analysis) return;

  // Gate by confidence
  const rank = CONFIDENCE_RANK[analysis.confidence] || 0;
  if (rank < MIN_RANK) {
    console.log(`[APEX-Q] ${symbol} ${timeframe} — güven ${analysis.confidence} < eşik, atlandı.`);
    return;
  }

  // Deduplicate within cycle by primary count label
  const signalKey = `${key}_${analysis.primaryCount?.label}`;
  if (sentThisCycle.has(signalKey)) return;
  sentThisCycle.add(signalKey);

  console.log(`[APEX-Q] ✔ Sinyal: ${symbol} ${timeframe} ${analysis.primaryCount?.direction} | ${analysis.confidence}`);

  const msg = formatSignal(symbol, timeframe, currentPrice, analysis);
  await sendTelegram(msg);
  await new Promise(r => setTimeout(r, 1500)); // Telegram rate limit
}

async function runScan() {
  console.log(`\n[APEX-Q] ▶ Tarama başladı — ${new Date().toISOString()}`);
  sentThisCycle.clear();

  for (const symbol of SCAN_COINS) {
    for (const tf of SCAN_TIMEFRAMES) {
      try {
        await scanSymbol(symbol, tf);
      } catch (e) {
        console.warn(`[APEX-Q] ${symbol} ${tf} hata: ${e.message}`);
      }
    }
  }

  console.log(`[APEX-Q] ✓ Tarama bitti. Sonraki: ${SCAN_INTERVAL_MIN} dk sonra.`);
}

// ─── Boot ────────────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════════╗');
console.log('║    APEX-Q Headless Scanner  v2           ║');
console.log('║    Engine → Hipotez  |  Claude → Karar  ║');
console.log('╚══════════════════════════════════════════╝');
console.log(`  Coinler      : ${SCAN_COINS.length} adet`);
console.log(`  Zaman dil.   : ${SCAN_TIMEFRAMES.join(', ')}`);
console.log(`  Aralık       : her ${SCAN_INTERVAL_MIN} dakikada bir`);
console.log(`  Min güven    : ${MIN_CONFIDENCE_LVL}`);
console.log(`  Claude API   : ${process.env.ANTHROPIC_API_KEY ? '✔ aktif' : '✗ EKSİK'}`);
console.log(`  Telegram     : ${TELEGRAM_BOT_TOKEN ? '✔ aktif' : '✗ dry-run modu'}`);
console.log('');

runScan().catch(console.error);
setInterval(() => runScan().catch(console.error), SCAN_INTERVAL_MIN * 60 * 1000);
