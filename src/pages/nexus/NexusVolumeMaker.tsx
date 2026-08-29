import { useRef, useEffect, useState } from "react";
import { Volume2, Play, Square, Plug } from "lucide-react";
import { useNexusBot } from "@/hooks/useNexusBot";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { NexusEmptyState, StatCard, fmtNum } from "@/components/nexus/shared";
import { ProtectionBanner } from "@/components/nexus/ProtectionBanner";
import { ExecutionSafetyPanel } from "@/components/nexus/ExecutionSafetyPanel";
import { NexusBotStatusBar } from "@/components/nexus/NexusBotStatusBar";
import type { VolumeStats } from "@/lib/nexus/bot";
import { startVolumeMakerGuarded, reportBotTradeClosed } from "@/lib/nexus/bot";
import { toast } from "@/hooks/use-toast";

export default function NexusVolumeMaker() {
  const { bot, connected } = useNexusBot();
  const [stats, setStats] = useState<VolumeStats | null>(null);
  const [mode, setMode] = useState("backpack_limit");
  const [signalSource, setSignalSource] = useState("backpack_rest");
  const [exchange, setExchange] = useState("binance");
  const [symbol, setSymbol] = useState("BTC");
  const [busy, setBusy] = useState(false);
  // Real wall-clock start time of the current run, used only to give the
  // reported ledger entry an honest duration — never fabricated.
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (!bot) return;
    let alive = true;
    const load = () => bot.getVolumeStats().then((s) => alive && setStats(s)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [bot]);

  if (!connected) {
    return (
      <div className="space-y-4">
        <header className="flex items-center gap-3">
          <Volume2 className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Volume Maker</h1>
            <p className="text-xs text-muted-foreground">Plug in a bot to run volume strategies</p>
          </div>
        </header>
        <NexusEmptyState
          icon={<Plug className="w-8 h-8" />}
          title="No trading bot connected"
          message="Volume making requires a live bot for order placement, fee tracking, and rebate accrual. No simulated stats are shown."
        />
      </div>
    );
  }

  const start = async () => {
    if (!bot) return;
    setBusy(true);
    try {
      const s = await startVolumeMakerGuarded({ mode, signalSource, exchange, symbol });
      setStats(s);
      startedAtRef.current = Date.now();
      toast({ title: "Volume maker started", description: `${exchange}/${symbol} · ${mode} · signal: ${signalSource}` });
    } catch (e) {
      toast({ title: "Start failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    if (!bot) return;
    setBusy(true);
    try {
      const s = await bot.stopVolumeMaker();
      setStats(s);
      // Fee/rebate margin is the only real, non-fabricated profit concept
      // available for this strategy — there's no per-position stop-loss,
      // so isStopExit is always false here.
      if (s.totalVolumeUsd > 0) {
        reportBotTradeClosed({
          strategy: "volume_maker",
          pair: "*",
          side: "*",
          closeProfit: (s.rebatesUsd - s.feesUsd) / s.totalVolumeUsd,
          isStopExit: false,
          openedAt: startedAtRef.current ?? Date.now(),
          closedAt: Date.now(),
        });
      }
      startedAtRef.current = null;
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-3">
        <Volume2 className="w-6 h-6 text-primary" />
        <div>
          <h1 className="text-xl font-bold">Volume Maker Controller</h1>
          <p className="text-xs text-muted-foreground">
            {stats?.active ? "Running" : "Idle"} · live stats from bot
          </p>
        </div>
      </header>
      <NexusBotStatusBar />
      <ProtectionBanner />
      <ExecutionSafetyPanel />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Total Volume" value={"$" + fmtNum(stats?.totalVolumeUsd ?? 0)} />
        <StatCard label="Trades" value={fmtNum(stats?.trades ?? 0)} tone="success" />
        <StatCard label="Fees Paid" value={"$" + (stats?.feesUsd ?? 0).toFixed(4)} tone="danger" />
        <StatCard label="Rebates Earned" value={"$" + (stats?.rebatesUsd ?? 0).toFixed(4)} tone="success" />
      </div>

      <Card className="p-4">
        <h3 className="font-semibold text-sm mb-3">Strategy Configuration</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-4">
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Mode</label>
            <select
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              disabled={stats?.active}
            >
              <option value="backpack_limit">Backpack Limit</option>
              <option value="lighter_market">Lighter Market</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Signal Source</label>
            <select
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
              value={signalSource}
              onChange={(e) => setSignalSource(e.target.value)}
              disabled={stats?.active}
            >
              <option value="backpack_rest">Backpack REST</option>
              <option value="hyperliquid_ws">Hyperliquid WebSocket</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Exchange</label>
            <select
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
              value={exchange}
              onChange={(e) => setExchange(e.target.value)}
              disabled={stats?.active}
            >
              <option value="binance">Binance</option>
              <option value="okx">OKX</option>
              <option value="hyperliquid">Hyperliquid</option>
              <option value="backpack">Backpack</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-muted-foreground mb-1 block">Symbol</label>
            <input
              className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              disabled={stats?.active}
              placeholder="BTC"
            />
          </div>
        </div>
        {stats?.active ? (
          <Button variant="destructive" disabled={busy} onClick={stop}>
            <Square className="w-4 h-4 mr-1" /> Stop
          </Button>
        ) : (
          <Button disabled={busy} onClick={start}>
            <Play className="w-4 h-4 mr-1" /> Start
          </Button>
        )}
      </Card>
    </div>
  );
}
