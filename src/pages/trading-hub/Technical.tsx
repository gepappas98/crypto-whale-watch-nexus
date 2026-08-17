import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { tradingApi, REFRESH, errText } from "@/lib/trading-api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { AlertCircle, RefreshCw } from "lucide-react";
import { SymbolQuickSelect } from "@/components/trading/SymbolQuickSelect";
import {
  ResponsiveContainer, BarChart, Bar, RadialBarChart, RadialBar, PolarAngleAxis, Cell,
} from "recharts";

const TFS = ["15m", "1H", "4H", "1D", "1W", "1M"];

function fmt(n: number | undefined | null, d = 2) {
  if (n == null || isNaN(n)) return "—";
  return n.toFixed(d);
}

function sigColor(s: string) {
  if (s.includes("STRONG BUY")) return "bg-emerald-600 text-white";
  if (s.includes("BUY")) return "bg-emerald-500/70 text-white";
  if (s.includes("STRONG SELL")) return "bg-red-600 text-white";
  if (s.includes("SELL")) return "bg-red-500/70 text-white";
  return "bg-amber-500/70 text-white";
}

export default function Technical() {
  // Screener.tsx and TechnicalContextBadge.tsx both already link here with
  // ?s=SYMBOL expecting this page to pick it up — it never did, so every
  // "Analyze" click for a non-BTC symbol silently landed back on BTC-USD.
  const [searchParams, setSearchParams] = useSearchParams();
  const initialSymbol = (searchParams.get("s") || "BTC-USD").toUpperCase();
  const [symbol, setSymbol] = useState(initialSymbol);
  const [input, setInput] = useState(initialSymbol);
  const [tf, setTf] = useState("1D");
  const [auto, setAuto] = useState(true);

  const selectSymbol = (s: string) => {
    setSymbol(s);
    setInput(s);
    setSearchParams({ s });
  };

  const q = useQuery({
    queryKey: ["technical", symbol, tf],
    queryFn: () => tradingApi.technical(symbol, tf),
    staleTime: REFRESH.technical,
    refetchInterval: auto ? REFRESH.technical : false,
  });

  const data = q.data;

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && selectSymbol(input.trim())}
            placeholder="Symbol (e.g. BTC-USD, AAPL)"
            className="w-48"
          />
          <Button onClick={() => selectSymbol(input.trim())}>Analyze</Button>
          <div className="flex gap-1 ml-2">
            {TFS.map((t) => (
              <Button key={t} size="sm" variant={tf === t ? "default" : "outline"} onClick={() => setTf(t)}>
                {t}
              </Button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <label className="flex items-center gap-2">
              <Switch checked={auto} onCheckedChange={setAuto} /> Auto 30s
            </label>
            <Button size="sm" variant="ghost" onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={`w-3 h-3 mr-1 ${q.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>
        <SymbolQuickSelect value={symbol} onSelect={selectSymbol} className="mt-3" />
        {data && (
          <div className="mt-3 text-xs text-muted-foreground">
            {symbol} · {tf} · Price <span className="text-foreground font-semibold">${fmt(data.price)}</span> · Updated {new Date(data.timestamp).toLocaleTimeString()}
          </div>
        )}
      </Card>

      {q.isError && (
        <Card className="p-4 border-destructive/40 bg-destructive/10">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4" /> {errText(q.error)}
          </div>
          <Button size="sm" className="mt-2" onClick={() => q.refetch()}>Retry</Button>
        </Card>
      )}

      {q.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      )}

      {data && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* RSI */}
          <Card className="p-4">
            <div className="text-xs text-muted-foreground uppercase">RSI (14)</div>
            <div className="text-3xl font-bold">{fmt(data.rsi.value, 1)}</div>
            <div className={`inline-block mt-1 px-2 py-0.5 rounded text-xs ${
              data.rsi.signal === "OVERSOLD" ? "bg-emerald-500/20 text-emerald-500" :
              data.rsi.signal === "OVERBOUGHT" ? "bg-red-500/20 text-red-500" :
              "bg-amber-500/20 text-amber-500"
            }`}>{data.rsi.signal}</div>
            <div className="h-24 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <RadialBarChart innerRadius="70%" outerRadius="100%" data={[{ v: data.rsi.value, fill: data.rsi.value < 30 ? "hsl(142 76% 45%)" : data.rsi.value > 70 ? "hsl(0 84% 60%)" : "hsl(38 92% 50%)" }]} startAngle={180} endAngle={0}>
                  <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                  <RadialBar dataKey="v" background />
                </RadialBarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* MACD */}
          <Card className="p-4">
            <div className="text-xs text-muted-foreground uppercase">MACD</div>
            <div className="text-sm mt-1 space-y-0.5">
              <div>Line: <span className="font-mono">{fmt(data.macd.line, 4)}</span></div>
              <div>Signal: <span className="font-mono">{fmt(data.macd.signal, 4)}</span></div>
              <div>Hist: <span className={`font-mono ${data.macd.hist >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(data.macd.hist, 4)}</span></div>
            </div>
            {data.macd.goldenCross && <div className="text-xs text-emerald-500 mt-1">⚡ Golden Cross detected</div>}
            {data.macd.deathCross && <div className="text-xs text-destructive mt-1">⚠ Death Cross detected</div>}
            <div className="h-20 mt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.macd.histSeries.map((v, i) => ({ i, v }))}>
                  <Bar dataKey="v">
                    {data.macd.histSeries.map((v, i) => (
                      <Cell key={i} fill={v >= 0 ? "hsl(142 76% 45%)" : "hsl(0 84% 60%)"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {/* Bollinger */}
          <Card className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Bollinger Bands</div>
            <div className="text-sm mt-1 space-y-0.5">
              <div>Upper: <span className="font-mono">{fmt(data.bollinger.upper)}</span></div>
              <div>Mid: <span className="font-mono">{fmt(data.bollinger.mid)}</span></div>
              <div>Lower: <span className="font-mono">{fmt(data.bollinger.lower)}</span></div>
              <div>%B: <span className="font-mono">{fmt(data.bollinger.pctB, 3)}</span></div>
            </div>
            <div className="mt-2 text-sm">
              Rating: <span className={`font-bold ${data.bollinger.rating > 0 ? "text-emerald-500" : data.bollinger.rating < 0 ? "text-destructive" : ""}`}>
                {data.bollinger.rating > 0 ? `+${data.bollinger.rating}` : data.bollinger.rating}
              </span>
            </div>
            {data.bollinger.squeeze && <div className="text-xs text-amber-500 mt-1">⚡ Bands contracting — volatility expansion likely</div>}
          </Card>

          {/* EMA */}
          <Card className="p-4">
            <div className="text-xs text-muted-foreground uppercase">EMA</div>
            <div className="text-sm mt-1 space-y-0.5">
              <div>EMA 20: <span className="font-mono">{fmt(data.ema.ema20)}</span></div>
              <div>EMA 50: <span className="font-mono">{fmt(data.ema.ema50)}</span></div>
              <div>EMA 200: <span className="font-mono">{fmt(data.ema.ema200)}</span></div>
            </div>
            <div className={`mt-2 text-sm ${data.ema.bullish ? "text-emerald-500" : "text-destructive"}`}>
              EMA20 {data.ema.bullish ? ">" : "<"} EMA50: {data.ema.bullish ? "Bullish" : "Bearish"}
            </div>
            {data.ema.goldenCross && <div className="text-xs text-emerald-500">⚡ Golden Cross</div>}
            {data.ema.deathCross && <div className="text-xs text-destructive">⚠ Death Cross</div>}
          </Card>

          {/* Supertrend */}
          <Card className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Supertrend</div>
            <div className={`text-2xl font-bold mt-1 ${data.supertrend.direction === "UPTREND" ? "text-emerald-500" : "text-destructive"}`}>
              {data.supertrend.direction}
            </div>
            <div className="text-sm mt-2 space-y-0.5">
              <div>ATR: <span className="font-mono">{fmt(data.supertrend.atr, 4)}</span></div>
              <div>Value: <span className="font-mono">{fmt(data.supertrend.value)}</span></div>
            </div>
            <div className={`mt-2 text-xs ${data.supertrend.direction === "UPTREND" ? "text-emerald-500" : "text-destructive"}`}>
              Signal: {data.supertrend.direction === "UPTREND" ? "BUY" : "SELL"}
            </div>
          </Card>

          {/* Overall */}
          <Card className="p-4">
            <div className="text-xs text-muted-foreground uppercase">Overall Signal</div>
            <div className={`mt-2 px-3 py-2 rounded text-center font-bold text-lg ${sigColor(data.overall.signal)}`}>
              {data.overall.signal}
            </div>
            <div className="mt-3 text-sm">Confidence: <span className="font-bold">{data.overall.confidence}%</span></div>
            <div className="text-xs text-muted-foreground mt-1">
              {data.overall.bullVotes}/{data.overall.totalVotes} indicators bullish · {data.overall.bearVotes}/{data.overall.totalVotes} bearish
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              Support: <span className="font-mono">{fmt(data.support)}</span> · Resistance: <span className="font-mono">{fmt(data.resistance)}</span>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
