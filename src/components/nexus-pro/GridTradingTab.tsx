import { useState } from "react";
import { PlusIcon, PlayIcon, PauseIcon, TrashIcon, GridIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { botApi, type GridBotStatus, type GridBotConfig } from "@/lib/botApi";

interface GridTradingTabProps {
  bots: GridBotStatus[];
  isConnected: boolean;
}

const EXCHANGES = ["Binance", "Coinbase", "Kraken", "Bybit", "OKX"];
const PAIRS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"];

export function GridTradingTab({ bots, isConnected }: GridTradingTabProps) {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<Partial<GridBotConfig>>({
    pair: "",
    exchange: "",
    upperPrice: 0,
    lowerPrice: 0,
    gridLevels: 10,
    totalInvestment: 1000,
  });

  const handleCreate = async () => {
    if (!formData.pair || !formData.exchange || !formData.upperPrice || !formData.lowerPrice) {
      toast.error("Please fill all required fields");
      return;
    }

    setIsCreating(true);
    try {
      await botApi.createGridBot(formData as GridBotConfig);
      toast.success("Grid bot created successfully");
      setIsCreateOpen(false);
      setFormData({
        pair: "",
        exchange: "",
        upperPrice: 0,
        lowerPrice: 0,
        gridLevels: 10,
        totalInvestment: 1000,
      });
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleStart = async (botId: string) => {
    try {
      await botApi.startGridBot(botId);
      toast.success("Bot started");
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    }
  };

  const handleStop = async (botId: string) => {
    try {
      await botApi.stopGridBot(botId);
      toast.success("Bot stopped");
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    }
  };

  const handleDelete = async (botId: string) => {
    try {
      await botApi.deleteGridBot(botId);
      toast.success("Bot deleted");
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    }
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-400">
        <div className="w-12 h-12 rounded-full border-2 border-slate-600 border-t-cyan-400 animate-spin mb-4" />
        <p>Awaiting connection to grid trading engine...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">Grid Trading Bots</h3>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-cyan-600 hover:bg-cyan-500">
              <PlusIcon className="w-4 h-4 mr-2" />
              Create Bot
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-slate-900 border-slate-700">
            <DialogHeader>
              <DialogTitle className="text-slate-100">Create Grid Bot</DialogTitle>
              <DialogDescription className="text-slate-400">
                Configure a new grid trading bot with your parameters.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">Trading Pair</Label>
                  <Select
                    value={formData.pair}
                    onValueChange={(v) => setFormData((p) => ({ ...p, pair: v }))}
                  >
                    <SelectTrigger className="bg-slate-800 border-slate-600">
                      <SelectValue placeholder="Select pair" />
                    </SelectTrigger>
                    <SelectContent>
                      {PAIRS.map((pair) => (
                        <SelectItem key={pair} value={pair}>
                          {pair}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Exchange</Label>
                  <Select
                    value={formData.exchange}
                    onValueChange={(v) => setFormData((p) => ({ ...p, exchange: v }))}
                  >
                    <SelectTrigger className="bg-slate-800 border-slate-600">
                      <SelectValue placeholder="Select exchange" />
                    </SelectTrigger>
                    <SelectContent>
                      {EXCHANGES.map((ex) => (
                        <SelectItem key={ex} value={ex}>
                          {ex}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">Upper Price ($)</Label>
                  <Input
                    type="number"
                    value={formData.upperPrice || ""}
                    onChange={(e) => setFormData((p) => ({ ...p, upperPrice: Number(e.target.value) }))}
                    className="bg-slate-800 border-slate-600"
                    placeholder="70000"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Lower Price ($)</Label>
                  <Input
                    type="number"
                    value={formData.lowerPrice || ""}
                    onChange={(e) => setFormData((p) => ({ ...p, lowerPrice: Number(e.target.value) }))}
                    className="bg-slate-800 border-slate-600"
                    placeholder="60000"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">Grid Levels</Label>
                  <Input
                    type="number"
                    value={formData.gridLevels || ""}
                    onChange={(e) => setFormData((p) => ({ ...p, gridLevels: Number(e.target.value) }))}
                    className="bg-slate-800 border-slate-600"
                    placeholder="10"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Investment ($)</Label>
                  <Input
                    type="number"
                    value={formData.totalInvestment || ""}
                    onChange={(e) => setFormData((p) => ({ ...p, totalInvestment: Number(e.target.value) }))}
                    className="bg-slate-800 border-slate-600"
                    placeholder="1000"
                  />
                </div>
              </div>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={isCreating}
                className="bg-cyan-600 hover:bg-cyan-500"
              >
                {isCreating ? "Creating..." : "Create Bot"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {bots.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-400 border border-dashed border-slate-700 rounded-lg">
          <GridIcon className="w-12 h-12 mb-4 opacity-50" />
          <p>No grid bots configured. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {bots.map((bot) => (
            <div
              key={bot.id}
              className="p-4 rounded-lg border border-slate-700 bg-slate-800/50"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-lg text-slate-100">{bot.pair}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                    {bot.exchange}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      bot.status === "running"
                        ? "bg-emerald-900/50 text-emerald-400"
                        : bot.status === "paused"
                        ? "bg-amber-900/50 text-amber-400"
                        : "bg-slate-700 text-slate-400"
                    }`}
                  >
                    {bot.status}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {bot.status === "running" ? (
                    <Button size="sm" variant="outline" onClick={() => handleStop(bot.id)}>
                      <PauseIcon className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => handleStart(bot.id)}>
                      <PlayIcon className="w-4 h-4" />
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-red-400 hover:text-red-300"
                    onClick={() => handleDelete(bot.id)}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4 text-sm">
                <div className="p-3 rounded bg-slate-900/50">
                  <p className="text-slate-400 text-xs mb-1">Active Orders</p>
                  <p className="font-medium text-slate-200">{bot.activeOrders}</p>
                </div>
                <div className="p-3 rounded bg-slate-900/50">
                  <p className="text-slate-400 text-xs mb-1">Filled Orders</p>
                  <p className="font-medium text-slate-200">{bot.filledOrders}</p>
                </div>
                <div className="p-3 rounded bg-slate-900/50">
                  <p className="text-slate-400 text-xs mb-1">Total Profit</p>
                  <p
                    className={`font-medium ${
                      bot.totalProfit >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    ${bot.totalProfit.toLocaleString()}
                  </p>
                </div>
                <div className="p-3 rounded bg-slate-900/50">
                  <p className="text-slate-400 text-xs mb-1">Profit %</p>
                  <p
                    className={`font-medium ${
                      bot.profitPercent >= 0 ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {bot.profitPercent >= 0 ? "+" : ""}
                    {bot.profitPercent.toFixed(2)}%
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
