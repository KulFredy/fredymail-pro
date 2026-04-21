/**
 * APEX-Q Telegram Formatter v2
 * Mobile-first format: one image + concise text
 * Includes: direction, entry, SL, TP1/2/3, R:R, confidence, timeline, invalidation
 */

function formatTelegramMessage(data) {
  if (!data || !data.pattern || !data.tradeSetup) {
    return '❌ *APEX-Q HATA*\nGeçerli Elliott dalgası bulunamadı veya veri eksik.';
  }

  const { symbol, timeframe, currentPrice, pattern, tradeSetup, confidence, timeline, momentum, altCount, anaTrend } = data;

  const dirEmoji = tradeSetup.direction === 'LONG' ? '🟢' : '🔴';
  const dirLabel = tradeSetup.direction === 'LONG' ? 'LONG (ALIŞ)' : 'SHORT (SATIŞ)';
  const trendEmoji = anaTrend?.includes('BULLISH') ? '📈' : '📉';

  const rrColor = tradeSetup.rr.recommend ? '✅' : '⚠️';
  const confColor = confidence.total >= 70 ? '🔥' : confidence.total >= 55 ? '🟡' : '🔶';
  const divLabel = momentum?.divergence === 'bullish'
    ? '⚡ Bullish Diverjans'
    : momentum?.divergence === 'bearish'
      ? '⚡ Bearish Diverjans'
      : '';

  const lines = [
    `${dirEmoji} *${symbol} • ${timeframe} • ${dirLabel}*`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `${trendEmoji} Faz: ${pattern.name}`,
    `💰 Anlık Fiyat: $${currentPrice.toLocaleString('en-US')}`,
    ``,
    `📍 *GİRİŞ ZONESİ*`,
    `   $${tradeSetup.entryZone.low.toLocaleString('en-US')} – $${tradeSetup.entryZone.high.toLocaleString('en-US')}`,
    `🔴 *SL (İptal)*: $${tradeSetup.sl.toLocaleString('en-US')}`,
    ``,
    `🎯 *HEDEFLER*`,
    `   TP1 (Fib 0.382): $${tradeSetup.tp1.toLocaleString('en-US')}`,
    `   TP2 (Fib 0.500): $${tradeSetup.tp2.toLocaleString('en-US')}`,
    `   TP3 (Fib 0.618): $${tradeSetup.tp3.toLocaleString('en-US')}`,
    ``,
    `${rrColor} *R:R*: ${tradeSetup.rr.str} (${tradeSetup.rr.rating})`,
    tradeSetup.rr.recommend ? '' : `⚠️ _R:R zayıf — dikkatli ol_`,
    ``,
    `${confColor} *Güven Skoru*: ${confidence.total}/100 (${confidence.interpretation})`,
    divLabel ? `   ${divLabel}` : '',
    ``,
    `⏱ *Süre Tahmini*: ~${timeline.expectedCandles} mum (${timeframe})`,
    `   W5\'ten bu yana: ${pattern.candlesSinceW5} mum geçti`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `🚫 *Senaryo İptal*: $${tradeSetup.invalidation.toLocaleString('en-US')} altında kapanış`,
    ``,
    altCount
      ? `📊 *Alternatif Senaryo* (${altCount.probability}%): ${altCount.description}\n   Tetik: ${altCount.triggerLabel}`
      : '',
    ``,
    `🧠 *Yönetim*: ${tradeSetup.managementRule}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `_APEX-Q • Elliott Wave Pro • ${new Date().toLocaleString('tr-TR')}_`,
  ].filter(l => l !== undefined);

  return lines.join('\n');
}

function formatTelegramAlert(alert, currentPrice) {
  return [
    `🔔 *APEX-Q ALARM TETİKLENDİ*`,
    ``,
    `📍 ${alert.symbol} — ${alert.label}`,
    `💰 Anlık: $${currentPrice.toLocaleString('en-US')}`,
    `🎯 Hedef: $${alert.triggerPrice.toLocaleString('en-US')}`,
    ``,
    `_${new Date().toLocaleString('tr-TR')}_`,
  ].join('\n');
}

module.exports = { formatTelegramMessage, formatTelegramAlert };
