import { useState, useEffect } from "react";
import { TrendingUp, TrendingDown, Minus, Loader2 } from "lucide-react";

const COINS = ["BTCUSDT","ETHUSDT","SOLUSDT","BNBUSDT","XRPUSDT"];
const TIMEFRAMES = ["5m","15m","1h","4h","1d"];

export default function WRCrystalBallPro() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTimeframe] = useState("1h");
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const analyze = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${timeframe}&limit=50`);
      if (!res.ok) throw new Error("Binance API error");
      const json = await res.json();
      
      const prices = json.map((k: any[]) => parseFloat(k[4]));
      const current = prices[prices.length - 1];
      const start = prices[0];
      const change = ((current - start) / start) * 100;
      
      let signal = "NEUTRAL";
      let confidence = 50;
      if (change > 3) { signal = "STRONG_BULL"; confidence = 85; }
      else if (change > 1) { signal = "BULLISH"; confidence = 70; }
      else if (change < -3) { signal = "STRONG_BEAR"; confidence = 85; }
      else if (change < -1) { signal = "BEARISH"; confidence = 70; }
      
      setData({ signal, confidence, change, currentPrice: current });
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { analyze(); }, []);

  const signals: any = {
    STRONG_BULL: { color: "text-emerald-400 bg-emerald-500/10", icon: TrendingUp, label: "STRONG BUY" },
    BULLISH: { color: "text-green-400 bg-green-500/10", icon: TrendingUp, label: "BUY" },
    NEUTRAL: { color: "text-slate-400 bg-slate-500/10", icon: Minus, label: "HOLD" },
    BEARISH: { color: "text-rose-400 bg-rose-500/10", icon: TrendingDown, label: "SELL" },
    STRONG_BEAR: { color: "text-red-500 bg-red-500/10", icon: TrendingDown, label: "STRONG SELL" },
  };

  const meta = data ? signals[data.signal] : null;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-purple-300">🔮 Crystal Ball</h3>
        <div className="flex gap-2">
          <select value={symbol} onChange={e => setSymbol(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs">
            {COINS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          <select value={timeframe} onChange={e => setTimeframe(e.target.value)} className="bg-slate-800 border border-slate-700 rounded px-2 py-1 text-xs">
            {TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={analyze} disabled={loading} className="bg-purple-600 text-white px-3 py-1 rounded text-xs flex items-center gap-1">
            {loading && <Loader2 className="w-3 h-3 animate-spin" />}
            Scan
          </button>
        </div>
      </div>
      
      {error && <div className="text-red-400 text-xs mb-4">{error}</div>}
      
      {data && meta && (
        <div className={`flex items-center gap-4 p-4 rounded-lg ${meta.color}`}>
          <meta.icon className="w-8 h-8" />
          <div>
            <div className="font-bold text-lg">{meta.label}</div>
            <div className="text-xs opacity-80">${data.currentPrice?.toFixed(2)} | {data.change > 0 ? '+' : ''}{data.change?.toFixed(2)}%</div>
          </div>
          <div className="ml-auto text-right">
            <div className="text-xs opacity-60">Confidence</div>
            <div className="font-bold">{data.confidence}%</div>
          </div>
        </div>
      )}
    </div>
  );
}
