"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import axios from "axios";
import {
  TrendingUp, TrendingDown, Activity, AlertTriangle, ShieldAlert,
  Target, ChevronDown, RefreshCcw, Zap, BarChart2, Clock, Info,
  CheckCircle, XCircle, ArrowUpRight, ArrowDownRight,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ConfidenceComponent {
  score: number;
  weight: string;
  label: string;
}

interface AnalysisData {
  symbol: string;
  timeframe: string;
  currentPrice: number;
  timestamp: number;
  error?: string;
  setupError?: string;
  pattern?: {
    name: string;
    direction: string;
    description: string;
    wavePoints: Record<string, number>;
    candlesSinceW5: number;
    validation: {
      valid: boolean;
      violations: string[];
      warning: string | null;
      metrics: { w2Retracement: number; w3Extension: string; w4Retracement: number };
      rulesScore: number;
    };
  };
  tradeSetup?: {
    direction: "LONG" | "SHORT";
    entryZone: { low: number; high: number; mid: number };
    invalidation: number;
    sl: number;
    tp1: number;
    tp2: number;
    tp3: number;
    rr: { rr: number; str: string; rating: string; color: string; recommend: boolean };
    confirmation: string;
    managementRule: string;
    isRecommended: boolean;
  };
  timeline?: { expectedCandles: number; remaining: number; note: string };
  confidence?: {
    total: number;
    components: Record<string, ConfidenceComponent>;
    interpretation: string;
    formula: string;
  };
  momentum?: { rsi: number; score: number; divergence: string | null; divergenceLabel: string };
  mtf?: {
    timeframes: Record<string, { trend: string; signal: string; rsi: number }>;
    score: number;
    alignment: string;
  };
  fibConfluence?: Array<{ price: number; strength: number; label: string; isHot: boolean }>;
  altCount?: {
    direction: string;
    description: string;
    triggerPrice: number;
    triggerLabel: string;
    probability: number;
    primaryProbability: number;
  };
  anaTrend?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SYMBOLS = [
  "BTC/USDT","ETH/USDT","SOL/USDT","BNB/USDT","XRP/USDT",
  "DOGE/USDT","ADA/USDT","AVAX/USDT","DOT/USDT","LINK/USDT",
  "SUI/USDT","ARB/USDT","OP/USDT","INJ/USDT","TIA/USDT",
  "NEAR/USDT","APT/USDT","TON/USDT","ATOM/USDT","FTM/USDT",
  "PEPE/USDT","WIF/USDT","JUP/USDT","SEI/USDT","STRK/USDT",
  "LTC/USDT","BCH/USDT","ETC/USDT","MATIC/USDT","UNI/USDT",
  "AAVE/USDT","MKR/USDT","CRV/USDT","SNX/USDT","GRT/USDT",
];

const TIMEFRAMES = ["15m","1h","4h","1d","1w"];

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3005";

// ─── Sub-components ───────────────────────────────────────────────────────────

function ConfidenceBar({ label, score, weight, color }: {
  label: string; score: number; weight: string; color: string;
}) {
  const barColor =
    score >= 70 ? "bg-apex-green" :
    score >= 50 ? "bg-apex-yellow" : "bg-apex-red";

  return (
    <div className="space-y-1">
      <div className="flex justify-between items-center text-[11px]">
        <span className="text-slate-400">{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-slate-600 text-[10px]">{weight}</span>
          <span className="text-white font-bold w-6 text-right">{score}</span>
        </div>
      </div>
      <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${barColor}`}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}

function RRBadge({ rating, recommend }: { rating: string; recommend: boolean }) {
  const cls = recommend
    ? "bg-emerald-900/40 border-emerald-600/50 text-emerald-400"
    : "bg-red-900/40 border-red-600/50 text-red-400";
  return (
    <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${cls}`}>
      {rating}
    </span>
  );
}

function MTFRow({ tf, trend, signal, rsi }: {
  tf: string; trend: string; signal: string; rsi: number;
}) {
  const signalColor =
    signal === "BUY" ? "text-apex-green" :
    signal === "SELL" ? "text-apex-red" : "text-slate-500";
  const trendIcon = trend === "UP"
    ? <ArrowUpRight className="w-3 h-3 text-apex-green" />
    : <ArrowDownRight className="w-3 h-3 text-apex-red" />;

  return (
    <div className="flex items-center justify-between py-1.5 border-b border-slate-800/50 last:border-0">
      <span className="text-slate-400 text-xs font-bold w-8">{tf}</span>
      <div className="flex items-center gap-1">{trendIcon}<span className="text-[11px] text-slate-500">{trend}</span></div>
      <span className={`text-xs font-bold ${signalColor}`}>{signal}</span>
      <span className="text-slate-600 text-[11px]">RSI {rsi}</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ElliottPage() {
  const [symbol, setSymbol] = useState("BTC/USDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [data, setData] = useState<AnalysisData | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<string>("");
  const [showFormula, setShowFormula] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const analyze = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get(`${API_BASE}/api/v1/elliott`, {
        params: { symbol, tf: timeframe },
      });
      setData(res.data);
      setLastUpdate(new Date().toLocaleTimeString("tr-TR"));
    } catch {
      setData({ symbol, timeframe, currentPrice: 0, timestamp: Date.now(), error: "API bağlantısı kurulamadı" });
    } finally {
      setLoading(false);
    }
  }, [symbol, timeframe]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(analyze, 30_000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefresh, analyze]);

  const ts = data?.tradeSetup;
  const conf = data?.confidence;
  const pat = data?.pattern;
  const isLong = ts?.direction === "LONG";
  const isBullishTrend = data?.anaTrend?.includes("BULLISH");

  return (
    <div className="min-h-screen bg-apex-bg text-slate-300 font-mono flex flex-col">

      {/* ── Header ── */}
      <header className="flex items-center gap-3 px-4 py-3 border-b border-apex-border bg-[#0e1420]">
        <span className="text-white font-black tracking-[0.2em] text-sm">APEX-Q</span>
        <span className="text-slate-700">|</span>
        <span className="text-slate-500 text-xs tracking-widest">ELLIOTT WAVE PRO</span>

        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          {/* Symbol selector */}
          <div className="relative">
            <select
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              className="bg-apex-card border border-apex-border text-white text-xs px-3 py-1.5 rounded-lg appearance-none pr-7 outline-none focus:border-apex-blue cursor-pointer"
            >
              {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <ChevronDown className="absolute right-2 top-2 w-3 h-3 text-slate-500 pointer-events-none" />
          </div>

          {/* Timeframe */}
          <div className="flex bg-apex-card border border-apex-border rounded-lg overflow-hidden">
            {TIMEFRAMES.map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1.5 text-xs font-bold transition-colors ${
                  timeframe === tf
                    ? "bg-apex-blue text-white"
                    : "text-slate-500 hover:text-slate-300"
                }`}
              >
                {tf}
              </button>
            ))}
          </div>

          {/* Auto refresh toggle */}
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border transition-colors ${
              autoRefresh
                ? "bg-apex-blue/20 border-apex-blue text-apex-blue"
                : "border-apex-border text-slate-500 hover:text-slate-300"
            }`}
          >
            <RefreshCcw className={`w-3 h-3 ${autoRefresh ? "animate-spin" : ""}`} />
            AUTO
          </button>

          {/* Analyze button */}
          <button
            onClick={analyze}
            disabled={loading}
            className="flex items-center gap-2 bg-apex-blue hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-black px-5 py-1.5 rounded-lg tracking-widest transition-colors"
          >
            {loading
              ? <><RefreshCcw className="w-3 h-3 animate-spin" /> ANALİZ EDİLİYOR...</>
              : <><Zap className="w-3 h-3" /> ANALİZE BAŞLA</>}
          </button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Chart + Wave Info ── */}
        <div className="flex-1 flex flex-col min-w-0 p-4 gap-4">

          {/* Ana Trend + Price row */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-apex-card border border-apex-border px-3 py-1.5 rounded-lg">
              <span className="text-slate-500 text-[10px] tracking-widest">ANA TREND (1D)</span>
              <span className={`text-xs font-black ${isBullishTrend ? "text-apex-green" : "text-apex-red"}`}>
                {data?.anaTrend ?? "—"}
              </span>
            </div>
            {data?.currentPrice ? (
              <div className="text-white font-black text-lg">
                ${data.currentPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </div>
            ) : null}
            {lastUpdate && (
              <span className="text-slate-700 text-[10px] ml-auto">Son güncelleme: {lastUpdate}</span>
            )}
          </div>

          {/* Chart placeholder / wave info */}
          {!data && !loading && (
            <div className="flex-1 bg-apex-card border border-apex-border rounded-xl flex flex-col items-center justify-center gap-4 min-h-[420px]">
              <BarChart2 className="w-16 h-16 text-slate-700" />
              <p className="text-slate-600 text-sm tracking-wider">Analiz başlatmak için sembol seçin ve ANALİZE BAŞLA&apos;ya tıklayın.</p>
            </div>
          )}

          {/* No pattern found */}
          {data && !data.error && !data.pattern && !loading && (
            <div className="flex-1 bg-apex-card border border-slate-700/50 rounded-xl flex flex-col items-center justify-center gap-4 min-h-[420px]">
              <Activity className="w-12 h-12 text-slate-700" />
              <div className="text-center space-y-2">
                <p className="text-slate-400 font-bold">Geçerli Elliott Dalgası Bulunamadı</p>
                <p className="text-slate-600 text-xs max-w-xs">Bu sembol/zaman diliminde net bir 5 dalga yapısı tespit edilemedi.</p>
              </div>
              <div className="flex flex-wrap gap-2 justify-center mt-2">
                {["4h","1d","1w"].map(tf => (
                  <button
                    key={tf}
                    onClick={() => { setTimeframe(tf); setTimeout(analyze, 100); }}
                    className="px-4 py-1.5 bg-apex-blue/20 border border-apex-blue/40 text-apex-blue text-xs rounded-lg hover:bg-apex-blue/30 transition-colors font-bold"
                  >
                    {tf} dene
                  </button>
                ))}
              </div>
              <p className="text-slate-700 text-[10px]">İpucu: 4h ve 1d zaman dilimlerinde pattern bulma oranı daha yüksektir.</p>
            </div>
          )}

          {loading && (
            <div className="flex-1 bg-apex-card border border-apex-border rounded-xl flex items-center justify-center min-h-[420px]">
              <div className="text-center space-y-3">
                <div className="w-8 h-8 border-2 border-apex-blue border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-slate-500 text-xs tracking-widest">DALGA SAYIMI YAPILIYOR...</p>
              </div>
            </div>
          )}

          {data?.error && (
            <div className="flex-1 bg-apex-card border border-red-900/40 rounded-xl flex flex-col items-center justify-center gap-3 min-h-[420px]">
              <XCircle className="w-10 h-10 text-apex-red" />
              <p className="text-red-400 text-sm">{data.error}</p>
            </div>
          )}

          {data?.setupError && !data?.error && (
            <div className="bg-red-900/20 border border-red-600/40 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-apex-red shrink-0 mt-0.5" />
              <div>
                <p className="text-red-400 font-bold text-xs tracking-widest mb-1">SETUP HATASI — İŞLEM GÖSTERİLMEYECEK</p>
                <p className="text-red-300 text-xs">{data.setupError}</p>
              </div>
            </div>
          )}

          {/* Wave Data Panel */}
          {pat && !data?.error && (
            <div className="bg-apex-card border border-apex-border rounded-xl p-4 space-y-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <div className={`w-2 h-2 rounded-full ${isLong ? "bg-apex-green" : "bg-apex-red"}`} />
                    <span className={`font-black text-sm ${isLong ? "text-apex-green" : "text-apex-red"}`}>
                      {pat.name}
                    </span>
                  </div>
                  <p className="text-slate-500 text-xs leading-relaxed max-w-xl">{pat.description}</p>
                </div>
                <span className="text-slate-600 text-[10px] shrink-0">W5&apos;ten: {pat.candlesSinceW5} mum</span>
              </div>

              {/* Wave Points Grid */}
              <div className="grid grid-cols-6 gap-2">
                {Object.entries(pat.wavePoints).map(([k, v]) => (
                  <div key={k} className="bg-[#0B0F19] border border-slate-800 rounded-lg p-2 text-center">
                    <div className="text-apex-yellow text-[10px] font-bold mb-1">{k}</div>
                    <div className="text-white text-xs font-bold">{Number(v).toLocaleString("en-US")}</div>
                  </div>
                ))}
              </div>

              {/* Wave Statistics */}
              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800">
                <div>
                  <span className="text-slate-600 text-[10px]">W2 Retracement</span>
                  <div className="text-white text-xs font-bold">%{pat.validation.metrics.w2Retracement}</div>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px]">W3 Extension</span>
                  <div className="text-white text-xs font-bold">{pat.validation.metrics.w3Extension}</div>
                </div>
                <div>
                  <span className="text-slate-600 text-[10px]">W4 Retracement</span>
                  <div className="text-white text-xs font-bold">%{pat.validation.metrics.w4Retracement}</div>
                </div>
              </div>

              {/* Violations */}
              {pat.validation.violations.length > 0 && (
                <div className="bg-red-900/10 border border-red-900/30 rounded-lg p-3">
                  <p className="text-red-500 text-[10px] font-bold tracking-widest mb-1.5">KURAL İHLALLERİ</p>
                  {pat.validation.violations.map((v, i) => (
                    <p key={i} className="text-red-400 text-xs">• {v}</p>
                  ))}
                </div>
              )}
              {pat.validation.warning && (
                <div className="bg-yellow-900/10 border border-yellow-900/30 rounded-lg px-3 py-2">
                  <p className="text-apex-yellow text-xs">⚠ {pat.validation.warning}</p>
                </div>
              )}
            </div>
          )}

          {/* Momentum + MTF row */}
          {data?.momentum && data?.mtf && (
            <div className="grid grid-cols-2 gap-4">
              {/* Momentum */}
              <div className="bg-apex-card border border-apex-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-apex-purple" />
                  <span className="text-slate-400 text-xs font-bold tracking-widest">MOMENTUM (RSI 14)</span>
                </div>
                <div className="flex items-end gap-3 mb-3">
                  <span className="text-3xl font-black text-white">{data.momentum.rsi}</span>
                  <span className={`text-xs font-bold mb-1 ${
                    data.momentum.rsi < 30 ? "text-apex-green" :
                    data.momentum.rsi > 70 ? "text-apex-red" : "text-slate-500"
                  }`}>
                    {data.momentum.rsi < 30 ? "AŞIRI SATIM" :
                     data.momentum.rsi > 70 ? "AŞIRI ALIM" : "NÖTR"}
                  </span>
                </div>
                {data.momentum.divergence && (
                  <div className={`flex items-center gap-1.5 text-xs px-2 py-1 rounded ${
                    data.momentum.divergence === "bullish"
                      ? "bg-emerald-900/20 text-emerald-400"
                      : "bg-red-900/20 text-red-400"
                  }`}>
                    <Zap className="w-3 h-3" />
                    {data.momentum.divergenceLabel}
                  </div>
                )}
              </div>

              {/* MTF */}
              <div className="bg-apex-card border border-apex-border rounded-xl p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-apex-blue" />
                    <span className="text-slate-400 text-xs font-bold tracking-widest">MULTI-TIMEFRAME</span>
                  </div>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                    data.mtf.alignment === "UYUMLU"
                      ? "bg-emerald-900/30 text-emerald-400"
                      : data.mtf.alignment === "ÇATIŞIYOR"
                        ? "bg-red-900/30 text-red-400"
                        : "bg-yellow-900/30 text-apex-yellow"
                  }`}>{data.mtf.alignment}</span>
                </div>
                {Object.entries(data.mtf.timeframes).map(([tf, v]) => (
                  <MTFRow key={tf} tf={tf} trend={v.trend} signal={v.signal} rsi={v.rsi} />
                ))}
              </div>
            </div>
          )}

          {/* Fib Confluence */}
          {data?.fibConfluence && data.fibConfluence.length > 0 && (
            <div className="bg-apex-card border border-apex-border rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Target className="w-4 h-4 text-apex-amber" />
                <span className="text-slate-400 text-xs font-bold tracking-widest">FİB CONFLUENCE ZONLARI</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {data.fibConfluence.map((z, i) => (
                  <div key={i} className={`border rounded-lg p-2.5 text-center ${
                    z.strength >= 3
                      ? "bg-amber-900/20 border-amber-600/40"
                      : "bg-slate-900/50 border-slate-700"
                  }`}>
                    {z.strength >= 3 && (
                      <div className="text-[9px] text-apex-amber font-bold tracking-widest mb-1">🔥 HOT ZONE</div>
                    )}
                    <div className="text-white font-bold text-sm">${z.price.toLocaleString("en-US")}</div>
                    <div className="text-slate-500 text-[10px] mt-0.5">{z.label}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ── Right Sidebar ── */}
        {ts && conf && !data?.error && (
          <div className="w-80 shrink-0 flex flex-col gap-3 p-4 border-l border-apex-border overflow-y-auto">

            {/* 1. Invalidation */}
            <div className="bg-red-950/30 border border-red-600/50 rounded-xl p-4 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-apex-red" />
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert className="w-4 h-4 text-apex-red" />
                <span className="text-red-400 text-[10px] font-bold tracking-widest">SENARYO İPTAL SEVİYESİ</span>
              </div>
              <div className="text-3xl font-black text-white tracking-tight mb-2">
                ${ts.invalidation.toLocaleString("en-US")}
              </div>
              <p className="text-red-300/70 text-[11px] leading-relaxed">
                Fiyat bu seviyenin {isLong ? "altında" : "üstünde"} kapanırsa
                yeni bir impulse dalgası {isLong ? "aşağı" : "yukarı"} yönlü başlamış demektir.
                Tepki yükselişi iptal olur.
              </p>
            </div>

            {/* 2. Trade Setup */}
            <div className="bg-apex-card border border-apex-border rounded-xl p-4 relative overflow-hidden">
              <div className={`absolute top-0 left-0 right-0 h-1 ${isLong ? "bg-apex-green" : "bg-apex-red"}`} />
              <div className="flex items-center gap-2 mb-3">
                <Target className={`w-4 h-4 ${isLong ? "text-apex-green" : "text-apex-red"}`} />
                <span className="text-slate-400 text-[10px] font-bold tracking-widest">İŞLEM PLANI (TRADE SETUP)</span>
              </div>

              <div className={`flex items-center gap-2 mb-3 px-2 py-1 rounded ${
                isLong ? "bg-emerald-900/20 border border-emerald-700/30" : "bg-red-900/20 border border-red-700/30"
              }`}>
                {isLong
                  ? <TrendingUp className="w-4 h-4 text-apex-green" />
                  : <TrendingDown className="w-4 h-4 text-apex-red" />}
                <span className={`font-black text-sm ${isLong ? "text-apex-green" : "text-apex-red"}`}>
                  {ts.direction} {isLong ? "(A-B-C Tepkisi Bekleniyor)" : "(Aşağı Tepki Bekleniyor)"}
                </span>
              </div>

              <div className="space-y-1.5 text-xs">
                <SetupRow label="Giriş (Entry Zone)"
                  value={`${ts.entryZone.low.toLocaleString("en-US")} – ${ts.entryZone.high.toLocaleString("en-US")}`}
                  valueClass="text-white" />
                <SetupRow label="Onay (Confirmation)" value={ts.confirmation} valueClass="text-slate-400" small />
                <SetupRow label="Stop-Loss (İptal)" value={`$${ts.sl.toLocaleString("en-US")}`} valueClass="text-apex-red font-bold" />
                <div className="h-px bg-slate-800 my-1" />
                <SetupRow label="TP1 (Zayıf Direnç)" value={`$${ts.tp1.toLocaleString("en-US")}`} valueClass="text-emerald-400" />
                <SetupRow label="TP2 (Orta Direnç)" value={`$${ts.tp2.toLocaleString("en-US")}`} valueClass="text-emerald-400" />
                <SetupRow label="TP3 (Güçlü Direnç)" value={`$${ts.tp3.toLocaleString("en-US")}`} valueClass="text-emerald-400" />
                <div className="h-px bg-slate-800 my-1" />
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Risk/Ödül (R:R)</span>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-black">{ts.rr.str}</span>
                    <RRBadge rating={ts.rr.rating} recommend={ts.rr.recommend} />
                  </div>
                </div>
              </div>

              {!ts.isRecommended && (
                <div className="mt-3 flex items-start gap-2 bg-red-900/20 border border-red-800/30 rounded-lg px-2 py-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-apex-red shrink-0 mt-0.5" />
                  <p className="text-red-400 text-[10px]">R:R 1:1.5 altı — bu setup işlem almak için önerilmez.</p>
                </div>
              )}

              <div className="mt-3 border-t border-slate-800 pt-2">
                <p className="text-slate-600 text-[10px] leading-relaxed">
                  📌 Yönetim: {ts.managementRule}
                </p>
              </div>
            </div>

            {/* 3. Timeline */}
            {data.timeline && (
              <div className="bg-apex-card border border-apex-border rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Clock className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-400 text-[10px] font-bold tracking-widest">ZAMAN PROJEKSİYONU</span>
                </div>
                <p className="text-slate-400 text-xs leading-relaxed">{data.timeline.note}</p>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-apex-blue rounded-full transition-all"
                      style={{
                        width: `${Math.min(100, ((data.timeline.expectedCandles - data.timeline.remaining) / data.timeline.expectedCandles) * 100)}%`
                      }}
                    />
                  </div>
                  <span className="text-slate-500 text-[10px]">{data.timeline.remaining} mum kaldı</span>
                </div>
              </div>
            )}

            {/* 4. Confidence Score */}
            <div className="bg-apex-card border border-apex-border rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <CheckCircle className={`w-4 h-4 ${
                    conf.total >= 70 ? "text-apex-green" :
                    conf.total >= 55 ? "text-apex-yellow" : "text-apex-red"
                  }`} />
                  <span className="text-slate-400 text-[10px] font-bold tracking-widest">GÜVEN SKORU (CONFIDENCE)</span>
                </div>
                <button onClick={() => setShowFormula(v => !v)} className="text-slate-700 hover:text-slate-400">
                  <Info className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="flex items-end gap-2 mb-3">
                <span className={`text-4xl font-black ${
                  conf.total >= 70 ? "text-apex-green" :
                  conf.total >= 55 ? "text-apex-yellow" : "text-apex-red"
                }`}>{conf.total}</span>
                <span className="text-slate-600 text-sm mb-1">/100</span>
                <span className={`text-xs font-bold mb-1 ml-1 ${
                  conf.interpretation === "GÜÇLÜ" ? "text-apex-green" :
                  conf.interpretation === "ORTA" ? "text-apex-yellow" : "text-apex-red"
                }`}>{conf.interpretation}</span>
              </div>

              {showFormula && (
                <div className="mb-3 bg-slate-900/50 border border-slate-800 rounded-lg px-3 py-2">
                  <p className="text-slate-500 text-[10px]">{conf.formula}</p>
                </div>
              )}

              <div className="space-y-2.5">
                {Object.values(conf.components).map((c) => (
                  <ConfidenceBar
                    key={c.label}
                    label={c.label}
                    score={c.score}
                    weight={c.weight}
                    color="apex"
                  />
                ))}
              </div>
            </div>

            {/* 5. Alternative Scenario */}
            {data.altCount && (
              <div className="bg-slate-900/60 border border-slate-700/50 rounded-xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Activity className="w-4 h-4 text-slate-500" />
                  <span className="text-slate-500 text-[10px] font-bold tracking-widest">ALTERNATİF SENARYO</span>
                </div>

                <div className="flex gap-2 mb-3">
                  <div className="flex-1 text-center bg-apex-card border border-apex-border rounded-lg py-2">
                    <div className="text-[10px] text-slate-500 mb-0.5">ANA SENARYO</div>
                    <div className={`font-black text-sm ${isLong ? "text-apex-green" : "text-apex-red"}`}>
                      {ts.direction}
                    </div>
                    <div className="text-apex-blue text-xs font-bold">%{data.altCount.primaryProbability}</div>
                  </div>
                  <div className="flex-1 text-center bg-apex-card border border-slate-700 rounded-lg py-2">
                    <div className="text-[10px] text-slate-600 mb-0.5">ALTERNATİF</div>
                    <div className={`font-black text-sm ${data.altCount.direction === "LONG" ? "text-apex-green" : "text-apex-red"}`}>
                      {data.altCount.direction}
                    </div>
                    <div className="text-slate-500 text-xs font-bold">%{data.altCount.probability}</div>
                  </div>
                </div>

                <p className="text-slate-600 text-[11px] leading-relaxed mb-2">{data.altCount.description}</p>
                <div className="flex items-center gap-1.5 bg-red-950/20 border border-red-900/30 rounded px-2 py-1.5">
                  <AlertTriangle className="w-3 h-3 text-apex-red shrink-0" />
                  <p className="text-red-400 text-[10px]">Tetik: {data.altCount.triggerLabel}</p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function SetupRow({
  label, value, valueClass, small,
}: {
  label: string; value: string; valueClass?: string; small?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-slate-500 shrink-0">{label}</span>
      <span className={`text-right break-all ${valueClass ?? "text-white"} ${small ? "text-[10px] text-slate-400" : ""}`}>
        {value}
      </span>
    </div>
  );
}
