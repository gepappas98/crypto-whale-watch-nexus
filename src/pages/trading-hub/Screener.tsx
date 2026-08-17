import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tradingApi, REFRESH, errText } from "@/lib/trading-api";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";

const SIGNALS = ["all", "oversold", "overbought", "trending up", "trending down"];

function fmt(n: number, d = 2) { return n == null || isNaN(n) ? "—" : n.toFixed(d); }

export default function Screener() {
  const [signal, setSignal] = useState("all");
  const [minRsi, setMinRsi] = useState(0);
  const [maxRsi, setMaxRsi] = useState(100);
  const [minVol, setMinVol] = useState(0);
  const [auto, setAuto] = useState(false);

  const q = useQuery({
    queryKey: ["screener", signal, minRsi, maxRsi, minVol],
    queryFn: () => tradingApi.screener({ signal, minRsi, maxRsi, minVolume: minVol }),
    staleTime: REFRESH.screener,
    refetchInterval: auto ? REFRESH.screener : false,
  });

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <Card className="p-4">
        <div className="text-sm font-semibold mb-3">Filters · Live Binance USDT pairs</div>
        <div className="flex flex-wrap gap-2 mb-3">
          {SIGNALS.map((s) => (
            <Button key={s} size="sm" variant={signal === s ? "default" : "outline"}
              className="capitalize" onClick={() => setSignal(s)}>
              {s}
            </Button>
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-muted-foreground">Min RSI</label>
            <Input type="number" value={minRsi} onChange={(e) => setMinRsi(+e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Max RSI</label>
            <Input type="number" value={maxRsi} onChange={(e) => setMaxRsi(+e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Min Volume (USDT)</label>
            <Input type="number" value={minVol} onChange={(e) => setMinVol(+e.target.value)} />
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={() => q.refetch()} disabled={q.isFetching}>
              <RefreshCw className={`w-3 h-3 mr-1 ${q.isFetching ? "animate-spin" : ""}`} />Scan
            </Button>
            <label className="flex items-center gap-2 text-xs">
              <Switch checked={auto} onCheckedChange={setAuto} /> 60s
            </label>
          </div>
        </div>
        {q.data && <div className="mt-2 text-xs text-muted-foreground">Updated {new Date(q.data.timestamp).toLocaleTimeString()} · {q.data.items.length} results</div>}
      </Card>

      {q.isError && (
        <Card className="p-4 border-destructive/40 bg-destructive/10 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 inline mr-2" />
          {errText(q.error)}
        </Card>
      )}

      {q.isLoading ? (
        <Skeleton className="h-96" />
      ) : (
        <Card className="p-0 overflow-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Symbol</TableHead><TableHead>Price</TableHead>
                <TableHead>24h %</TableHead><TableHead>RSI</TableHead>
                <TableHead>MACD H</TableHead><TableHead>BB Rating</TableHead>
                <TableHead>Volume</TableHead><TableHead>Signal</TableHead><TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {q.data?.items.map((r) => (
                <TableRow key={r.symbol}
                  className={r.signal === "BUY" ? "bg-emerald-500/5" : r.signal === "SELL" ? "bg-red-500/5" : ""}>
                  <TableCell className="font-mono font-semibold">{r.symbol}</TableCell>
                  <TableCell className="font-mono text-xs">{fmt(r.price, r.price < 1 ? 6 : 2)}</TableCell>
                  <TableCell className={`font-mono text-xs ${r.change24h >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(r.change24h)}%</TableCell>
                  <TableCell className={`font-mono text-xs ${r.rsi < 30 ? "text-emerald-500" : r.rsi > 70 ? "text-destructive" : ""}`}>{fmt(r.rsi, 1)}</TableCell>
                  <TableCell className={`font-mono text-xs ${r.macdHist >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(r.macdHist, 4)}</TableCell>
                  <TableCell className="font-mono text-xs">{r.bollingerRating > 0 ? `+${r.bollingerRating}` : r.bollingerRating}</TableCell>
                  <TableCell className="font-mono text-xs">{(r.volume / 1e6).toFixed(2)}M</TableCell>
                  <TableCell>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      r.signal === "BUY" ? "bg-emerald-500/20 text-emerald-500" :
                      r.signal === "SELL" ? "bg-red-500/20 text-destructive" : "bg-amber-500/20 text-amber-500"
                    }`}>{r.signal}</span>
                  </TableCell>
                  <TableCell>
                    <Link to={`/trading-hub/technical?s=${r.symbol}`} className="text-xs text-primary hover:underline">Analyze</Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
