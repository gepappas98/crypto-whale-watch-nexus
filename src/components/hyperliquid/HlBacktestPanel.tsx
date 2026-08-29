import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  ReferenceLine,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { AlertCircle, Activity } from "lucide-react";
import {
  runHlSmaBacktest,
  type HlBacktestConfig,
  type HlBacktestResult,
} from "@/lib/nexus/hlBacktest";

const INTERVALS: HlBacktestConfig["interval"][] = ["15m", "1h", "4h", "1d"];
const COINS = ["BTC", "ETH", "SOL", "HYPE", "ARB", "LINK"];

export function HlBacktestPanel() {
  const [coin, setCoin] = useState("BTC");
  const [interval, setInterval] = useState<HlBacktestConfig["interval"]>("1h");
  const [lookbackBars, setLookbackBars] = useState(500);
  const [fastSma, setFastSma] = useState(10);
  const [slowSma, setSlowSma] = useState(30);

  const run = useMutation<HlBacktestResult>({
    mutationFn: () =>
      runHlSmaBacktest({
        coin,
        interval,
        lookbackBars: Math.max(50, Math.min(2000, lookbackBars)),
        fastSma: Math.max(2, fastSma),
        slowSma: Math.max(fastSma + 1, slowSma),
      }),
  });

  const r = run.data;
  const equityData =
    r?.equity.map((e) => ({
      t: e.t,
      equity: Number((e.equity * 100).toFixed(2)),
      label: new Date(e.t).toLocaleDateString(),
    })) ?? [];

  return (
    <div className="space-y-4">
      <Card className="p-4 border-primary/20">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="w-4 h-4 text-primary" />
          <div>
            <h2 className="text-sm font-semibold tracking-wide">Hyperliquid visual backtest</h2>
            <p className="text-[10px] text-muted-foreground">
              Live HL candles · SMA cross long/flat · research only (no fees/funding)
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="text-xs text-muted-foreground">Coin</label>
            <Select value={coin} onValueChange={setCoin}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COINS.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              className="mt-1 h-7 text-xs"
              value={coin}
              onChange={(e) => setCoin(e.target.value.toUpperCase())}
              placeholder="Custom coin"
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Interval</label>
            <Select
              value={interval}
              onValueChange={(v) => setInterval(v as HlBacktestConfig["interval"])}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVALS.map((i) => (
                  <SelectItem key={i} value={i}>
                    {i}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Bars</label>
            <Input
              type="number"
              value={lookbackBars}
              onChange={(e) => setLookbackBars(+e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Fast SMA</label>
            <Input type="number" value={fastSma} onChange={(e) => setFastSma(+e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Slow SMA</label>
            <Input type="number" value={slowSma} onChange={(e) => setSlowSma(+e.target.value)} />
          </div>
          <Button onClick={() => run.mutate()} disabled={run.isPending}>
            {run.isPending ? "Running…" : "Run HL Backtest"}
          </Button>
        </div>
      </Card>

      {run.isError && (
        <Card className="p-4 border-destructive/40 bg-destructive/10 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 inline mr-2" />
          {run.error instanceof Error ? run.error.message : "Backtest failed"}
        </Card>
      )}

      {run.isPending && <Skeleton className="h-64 w-full" />}

      {r && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            <Metric label="Return" value={`${r.totalReturnPct.toFixed(2)}%`} good={r.totalReturnPct >= 0} />
            <Metric label="Max DD" value={`${r.maxDrawdownPct.toFixed(2)}%`} good={r.maxDrawdownPct < 15} />
            <Metric label="Win rate" value={`${(r.winRate * 100).toFixed(1)}%`} />
            <Metric label="Trades" value={String(r.trades.length)} />
            <Metric label="Bars" value={String(r.meta.barCount)} />
          </div>

          <Card className="p-4">
            <div className="text-xs text-muted-foreground mb-2">
              Equity curve · {r.meta.rule} · {r.meta.note}
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityData}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={40} />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 10 }} width={48} />
                  <Tooltip
                    contentStyle={{ fontSize: 11 }}
                    formatter={(v: number) => [`${v.toFixed(2)}%`, "Equity"]}
                  />
                  <ReferenceLine y={100} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                  <Line
                    type="monotone"
                    dataKey="equity"
                    stroke="hsl(var(--primary))"
                    dot={false}
                    strokeWidth={1.5}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          {r.trades.length > 0 && (
            <Card className="p-4 overflow-x-auto">
              <div className="text-xs font-medium mb-2">Trades (last 30)</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entry</TableHead>
                    <TableHead>Exit</TableHead>
                    <TableHead>Entry px</TableHead>
                    <TableHead>Exit px</TableHead>
                    <TableHead>PnL %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.trades.slice(-30).reverse().map((t, i) => (
                    <TableRow key={`${t.entryTs}-${i}`}>
                      <TableCell className="text-xs">{new Date(t.entryTs).toLocaleString()}</TableCell>
                      <TableCell className="text-xs">{new Date(t.exitTs).toLocaleString()}</TableCell>
                      <TableCell className="font-mono text-xs">{t.entry.toFixed(4)}</TableCell>
                      <TableCell className="font-mono text-xs">{t.exit.toFixed(4)}</TableCell>
                      <TableCell
                        className={`font-mono text-xs ${
                          t.pnlPct >= 0 ? "text-emerald-400" : "text-red-400"
                        }`}
                      >
                        {t.pnlPct >= 0 ? "+" : ""}
                        {t.pnlPct.toFixed(2)}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  good,
}: {
  label: string;
  value: string;
  good?: boolean;
}) {
  return (
    <Card className="p-3">
      <div className="text-[9px] text-muted-foreground tracking-wider">{label}</div>
      <div
        className={`font-mono text-lg ${
          good === true ? "text-emerald-400" : good === false ? "text-red-400" : ""
        }`}
      >
        {value}
      </div>
    </Card>
  );
}
