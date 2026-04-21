/**
 * APEX-Q Elliott Wave Server v2
 * Endpoints:
 *   GET  /api/v1/elliott          - Full analysis
 *   GET  /api/v1/symbols          - Active USDT futures pairs
 *   GET  /api/v1/telegram         - Telegram-formatted message
 *   POST /api/v1/alerts           - Register price alert
 *   GET  /api/v1/alerts           - List active alerts
 *   WS   ws://host:3006           - Real-time subscriptions
 */

const express = require('express');
const cors = require('cors');
const WebSocket = require('ws');
const ccxt = require('ccxt');
const { analyzeElliott, calculateRR, validateTradeSetup } = require('./elliott_engine');
const { formatTelegramMessage } = require('./telegram_formatter');

const app = express();
app.use(cors());
app.use(express.json());

const exchange = new ccxt.binanceusdm({ enableRateLimit: true });

// ─── Symbol Cache ─────────────────────────────────────────────────────────────

let symbolCache = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'];

async function refreshSymbols() {
  try {
    const markets = await exchange.loadMarkets();
    const usdtFutures = Object.keys(markets)
      .filter(s => s.endsWith('/USDT') && markets[s].future)
      .sort();
    const priority = ['BTC/USDT', 'ETH/USDT', 'SOL/USDT', 'BNB/USDT', 'XRP/USDT'];
    symbolCache = [...priority, ...usdtFutures.filter(s => !priority.includes(s))].slice(0, 100);
    console.log(`[APEX-Q] ${symbolCache.length} sembol güncellendi`);
  } catch (e) {
    console.warn('[APEX-Q] Sembol güncelleme hatası:', e.message);
  }
}

// ─── Alert Store (in-memory) ──────────────────────────────────────────────────

const alerts = [];

function checkAlerts(analysisData) {
  if (!analysisData || !analysisData.tradeSetup) return [];
  const triggered = [];
  const price = analysisData.currentPrice;
  const { entryZone, sl, tp1, tp2, tp3, invalidation } = analysisData.tradeSetup;

  for (const alert of alerts.filter(a => a.active && a.symbol === analysisData.symbol)) {
    if (price >= alert.triggerPrice * 0.999 && price <= alert.triggerPrice * 1.001) {
      alert.active = false;
      triggered.push({ ...alert, triggeredAt: Date.now(), currentPrice: price });
    }
  }

  return triggered;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/', (req, res) => res.sendFile(__dirname + '/public/elliott.html'));

app.get('/api/v1/elliott', async (req, res) => {
  const symbol = (req.query.symbol || 'BTC/USDT').toUpperCase().replace('-', '/');
  const timeframe = req.query.tf || '1h';

  try {
    const data = await analyzeElliott(symbol, timeframe);

    if (data.error) {
      return res.status(500).json({ error: data.error });
    }

    // Check alerts
    const triggered = checkAlerts(data);
    if (triggered.length > 0) {
      data.triggeredAlerts = triggered;
    }

    // Warn if R:R is bad
    if (data.tradeSetup && !data.tradeSetup.rr.recommend) {
      data.tradeSetup.warning = `R:R ${data.tradeSetup.rr.str} — İşlem önerilmez (min 1:1.5 gerekli)`;
    }

    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/v1/symbols', (req, res) => {
  res.json({ symbols: symbolCache });
});

app.get('/api/v1/telegram', async (req, res) => {
  const symbol = (req.query.symbol || 'BTC/USDT').toUpperCase().replace('-', '/');
  const timeframe = req.query.tf || '1h';

  try {
    const data = await analyzeElliott(symbol, timeframe);
    if (data.error) return res.status(500).json({ error: data.error });

    const message = formatTelegramMessage(data);
    res.json({ message, data });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/v1/alerts', (req, res) => {
  const { symbol, triggerPrice, label, type } = req.body;
  if (!symbol || !triggerPrice) {
    return res.status(400).json({ error: 'symbol ve triggerPrice zorunlu' });
  }
  const alert = {
    id: Date.now(),
    symbol: symbol.toUpperCase(),
    triggerPrice: parseFloat(triggerPrice),
    label: label || 'Fiyat alarmı',
    type: type || 'price',
    active: true,
    createdAt: Date.now(),
  };
  alerts.push(alert);
  res.json({ success: true, alert });
});

app.get('/api/v1/alerts', (req, res) => {
  const symbol = req.query.symbol;
  const filtered = symbol
    ? alerts.filter(a => a.symbol === symbol.toUpperCase())
    : alerts;
  res.json({ alerts: filtered });
});

app.delete('/api/v1/alerts/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const idx = alerts.findIndex(a => a.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Alarm bulunamadı' });
  alerts.splice(idx, 1);
  res.json({ success: true });
});

// ─── HTTP Server ──────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3005;
const server = app.listen(PORT, () => {
  console.log(`[APEX-Q] Elliott Server → http://localhost:${PORT}`);
  refreshSymbols();
  setInterval(refreshSymbols, 12 * 60 * 60 * 1000);
});

// ─── WebSocket Server ─────────────────────────────────────────────────────────

const wss = new WebSocket.Server({ port: 3006 });
const subscriptions = new Map(); // clientId → { symbol, tf }

wss.on('connection', (ws) => {
  const clientId = Date.now().toString();
  console.log(`[WS] Bağlandı: ${clientId}`);

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw);

      if (msg.type === 'subscribe') {
        subscriptions.set(clientId, {
          symbol: (msg.symbol || 'BTC/USDT').toUpperCase(),
          tf: msg.tf || '1h',
          interval: null,
        });

        const pushUpdate = async () => {
          if (ws.readyState !== WebSocket.OPEN) return;
          try {
            const data = await analyzeElliott(
              subscriptions.get(clientId).symbol,
              subscriptions.get(clientId).tf
            );
            ws.send(JSON.stringify({ type: 'analysis', data }));
          } catch (e) {
            ws.send(JSON.stringify({ type: 'error', message: e.message }));
          }
        };

        await pushUpdate();
        const sub = subscriptions.get(clientId);
        sub.interval = setInterval(pushUpdate, 15000);
        subscriptions.set(clientId, sub);
      }

      if (msg.type === 'unsubscribe') {
        const sub = subscriptions.get(clientId);
        if (sub && sub.interval) clearInterval(sub.interval);
        subscriptions.delete(clientId);
      }
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Geçersiz mesaj formatı' }));
    }
  });

  ws.on('close', () => {
    const sub = subscriptions.get(clientId);
    if (sub && sub.interval) clearInterval(sub.interval);
    subscriptions.delete(clientId);
    console.log(`[WS] Ayrıldı: ${clientId}`);
  });
});

console.log(`[APEX-Q] WebSocket Server → ws://localhost:3006`);
