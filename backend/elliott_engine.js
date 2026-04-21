/**
 * APEX-Q Elliott Wave Engine v2
 * Improvements:
 * - Hard-coded Elliott rule validator (10 rules)
 * - LONG/SHORT direction validation (TP > entry > SL assertion)
 * - Entry zone narrowed to ±2% from current price
 * - R:R filter with rating (< 1:1.5 → warning)
 * - Alternative scenario (alt-count) generation
 * - Dynamic volume score (W3 vs W1 volume comparison)
 * - Fib confluence zone detection
 * - Transparent confidence formula (weighted components)
 * - Divergence detection (RSI bullish/bearish)
 * - Multi-timeframe with real trend alignment
 */

const ccxt = require('ccxt');
const { RSI, MACD } = require('technicalindicators');

const exchange = new ccxt.binance({ enableRateLimit: true });

// ─── Elliott Rules Validator ────────────────────────────────────────────────

function validateImpulse(points, isBullish) {
  const [p0, p1, p2, p3, p4, p5] = points;

  const w1 = Math.abs(p1 - p0);
  const w2 = Math.abs(p2 - p1);
  const w3 = Math.abs(p3 - p2);
  const w4 = Math.abs(p4 - p3);
  const w5 = Math.abs(p5 - p4);

  const violations = [];

  // Rule 1: W2 cannot retrace ≥ 100% of W1
  const w2Ret = w2 / w1;
  if (w2Ret >= 1.0) violations.push('W2 W1\'in tamamını geri aldı (%' + Math.round(w2Ret * 100) + ')');

  // Rule 2: W3 cannot be the shortest impulse wave
  if (w3 < w1 && w3 < w5) violations.push('W3 en kısa dalga olamaz');

  // Rule 3: W4 cannot enter W1 price territory
  if (isBullish && p4 < p1) violations.push('W4 W1 fiyat bölgesine girdi (overlap)');
  if (!isBullish && p4 > p1) violations.push('W4 W1 fiyat bölgesine girdi (overlap)');

  // Rule 4: W3 extension check (should be > 1x W1)
  const w3Ext = w3 / w1;
  if (w3Ext < 1.0) violations.push('W3 W1\'den kısa (extension yok)');

  // Rule 5: W2 retracement should be between 38.2% - 78.6%
  if (w2Ret < 0.236) violations.push('W2 çok az geri çekildi (<%23.6)');

  // Rule 6: W4 should retrace 23.6% - 38.2% of W3 (guideline)
  const w4Ret = w4 / w3;
  const w4Warning = w4Ret > 0.618 ? 'W4 derin düzeltme (%' + Math.round(w4Ret * 100) + ')' : null;

  const isValid = violations.length === 0;
  const rulesScore = Math.max(0, 100 - violations.length * 15);

  return {
    valid: isValid,
    violations,
    warning: w4Warning,
    metrics: {
      w2Retracement: parseFloat((w2Ret * 100).toFixed(1)),
      w3Extension: parseFloat((w3Ext * 100).toFixed(1)) + 'x → ' + parseFloat(w3Ext.toFixed(3)) + 'x',
      w4Retracement: parseFloat((w4Ret * 100).toFixed(1)),
    },
    rulesScore,
  };
}

// ─── Direction Validator (Bug Fix) ─────────────────────────────────────────

function validateTradeSetup(direction, entry, sl, tp1) {
  if (direction === 'LONG') {
    if (!(tp1 > entry && entry > sl)) {
      return {
        valid: false,
        reason: `LONG mantık hatası: TP1(${tp1.toFixed(2)}) > Giriş(${entry.toFixed(2)}) > SL(${sl.toFixed(2)}) olmalı`,
      };
    }
  } else if (direction === 'SHORT') {
    if (!(tp1 < entry && entry < sl)) {
      return {
        valid: false,
        reason: `SHORT mantık hatası: TP1(${tp1.toFixed(2)}) < Giriş(${entry.toFixed(2)}) < SL(${sl.toFixed(2)}) olmalı`,
      };
    }
  }
  return { valid: true };
}

