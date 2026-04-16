import { useState, useEffect } from "react";
import { useKronos } from "@/hooks/useKronos";
import { Signal } from "@/api/kronosClient";
import { Loader2, TrendingUp, TrendingDown, Minus, Activity } from "lucide-react";

const COINS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT", "AVAXUSDT", "LINKUSDT"];
const FRAMES = ["5m", "15m", "1h", "4h", "1d"] as const;
const LENGTHS = [12, 24, 48, 96] as const;

const SIGNAL_META: Record<Signal, { label: string; color: string; bg: string; icon: any; gradient: string }> = {
  STRONG_BULL: { 
    label: "STRONG BULL", 
    color: "text-emerald-400", 
    bg: "bg-emerald-500/10", 
    icon: TrendingUp,
    gradient: "from-emerald-500/20 to-transparent"
  },
  BULLISH: { 
    label: "BULLISH", 
    color: "text-green-400", 
    bg: "bg-green-500/10", 
    icon: TrendingUp,
    gradient: "from-green-500/20 to-transparent"
  },
  NEUTRAL: { 
    label: "NEUTRAL", 
    color: "text-slate-400", 
    bg: "bg-slate-500/10", 
    icon: Minus,
    gradient: "from-slate-500/20 to-transparent"
  },
  BEARISH: { 
    label: "BEARISH", 
    color: "text-rose-400", 
    bg: "bg-rose-500/10", 
    icon: TrendingDown,
    gradient: "from-rose-500/20 to-transparent"
  },
  STRONG_BEAR: { 
    label: "STRONG BEAR", 
    color: "text-red-500", 
    bg: "bg-red-500/10", 
    icon: TrendingDown,
    gradient: "from-red-500/20 to-transparent"
  },
};

export default function CrystalBallPro() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [timeframe, setTf] = useState<typeof FRAMES[number]>("1h");
  const [predLen, setPredLen] = useState<typeof LENGTHS[number]>(24);
  const [samples] = useState(5);

  const { data, loading, error, lastFetch, run } = useKronos();

  const handleRun = () => run({ symbol, timeframe, pred_len: predLen, sample_count: samples });

  useEffect(() => { handleRun(); }, []);

  const sig = data ? SIGNAL_META[data.signal] : null;
  const Icon = sig?.icon || Activity;

  return (
    <div className="glass-panel rounded-2xl p-6 space-y-6 bg-slate-900/50 border border-slate-800">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center">
            <span className="text-2xl">🔮</span>
          </div>
          <div>
            <h2 className="text-lg font-bold text-purple-300">Crystal Ball PRO</h2>
            <p className="text-xs text-slate-500">Powered by Kronos AI</p>
          </div>
        </div>
        {data && (
          <span className="text-xs px-3 py-1 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
            {data.model}
          </span>
        )}
      </div>

      {/* Controls */}
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
          onChange={e => setTf(e.target.value as typeof FRAMES[number])}
          className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
        >
          {FRAMES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>

        <select 
          value={predLen} 
          onChange={e => setPredLen(Number(e.target.value) as typeof LENGTHS[number])}
          className="bg-slate-800 border border-slate-700 rounded-lg px-4 py-2 text-sm text-slate-200 focus:outline-none focus:ring-2 focus:ring-purple-500/50"
        >
          {LENGTHS.map(l => <option key={l} value={l}>{l} candles</option>)}
        </select>

        <button
          onClick={handleRun}
          disabled={loading}
          className="ml-auto bg-purple-600 hover:bg-purple-500 disabled:bg-purple-900/50 disabled:cursor-not-allowed text-white px-6 py-2 rounded-lg font-medium text-sm flex items-center gap-2 transition-colors"
        >
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Activity className="w-4 h-4" />}
          {loading ? "Running..." : "Forecast"}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
          ⚠️ {error}
        </div>
      )}

      {/* Signal Card */}
      {data && sig && (
        <div className={`relative overflow-hidden rounded-xl border border-slate-700/50 ${sig.bg} p-6`}>
          <div className={`absolute inset-0 bg-gradient-to-r ${sig.gradient} opacity-50`} />
          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className={`p-3 rounded-xl bg-slate-950/50 ${sig.color}`}>
                <Icon className="w-8 h-8" />
              </div>
              <div>
                <div className={`text-2xl font-bold ${sig.color}`}>{sig.label}</div>
                <div className="text-slate-400 text-sm mt-1">
                  {data.price_change_pct > 0 ? "+" : ""}{data.price_change_pct.toFixed(2)}% predicted over {data.forecast.length} candles
                </div>
              </div>
            </div>
            <div className="text-right">
              <div className="text-slate-500 text-xs uppercase tracking-wider">Confidence</div>
              <div className="text-2xl font-bold text-slate-200">{(data.confidence_score * 100).toFixed(0)}%</div>
            </div>
          </div>
        </div>
      )}

      {/* Data Table */}
      {data && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800">
                <th className="text-left py-3 px-4 text-slate-500 font-medium">Time</th>
                <th className="text-right py-3 px-4 text-slate-500 font-medium">Close</th>
                <th className="text-right py-3 px-4 text-slate-500 font-medium">CI Low</th>
                <th className="text-right py-3 px-4 text-slate-500 font-medium">CI High</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {data.forecast.slice(0, 8).map((candle, i) => {
                const isUp = candle.close >= candle.open;
                return (
                  <tr key={i} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-3 px-4 text-slate-400">
                      {new Date(candle.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </td>
                    <td className={`py-3 px-4 text-right font-medium ${isUp ? "text-emerald-400" : "text-rose-400"}`}>
                      {candle.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-500">
                      {candle.ci_low.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-3 px-4 text-right text-slate-500">
                      {candle.ci_high.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.forecast.length > 8 && (
            <div className="text-center py-3 text-slate-600 text-xs">
              + {data.forecast.length - 8} more predictions
            </div>
          )}
        </div>
      )}

      {/* Footer */}
      {lastFetch && (
        <div className="text-xs text-slate-600 text-right pt-4 border-t border-slate-800">
          Last updated {lastFetch.toLocaleTimeString()} • Cache 5min
        </div>
      )}
    </div>
  );
}
