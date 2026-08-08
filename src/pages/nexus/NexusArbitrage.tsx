import { useState } from "react";
import {
  BarChart3,
  Play,
  RefreshCw,
  AlertCircle,
  AlertTriangle,
  Activity,
  TrendingUp,
  TrendingDown,
  Zap,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { toast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { fetchAllMarkets, type Exchange } from "@/lib/nexus/exchanges";
import {
  scanArbitrage, getOpportunityHistory, MIN_SPREAD_PCT,
  type ArbitrageOpportunity,
} from "@/lib/nexus/arbitrage";
import { isBotConnected, executeArbitrageGuarded, ProtectionBlockedError } from "@/lib/nexus/bot";

/* ═══════════════════════════════════════════════════════════════
   This page used to run its own direct-fetch arbitrage scan
   (Hyperliquid + Coinbase + CryptoCompare) with a synthetic
   Math.random()-jittered chart and a permanently-disabled Execute
   button. It now goes through the same shared pipeline the rest of
   Nexus uses:
     lib/nexus/exchanges.ts  → fetchAllMarkets()   (HL/Backpack/Binance/OKX)
     lib/nexus/arbitrage.ts  → scanArbitrage()      (spread + plausibility filter)
     lib/nexus/bot.ts        → executeArbitrageGuarded() (protections-gated exec)
   Real spread history now comes from arbitrage.ts's own rolling
   buffer (getOpportunityHistory) instead of being faked per render.
   ═══════════════════════════════════════════════════════════════ */

interface ExchangeHealth {
  name: Exchange;
  status: "live" | "dead";
  error?: string;
}

const EXCHANGE_LABELS: Record<Exchange, string> = {
  hyperliquid: "Hyperliquid",
  backpack: "Backpack",
  binance: "Binance",
  okx: "OKX",
};

const CONFIDENCE_STYLE: Record<ArbitrageOpportunity["confidence"], string> = {
  high: "border-green-500/50 text-green-400 bg-green-500/5",
  medium: "border-yellow-500/50 text-yellow-400 bg-yellow-500/5",
  low: "border-gray-500/50 text-gray-400 bg-gray-500/5",
};

/** "long_short" + [exA, exB] → ["LONG hyperliquid", "SHORT backpack"] —
 *  more accurate than the old single LONG/SHORT badge, which didn't say
 *  which leg was which. */
function legLabels(opp: ArbitrageOpportunity): [string, string] {
  const [wordA, wordB] = opp.direction.split("_");
  return [
    `${wordA.toUpperCase()} ${EXCHANGE_LABELS[opp.exchanges[0]]}`,
    `${wordB.toUpperCase()} ${EXCHANGE_LABELS[opp.exchanges[1]]}`,
  ];
}

export default function NexusArbitrage() {
  const [selected, setSelected] = useState<string | null>(null);
  const [notionalUsd, setNotionalUsd] = useState(1000);

  const {
    data,
    isLoading,
    error,
    refetch,
    isRefetching,
  } = useQuery({
    queryKey: ["nexus-arbitrage-shared", notionalUsd],
    queryFn: async (): Promise<{ opportunities: ArbitrageOpportunity[]; health: ExchangeHealth[] }> => {
      const market = await fetchAllMarkets();
      const opportunities = scanArbitrage(market, notionalUsd);
      const health: ExchangeHealth[] = (Object.keys(EXCHANGE_LABELS) as Exchange[]).map((ex) => {
        const err = market.errors[ex];
        return err ? { name: ex, status: "dead", error: err } : { name: ex, status: "live" };
      });
      return { opportunities, health };
    },
    refetchInterval: 5000,
    retry: 2,
    staleTime: 3000,
  });

  const opportunities = data?.opportunities ?? [];
  const exchangeHealth = data?.health ?? [];
  const deadExchanges = exchangeHealth.filter((e) => e.status === "dead");

  const selectedOpp =
    opportunities.find((o) => o.id === selected) ?? opportunities[0];

  const spreadHistory = selectedOpp ? getOpportunityHistory(selectedOpp) : [];
  const chartData = spreadHistory.map((spread, i) => ({ t: i, spread }));

  const execute = async (opp: ArbitrageOpportunity) => {
    if (!isBotConnected()) {
      toast({
        title: "Execution not connected",
        description: "Connect a trading bot via registerBot() to enable real execution.",
        variant: "destructive",
      });
      return;
    }
    try {
      const result = await executeArbitrageGuarded(opp);
      if (result.ok) {
        toast({ title: "Order sent", description: `${opp.pair} — ${result.txHash ?? "submitted"}` });
      } else {
        toast({ title: "Execution failed", description: result.error ?? "Unknown error", variant: "destructive" });
      }
    } catch (e) {
      if (e instanceof ProtectionBlockedError) {
        toast({ title: "Blocked by protections", description: e.gate.reason ?? "Trade gate denied this action", variant: "destructive" });
      } else {
        toast({ title: "Execution error", description: (e as Error).message, variant: "destructive" });
      }
    }
  };

  return (
    <div className="space-y-6 p-4 max-w-7xl mx-auto">
      {/* ── HEADER ── */}
      <header className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-green-500/10 border border-green-500/20">
            <Zap className="w-6 h-6 text-green-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold font-mono tracking-tight">
              ARBITRAGE COMMAND CENTER
            </h1>
            <p className="text-xs text-muted-foreground">
              Hyperliquid ↔ Backpack ↔ Binance ↔ OKX • Shared scan pipeline • Every 5s
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {exchangeHealth.map((ex) => (
            <Badge
              key={ex.name}
              variant="outline"
              className={`font-mono text-xs ${
                ex.status === "live"
                  ? "border-green-500/50 text-green-400 bg-green-500/5"
                  : "border-red-500/50 text-red-400 bg-red-500/5"
              }`}
              title={ex.error || ""}
            >
              <Activity
                className={`w-3 h-3 mr-1 ${
                  ex.status === "live" ? "animate-pulse" : ""
                }`}
              />
              {EXCHANGE_LABELS[ex.name]}
              {ex.status === "dead" ? " DOWN" : ""}
            </Badge>
          ))}

          <Button
            onClick={() => refetch()}
            variant="outline"
            size="sm"
            disabled={isRefetching}
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${isRefetching ? "animate-spin" : ""}`}
            />
            Refresh
          </Button>
        </div>
      </header>

      {/* ── ERROR BANNER ── */}
      {error && (
        <div className="flex items-center gap-3 p-4 border border-red-500/30 bg-red-950/20 rounded-lg text-red-400 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{(error as Error).message} — Retrying automatically</span>
        </div>
      )}

      {!isBotConnected() && (
        <div className="flex items-center gap-3 p-3 border border-yellow-500/20 bg-yellow-950/10 rounded-lg text-yellow-500/90 text-xs">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>No trading bot connected — opportunities are read-only until one is registered via registerBot().</span>
        </div>
      )}

      {/* ── OPPORTUNITIES TABLE ── */}
      <Card className="bg-black/40 border-green-500/20 backdrop-blur">
        <div className="p-4 border-b border-border/50 flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-400" />
            Live Opportunities
          </h2>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {opportunities.length} pairs above {MIN_SPREAD_PCT}%
            </span>
            {isLoading && !isRefetching && (
              <RefreshCw className="w-3 h-3 animate-spin text-muted-foreground" />
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono">
            <thead>
              <tr className="border-b border-gray-800/50 text-muted-foreground text-xs uppercase tracking-wider">
                <th className="text-left p-4">Pair</th>
                <th className="text-left p-4">Route</th>
                <th className="text-right p-4">Spread</th>
                <th className="text-right p-4">Baseline</th>
                <th className="text-center p-4">Direction</th>
                <th className="text-right p-4">Est. P/L</th>
                <th className="text-right p-4">Conf.</th>
                <th className="text-center p-4">Action</th>
              </tr>
            </thead>
            <tbody>
              {opportunities.length > 0 ? (
                opportunities.map((opp) => {
                  const [longLabel, shortLabel] = legLabels(opp);
                  return (
                    <tr
                      key={opp.id}
                      onClick={() => setSelected(opp.id)}
                      className={`border-b border-gray-800/30 hover:bg-green-950/20 cursor-pointer transition-all ${
                        selected === opp.id || (!selected && opp === opportunities[0]) ? "bg-green-950/30" : ""
                      }`}
                    >
                      <td className="p-4 font-bold text-white">
                        {opp.pair}
                        {!opp.plausible && (
                          <AlertTriangle
                            className="inline w-3 h-3 ml-1.5 text-yellow-500 align-text-top"
                            aria-label={opp.plausibilityNote}
                          />
                        )}
                      </td>
                      <td className="p-4 text-gray-400 text-xs" title={opp.plausibilityNote}>
                        {EXCHANGE_LABELS[opp.exchanges[0]]} ↔ {EXCHANGE_LABELS[opp.exchanges[1]]}
                      </td>
                      <td className="p-4 text-right">
                        <span className="text-green-400 font-bold">
                          +{opp.spreadPercent}%
                        </span>
                      </td>
                      <td className="p-4 text-right text-gray-300">
                        {opp.historicalBaseline.toFixed(4)}%
                        <span className="text-[10px] text-muted-foreground ml-1">({opp.baselineSamples} smp)</span>
                      </td>
                      <td className="p-4 text-center">
                        <Badge className="text-[10px] bg-green-600/80 hover:bg-green-600">
                          {longLabel.includes("LONG") ? <TrendingUp className="w-3 h-3 mr-1 inline" /> : null}
                          {longLabel}
                        </Badge>
                        <Badge className="text-[10px] bg-red-600/80 hover:bg-red-600 mt-1">
                          <TrendingDown className="w-3 h-3 mr-1 inline" />
                          {shortLabel}
                        </Badge>
                      </td>
                      <td className="p-4 text-right font-bold text-emerald-400">
                        +${opp.estimatedProfitUsd}
                      </td>
                      <td className="p-4 text-right">
                        <Badge variant="outline" className={`text-xs ${CONFIDENCE_STYLE[opp.confidence]}`}>
                          {opp.confidence}
                        </Badge>
                      </td>
                      <td className="p-4 text-center">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={(e) => {
                            e.stopPropagation();
                            execute(opp);
                          }}
                          disabled={!isBotConnected() || !opp.plausible}
                          title={!opp.plausible ? opp.plausibilityNote : undefined}
                          className="border-green-500/30 text-green-400 hover:bg-green-500/10"
                        >
                          <Play className="w-3 h-3 mr-1" /> Exec
                        </Button>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="p-12 text-center">
                    {isLoading ? (
                      <div className="flex flex-col items-center gap-3 text-gray-400">
                        <RefreshCw className="w-6 h-6 animate-spin" />
                        <span>Scanning exchanges for arbitrage edges...</span>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-gray-400">
                          No opportunities above {MIN_SPREAD_PCT}% right now.
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {deadExchanges.length > 0
                            ? `${deadExchanges
                                .map((e) => EXCHANGE_LABELS[e.name])
                                .join(", ")} down — spreads may be hidden`
                            : "Markets are tight. Volatility creates edges."}
                        </p>
                      </div>
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* ── CHART ── */}
      {selectedOpp && (
        <Card className="bg-black/40 border-green-500/20 backdrop-blur">
          <div className="p-4 border-b border-border/50 flex items-center justify-between">
            <h3 className="font-semibold flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-green-400" />
              Real Spread History — {selectedOpp.pair}
            </h3>
            <div className="flex gap-4 text-xs font-mono">
              {(Object.entries(selectedOpp.prices) as [Exchange, number][]).map(([ex, price]) => (
                <span key={ex} className="text-gray-400">
                  {EXCHANGE_LABELS[ex]}:{" "}
                  <span className="text-white">
                    ${price.toLocaleString(undefined, {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                </span>
              ))}
            </div>
          </div>
          <div className="h-80 p-4">
            {chartData.length > 1 ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1a1a1a" />
                  <XAxis dataKey="t" stroke="#444" fontSize={12} />
                  <YAxis
                    stroke="#444"
                    fontSize={12}
                    tickFormatter={(v: number) => `${v.toFixed(2)}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#0a0a0a",
                      border: "1px solid #22c55e40",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                    itemStyle={{ color: "#22c55e" }}
                    labelStyle={{ color: "#666" }}
                    formatter={(value: number) => [
                      `${value.toFixed(3)}%`,
                      "Spread",
                    ]}
                  />
                  <Line
                    type="monotone"
                    dataKey="spread"
                    stroke="#22c55e"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: "#22c55e", stroke: "#000" }}
                  />
                  <ReferenceLine
                    y={selectedOpp.spreadPercent}
                    stroke="#eab308"
                    strokeDasharray="4 4"
                    label={{
                      value: "Current",
                      position: "right",
                      fill: "#eab308",
                      fontSize: 11,
                    }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Building history for this pair — check back in a few scans.
              </div>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