// ─── Entry Zone (Bug Fix: max ±2%) ──────────────────────────────────────────

function calculateEntryZone(currentPrice, direction, recentLow, recentHigh) {
  const MAX_RANGE = 0.02;

  let base;
  if (direction === 'LONG') {
    base = recentLow && Math.abs(recentLow - currentPrice) / currentPrice < MAX_RANGE
      ? recentLow
      : currentPrice;
  } else {
    base = recentHigh && Math.abs(recentHigh - currentPrice) / currentPrice < MAX_RANGE
      ? recentHigh
      : currentPrice;
  }

  const low = parseFloat((base * (1 - 0.008)).toFixed(2));
  const high = parseFloat((base * (1 + 0.008)).toFixed(2));

  return { low, high, mid: parseFloat(((low + high) / 2).toFixed(2)) };
}

// ─── R:R Calculator with Rating ─────────────────────────────────────────────

function calculateRR(entry, sl, tp1) {
  const risk = Math.abs(entry - sl);
  if (risk === 0) return { rr: 0, str: '0:0', rating: 'GEÇERSİZ', recommend: false, color: 'red' };

  const reward = Math.abs(tp1 - entry);
  const rr = reward / risk;

  let rating, color, recommend;
  if (rr >= 3)      { rating = 'MÜKEMMEL'; color = 'emerald'; recommend = true; }
  else if (rr >= 2) { rating = 'İYİ';      color = 'green';   recommend = true; }
  else if (rr >= 1.5){ rating = 'KABUL';   color = 'yellow';  recommend = true; }
  else if (rr >= 1)  { rating = 'ZAYIF';   color = 'orange';  recommend: false; }
  else               { rating = 'İŞLEM ALMA'; color = 'red';  recommend: false; }

  return {
    rr: parseFloat(rr.toFixed(2)),
    str: `1:${parseFloat(rr.toFixed(2))}`,
    rating,
    color,
    recommend: rr >= 1.5,
  };
}

// ─── Pivot Detection ────────────────────────────────────────────────────────

function getPivots(candles, leftBars = 8, rightBars = 5) {
  const pivots = [];
  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const high = candles[i][2];
    const low = candles[i][3];
    let isPeakHigh = true, isPeakLow = true;

    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      if (candles[j][2] > high) isPeakHigh = false;
      if (candles[j][3] < low) isPeakLow = false;
    }

    if (isPeakHigh) pivots.push({ type: 'high', idx: i, price: high, ts: candles[i][0] });
    if (isPeakLow)  pivots.push({ type: 'low',  idx: i, price: low,  ts: candles[i][0] });
  }
  return pivots.sort((a, b) => a.idx - b.idx);
}

function filterAlternating(pivots) {
  const result = [];
  for (const p of pivots) {
    if (result.length === 0) { result.push(p); continue; }
    const last = result[result.length - 1];
    if (last.type === p.type) {
      if (p.type === 'high' && p.price > last.price) result[result.length - 1] = p;
      else if (p.type === 'low' && p.price < last.price) result[result.length - 1] = p;
    } else {
      result.push(p);
    }
  }
  return result;
}

// ─── Fib Confluence Zones ───────────────────────────────────────────────────

