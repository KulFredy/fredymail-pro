/**
 * APEX-Q Headless Scanner
 *
 * Flow:
 *   1. Every SCAN_INTERVAL_MIN minutes: scan SCAN_COINS × SCAN_TIMEFRAMES
 *   2. For each coin/tf: run Elliott Wave analysis (elliott_engine.js)
 *   3. If valid setup found (confidence ≥ MIN_CONFIDENCE, R:R recommended):
 *      a. Build a structured prompt from the raw math data
 *      b. Send to Claude claude-sonnet-4-6 API for natural-language interpretation
 *      c. Deliver the final message via Telegram
 *
 * Environment variables (copy .env.example → .env):
 *   ANTHROPIC_API_KEY    - Required for Claude interpretation
 *   TELEGRAM_BOT_TOKEN   - Required for Telegram delivery
 *   TELEGRAM_CHAT_ID     - Target chat/channel ID (include leading - for groups)
 *   SCAN_INTERVAL_MIN    - Minutes between full sweeps (default: 30)
 *   MIN_CONFIDENCE       - Min confidence % to send alert (default: 60)
 *   SCAN_TIMEFRAMES      - Comma-separated list (default: 1h,4h)
 *   SCAN_COINS           - Comma-separated list (default: top 20 coins)
 */

require('dotenv').config();
const https = require('https');
const { analyzeElliott } = require('./elliott_engine');

// ─── Config ──────────────────────────────────────────────────────────────────

const ANTHROPIC_API_KEY  = process.env.ANTHROPIC_API_KEY;
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;
const SCAN_INTERVAL_MIN  = parseInt(process.env.SCAN_INTERVAL_MIN  || '30');
const MIN_CONFIDENCE     = parseInt(process.env.MIN_CONFIDENCE     || '60');
const SCAN_TIMEFRAMES    = (process.env.SCAN_TIMEFRAMES || '1h,4h').split(',').map(s => s.trim());

const DEFAULT_COINS = [
  'BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT',
  'DOGE/USDT', 'ADA/USDT', 'AVAX/USDT', 'LINK/USDT', 'DOT/USDT',
  'MATIC/USDT', 'UNI/USDT', 'LTC/USDT', 'ATOM/USDT', 'FIL/USDT',
  'APT/USDT', 'ARB/USDT', 'OP/USDT', 'INJ/USDT', 'SUI/USDT',
];

const SCAN_COINS = process.env.SCAN_COINS
  ? process.env.SCAN_COINS.split(',').map(s => s.trim())
  : DEFAULT_COINS;

// ─── HTTP helper ─────────────────────────────────────────────────────────────

function httpPost(hostname, path, headers, body) {
  return new Promise((resolve, reject) => {
    const buf = Buffer.from(JSON.stringify(body));
    const req = https.request(
      { hostname, path, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': buf.length, ...headers } },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error('JSON parse error: ' + data.slice(0, 200))); }
        });
      }
    );
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

// ─── Telegram ────────────────────────────────────────────────────────────────

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    console.log('[DRY-RUN] Telegram:\n' + text + '\n');
    return;
  }
  try {
    await httpPost(
      'api.telegram.org',
      `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {},
      { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'Markdown' }
    );
  } catch (e) {
    console.warn('[APEX-Q] Telegram gönderme hatası:', e.message);
  }
}

// ─── Claude API ───────────────────────────────────────────────────────────────

async function callClaude(prompt) {
  if (!ANTHROPIC_API_KEY) return null;
  try {
    const resp = await httpPost(
      'api.anthropic.com',
      '/v1/messages',
      { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      { model: 'claude-sonnet-4-6', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }
    );
    return resp.content?.[0]?.text?.trim() || null;
  } catch (e) {
    console.warn('[APEX-Q] Claude API hatası:', e.message);
    return null;
  }
}

// ─── Prompt builder ──────────────────────────────────────────────────────────

function buildClaudePrompt(data) {
  const { symbol, timeframe, currentPrice, pattern, tradeSetup, confidence, momentum, mtf, fibConfluence } = data;
  const { direction, entryZone, sl, tp1, tp2, rr } = tradeSetup;

  const fibText = fibConfluence?.length
    ? fibConfluence.slice(0, 2).map(z => `${z.label} @ ${z.price}`).join(' | ')
    : 'Belirgin confluence yok';

  const mtfText = Object.entries(mtf?.timeframes || {})
    .map(([tf, d]) => `${tf}: ${d.trend} RSI:${d.rsi}`)
    .join(', ');

  const violations = pattern.validation.violations?.join(', ') || 'Yok';
  const warnings   = pattern.validation.warnings?.join(', ')   || 'Yok';

  return `Sen profesyonel bir kripto vadeli işlem analisti yardımcısısın.
Aşağıdaki matematiksel Elliott Dalga analizi çıktısını, kısa ve doğrudan bir Türkçe trade yorumuna dönüştür.
Maksimum 4 cümle. Emoji kullanma. Matematiksel hesaplama yapma — sadece yorumla.

Sembol: ${symbol} | Zaman Dilimi: ${timeframe} | Mevcut Fiyat: ${currentPrice}
Dalga Yapısı: ${pattern.name}
Beklenen Hareket: ${direction}

TRADE KURULUMU:
  Giriş Bölgesi : ${entryZone.low} – ${entryZone.high}
  Stop Loss     : ${sl}
  Hedef 1       : ${tp1}  |  Hedef 2: ${tp2}
  R:R Oranı     : ${rr.str} (${rr.rating})

ANALİZ:
  Güven Skoru   : %${confidence.total} (${confidence.interpretation})
  RSI           : ${momentum.rsi}  |  Diverjans: ${momentum.divergence || 'yok'}
  Fibonacci     : ${fibText}
  MTF           : ${mtfText}
  İhlaller      : ${violations}
  Uyarılar      : ${warnings}`;
}

// ─── Signal formatter ────────────────────────────────────────────────────────

function formatMessage(data, claudeText) {
  const { symbol, timeframe, currentPrice, pattern, tradeSetup, confidence } = data;
  const { direction, entryZone, sl, tp1, tp2, rr } = tradeSetup;
  const dir = direction === 'LONG' ? '📈 LONG' : '📉 SHORT';
  const ts  = new Date().toLocaleString('tr-TR', { timeZone: 'Europe/Istanbul' });

  const lines = [
    `🔔 *APEX\\-Q SİNYAL*  |  ${symbol}  |  ${timeframe}`,
    ``,
    `*Dalga:* ${pattern.name}`,
    `*Yön:* ${dir}`,
    `*Güven:* %${confidence.total} (${confidence.interpretation})`,
    `*R:R:* ${rr.str}  —  ${rr.rating}`,
    ``,
    `*Giriş:* \`${entryZone.low} – ${entryZone.high}\``,
    `*Stop Loss:* \`${sl}\``,
    `*TP1:* \`${tp1}\`   *TP2:* \`${tp2}\``,
    `*Fiyat:* \`${currentPrice}\``,
  ];

  if (claudeText) {
    lines.push('', '─────────────────────────', claudeText, '─────────────────────────');
  }

  lines.push('', `_${ts} | APEX\\-Q v2_`);
  return lines.join('\n');
}

