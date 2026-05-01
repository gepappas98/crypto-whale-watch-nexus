import { Activity, Shield, TrendingUp, Waves } from "lucide-react";
import { useNexusMarkets } from "@/hooks/useNexusMarkets";
import { Card } from "@/components/ui/card";
import { StatCard, fmtNum, fmtPrice, NexusEmptyState } from "@/components/nexus/shared";

export default function NexusWhaleWatch() {
  const { data, isLoading } = useNexusMarkets(3000);
  const hl = data?.hyperliquid ?? [];

  const totalOI = hl.reduce((s, d) => s + (d.openInterest || 0) * (d.markPrice || 0), 0);
  const totalVolume = hl.reduce((s, d) => s + (d.dayVolume || 0), 0);
  const avgFunding = hl.length ? hl.reduce((s, d) => s + (d.fundingRate || 0), 0) / hl.length : 0;

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <Waves className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">Whale Watch</h1>
          <p className="text-xs text-muted-foreground">
            Real-time perpetuals from api.hyperliquid.xyz — live data, no simulations
          </p>
        </div>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<Activity className="w-4 h-4" />}
          label="Hyperliquid OI (USD)"
          value={"$" + fmtNum(totalOI)}
          hint={`${hl.length} markets`}
        />
        <StatCard
          icon={<TrendingUp className="w-4 h-4" />}
          label="24h Notional Volume"
          value={"$" + fmtNum(totalVolume)}
          tone="success"
        />
        <StatCard
          icon={<Shield className="w-4 h-4" />}
          label="Avg Funding (8h)"
          value={(avgFunding * 100).toFixed(4) + "%"}
          tone={avgFunding >= 0 ? "success" : "danger"}
        />
        <StatCard
          icon={<Waves className="w-4 h-4" />}
          label="Whale Feed"
          value="—"
          hint="Awaiting bot connection"
          tone="muted"
        />
      </div>

      <Card className="overflow-hidden">
        <div className="p-3 border-b border-border flex items-center justify-between">
          <h2 className="font-semibold text-sm">Hyperliquid Perpetuals</h2>
          <span className="text-[10px] text-muted-foreground">
            {isLoading && hl.length === 0 ? "loading…" : `${hl.length} markets · refreshes every 3s`}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="text-left p-2 font-medium">Asset</th>
                <th className="text-right p-2 font-medium">Mark</th>
                <th className="text-right p-2 font-medium">Oracle</th>
                <th className="text-right p-2 font-medium">Premium</th>
                <th className="text-right p-2 font-medium">Funding</th>
                <th className="text-right p-2 font-medium">OI</th>
                <th className="text-right p-2 font-medium">24h Vol</th>
                <th className="text-right p-2 font-medium">Lev</th>
              </tr>
            </thead>
            <tbody>
              {hl
                .slice()
                .sort((a, b) => (b.dayVolume || 0) - (a.dayVolume || 0))
                .slice(0, 25)
                .map((a) => (
                  <tr key={a.symbol} className="border-b border-border/40 hover:bg-secondary/40">
                    <td className="p-2 font-mono font-medium">{a.symbol}</td>
                    <td className="p-2 text-right font-mono">{fmtPrice(a.markPrice)}</td>
                    <td className="p-2 text-right font-mono text-muted-foreground">{fmtPrice(a.oraclePrice)}</td>
                    <td className={`p-2 text-right font-mono ${a.premium >= 0 ? "text-primary" : "text-destructive"}`}>
                      {(a.premium * 100).toFixed(4)}%
                    </td>
                    <td className={`p-2 text-right font-mono ${a.fundingRate >= 0 ? "text-primary" : "text-destructive"}`}>
                      {(a.fundingRate * 100).toFixed(4)}%
                    </td>
                    <td className="p-2 text-right font-mono">{fmtNum(a.openInterest)}</td>
                    <td className="p-2 text-right font-mono">{fmtNum(a.dayVolume)}</td>
                    <td className="p-2 text-right font-mono">{a.maxLeverage}x</td>
                  </tr>
                ))}
              {!isLoading && hl.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-6 text-center text-muted-foreground text-xs">
                    No data — check connectivity to api.hyperliquid.xyz
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <NexusEmptyState
        icon={<Waves className="w-8 h-8" />}
        title="Blockchain Whale Feed"
        message="Connect a trading bot to stream blockchain whale transactions ($500K+ moves). Until then no data is shown — we never display simulated whale events."
      />
    </div>
  );
}
