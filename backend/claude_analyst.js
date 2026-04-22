/**
 * APEX-Q Claude Analyst  v3  (Vision + Pattern Library)
 *
 * Two-layer few-shot approach:
 *   1. TEXT layer  — library.json descriptions in system prompt (always active)
 *   2. VISION layer — actual chart images sent as base64 blocks in user turn
 *                     (active only for patterns whose image file exists)
 *
 * Image naming convention — put files in backend/patterns/:
 *   01_Liquidity_Hunt_SFP.png
 *   02_Macro_Complex_Correction_WXYZ.png
 *   03_Trend_Break_Wave_3_Start.png
 *   04_RSI_Positive_Divergence_Sweep.png
 *   05_Range_Accumulation_Breakout.png
 *   06_HTF_RSI_Lead_Bias.png
 *   07_Peak_CHoCH_Trend_Reversal.png
 *   08_Daily_RSI_Accumulation_Lead.png
 *   09_Demand_Zone_ABC_Response.png
 *   10_Fibonacci_Verified_Wave_4.png
 *   11_Expanding_Impulse_SR_Flip.png
 *
 * Files must be PNG or JPEG. Absent images are silently skipped — the system
 * still works with text-only few-shot.
 */

require('dotenv').config();
const fs    = require('fs');
const path  = require('path');
const https = require('https');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const PATTERNS_DIR      = path.join(__dirname, 'patterns');

// ─── Load pattern library (text) ─────────────────────────────────────────────

