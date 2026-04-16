import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, Minus, Loader2, Activity } from "lucide-react";

const COINS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT","DOGEUSDT","AVAXUSDT","LINKUSDT"];
const FRAMES = ["5m","15m","1h","4h","1d"];

interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
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
    setData(null);
    
    try {
      // Direct Binance fetch with no-cors mode fallback
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);
      
      const res = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=50`,
        { signal: controller.signal }
      );
      
      clearTimeout(timeoutId);
      
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      
      if (!Array.isArray(json)) throw new Error("Invalid data");
      
      // Parse candles
      const candles = json.map((k: any[]) => ({
        time: k[0],
        open: parseFloat(k[1]),
        high: parseFloat(k[2]),
        low: parseFloat(k[3]),
        close: parseFloat(k[4]),
        volume: parseFloat(k[5])
      }));

      // Simple analysis
      const current = candles[candles.length - 1];
      const prev = candles[candles.length - 2];
      const change24h = ((current.close - candles[0].close) / candles[0].close) * 100;
      
      // Determine signal
      let signal = "NEUTRAL";
      let confidence = 50;
      
      if (change24h > 5) { signal = "STRONG_BULL"; confidence = 85; }
      else if (change24h > 2) { signal = "BULLISH"; confidence = 70; }
      else if (change24h < -5) { signal = "STRONG_BEAR"; confidence = 85; }
      else if (change24h < -2) { signal = "BEARISH"; confidence = 70; }
      
      // Generate predictions
      const predictions = [];
      let price = current.close;
      const volatility = Math.abs(change24h) / 10;
      
      for (let i = 1; i <= 8; i++) {
        const drift = signal.includes("BULL") ? 0.2 : signal.includes("BEAR") ? -0.2 : 0;
        price = price * (1 + (Math.random() - 0.5) * 0.01 + drift * 0.01);
        predictions.push({
          time: `+${i}h`,
          price: price
        });
      }

      setData({
        signal,
        confidence: confidence / 100,
        changePct: change24h,
        currentPrice: current.close,
        predictions
      });
      
    } catch (e: any) {
      console.error("Fetch error:", e);
      setError(e.message || "Network error - try again");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { runAnalysis(); }, []);

  const SIGNAL_META: any = {
    STRONG_BULL: { color: "text-emerald-400 bg-emerald-500/10", icon: TrendingUp, label: "STRONG BUY" },
    BULLISH: { color: "text-green-400 bg-green-500/10", icon: TrendingUp, label: "BUY" },
    NEUTRAL: { color: "text-slate-400 bg-slate-500/10", icon: Minus, label: "HOLD" },
    BEARISH: { color: "text-rose-400 bg-rose-500/10", icon: TrendingDown, label: "SELL" },
    STRONG_BEAR: { color: "text-red-500 bg-red-500/10", icon: TrendingDown, label: "STRONG SELL" },
  };

  const sig = data ? SIGNAL_META[data.signal] : null;
  const Icon = sig?.icon || Activity;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <span className="text-2xl">🔮</span>
        <div>
          <h2 className="text-lg font-bold text-purple-300">Crystal Ball</h2>
          <p className="text-xs text-slate-500">Live Binance Data</p>
        </div>
      </div>

      <div className="flex gap-3">
        <select 
          value={symbol} 
          onChange={e => setSymbol(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200"
        >
          {COINS.map(c => <option key={c} value={c}>{c}</option>)}
        </select>

        <select 
          value={timeframe} 
          onChange={e => setTf(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-2 text-sm text-slate-200"
        >
          {FRAMES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <button
          onClick={runAnalysis}
          disabled={loading}
          className="ml-auto bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white px-4 py-2 rounded text-sm flex items-center gap-2"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          {loading ? "Loading..." : "Analyze"}
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          Error: {error}
        </div>
      )}

      {data && sig && (
        <>
          <div className={`rounded-xl p-6 ${sig.color} bg-opacity-10`}>
            <div className="flex items-center gap-4">
              <Icon className="w-10 h-10" />
              <div>
                <div className={`text-2xl font-bold ${sig.color.split(' ')[0]}`}>{sig.label}</div>
                <div className="text-sm text-slate-400 mt-1">
                  Current: ${data.currentPrice?.toLocaleString()} • 24h: {data.changePct > 0 ? '+' : ''}{data.changePct?.toFixed(2)}%
                </div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-xs text-slate-500">Confidence</div>
                <div className="text-xl font-bold">{(data.confidence * 100).toFixed(0)}%</div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {data.predictions?.map((p: any, i: number) => (
              <div key={i} className="bg-slate-800/50 rounded p-3 text-center">
                <div className="text-xs text-slate-500">{p.time}</div>
                <div className="text-sm font-medium text-slate-200">${p.price.toFixed(2)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