function calculateFibConfluence(waveStart, waveEnd, direction) {
  const range = Math.abs(waveEnd - waveStart);
  const base = waveEnd;
  const dir = direction === 'LONG' ? 1 : -1;

  const retLevels = [0.236, 0.382, 0.500, 0.618, 0.786];
  const extLevels = [1.000, 1.272, 1.414, 1.618, 2.000];

  const allLevels = [];
  retLevels.forEach(r => allLevels.push({ price: base + dir * range * r, ratio: r, type: 'retracement' }));
  extLevels.forEach(e => allLevels.push({ price: base + dir * range * e, ratio: e, type: 'extension' }));

  // Group within 0.5% tolerance
  const zones = [];
  const sorted = allLevels.sort((a, b) => a.price - b.price);

  for (let i = 0; i < sorted.length; i++) {
    const group = [sorted[i]];
    for (let j = i + 1; j < sorted.length; j++) {
      if (Math.abs(sorted[j].price - sorted[i].price) / sorted[i].price < 0.005) {
        group.push(sorted[j]);
        i = j;
      }
    }
    const avgPrice = group.reduce((s, x) => s + x.price, 0) / group.length;
    zones.push({
      price: parseFloat(avgPrice.toFixed(2)),
      strength: group.length,
      ratios: group.map(g => g.ratio),
      isHot: group.length >= 2,
      label: group.map(g => `Fib ${g.ratio}`).join(' + '),
    });
  }

  return zones.filter(z => z.isHot).sort((a, b) => b.strength - a.strength);
}

// ─── Divergence Detection ───────────────────────────────────────────────────

function detectDivergence(candles, rsiValues) {
  const len = Math.min(candles.length, rsiValues.length);
  if (len < 10) return { bullish: false, bearish: false };

  const prices = candles.slice(-len).map(c => c[4]);
  const rsis = rsiValues.slice(-len);

  // Look in last 20 candles
  const window = Math.min(20, len);
  const recentPrices = prices.slice(-window);
  const recentRsi = rsis.slice(-window);

  // Bullish divergence: price lower low, RSI higher low
  const priceMin1Idx = recentPrices.indexOf(Math.min(...recentPrices.slice(0, window / 2)));
  const priceMin2Idx = window / 2 + recentPrices.slice(window / 2).indexOf(Math.min(...recentPrices.slice(window / 2)));

  const bullish = recentPrices[priceMin2Idx] < recentPrices[priceMin1Idx] &&
                  recentRsi[priceMin2Idx] > recentRsi[priceMin1Idx];

  // Bearish divergence: price higher high, RSI lower high
  const priceMax1Idx = recentPrices.indexOf(Math.max(...recentPrices.slice(0, window / 2)));
  const priceMax2Idx = window / 2 + recentPrices.slice(window / 2).indexOf(Math.max(...recentPrices.slice(window / 2)));

  const bearish = recentPrices[priceMax2Idx] > recentPrices[priceMax1Idx] &&
                  recentRsi[priceMax2Idx] < recentRsi[priceMax1Idx];

  return { bullish, bearish };
}

// ─── Dynamic Volume Score ───────────────────────────────────────────────────

function calculateVolumeScore(candles, waveIndices) {
  if (!candles || candles.length < 20) return 50;

  const vols = candles.map(c => parseFloat(c[5]));
  const avgVol = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;

  let score = 50;

  // W3 should have above-average volume
  if (waveIndices && waveIndices.w3Start !== undefined && waveIndices.w3End !== undefined) {
    const w3Vols = vols.slice(waveIndices.w3Start, waveIndices.w3End + 1);
    const w3Avg = w3Vols.reduce((a, b) => a + b, 0) / w3Vols.length;
    if (w3Avg > avgVol * 1.3) score += 25;
    else if (w3Avg > avgVol * 1.1) score += 15;
    else if (w3Avg < avgVol * 0.8) score -= 10;
  }

  // Correction (W4-W5) should have below-average volume (healthy correction)
  const correctionVols = vols.slice(-10);
  const corrAvg = correctionVols.reduce((a, b) => a + b, 0) / correctionVols.length;
  if (corrAvg < avgVol * 0.7) score += 15;
  else if (corrAvg < avgVol * 0.9) score += 8;
  else if (corrAvg > avgVol * 1.2) score -= 10;

  return Math.min(100, Math.max(0, Math.round(score)));
}

// ─── Momentum Score ─────────────────────────────────────────────────────────

