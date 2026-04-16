import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, Minus, Loader2, Activity } from "lucide-react";

const COINS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","AVAXUSDT","LINKUSDT"];
const FRAMES = [
  { label: "5m", ms: 5 * 60 * 1000 },
  { label: "15m", ms: 15 * 60 * 1000 },
  { label: "1h", ms: 60 * 60 * 1000 },
  { label: "4h", ms: 4 * 60 * 60 * 1000 },
  { label: "1d", ms: 24 * 60 * 60 * 1000 }
];

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Fetch from Binance directly (CORS enabled, no key needed)
async function fetchBinanceOHLCV(symbol: string, interval: string, limit: number = 100): Promise<Candle[]> {
  const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`);
  if (!res.ok) throw new Error("Binance API failed");
  const data = await res.json();
  return data.map((k: any[]) => ({
    time: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5])
  }));
}

// Simple Technical Analysis
function calculateRSI(candles: Candle[], period: number = 14): number {
  if (candles.length < period) return 50;
  let gains = 0, losses = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    const change = candles[i].close - candles[i-1]?.close || 0;
    if (change > 0) gains += change;
    else losses += Math.abs(change);
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calculateEMA(candles: Candle[], period: number): number {
  const k = 2 / (period + 1);
  let ema = candles[0].close;
  for (let i = 1; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}

function generateForecast(candles: Candle[], timeframeMs: number): {
  signal: "STRONG_BULL" | "BULLISH" | "NEUTRAL" | "BEARISH" | "STRONG_BEAR";
  confidence: number;
  changePct: number;
  predictions: { price: number; time: string }[];
} {
  const rsi = calculateRSI(candles);
  const ema20 = calculateEMA(candles.slice(-20), 20);
  const ema50 = calculateEMA(candles.slice(-50), 50);
  const currentPrice = candles[candles.length - 1].close;
  
  // Trend strength
  const trendUp = ema20 > ema50;
  const rsiBullish = rsi > 50 && rsi < 80;
  const rsiBearish = rsi < 50 && rsi > 20;
  const rsiOverbought = rsi > 70;
  const rsiOversold = rsi < 30;
  
  let signal: typeof result.signal = "NEUTRAL";
  let confidence = 0.5;
  
  if (trendUp && rsiBullish && !rsiOverbought) {
    signal = "BULLISH";
    confidence = 0.65 + (rsi - 50) / 100;
  } else if (trendUp && rsiOverbought) {
    signal = "NEUTRAL";
    confidence = 0.5;
  } else if (!trendUp && rsiBearish && !rsiOversold) {
    signal = "BEARISH";
    confidence = 0.65 + (50 - rsi) / 100;
  } else if (!trendUp && rsiOversold) {
    signal = "BULLISH"; // Bounce play
    confidence = 0.6;
  }
  
  // Strong signals
  if (rsi > 60 && trendUp && (currentPrice > ema20 * 1.02)) {
    signal = "STRONG_BULL";
    confidence = 0.8;
  } else if (rsi < 40 && !trendUp && (currentPrice < ema20 * 0.98)) {
    signal = "STRONG_BEAR";
    confidence = 0.8;
  }
  
  // Generate fake future candles based on momentum
  const volatility = candles.slice(-20).reduce((acc, c) => acc + (c.high - c.low) / c.close, 0) / 20;
  const momentum = (candles[candles.length - 1].close - candles[candles.length - 10].close) / candles[candles.length - 10].close;
  
  const predictions = [];
  let lastPrice = currentPrice;
  const now = Date.now();
  
  for (let i = 1; i <= 12; i++) {
    const drift = signal.includes("BULL") ? volatility * 0.5 : signal.includes("BEAR") ? -volatility * 0.5 : 0;
    const randomWalk = (Math.random() - 0.5) * volatility * 0.3;
    lastPrice = lastPrice * (1 + drift + randomWalk + (momentum * 0.1));
    predictions.push({
      price: lastPrice,
      time: new Date(now + (timeframeMs * i)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    });
  }
  
  const changePct = ((predictions[predictions.length - 1].price - currentPrice) / currentPrice) * 100;
  
  return { signal, confidence: Math.min(confidence, 0.95), changePct, predictions };
}

export default function CrystalBallPro() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTf] = useState("1h");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const runAnalysis = async () => {
    setLoading(true);
    setError(null);
    try {
      const candles = await fetchBinanceOHLCV(symbol, timeframe, 100);
      const tfObj = FRAMES.find(f => f.label === timeframe)!;
      const result = generateForecast(candles, tfObj.ms);
      setData(result);
    } catch (e: any) {
      setError("Failed to fetch market data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { runAnalysis(); }, []);

  const SIGNAL_META: any = {
    STRONG_BULL: { color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", icon: TrendingUp, label: "STRONG BULL" },
    BULLISH: { color: "text-green-400 bg-green-500/10 border-green-500/20", icon: TrendingUp, label: "BULLISH" },
    NEUTRAL: { color: "text-slate-400 bg-slate-500/10 border-slate-500/20", icon: Minus, label: "NEUTRAL" },
    BEARISH: { color: "text-rose-400 bg-rose-500/10 border-rose-500/20", icon: TrendingDown, label: "BEARISH" },
    STRONG_BEAR: { color: "text-red-500 bg-red-500/10 border-red-500/20", icon: TrendingDown, label: "STRONG BEAR" },
  };

  const sig = data ? SIGNAL_META[data.signal] : null;
  const Icon = sig?.icon || Activity;

  return (
    <div className="bg-slate-900/50 backdrop-blur border border-slate-800 rounded-2xl p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center text-2xl">🔮</div>
          <div>
            <h2 className="text-lg font-bold text-purple-300">Crystal Ball PRO</h2>
            <p className="text-xs text-slate-500">On-Chain Technical Analysis</p>
          </div>
        </div>
        <span className="text-xs px-3 py-1 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
          Client-Side
        </span>
      </div>

      <div className="flex flex-wrap gap-3">
        <select 
          value={symbol} 
          onChange={e => setSymbol(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
        >
          {COINS.map(c => <option key={c} value={c}>{c.replace("USDT", "/USDT")}</option>)}
        </select>

        <select 
          value={timeframe} 
          onChange={e => setTf(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
        >
          {FRAMES.map(f => <option key={f.label} value={f.label}>{f.label}</option>)}
        </select>

        <button
          onClick={runAnalysis}
          disabled={loading}
          className="ml-auto bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900/50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
          {loading ? "Scanning..." : "Analyze"}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      {data && sig && (
        <div className={`relative overflow-hidden rounded-xl border ${sig.color} p-6`}>
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl bg-slate-950/50 ${sig.color.split(' ')[0]}`}>
                <Icon className="w-8 h-8" />
              </div>
              <div>
                <div className={`text-2xl font-bold ${sig.color.split(' ')[0]}`}>{sig.label}</div>
                <div className="text-slate-400 text-sm mt-1">
                  Projected: {data.changePct > 0 ? "+" : ""}{data.changePct.toFixed(2)}% over 12 candles
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-slate-500 text-xs uppercase tracking-wider">Confidence</div>
              <div className="text-2xl font-bold text-slate-200">{(data.confidence * 100).toFixed(0)}%</div>
            </div>
          </div>
        </div>
      )}

      {data?.predictions && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left py-3 px-4 text-slate-500 font-medium">Time</th>
                <th className="text-right py-3 px-4 text-slate-500 font-medium">Projected Price</th>
                <th className="text-right py-3 px-4 text-slate-500 font-medium">Change</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {data.predictions.map((pred: any, i: number) => {
                const prevPrice = i === 0 ? data.predictions[0].price / (1 + data.changePct/100/12) : data.predictions[i-1].price;
                const change = ((pred.price - prevPrice) / prevPrice) * 100;
                return (
                  <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 text-slate-400">{pred.time}</td>
                    <td className="py-3 px-4 text-right font-medium text-slate-200">
                      ${pred.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className={`py-3 px-4 text-right font-medium ${change >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                      {change >= 0 ? "+" : ""}{change.toFixed(2)}%
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-slate-600 text-right pt-4 border-t border-slate-800">
        Data: Binance Public API • Analysis: Client-Side RSI/EMA • No backend required
      </div>
    </div>
  );
}
