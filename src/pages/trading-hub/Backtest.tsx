import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { tradingApi, errText } from "@/lib/trading-api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Table, TableHeader, TableBody, TableRow, TableHead, TableCell,
} from "@/components/ui/table";
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import { AlertCircle } from "lucide-react";
import type { BacktestResult } from "@/types/trading";
import { SymbolQuickSelect } from "@/components/trading/SymbolQuickSelect";
import { HlBacktestPanel } from "@/components/trading/HlBacktestPanel";

const STRATS = [
  { v: "rsi", l: "RSI" }, { v: "bollinger", l: "Bollinger" }, { v: "macd", l: "MACD" },
  { v: "ema_cross", l: "EMA Cross" }, { v: "supertrend", l: "Supertrend" }, { v: "donchian", l: "Donchian" },
];
const PERIODS = ["3mo", "6mo", "1y", "2y", "5y"];

function fmt(n: number, d = 2) { return isNaN(n) ? "—" : n.toFixed(d); }
function fmtMoney(n: number) { return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`; }
function fmtDate(t: number) { return new Date(t).toLocaleDateString(); }

export default function Backtest() {
  const [symbol, setSymbol] = useState("BTC-USD");
  const [strategy, setStrategy] = useState("rsi");
  const [period, setPeriod] = useState("1y");
  const [capital, setCapital] = useState(10000);
  const [commission, setCommission] = useState(0.1);

  const run = useMutation<BacktestResult>({
    mutationFn: () => tradingApi.backtest({ symbol, strategy, period, capital, commission }),
  });

  const compare = useMutation({
    mutationFn: () => tradingApi.compareStrategies(symbol, period, capital, commission),
  });

  const r = run.data;

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <Card className="p-4">
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3 items-end">
          <div>
            <label className="text-xs text-muted-foreground">Symbol</label>
            <Input value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Strategy</label>
            <Select value={strategy} onValueChange={setStrategy}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{STRATS.map(s => <SelectItem key={s.v} value={s.v}>{s.l}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Period</label>
            <Select value={period} onValueChange={setPeriod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PERIODS.map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Capital</label>
            <Input type="number" value={capital} onChange={(e) => setCapital(+e.target.value)} />
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Commission %</label>
            <Input type="number" step="0.01" value={commission} onChange={(e) => setCommission(+e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={() => run.mutate()} disabled={run.isPending}>
              {run.isPending ? "Running…" : "Run Backtest"}
            </Button>
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => compare.mutate()} disabled={compare.isPending}>
            {compare.isPending ? "Comparing…" : "Compare All Strategies"}
          </Button>
        </div>
        <SymbolQuickSelect value={symbol} onSelect={setSymbol} className="mt-3" />
      </Card>

      {(run.isError || compare.isError) && (
        <Card className="p-4 border-destructive/40 bg-destructive/10 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 inline mr-2" />
          {errText(run.error ?? compare.error)}
        </Card>
      )}

      {run.isPending && (
        <div className="space-y-3">
          <Skeleton className="h-64" />
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
          </div>
        </div>
      )}

      {r && (
        <>
          <Card className="p-4">
            <div className="text-sm font-semibold mb-2">Equity Curve</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={r.equity}>
                  <XAxis dataKey="t" tickFormatter={(t) => new Date(t).toLocaleDateString()} fontSize={10} />
                  <YAxis fontSize={10} />
                  <Tooltip labelFormatter={(t) => new Date(t as number).toLocaleString()} formatter={(v: number) => fmtMoney(v)} />
                  <Line dataKey="v" stroke="hsl(142 76% 45%)" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {[
              ["Total Return", `${fmt(r.totalReturn)}%`, r.totalReturn >= 0],
              ["Win Rate", `${fmt(r.winRate)}%`],
              ["Sharpe", fmt(r.sharpe)],
              ["Calmar", fmt(r.calmar)],
              ["Max DD", `${fmt(r.maxDrawdown)}%`, false],
              ["Profit Factor", fmt(r.profitFactor)],
              ["Expectancy", fmtMoney(r.expectancy)],
              ["Best Trade", fmtMoney(r.bestTrade), true],
              ["Worst Trade", fmtMoney(r.worstTrade), false],
              ["vs Buy & Hold", `${fmt(r.outperformance)}%`, r.outperformance >= 0],
            ].map(([l, v, pos], i) => (
              <Card key={i} className="p-3">
                <div className="text-[10px] uppercase text-muted-foreground">{l}</div>
                <div className={`text-base font-bold ${pos === true ? "text-emerald-500" : pos === false ? "text-destructive" : ""}`}>{v as string}</div>
              </Card>
            ))}
          </div>

          <Card className="p-4">
            <div className="text-sm font-semibold mb-2">Trade Log ({r.trades.length})</div>
            <div className="max-h-96 overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entry</TableHead><TableHead>Exit</TableHead>
                    <TableHead>Entry $</TableHead><TableHead>Exit $</TableHead>
                    <TableHead>P&L</TableHead><TableHead>Return %</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {r.trades.slice(0, 100).map((t, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-xs">{fmtDate(t.entryDate)}</TableCell>
                      <TableCell className="text-xs">{fmtDate(t.exitDate)}</TableCell>
                      <TableCell className="font-mono text-xs">{fmt(t.entry)}</TableCell>
                      <TableCell className="font-mono text-xs">{fmt(t.exit)}</TableCell>
                      <TableCell className={`font-mono text-xs ${t.pnl >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmtMoney(t.pnl)}</TableCell>
                      <TableCell className={`font-mono text-xs ${t.ret >= 0 ? "text-emerald-500" : "text-destructive"}`}>{fmt(t.ret)}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
        </>
      )}

      <div className="border-t border-border pt-6 mt-2">
        <HlBacktestPanel />
      </div>

      {compare.data && (
        <Card className="p-4">
          <div className="text-sm font-semibold mb-2">Strategy Comparison · {compare.data.symbol} · {compare.data.period}</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rank</TableHead><TableHead>Strategy</TableHead>
                <TableHead>Total Return</TableHead><TableHead>Sharpe</TableHead>
                <TableHead>Win Rate</TableHead><TableHead>Max DD</TableHead><TableHead>Trades</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {compare.data.results.map((row, i) => (
                <TableRow key={row.strategy} className={i === 0 ? "bg-emerald-500/10" : ""}>
                  <TableCell className="font-bold">#{i + 1}</TableCell>
                  <TableCell className="capitalize">{row.strategy.replace("_", " ")}</TableCell>
                  <TableCell className={row.totalReturn >= 0 ? "text-emerald-500" : "text-destructive"}>{fmt(row.totalReturn)}%</TableCell>
                  <TableCell>{fmt(row.sharpe)}</TableCell>
                  <TableCell>{fmt(row.winRate)}%</TableCell>
                  <TableCell className="text-destructive">{fmt(row.maxDrawdown)}%</TableCell>
                  <TableCell>{row.tradeCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
