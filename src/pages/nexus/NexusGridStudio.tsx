import { useEffect, useRef, useState } from "react";
import { Grid3X3, Plus, Square, Trash2, Plug } from "lucide-react";
import { useNexusBot } from "@/hooks/useNexusBot";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NexusEmptyState } from "@/components/nexus/shared";
import { ProtectionBanner } from "@/components/nexus/ProtectionBanner";
import { ExecutionSafetyPanel } from "@/components/nexus/ExecutionSafetyPanel";
import { NexusBotStatusBar } from "@/components/nexus/NexusBotStatusBar";
import type { GridConfig, GridStatus } from "@/lib/nexus/bot";
import { createGridGuarded, reportBotTradeClosed } from "@/lib/nexus/bot";
import { toast } from "@/hooks/use-toast";

const MODES: GridConfig["mode"][] = ["normal", "martingale", "moving", "scalping", "capital_protection"];

export default function NexusGridStudio() {
  const { bot, connected } = useNexusBot();
  const [grids, setGrids] = useState<GridStatus[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<Partial<GridConfig>>({
    exchange: "hyperliquid",
    symbol: "BTC",
    marketType: "perpetual",
    mode: "normal",
    gridCount: 10,
    feeRate: 0.0005,
  });

  useEffect(() => {
    if (!bot) return;
    let alive = true;
    const load = () => bot.listGrids().then((g) => alive && applyGridUpdate(g)).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [bot]);

  // Track which grid ids we've already reported to the protection ledger so
  // an active→stopped transition is only recorded once, and remember each
  // grid's openedAt so the reported trade has a real duration.
  const reportedRef = useRef<Set<string>>(new Set());
  const openedAtRef = useRef<Map<string, number>>(new Map());

  const applyGridUpdate = (updated: GridStatus[]) => {
    setGrids((prev) => {
      const prevById = new Map(prev.map((g) => [g.id, g]));
      for (const g of updated) {
        if (!openedAtRef.current.has(g.id)) {
          openedAtRef.current.set(g.id, g.createdAt);
        }
        const before = prevById.get(g.id);
        const justClosed =
          before?.status === "active" && (g.status === "stopped" || g.status === "error");
        if (justClosed && !reportedRef.current.has(g.id)) {
          reportedRef.current.add(g.id);
          // Real closeProfit derived from the bot's own reported pnl and the
          // investment the user actually configured for this grid — not a
          // fabricated number.
          const closeProfit = g.totalInvestment > 0 ? g.pnl / g.totalInvestment : 0;
          reportBotTradeClosed({
            strategy: "grid",
            pair: g.symbol,
            side: "*",
            closeProfit,
            isStopExit: g.status === "error",
            openedAt: openedAtRef.current.get(g.id) ?? g.createdAt,
            closedAt: Date.now(),
          });
        }
      }
      return updated;
    });
  };

  if (!connected) {
    return (
      <div className="space-y-4">
        <header className="flex items-center gap-3">
          <Grid3X3 className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Grid Trading Studio</h1>
            <p className="text-xs text-muted-foreground">Plug in a bot to deploy grid strategies</p>
          </div>
        </header>
        <NexusEmptyState
          icon={<Plug className="w-8 h-8" />}
          title="No trading bot connected"
          message="Grid execution, P/L, and active orders require a live bot. Register one with registerBot() from src/lib/nexus/bot.ts. Until then no grids are shown — we never display simulated trades."
        />
      </div>
    );
  }

  const create = async () => {
    if (!bot || !form.symbol || !form.upperPrice || !form.lowerPrice || !form.totalInvestment) return;
    const cfg: GridConfig = {
      id: `grid-${Date.now()}`,
      exchange: form.exchange ?? "hyperliquid",
      symbol: form.symbol,
      marketType: form.marketType ?? "perpetual",
      mode: form.mode ?? "normal",
      upperPrice: form.upperPrice,
      lowerPrice: form.lowerPrice,
      gridCount: form.gridCount ?? 10,
      totalInvestment: form.totalInvestment,
      feeRate: form.feeRate ?? 0.0005,
    };
    try {
      const g = await createGridGuarded(cfg);
      setGrids((prev) => [...prev, g]);
      setShowCreate(false);
      toast({ title: "Grid created", description: `${cfg.symbol} on ${cfg.exchange}` });
    } catch (e) {
      toast({ title: "Failed to create grid", description: (e as Error).message, variant: "destructive" });
    }
  };

  const stop = async (id: string) => {
    if (!bot) return;
    await bot.stopGrid(id);
    const g = grids.find((x) => x.id === id);
    setGrids((p) => p.map((x) => (x.id === id ? { ...x, status: "stopped" } : x)));
    if (g && !reportedRef.current.has(id)) {
      reportedRef.current.add(id);
      const closeProfit = g.totalInvestment > 0 ? g.pnl / g.totalInvestment : 0;
      reportBotTradeClosed({
        strategy: "grid",
        pair: g.symbol,
        side: "*",
        closeProfit,
        isStopExit: false,
        openedAt: openedAtRef.current.get(id) ?? g.createdAt,
        closedAt: Date.now(),
      });
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Grid3X3 className="w-6 h-6 text-primary" />
          <div>
            <h1 className="text-xl font-bold">Grid Trading Studio</h1>
            <p className="text-xs text-muted-foreground">{grids.length} grid(s) · live from bot</p>
          </div>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4 mr-1" /> New Grid
        </Button>
      </header>
      <NexusBotStatusBar />
      <ProtectionBanner />
      <ExecutionSafetyPanel />

      {showCreate && (
        <Card className="p-4">
          <h3 className="font-semibold mb-3 text-sm">Create Grid Strategy</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">Symbol</Label>
              <Input value={form.symbol ?? ""} onChange={(e) => setForm({ ...form, symbol: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">Mode</Label>
              <select
                className="w-full rounded border border-input bg-background px-3 py-2 text-sm"
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value as GridConfig["mode"] })}
              >
                {MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <div>
              <Label className="text-xs">Upper Price</Label>
              <Input
                type="number"
                value={form.upperPrice ?? ""}
                onChange={(e) => setForm({ ...form, upperPrice: parseFloat(e.target.value) })}
              />
            </div>
            <div>
              <Label className="text-xs">Lower Price</Label>
              <Input
                type="number"
                value={form.lowerPrice ?? ""}
                onChange={(e) => setForm({ ...form, lowerPrice: parseFloat(e.target.value) })}
              />
            </div>
            <div>
              <Label className="text-xs">Grid Count</Label>
              <Input
                type="number"
                value={form.gridCount ?? 10}
                onChange={(e) => setForm({ ...form, gridCount: parseInt(e.target.value) })}
              />
            </div>
            <div>
              <Label className="text-xs">Investment ($)</Label>
              <Input
                type="number"
                value={form.totalInvestment ?? ""}
                onChange={(e) => setForm({ ...form, totalInvestment: parseFloat(e.target.value) })}
              />
            </div>
            <div className="col-span-2 flex items-end gap-2">
              <Button onClick={create} className="flex-1">Create</Button>
              <Button variant="outline" onClick={() => setShowCreate(false)} className="flex-1">Cancel</Button>
            </div>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {grids.map((g) => (
          <Card key={g.id} className="p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="font-mono font-bold text-sm">{g.symbol}</span>
              <span
                className={`text-[10px] uppercase px-2 py-0.5 rounded border ${
                  g.status === "active"
                    ? "border-primary/40 text-primary bg-primary/10"
                    : "border-border text-muted-foreground"
                }`}
              >
                {g.status}
              </span>
            </div>
            <div className="space-y-1.5 text-xs">
              <Row label="Exchange" value={g.exchange} />
              <Row label="Mode" value={g.mode} />
              <Row label="Range" value={`$${g.lowerPrice} – $${g.upperPrice}`} />
              <Row label="Grids" value={`${g.filledGrids}/${g.gridCount}`} />
              <Row label="Investment" value={`$${g.totalInvestment.toFixed(2)}`} />
              <div className="flex justify-between border-t border-border pt-2 mt-2">
                <span className="text-muted-foreground">P&L</span>
                <span className={`font-mono font-bold ${g.pnl >= 0 ? "text-primary" : "text-destructive"}`}>
                  {g.pnl >= 0 ? "+" : ""}${g.pnl.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              {g.status === "active" && (
                <Button size="sm" variant="destructive" className="flex-1" onClick={() => stop(g.id)}>
                  <Square className="w-3 h-3 mr-1" /> Stop
                </Button>
              )}
              <Button size="sm" variant="outline" className="px-2">
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          </Card>
        ))}
        {grids.length === 0 && (
          <div className="col-span-full">
            <NexusEmptyState
              icon={<Grid3X3 className="w-8 h-8" />}
              title="No active grids"
              message="Create a grid strategy to start automated trading."
            />
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
