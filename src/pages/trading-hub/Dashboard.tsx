import { useQuery } from "@tanstack/react-query";
import { tradingApi, REFRESH, errText } from "@/lib/trading-api";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw, TrendingUp, TrendingDown } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { Link } from "react-router-dom";

function fmt(n: number | undefined, d = 2) {
  if (n == null || isNaN(n)) return "—";
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return n.toFixed(d);
}

export default function TradingDashboard() {
  const snap = useQuery({
    queryKey: ["market-snapshot"],
    queryFn: tradingApi.marketSnapshot,
    staleTime: REFRESH.market,
    refetchInterval: REFRESH.market,
  });

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold">Trading Intelligence Hub</h1>
        <p className="text-sm text-muted-foreground">
          Live technical analysis, backtesting, sentiment, and screening — real data only.
        </p>
      </div>

      {/* Market Snapshot Ticker */}
      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Live Market Snapshot</h2>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {snap.isError && <span className="text-destructive flex items-center gap-1"><AlertCircle className="w-3 h-3" /> {errText(snap.error)}</span>}
            {snap.data && <span>Updated {new Date(snap.data.timestamp).toLocaleTimeString()}</span>}
            <Button size="sm" variant="ghost" onClick={() => snap.refetch()} disabled={snap.isFetching}>
              <RefreshCw className={`w-3 h-3 ${snap.isFetching ? "animate-spin" : ""}`} />
            </Button>
          </div>
        </div>
        {snap.isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
            {snap.data?.items.map((it) => {
              const up = (it.changePct ?? 0) >= 0;
              return (
                <div key={it.symbol} className="border border-border rounded p-2 bg-card/50">
                  <div className="text-[10px] text-muted-foreground uppercase">{it.label}</div>
                  {it.error ? (
                    <div className="text-[10px] text-destructive mt-1">err</div>
                  ) : (
                    <>
                      <div className="text-sm font-semibold">{fmt(it.price, it.symbol.includes("USD") || it.label === "VIX" ? 2 : 4)}</div>
                      <div className={`text-xs flex items-center gap-1 ${up ? "text-emerald-500" : "text-destructive"}`}>
                        {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {fmt(it.changePct, 2)}%
                      </div>
                      {it.spark && it.spark.length > 1 && (
                        <div className="h-6 mt-1">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={it.spark.map((c, i) => ({ i, c }))}>
                              <Line dataKey="c" stroke={up ? "hsl(142 76% 45%)" : "hsl(0 84% 60%)"} strokeWidth={1.5} dot={false} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Quick links */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { to: "/trading-hub/technical", t: "Technical Analysis", d: "RSI · MACD · Bollinger · EMA · Supertrend" },
          { to: "/trading-hub/backtest", t: "Backtest Engine", d: "6 strategies on real OHLC history" },
          { to: "/trading-hub/screener", t: "Market Screener", d: "Live Binance USDT pairs" },
          { to: "/trading-hub/sentiment", t: "Sentiment & News", d: "Reddit + RSS — real posts only" },
          { to: "/trading-hub/timeframes", t: "Multi-Timeframe", d: "1W → 15m alignment" },
          { to: "/trading-hub/patterns", t: "Candlestick Patterns", d: "Live pattern detection" },
        ].map((c) => (
          <Link key={c.to} to={c.to} className="block border border-border rounded p-4 hover:border-primary transition bg-card/50">
            <div className="font-semibold text-sm">{c.t}</div>
            <div className="text-xs text-muted-foreground mt-1">{c.d}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