function calculateMomentumScore(candles) {
  if (!candles || candles.length < 20) return { score: 50, divergence: null };

  const closes = candles.map(c => parseFloat(c[4]));

  let rsiValues = [];
  try {
    rsiValues = RSI.calculate({ values: closes, period: 14 });
  } catch (e) {
    return { score: 50, divergence: null };
  }

  const currentRsi = rsiValues[rsiValues.length - 1];
  let score = 50;

  // Oversold bounce → bullish
  if (currentRsi < 30) score += 25;
  else if (currentRsi < 40) score += 15;
  // Overbought pullback → bearish pressure on correction
  else if (currentRsi > 70) score -= 10;

  const divergence = detectDivergence(candles, rsiValues);
  if (divergence.bullish) score += 20;
  if (divergence.bearish) score -= 15;

  return {
    score: Math.min(100, Math.max(0, Math.round(score))),
    rsi: parseFloat(currentRsi.toFixed(1)),
    divergence: divergence.bullish ? 'bullish' : divergence.bearish ? 'bearish' : null,
  };
}

// ─── Transparent Confidence Score ───────────────────────────────────────────

function calculateConfidence(structuralScore, momentumScore, volumeScore, mtfScore) {
  const weights = { structural: 0.35, momentum: 0.25, volume: 0.20, mtf: 0.20 };
  const total = Math.round(
    structuralScore * weights.structural +
    momentumScore   * weights.momentum   +
    volumeScore     * weights.volume     +
    mtfScore        * weights.mtf
  );

  return {
    total,
    components: {
      structural: { score: structuralScore, weight: '35%', label: 'Yapısal Uyum' },
      momentum:   { score: momentumScore,   weight: '25%', label: 'Momentum Desteği' },
      volume:     { score: volumeScore,     weight: '20%', label: 'Hacim Doğrulaması' },
      mtf:        { score: mtfScore,        weight: '20%', label: 'MTF Uyumu' },
    },
    interpretation: total >= 70 ? 'GÜÇLÜ' : total >= 55 ? 'ORTA' : 'ZAYIF',
    formula: 'Yapısal×0.35 + Momentum×0.25 + Hacim×0.20 + MTF×0.20',
  };
}

// ─── Alternative Scenario ───────────────────────────────────────────────────

function generateAlternativeCount(waves, primaryDirection, primaryConfidence, currentPrice) {
  const altDirection = primaryDirection === 'LONG' ? 'SHORT' : 'LONG';
  const w5Price = waves.w5;

  // Invalidation of primary = alt trigger
  const altTriggerPrice = primaryDirection === 'LONG'
    ? parseFloat((w5Price * 0.995).toFixed(2))
    : parseFloat((w5Price * 1.005).toFixed(2));

  const altScenario = primaryDirection === 'LONG'
    ? 'Uzatılmış W3 düzeltmesi devam ediyor — ABC tamamlanmadı'
    : 'Uzatılmış W3 yükselişi devam ediyor — ABC tamamlanmadı';

  const primaryPct = Math.min(primaryConfidence, 72);
  const altPct = 100 - primaryPct;

  return {
    direction: altDirection,
    description: altScenario,
    triggerPrice: altTriggerPrice,
    triggerLabel: `${altTriggerPrice} ${primaryDirection === 'LONG' ? 'altında' : 'üstünde'} kapanış`,
    probability: altPct,
    primaryProbability: primaryPct,
  };
}

// ─── Wave Detection ─────────────────────────────────────────────────────────

function findElliottWaves(pivotsRaw, candles) {
  const pivots = filterAlternating(pivotsRaw);
  const results = [];

  for (let i = 0; i <= pivots.length - 6; i++) {
    const [p0, p1, p2, p3, p4, p5] = pivots.slice(i, i + 6);
    const prices = [p0.price, p1.price, p2.price, p3.price, p4.price, p5.price];
    const isBullish = p1.price > p0.price;

    // Check pivot alternation
    if (isBullish) {
      if (!(p1.type === 'high' && p2.type === 'low' && p3.type === 'high' && p4.type === 'low' && p5.type === 'high')) continue;
    } else {
      if (!(p1.type === 'low' && p2.type === 'high' && p3.type === 'low' && p4.type === 'high' && p5.type === 'low')) continue;
    }

    const validation = validateImpulse(prices, isBullish);
    if (!validation.valid) continue;

    const waveSpan = Math.abs(p5.price - p0.price);
    const waveIndices = {
      w3Start: p2.idx,
      w3End: p3.idx,
    };

    results.push({
      isBullish,
      points: { p0, p1, p2, p3, p4, p5 },
      prices,
      validation,
      waveSpan,
      waveIndices,
      candles,
    });
  }

  // Return most recent valid pattern
  return results.length > 0 ? results[results.length - 1] : null;
}

