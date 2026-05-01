import { useState } from "react";
import { ArrowRightLeft, BarChart3, Play } from "lucide-react";
import { useNexusArbitrage } from "@/hooks/useNexusMarkets";
import { getSpreadHistory } from "@/lib/nexus/arbitrage";
import { useNexusBot } from "@/hooks/useNexusBot";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { fmtPrice } from "@/components/nexus/shared";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { toast } from "@/hooks/use-toast";

export default function NexusArbitrage() {
  const { opportunities, isLoading, errors } = useNexusArbitrage(5000);
  const { bot } = useNexusBot();
  const [selected, setSelected] = useState<string | null>(null);
  const [executing, setExecuting] = useState<Set<string>>(new Set());

  const selectedOpp = opportunities.find((o) => o.id === selected) ?? opportunities[0];
  const histKey = selectedOpp
    ? `${selectedOpp.pair.split("-")[0]}-${selectedOpp.exchanges[0] === "hyperliquid" ? "HL" : "BP"}-${
        selectedOpp.exchanges[1] === "binance" ? "BN" : "BP"
      }`
    : "";
  const history = histKey ? getSpreadHistory(histKey) : [];
  const chartData = history.map((spread, i) => ({
    t: i,
    spread: +spread.toFixed(4),
    baseline: selectedOpp?.historicalBaseline ?? 0,
  }));

  const execute = async (oppId: string) => {
    const opp = opportunities.find((o) => o.id === oppId);
    if (!opp) return;
    if (!bot) {
      toast({
        title: "No bot connected",
        description: "Plug in a trading bot via registerBot() to enable execution.",
        variant: "destructive",
      });
      return;
    }
    setExecuting((s) => new Set(s).add(oppId));
    try {
      const res = await bot.executeArbitrage(opp);
      toast({
        title: res.ok ? "Arbitrage submitted" : "Execution failed",
        description: res.ok ? `tx: ${res.txHash ?? "n/a"}` : res.error ?? "Unknown error",
        variant: res.ok ? "default" : "destructive",
      });
    } finally {
      setExecuting((s) => {
        const n = new Set(s);
        n.delete(oppId);
        return n;
      });
    }
  };

  const errMsg = Object.entries(errors)
    .map(([k, v]) => `${k}: ${v}`)
    .join(" · ");

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <BarChart3 className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">Arbitrage Command Center</h1>
          <p className="text-xs text-muted-foreground">
            Live spreads HL ↔ Backpack ↔ Binance · scans every 5s · real prices only
          </p>
        </div>
      </header>

      {errMsg && (
        <div className="text-[11px] text-yellow-500/80 px-3 py-2 rounded border border-yellow-500/30 bg-yellow-500/5">
          {errMsg}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="lg:col-span-2 overflow-hidden">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <h2 className="font-semibold text-sm">Live Opportunities</h2>
            <span className="text-[10px] text-muted-foreground">{opportunities.length} pairs above 0.05% spread</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-muted-foreground border-b border-border">
                  <th className="text-left p-2 font-medium">Pair</th>
                  <th className="text-left p-2 font-medium">Route</th>
                  <th className="text-right p-2 font-medium">Spread</th>
                  <th className="text-right p-2 font-medium">Baseline</th>
                  <th className="text-right p-2 font-medium">Direction</th>
                  <th className="text-right p-2 font-medium">Est. P/L $1k</th>
                  <th className="text-right p-2 font-medium">Conf.</th>
                  <th className="text-right p-2 font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.map((o) => (
                  <tr
                    key={o.id}
                    onClick={() => setSelected(o.id)}
                    className={`border-b border-border/40 hover:bg-secondary/40 cursor-pointer ${
                      selected === o.id ? "bg-primary/5" : ""
                    }`}
                  >
                    <td className="p-2 font-mono font-medium">{o.pair}</td>
                    <td className="p-2 font-mono text-muted-foreground">
                      {o.exchanges[0]} ↔ {o.exchanges[1]}
                    </td>
                    <td className="p-2 text-right font-mono text-primary font-bold">
                      {o.spreadPercent.toFixed(4)}%
                    </td>
                    <td className="p-2 text-right font-mono text-muted-foreground">
                      {o.historicalBaseline.toFixed(4)}%
                    </td>
                    <td className="p-2 text-right font-mono">{o.direction.replace("_", "→")}</td>
                    <td className="p-2 text-right font-mono">${o.estimatedProfitUsd.toFixed(2)}</td>
                    <td className="p-2 text-right">
                      <span
                        className={`text-[10px] uppercase px-1.5 py-0.5 rounded border ${
                          o.confidence === "high"
                            ? "border-primary/40 text-primary"
                            : o.confidence === "medium"
                            ? "border-yellow-500/40 text-yellow-500"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {o.confidence}
                      </span>
                    </td>
                    <td className="p-2 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px]"
                        disabled={executing.has(o.id)}
                        onClick={(e) => {
                          e.stopPropagation();
                          execute(o.id);
                        }}
                      >
                        <Play className="w-3 h-3 mr-1" />
                        {executing.has(o.id) ? "…" : "Execute"}
                      </Button>
                    </td>
                  </tr>
                ))}
                {!isLoading && opportunities.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-6 text-center text-muted-foreground text-xs">
                      No opportunities above 0.05% spread right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card className="overflow-hidden">
          <div className="p-3 border-b border-border">
            <h2 className="font-semibold text-sm flex items-center gap-2">
              <ArrowRightLeft className="w-4 h-4 text-primary" />
              {selectedOpp ? `${selectedOpp.pair} — ${selectedOpp.exchanges.join(" ↔ ")}` : "Select an opportunity"}
            </h2>
          </div>
          <div className="p-3">
            {selectedOpp ? (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs mb-3">
                  {Object.entries(selectedOpp.prices).map(([ex, px]) => (
                    <div key={ex} className="rounded border border-border p-2">
                      <div className="text-[10px] uppercase text-muted-foreground">{ex}</div>
                      <div className="font-mono font-bold">{fmtPrice(px)}</div>
                    </div>
                  ))}
                </div>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                      <XAxis dataKey="t" hide />
                      <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          fontSize: 11,
                        }}
                      />
                      <ReferenceLine y={selectedOpp.historicalBaseline} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Line type="monotone" dataKey="spread" stroke="hsl(var(--primary))" dot={false} strokeWidth={2} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <p className="text-[10px] text-muted-foreground mt-2">
                  Spread history is sampled live (max 100 points). No synthetic data.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">Click any row to view live spread history.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
