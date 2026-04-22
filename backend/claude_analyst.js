/**
 * APEX-Q Claude Analyst
 *
 * The mathematical engine (elliott_engine.js) generates wave-count HYPOTHESES.
 * This module sends those hypotheses — plus raw OHLCV data and indicators —
 * to Claude claude-sonnet-4-6 and asks it to act as a detective:
 *   1. Which hypothesis is most credible?
 *   2. At exactly what price is it definitively WRONG?
 *   3. What would CONFIRM it?
 *   4. What is the trade plan?
 *
 * Claude has access to text-based few-shot examples of canonical Elliott counts
 * so it can pattern-match without needing chart images.
 */

require('dotenv').config();
const https = require('https');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

// ─── Few-shot system prompt ───────────────────────────────────────────────────
// These are canonical text-described Elliott counts Claude uses as reference.
// When you have labeled chart images, add them to the messages array as vision
// content blocks alongside these text examples.

const SYSTEM_PROMPT = `Sen uzman bir kripto vadeli işlem Elliott Dalga analistisin.
Binance USDM Futures piyasasında yıllar içinde yüzlerce sayım yapmış, deneyimli bir "dedektif" gibi düşünürsün.

TEMEL MISYONUN:
Ham fiyat verisi ve birkaç matematiksel aday dalga sayımını alırsın.
Elindeki kanıtları (Fibonacci uyumu, hacim, momentum, yapısal uyum) değerlendirirsin.
En mantıklı sayımı seçer, NEREDE YANILACAĞINI söylersin, sonra trade planı çıkarırsın.

══════════ SABIT KURALLAR ══════════

HARD KURALLAR (hiç ihlal edilemez):
1. W2 hiçbir zaman W1'in başlangıcının ötesine geçemez.
2. W3 asla en kısa impulse dalgası olamaz (W1 ve W5'ten kısa olamaz).
3. W4 nadiren W1'in fiyat bölgesine girer — gövde kapanışına bak, wick'leri görmezden gel.

FUTURES PİYASASI GERÇEKLERİ:
- Wick ihlalleri normaldir; kural ihlali için GÖVDE kapanışı şart.
- Funding rate yüksekken W3'ler çok agresif uzayabilir (3×-4× W1).
- Likit coinlerde (BTC, ETH, SOL) sayım güvenilir; küçük coinlerde gürültü var.
- W4 genellikle bir önceki W4'ün alanında son bulur — onu hedef al.
- Ending diagonal (çapraz W5): fiyat overlap yapar ama her dalga içi 3'lü yapıdadır.

FİBONACCI ALAN TOLERANSI:
- %38.2 → kabul aralığı: %33–%44
- %61.8 → kabul aralığı: %55–%68
- %161.8 → kabul aralığı: %145–%178
Tam nokta değil BÖLGE önemlidir.

══════════ FEW-SHOT ÖRNEKLER ══════════

──── ÖRNEK 1: Klasik Textbook Bullish Impulse ────
Fiyatlar: W0:100 → W1:155 → W2:121 → W3:235 → W4:200 → W5:268
Metrikler: W2 geri çekilme: %61.8 ✓ | W3/W1: 2.36× ✓ | W4 geri çekilme: %33.6 ✓
Hacim: W3'te %190 ortalama üzeri ✓ — W4'te %60 ↓ (sağlıklı düzeltme)
Sonuç: GÜÇLÜ sayım. 5. dalga bitti → SHORT pozisyon ara. İnvalidasyon: W4 altı (200 altı GÖVDE kapanışı).
Beklenti: %61.8 geri çekilme → ~178, sonra %100 → 100 (tam düzeltme).

──── ÖRNEK 2: Extended W3 Bearish Impulse ────
Fiyatlar: W0:500 → W1:415 → W2:465 → W3:275 → W4:340 → W5:248
Metrikler: W2 geri çekilme: %58.8 (Fib 0.618 yakını) ✓ | W3/W1: 2.82× ✓ | W4: %30.7 ✓
Hacim: W3'te zirve, W4/W5'te belirgin düşüş ✓
Sonuç: 5'li bearish impulse tamamlandı → LONG tepki beklenir. İnvalidasyon: W4 üzeri (340 üzeri kapanış).
Not: Extended W3, genelde W5'in W1'den kısa olduğuna işaret eder — doğrulandı ✓.

──── ÖRNEK 3: Truncated (Başarısız) W5 — Bear Sinyali ────
Fiyatlar: W0:100 → W1:162 → W2:131 → W3:245 → W4:207 → W5:238
W5, W3'ün zirvesini aşamadı (238 < 245) — "truncated fifth" ✓
Hacim: W5'te belirgin düşüş → momentum tükendi
Sonuç: Zayıf W5, güçlü düzeltme sinyali → agresif SHORT. İnvalidasyon: 245 üzeri kapanış (bu olursa sayım yanlış, W5 uzuyor).

──── ÖRNEK 4: W4 ABC Düzeltmesi (Zigzag) ────
W4 içinde 3 aşamalı yapı: A dalgası ↓, B toparlanması (%50-61.8 geri alım), C dalgası ↓ (A ile eşit veya 1.618×A)
Hacim: Tüm W4 süresinde ortalama altı → sağlıklı konsolidasyon
Sonuç: W4 tamamlandı, W5 başlamış olabilir → Yükseliş devam edebilir. İnvalidasyon: W4 başlangıcı altı.

──── ÖRNEK 5: Ending Diagonal (Kama) W5 ────
W5 içinde alt-dalgalar birbirine girer (overlap yapar).
Her iç dalga 3'lü yapıda (zigzag).
Genişleyen veya daralan kama formu görünür.
Sonuç: Kama W5, sert ve hızlı bir "V dönüşü" habercisidir. İnvalidasyon: Kama başlangıcı altı kapanış.

──── ÖRNEK 6: Yanlış Sayım — Gerçekte Düzeltme ────
Görünen: 5 dalgalı yapı var ama W3 W1'den yalnızca %12 daha uzun.
Hacim: W3'te ortalama altı → momentum onayı yok.
Tüm hareket önceki büyük trendin %61.8 geri çekilme noktasında durmuş.
Sonuç: Bu büyük ihtimalle bir DÜZELTME dalgası (ABC), impulse değil. Sayımı reddet veya çok düşük güven ver.

══════════ YANIT FORMATI ══════════

SADECE geçerli JSON döndür. Markdown code block veya başka metin ekleme.

{
  "primaryCount": {
    "label": "Kısa başlık (örn: Bullish Impulse Tamamlandı — W5 Zirvesi)",
    "currentPosition": "Fiyatın şu an hangi noktada olduğu (örn: W5 bitişi / W4 içi / ABC-C)",
    "isBullish": true,
    "wavePoints": { "W0": 0, "W1": 0, "W2": 0, "W3": 0, "W4": 0, "W5": 0 },
    "direction": "LONG|SHORT",
    "probability": 0,
    "invalidation": {
      "price": 0,
      "condition": "Bu fiyatın altına/üstüne GÖVDE ile kapanırsa sayım geçersiz"
    },
    "confirmation": "Bu sayımı kesinleştirecek sinyal (örn: 15m'de RSI bullish cross + hacim artışı)",
    "targets": [
      { "label": "TP1", "price": 0, "fib": "0.382 geri çekilme" },
      { "label": "TP2", "price": 0, "fib": "0.618 geri çekilme" },
      { "label": "TP3", "price": 0, "fib": "1.000 geri çekilme (W4 seviyesi)" }
    ],
    "tradeSetup": {
      "entry": "Giriş bölgesi açıklaması",
      "stopLoss": 0,
      "riskNote": "Neden bu SL seviyesi"
    }
  },
  "alternative": {
    "label": "Alternatif senaryo başlığı",
    "description": "Ne zaman/nasıl devreye girer",
    "probability": 0,
    "triggerPrice": 0
  },
  "analysis": {
    "fibonicci": "Fibonacci uyumu değerlendirmesi (1-2 cümle)",
    "volume": "Hacim yorumu (1 cümle)",
    "momentum": "RSI/momentum yorumu (1 cümle)",
    "context": "Genel market bağlamı (1 cümle)"
  },
  "confidence": "YÜKSEK|ORTA|DÜŞÜK",
  "reasoning": "Neden bu sayımı seçtim ve alternatiflerden neden üstün olduğu (2-3 cümle)"
}`;