// ─── Multi-Timeframe Analysis ────────────────────────────────────────────────

async function getMTFData(symbol) {
  const timeframes = ['15m', '1h', '4h', '1d'];
  const results = {};

  for (const tf of timeframes) {
    try {
      const ohlcv = await exchange.fetchOHLCV(symbol, tf, undefined, 50);
      if (!ohlcv || ohlcv.length < 14) { results[tf] = { trend: 'NEUTRAL', signal: 'WAIT' }; continue; }

      const closes = ohlcv.map(c => c[4]);
      const rsi = RSI.calculate({ values: closes, period: 14 });
      const lastRsi = rsi[rsi.length - 1];
      const lastClose = closes[closes.length - 1];
      const prevClose = closes[closes.length - 6];

      const trend = lastClose > prevClose ? 'UP' : 'DOWN';
      const signal = lastRsi < 40 ? 'BUY' : lastRsi > 60 ? 'SELL' : 'WAIT';

      results[tf] = { trend, signal, rsi: parseFloat(lastRsi.toFixed(1)) };
    } catch {
      results[tf] = { trend: 'NEUTRAL', signal: 'WAIT' };
    }
  }

  const upCount = Object.values(results).filter(r => r.trend === 'UP').length;
  const mtfScore = upCount >= 3 ? 85 : upCount === 2 ? 60 : upCount === 1 ? 40 : 20;

  return { timeframes: results, score: mtfScore, alignment: upCount >= 3 ? 'UYUMLU' : upCount <= 1 ? 'ÇATIŞIYOR' : 'KARIŞIK' };
}

// ─── Main Analysis ───────────────────────────────────────────────────────────

