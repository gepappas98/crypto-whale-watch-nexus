import { useEffect, useState } from "react";
import { Wallet, Plug, TrendingUp } from "lucide-react";
import { useNexusBot } from "@/hooks/useNexusBot";
import { Card } from "@/components/ui/card";
import { NexusEmptyState, StatCard, fmtNum } from "@/components/nexus/shared";
import { ProtectionBanner } from "@/components/nexus/ProtectionBanner";
import { NexusBotStatusBar } from "@/components/nexus/NexusBotStatusBar";
import { ProtectionOptimizerPanel } from "@/components/nexus/ProtectionOptimizerPanel";
import { ProtectionConfigPanel } from "@/components/nexus/ProtectionConfigPanel";
import { ExecutionSafetyPanel } from "@/components/nexus/ExecutionSafetyPanel";
import type { PortfolioSummary } from "@/lib/nexus/bot";

export default function NexusPortfolio() {
  const { bot, connected } = useNexusBot();
  const [data, setData] = useState<PortfolioSummary | null>(null);

  useEffect(() => {
    if (!bot) return;
    let alive = true;
    const load = () => bot.getPortfolio().then((d) => alive && setData(d)).catch(() => {});
    load();
    const t = setInterval(load, 10_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [bot]);

  if (!connected) {
    return (
      <div className="space-y-4">
        <header className="flex items-center gap-3">
          <Wallet className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Portfolio</h1>
            <p className="text-xs text-muted-foreground">AUM, P/L and exchange balances</p>
          </div>
        </header>
        <NexusEmptyState
          icon={<Plug className="w-8 h-8" />}
          title="No trading bot connected"
          message="Portfolio data requires authenticated exchange APIs through your bot. Connect one to see real balances. We never display fake numbers."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <Wallet className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">Portfolio</h1>
          <p className="text-xs text-muted-foreground">Live from connected bot</p>
        </div>
      </header>
      <NexusBotStatusBar />
      <ProtectionBanner />
      <ExecutionSafetyPanel />
      <ProtectionOptimizerPanel />
      <ProtectionConfigPanel />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total AUM" value={"$" + fmtNum(data?.totalAumUsd ?? 0)} icon={<Wallet className="w-4 h-4" />} />
        <StatCard
          label="Daily P&L"
          value={(data?.dailyPnlUsd ?? 0) >= 0 ? "+$" + fmtNum(data?.dailyPnlUsd ?? 0) : "-$" + fmtNum(Math.abs(data?.dailyPnlUsd ?? 0))}
          tone={(data?.dailyPnlUsd ?? 0) >= 0 ? "success" : "danger"}
          icon={<TrendingUp className="w-4 h-4" />}
        />
        <StatCard label="Win Rate" value={((data?.winRate ?? 0) * 100).toFixed(1) + "%"} />
        <StatCard label="Active Strategies" value={String(data?.activeStrategies ?? 0)} tone="muted" />
      </div>

      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-3">Exchange Balances</h3>
        {data?.exchanges.length ? (
          <ul className="space-y-2 text-xs">
            {data.exchanges.map((ex) => (
              <li key={ex.name} className="flex justify-between border-b border-border/50 pb-2">
                <span className="font-mono capitalize">{ex.name}</span>
                <span className="flex items-center gap-3">
                  <span className={`text-[10px] ${ex.connected ? "text-primary" : "text-muted-foreground"}`}>
                    {ex.connected ? "connected" : "offline"}
                  </span>
                  <span className="font-mono font-bold">${fmtNum(ex.balanceUsd)}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">No exchange balances reported.</p>
        )}
      </Card>
    </div>
  );
}