// ─── Compact OHLCV formatter ──────────────────────────────────────────────────
// Sends the last N candles as a compact text table to save tokens.

function formatCandles(candles, n = 40) {
  const slice = candles.slice(-n);
  const header = 'idx | tarih(UTC)          | açılış   | yüksek   | düşük    | kapanış  | hacim';
  const divider = '----+---------------------+----------+----------+----------+----------+--------';
  const rows = slice.map((c, i) => {
    const d = new Date(c[0]).toISOString().slice(0, 16);
    return `${String(i).padStart(3)} | ${d} | ${String(c[1].toFixed(4)).padStart(8)} | ${String(c[2].toFixed(4)).padStart(8)} | ${String(c[3].toFixed(4)).padStart(8)} | ${String(c[4].toFixed(4)).padStart(8)} | ${Math.round(c[5])}`;
  });
  return [header, divider, ...rows].join('\n');
}

// ─── Candidate formatter ─────────────────────────────────────────────────────

function formatCandidate(c, idx) {
  const dir = c.isBullish ? 'Bullish impulse' : 'Bearish impulse';
  const pts = c.points;
  return [
    `ADAY ${idx + 1} [${dir}] — pivot hassasiyet: ${c.pivotSensitivity}`,
    `  W0: ${pts.p0.price.toFixed(4)}  W1: ${pts.p1.price.toFixed(4)}  W2: ${pts.p2.price.toFixed(4)}`,
    `  W3: ${pts.p3.price.toFixed(4)}  W4: ${pts.p4.price.toFixed(4)}  W5: ${pts.p5.price.toFixed(4)}`,
    `  W2 geri çekilme: %${c.evidence.metrics.w2Retracement}  |  W3 uzama: ${c.evidence.metrics.w3Extension}  |  W4 geri çekilme: %${c.evidence.metrics.w4Retracement}`,
    `  Fibonacci skoru: ${c.evidence.fibScore}/100  |  Kural skoru: ${c.evidence.rulesScore}/100`,
    `  İhlaller: ${c.evidence.violations.join('; ') || 'Yok'}`,
    `  Uyarılar: ${c.evidence.warnings.join('; ') || 'Yok'}`,
    `  W5 bitişinden bu yana: ${c.evidence.candlesAgo} mum önce`,
  ].join('\n');
}