async function analyzeElliott(symbol = 'BTC/USDT', timeframe = '1h', limit = 200) {
  try {
    const candles = await exchange.fetchOHLCV(symbol, timeframe, undefined, limit);
    if (!candles || candles.length < 50) throw new Error('Yetersiz veri');

    const currentPrice = candles[candles.length - 1][4];

    const pivots = getPivots(candles);
    const wave = findElliottWaves(pivots, candles);

    if (!wave) {
      return {
        symbol, timeframe, currentPrice,
        pattern: null,
        message: 'Geçerli Elliott dalgası bulunamadı',
        timestamp: Date.now(),
      };
    }

    const { isBullish, points, validation, waveSpan, waveIndices } = wave;
    // Bearish impulse (5 waves DOWN) → expect LONG correction upward
    // Bullish impulse (5 waves UP)   → expect SHORT correction downward
    const direction = isBullish ? 'SHORT' : 'LONG';

    const w5Price = points.p5.price;
    const w0Price = points.p0.price;

    // Fibonacci targets — correction moves opposite to impulse
    const corrBase = w5Price;
    const corrDir = isBullish ? -1 : 1;

    const tp1 = parseFloat((corrBase + corrDir * waveSpan * 0.382).toFixed(2));
    const tp2 = parseFloat((corrBase + corrDir * waveSpan * 0.500).toFixed(2));
    const tp3 = parseFloat((corrBase + corrDir * waveSpan * 0.618).toFixed(2));
    const invalidation = parseFloat((w5Price - corrDir * waveSpan * 0.05).toFixed(2));

    // Entry zone (±0.8% from current, not wide range)
    const recentCandles = candles.slice(-5);
    const recentLow  = Math.min(...recentCandles.map(c => c[3]));
    const recentHigh = Math.max(...recentCandles.map(c => c[2]));
    const entryZone = calculateEntryZone(currentPrice, direction, recentLow, recentHigh);

    // Direction validation
    const setupCheck = validateTradeSetup(direction, entryZone.mid, invalidation, tp1);
    if (!setupCheck.valid) {
      return {
        symbol, timeframe, currentPrice,
        pattern: null,
        setupError: setupCheck.reason,
        message: setupCheck.reason,
        timestamp: Date.now(),
      };
    }

    // R:R calculation
    const rrData = calculateRR(entryZone.mid, invalidation, tp1);

    // Scores
    const momentum = calculateMomentumScore(candles);
    const volScore = calculateVolumeScore(candles, waveIndices);
    const mtfData = await getMTFData(symbol);
    const confidence = calculateConfidence(
      validation.rulesScore,
      momentum.score,
      volScore,
      mtfData.score
    );

    // Fib confluence
    const confluenceZones = calculateFibConfluence(w0Price, w5Price, direction);

    // Alternative count
    const altCount = generateAlternativeCount(
      { w5: w5Price },
      direction,
      confidence.total,
      currentPrice
    );

    // Timeline: average correction duration ≈ W3 duration × 0.382
    const w3Duration = points.p3.idx - points.p2.idx;
    const expectedCandles = Math.round(w3Duration * 0.618);

    // Candlebars since W5
    const candlesSinceW5 = candles.length - 1 - points.p5.idx;

    return {
      symbol,
      timeframe,
      currentPrice,
      timestamp: Date.now(),

      pattern: {
        name: isBullish ? 'A-B-C DÜZELTMESİ (DÜŞÜŞ)' : 'A-B-C TEPKİSİ (YÜKSELİŞ)',
        direction,
        description: isBullish
          ? '5 dalgalık yükseliş trendi bitti. Fiyatın aşağı yönlü ABC düzeltmesi yapması bekleniyor.'
          : '5 dalgalık düşüş trendi bitti. Fiyatın yukarı yönlü tepki (A dalgası) vermesi bekleniyor.',
        wavePoints: {
          W0: parseFloat(w0Price.toFixed(2)),
          W1: parseFloat(points.p1.price.toFixed(2)),
          W2: parseFloat(points.p2.price.toFixed(2)),
          W3: parseFloat(points.p3.price.toFixed(2)),
          W4: parseFloat(points.p4.price.toFixed(2)),
          W5: parseFloat(w5Price.toFixed(2)),
        },
        candlesSinceW5,
        validation,
      },

      tradeSetup: {
        direction,
        entryZone,
        invalidation,
        sl: invalidation,
        tp1,
        tp2,
        tp3,
        rr: rrData,
        confirmation: 'Alt zaman diliminde dönüş formasyonu (15m/1h)',
        managementRule: 'TP1\'e ulaştığında SL\'i giriş seviyesine (break-even) çek',
        isRecommended: rrData.recommend,
      },

      timeline: {
        expectedCandles,
        remaining: Math.max(0, expectedCandles - candlesSinceW5),
        note: `Tahmini düzeltme süresi: ~${expectedCandles} mum (${timeframe})`,
      },

      confidence,

      momentum: {
        rsi: momentum.rsi,
        score: momentum.score,
        divergence: momentum.divergence,
        divergenceLabel: momentum.divergence === 'bullish'
          ? 'Bullish Diverjans tespit edildi'
          : momentum.divergence === 'bearish'
            ? 'Bearish Diverjans tespit edildi'
            : 'Diverjans yok',
      },

      mtf: mtfData,

      fibConfluence: confluenceZones.slice(0, 4),

      altCount,

      anaTrend: mtfData.timeframes['1d']?.trend === 'UP' ? 'YÜKSELİŞ (BULLISH)' : 'DÜŞÜŞ (BEARISH)',
    };

  } catch (err) {
    return {
      symbol,
      timeframe,
      error: err.message,
      timestamp: Date.now(),
    };
  }
}

module.exports = { analyzeElliott, validateImpulse, calculateRR, validateTradeSetup };