// ─── Core scan loop ──────────────────────────────────────────────────────────

// Tracks signals already sent this cycle to avoid duplicate Telegram messages
const sentThisCycle = new Set();

async function runScan() {
  console.log(`\n[APEX-Q] ▶ Tarama başladı — ${new Date().toISOString()}`);
  sentThisCycle.clear();
  let signalCount = 0;

  for (const symbol of SCAN_COINS) {
    for (const tf of SCAN_TIMEFRAMES) {
      try {
        const data = await analyzeElliott(symbol, tf);

        if (!data.pattern || !data.tradeSetup) continue;

        const key = `${symbol}_${tf}_${data.pattern.name}`;
        if (sentThisCycle.has(key)) continue;

        if (data.confidence.total < MIN_CONFIDENCE)   continue;
        if (!data.tradeSetup.isRecommended)            continue;

        console.log(`[APEX-Q] ✔ Sinyal: ${symbol} ${tf} ${data.pattern.direction} | Güven: %${data.confidence.total}`);
        sentThisCycle.add(key);
        signalCount++;

        const claudeText = await callClaude(buildClaudePrompt(data));
        const msg = formatMessage(data, claudeText);
        await sendTelegram(msg);

        // Respect Telegram rate limit
        await new Promise(r => setTimeout(r, 1500));

      } catch (e) {
        console.warn(`[APEX-Q] ${symbol} ${tf} hata: ${e.message}`);
      }
    }
  }

  console.log(`[APEX-Q] ✓ Tarama bitti — ${signalCount} sinyal gönderildi. Sonraki: ${SCAN_INTERVAL_MIN} dk sonra.`);
}

// ─── Boot ────────────────────────────────────────────────────────────────────

console.log('╔══════════════════════════════════════╗');
console.log('║       APEX-Q Headless Scanner        ║');
console.log('╚══════════════════════════════════════╝');
console.log(`  Coinler     : ${SCAN_COINS.length} adet`);
console.log(`  Zaman dil.  : ${SCAN_TIMEFRAMES.join(', ')}`);
console.log(`  Aralık      : her ${SCAN_INTERVAL_MIN} dakikada bir`);
console.log(`  Min güven   : %${MIN_CONFIDENCE}`);
console.log(`  Claude API  : ${ANTHROPIC_API_KEY ? '✔ aktif' : '✗ devre dışı (ANTHROPIC_API_KEY yok)'}`);
console.log(`  Telegram    : ${TELEGRAM_BOT_TOKEN ? '✔ aktif' : '✗ dry-run modu'}`);
console.log('');

runScan().catch(console.error);
setInterval(() => runScan().catch(console.error), SCAN_INTERVAL_MIN * 60 * 1000);