// ─── Build the analyst prompt ────────────────────────────────────────────────

function buildAnalystPrompt({ symbol, timeframe, currentPrice, candles, candidates, rsi, rsiDivergence, volumeScore, mtf }) {
  const candleTable = formatCandles(candles, 40);
  const candidateText = candidates.length > 0
    ? candidates.map((c, i) => formatCandidate(c, i)).join('\n\n')
    : 'Motor hiçbir aday bulamadı — raw fiyat verisinden sıfırdan analiz yap.';

  const mtfText = mtf ? Object.entries(mtf.timeframes || {})
    .map(([tf, d]) => `${tf}: ${d.trend} | RSI: ${d.rsi} | Sinyal: ${d.signal}`)
    .join('\n  ') : 'Mevcut değil';

  return `Analiz et: ${symbol} | Zaman dilimi: ${timeframe}
Şu anki fiyat: ${currentPrice}
RSI(14): ${rsi ?? 'N/A'}  |  Diverjans: ${rsiDivergence ?? 'yok'}  |  Hacim skoru: ${volumeScore ?? 'N/A'}/100

──── SON 40 MUM (OHLCV) ────
${candleTable}

──── MOTOR ADAYLARI ────
${candidateText}

──── ÇOKLU ZAMAN DİLİMİ ────
  ${mtfText}

──── GÖREVİN ────
Yukarıdaki tüm veriyi analiz et.
Adayları değerlendir (veya yenisini öner).
En mantıklı Elliott sayımını seç.
MUTLAKA invalidasyon fiyatı belirt.
Sadece JSON döndür.`;
}

// ─── Claude API call ─────────────────────────────────────────────────────────

function callClaude(userPrompt) {
  return new Promise((resolve, reject) => {
    const body = Buffer.from(JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
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
            reject(new Error('Claude JSON parse hatası: ' + data.slice(0, 300)));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Parse Claude's JSON response ────────────────────────────────────────────
// Claude sometimes wraps JSON in markdown fences — strip them.

function parseClaudeJSON(text) {
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  return JSON.parse(cleaned);
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * analyzeWithClaude
 * @param {object} params
 *   symbol, timeframe, currentPrice, candles, candidates, rsi,
 *   rsiDivergence, volumeScore, mtf
 * @returns {object|null}  Parsed Claude analysis or null on failure
 */
async function analyzeWithClaude(params) {
  if (!ANTHROPIC_API_KEY) {
    console.warn('[Claude] ANTHROPIC_API_KEY ayarlı değil — analiz atlandı.');
    return null;
  }

  const prompt = buildAnalystPrompt(params);

  try {
    const raw = await callClaude(prompt);
    const result = parseClaudeJSON(raw);
    result._raw = raw; // keep original for debugging
    return result;
  } catch (e) {
    console.warn(`[Claude] Analiz hatası (${params.symbol} ${params.timeframe}):`, e.message);
    return null;
  }
}

module.exports = { analyzeWithClaude, buildAnalystPrompt, SYSTEM_PROMPT };