function loadLibrary() {
  try {
    const raw = fs.readFileSync(path.join(PATTERNS_DIR, 'library.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    console.warn('[Claude] patterns/library.json bulunamadı — metin few-shot devre dışı.');
    return [];
  }
}

const LIBRARY = loadLibrary();

// ─── Load pattern images (vision) ────────────────────────────────────────────
// Tries both PNG and JPEG. Returns Map<id → {data, mediaType}>

function loadPatternImages() {
  const map = new Map();
  if (!fs.existsSync(PATTERNS_DIR)) return map;

  for (const p of LIBRARY) {
    const candidates = [
      `${String(p.id).padStart(2, '0')}_${p.pattern_name}.png`,
      `${String(p.id).padStart(2, '0')}_${p.pattern_name}.jpg`,
      `${String(p.id).padStart(2, '0')}.png`,
      `${String(p.id).padStart(2, '0')}.jpg`,
      `${p.id}.png`,
      `${p.id}.jpg`,
    ];
    for (const name of candidates) {
      const full = path.join(PATTERNS_DIR, name);
      if (fs.existsSync(full)) {
        const ext = path.extname(name).toLowerCase();
        map.set(p.id, {
          data:      fs.readFileSync(full).toString('base64'),
          mediaType: ext === '.jpg' ? 'image/jpeg' : 'image/png',
          filename:  name,
        });
        break;
      }
    }
  }
  const loaded = map.size;
  console.log(`[Claude] Pattern kütüphanesi: ${LIBRARY.length} JSON, ${loaded} görsel yüklendi.`);
  return map;
}

const PATTERN_IMAGES = loadPatternImages();

// ─── Pattern relevance selector ───────────────────────────────────────────────
// Picks the 3-4 most relevant reference patterns for a given analysis context.
// Runs BEFORE calling Claude so we don't dump all 11 images every time.

function selectRelevantPatterns(candidates, maxImages = 4) {
  if (!LIBRARY.length) return [];

  // Infer likely direction from engine candidates
  const bullishCount  = candidates.filter(c => c.isBullish).length;
  const bearishCount  = candidates.filter(c => !c.isBullish).length;
  const probBullish   = bullishCount >= bearishCount; // impulse direction

  // After bullish impulse → we expect SHORT correction → BEARISH patterns relevant
  // After bearish impulse → we expect LONG correction  → BULLISH patterns relevant
  const biasBias = probBullish ? 'BEARISH' : 'BULLISH';

  const scored = LIBRARY.map(p => {
    let score = 0;

    // Bias match (post-impulse correction context)
    if (p.bias === biasBias) score += 10;

    // Always include CHoCH / reversal (risk awareness)
    if (p.pattern_name.includes('CHoCH') || p.pattern_name.includes('Reversal')) score += 8;

    // Wave-4 Fibonacci pattern — always relevant
    if (p.pattern_name.includes('Wave_4') || p.pattern_name.includes('Fibonacci')) score += 7;

    // SFP / liquidity — common at wave terminations in futures
    if (p.pattern_name.includes('SFP') || p.pattern_name.includes('Liquidity')) score += 6;

    // S/R Flip — relevant for impulse continuation
    if (p.pattern_name.includes('SR_Flip') || p.pattern_name.includes('Impulse')) score += 5;

    // Prefer patterns with images loaded
    if (PATTERN_IMAGES.has(p.id)) score += 4;

    return { ...p, score };
  });

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, maxImages);
}

// ─── Text formatter for a single pattern ─────────────────────────────────────

function formatPatternText(p) {
  return [
    `Pattern #${p.id}: ${p.pattern_name}  [${p.bias}]`,
    `Zaman Dilimi: ${p.timeframe_context || '—'}  |  Dalga Bağlamı: ${p.wave_context || '—'}`,
    `Teknik: ${p.technical_context}`,
    `Teyit  : ${p.confirmation_signal}`,
    `İnvalidasyon: ${p.invalidation.condition}`,
  ].join('\n');
}

// ─── System prompt (text layer — all 11 patterns) ────────────────────────────

function buildSystemPrompt() {
  const patternBlock = LIBRARY.length > 0
    ? `\n\n══════════ PATTERN KÜTÜPHANESİ (${LIBRARY.length} adet) ══════════\n\n` +
      LIBRARY.map(p => formatPatternText(p)).join('\n\n──────────\n\n')
    : '';

  return `Sen uzman bir kripto vadeli işlem Elliott Dalga analistisin.
Binance USDM Futures piyasasında yıllar içinde yüzlerce sayım yapmış, deneyimli bir "dedektif" gibi düşünürsün.

TEMEL MISYONUN:
Ham fiyat verisi ve birkaç matematiksel aday dalga sayımını alırsın.
Elindeki kanıtları (Fibonacci uyumu, hacim, momentum, likidite, yapısal uyum) değerlendirirsin.
En mantıklı sayımı seçer, NEREDE YANILACAĞINI söylersin, sonra trade planı çıkarırsın.

══════════ SABIT KURALLAR ══════════

HARD KURALLAR:
1. W2 hiçbir zaman W1 başlangıcının ötesine geçemez.
2. W3 asla en kısa impulse dalgası olamaz.
3. W4 W1 fiyat bölgesine gövde ile giremez. (Futures wick ihlalleri %1-2 kabul edilebilir)

FUTURES PİYASASI GERÇEKLERİ:
- Wick ihlalleri normaldir; kural ihlali için GÖVDE kapanışına bak.
- Funding rate yüksekken W3'ler 3×-4× uzayabilir.
- Likit coinlerde (BTC, ETH, SOL) sayım daha güvenilir; küçük altkoinlerde gürültü var.
- W4 genellikle bir önceki W4 alanında biter — bu bölgeyi hedef olarak kullan.
- Ending diagonal (kama W5): iç dalgalar 3'lüdür ve overlap yapar.
- SFP (Swing Failure Pattern) ve CHoCH (Change of Character) sinyalleri
  dalga dönüm noktalarında sıkça görülür — bunları invalidasyon ve teyit için kullan.

FİBONACCI ALAN TOLERANSI:
%38.2 → kabul: %33–%44   |   %61.8 → kabul: %55–%68   |   %161.8 → kabul: %145–%178
Tam nokta değil BÖLGE önemlidir.${patternBlock}

══════════ YANIT FORMATI ══════════

SADECE geçerli JSON döndür. Markdown code block veya başka metin ekleme.

{
  "primaryCount": {
    "label": "Kısa başlık",
    "currentPosition": "Fiyatın şu an hangi noktada (örn: W5 bitişi / W4 içi / ABC-C)",
    "matchedPattern": "library.json'dan eşleşen pattern_name veya null",
    "isBullish": true,
    "wavePoints": { "W0": 0, "W1": 0, "W2": 0, "W3": 0, "W4": 0, "W5": 0 },
    "direction": "LONG|SHORT",
    "probability": 0,
    "invalidation": {
      "price": 0,
      "condition": "Bu fiyatın altına/üstüne GÖVDE ile kapanırsa sayım geçersiz"
    },
    "confirmation": "Bu sayımı kesinleştirecek sinyal",
    "targets": [
      { "label": "TP1", "price": 0, "fib": "0.382 geri çekilme" },
      { "label": "TP2", "price": 0, "fib": "0.618 geri çekilme" },
      { "label": "TP3", "price": 0, "fib": "1.000 geri çekilme" }
    ],
    "tradeSetup": {
      "entry": "Giriş bölgesi",
      "stopLoss": 0,
      "riskNote": "Neden bu SL"
    }
  },
  "alternative": {
    "label": "Alternatif senaryo",
    "description": "Ne zaman devreye girer",
    "probability": 0,
    "triggerPrice": 0
  },
  "analysis": {
    "fibonacci": "Fibonacci uyumu değerlendirmesi",
    "volume": "Hacim yorumu",
    "momentum": "RSI/momentum yorumu",
    "liquidity": "Likidite / SFP / CHoCH gözlemi (varsa)"
  },
  "confidence": "YÜKSEK|ORTA|DÜŞÜK",
  "reasoning": "Neden bu sayımı seçtim (2-3 cümle)"
}`;
}

// ─── Build user message content array (text + vision) ────────────────────────

function buildAnalystContent(params) {
  const { symbol, timeframe, currentPrice, candles, candidates, rsi, rsiDivergence, volumeScore, mtf } = params;

  const relevant = selectRelevantPatterns(candidates);
  const hasImages = relevant.some(p => PATTERN_IMAGES.has(p.id));

  const content = [];

  // ── Referans pattern section (images + text) ──────────────────────────────
  if (relevant.length > 0) {
    content.push({
      type: 'text',
      text: `══ REFERANS PATTERN KÜTÜPHANESİ (En alakalı ${relevant.length} pattern) ══\nAşağıdaki grafikler ve açıklamalar, sistemin öğrendiği kütüphanenin en alakalı örnekleridir.`,
    });

    for (const p of relevant) {
      const img = PATTERN_IMAGES.get(p.id);
      if (img) {
        content.push({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.data },
        });
      }
      content.push({ type: 'text', text: formatPatternText(p) });
    }

    content.push({ type: 'text', text: '══ ANALİZ VERİSİ ══' });
  }

  // ── OHLCV table ──────────────────────────────────────────────────────────
  const slice = candles.slice(-40);
  const candleRows = slice.map((c, i) => {
    const d = new Date(c[0]).toISOString().slice(0, 16);
    return `${String(i).padStart(2)} | ${d} | O:${c[1].toFixed(4)} H:${c[2].toFixed(4)} L:${c[3].toFixed(4)} C:${c[4].toFixed(4)} V:${Math.round(c[5])}`;
  }).join('\n');

  // ── Candidate wave counts ────────────────────────────────────────────────
  const candidateText = candidates.length > 0
    ? candidates.map((c, i) => {
        const dir = c.isBullish ? 'Bullish impulse' : 'Bearish impulse';
        const pts = c.points;
        return [
          `ADAY ${i + 1} [${dir}] — hassasiyet: ${c.pivotSensitivity}`,
          `  W0:${pts.p0.price.toFixed(4)} W1:${pts.p1.price.toFixed(4)} W2:${pts.p2.price.toFixed(4)} W3:${pts.p3.price.toFixed(4)} W4:${pts.p4.price.toFixed(4)} W5:${pts.p5.price.toFixed(4)}`,
          `  W2 ret:${c.evidence.metrics.w2Retracement}%  W3 ext:${c.evidence.metrics.w3Extension}  W4 ret:${c.evidence.metrics.w4Retracement}%`,
          `  Fib skoru:${c.evidence.fibScore}/100  Kural skoru:${c.evidence.rulesScore}/100`,
          `  İhlaller: ${c.evidence.violations.join('; ') || 'Yok'}`,
          `  Uyarılar: ${c.evidence.warnings.join('; ') || 'Yok'}`,
          `  W5'ten bu yana: ${c.evidence.candlesAgo} mum`,
        ].join('\n');
      }).join('\n\n')
    : 'Motor aday bulamadı — sıfırdan analiz et.';

  // ── MTF ─────────────────────────────────────────────────────────────────
  const mtfText = mtf
    ? Object.entries(mtf.timeframes || {}).map(([tf, d]) => `  ${tf}: ${d.trend} RSI:${d.rsi} ${d.signal}`).join('\n')
    : '  Mevcut değil';

  content.push({
    type: 'text',
    text: [
      `Sembol: ${symbol}  |  Zaman Dilimi: ${timeframe}  |  Şu anki fiyat: ${currentPrice}`,
      `RSI(14): ${rsi ?? 'N/A'}  |  Diverjans: ${rsiDivergence ?? 'yok'}  |  Hacim skoru: ${volumeScore ?? 'N/A'}/100`,
      '',
      '── SON 40 MUM ──',
      candleRows,
      '',
      '── MOTOR ADAYLARI ──',
      candidateText,
      '',
      '── ÇOKLU ZAMAN DİLİMİ ──',
      mtfText,
      '',
      '── GÖREVİN ──',
      'Tüm kanıtları değerlendir. En mantıklı Elliott sayımını seç (veya yenisini öner).',
      'MUTLAKA invalidasyon fiyatı belirt. Sadece JSON döndür.',
    ].join('\n'),
  });

  return content;
}

// ─── Claude API call (supports vision content array) ─────────────────────────

const SYSTEM_PROMPT = buildSystemPrompt();

function callClaude(content) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1400,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
    }));

    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Length': body.length,
        },
      },
      res => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            if (parsed.error) return reject(new Error(parsed.error.message));
            resolve(parsed.content?.[0]?.text?.trim() || '');
          } catch (e) {
            reject(new Error('Parse hatası: ' + data.slice(0, 300)));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function parseClaudeJSON(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

// ─── Public API ──────────────────────────────────────────────────────────────

async function analyzeWithClaude(params) {
  if (!ANTHROPIC_API_KEY) {
    console.warn('[Claude] ANTHROPIC_API_KEY ayarlı değil.');
    return null;
  }
  const content = buildAnalystContent(params);
  try {
    const raw    = await callClaude(content);
    const result = parseClaudeJSON(raw);
    result._raw  = raw;
    return result;
  } catch (e) {
    console.warn(`[Claude] Hata (${params.symbol} ${params.timeframe}):`, e.message);
    return null;
  }
}

module.exports = { analyzeWithClaude, LIBRARY, PATTERN_IMAGES, SYSTEM_PROMPT };
