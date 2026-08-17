import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tradingApi, REFRESH, errText } from "@/lib/trading-api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { SymbolQuickSelect } from "@/components/trading/SymbolQuickSelect";

function fmt(n?: number, d = 2) { return n == null || isNaN(n) ? "—" : n.toFixed(d); }

function alignClass(a: string) {
  if (a.includes("BULLISH")) return "bg-emerald-600 text-white";
  if (a.includes("BEARISH")) return "bg-red-600 text-white";
  return "bg-amber-500 text-white";
}

export default function Timeframes() {
  const [symbol, setSymbol] = useState("BTC-USD");
  const [input, setInput] = useState("BTC-USD");

  const q = useQuery({
    queryKey: ["mtf", symbol],
    queryFn: () => tradingApi.multiTimeframe(symbol),
    staleTime: REFRESH.multiTimeframe,
    refetchInterval: REFRESH.multiTimeframe,
  });

  const selectSymbol = (s: string) => { setSymbol(s); setInput(s); };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <Card className="p-4 flex flex-col gap-2">
        <div className="flex items-center gap-2">
        <Input className="w-48" value={input} onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && setSymbol(input.trim())} />
        <Button onClick={() => setSymbol(input.trim())}>Analyze</Button>
        {q.data && <span className="text-xs text-muted-foreground ml-auto">Updated {new Date(q.data.timestamp).toLocaleTimeString()}</span>}
        </div>
        <SymbolQuickSelect value={symbol} onSelect={selectSymbol} />
      </Card>

      {q.isError && (
        <Card className="p-4 border-destructive/40 bg-destructive/10 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 inline mr-2" />{errText(q.error)}
        </Card>
      )}

      {q.data && (
        <div className={`p-4 rounded text-center font-bold text-lg ${alignClass(q.data.alignment)}`}>
          {q.data.alignment}
        </div>
      )}

      {q.isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      ) : q.data ? (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          {q.data.timeframes.map((tf) => (
            <Card key={tf.timeframe} className="p-4">
              <div className="text-xs text-muted-foreground uppercase">{tf.timeframe}</div>
              {tf.error ? (
                <div className="text-xs text-destructive mt-2">{tf.error}</div>
              ) : (
                <>
                  <div className={`mt-1 text-sm font-bold ${tf.trend === "UPTREND" ? "text-emerald-500" : "text-destructive"}`}>
                    {tf.trend}
                  </div>
                  <div className="mt-2 text-xs space-y-1">
                    <div>Price: <span className="font-mono">{fmt(tf.price)}</span></div>
                    <div>RSI: <span className="font-mono">{fmt(tf.rsi, 1)}</span></div>
                    <div>MACD H: <span className={`font-mono ${(tf.macdHist ?? 0) >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(tf.macdHist, 4)}</span></div>
                    <div>Signal: <span className="font-semibold">{tf.signal}</span></div>
                    <div>Support: <span className="font-mono">{fmt(tf.support)}</span></div>
                    <div>Resistance: <span className="font-mono">{fmt(tf.resistance)}</span></div>
                  </div>
                </>
              )}
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}
