import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tradingApi, REFRESH, errText } from "@/lib/trading-api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle } from "lucide-react";
import { LineChart, Line, ResponsiveContainer } from "recharts";
import { SymbolQuickSelect } from "@/components/trading/SymbolQuickSelect";

function typeClass(t: string) {
  return t === "Bullish" ? "text-emerald-500" : t === "Bearish" ? "text-destructive" : "text-amber-500";
}

export default function Patterns() {
  const [symbol, setSymbol] = useState("BTC-USD");
  const [input, setInput] = useState("BTC-USD");
  const [tf, setTf] = useState("1D");

  const q = useQuery({
    queryKey: ["patterns", symbol, tf],
    queryFn: () => tradingApi.patterns(symbol, tf),
    staleTime: REFRESH.patterns,
    refetchInterval: REFRESH.patterns,
  });

  const selectSymbol = (s: string) => { setSymbol(s); setInput(s); };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <Card className="p-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
        <Input className="w-48" value={input} onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && setSymbol(input.trim())} />
        <div className="flex gap-1">
          {["15m", "1H", "4H", "1D", "1W"].map((t) => (
            <Button key={t} size="sm" variant={tf === t ? "default" : "outline"} onClick={() => setTf(t)}>{t}</Button>
          ))}
        </div>
        <Button onClick={() => setSymbol(input.trim())}>Detect Patterns</Button>
        {q.data && <span className="text-xs text-muted-foreground ml-auto">Updated {new Date(q.data.timestamp).toLocaleTimeString()}</span>}
        </div>
        <SymbolQuickSelect value={symbol} onSelect={selectSymbol} />
      </Card>

      {q.isError && (
        <Card className="p-4 border-destructive/40 bg-destructive/10 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 inline mr-2" />{errText(q.error)}
        </Card>
      )}

      {q.isLoading && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-40" />)}
        </div>
      )}

      {q.data && q.data.patterns.length === 0 && (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No significant patterns detected in current period.
        </Card>
      )}

      {q.data && q.data.patterns.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {q.data.patterns.map((p, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-semibold">{p.name}</div>
                  <div className={`text-xs ${typeClass(p.type)}`}>{p.type} · {p.confidence}%</div>
                </div>
                <div className="text-[10px] text-muted-foreground text-right">
                  {new Date(p.time).toLocaleString()}
                </div>
              </div>
              <div className="h-20 mt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={p.miniChart.map((c, idx) => ({ idx, c: c.c }))}>
                    <Line dataKey="c" stroke={p.type === "Bullish" ? "hsl(142 76% 45%)" : p.type === "Bearish" ? "hsl(0 84% 60%)" : "hsl(38 92% 50%)"} strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
