import { useState } from "react";
import { PlusIcon, PlayIcon, PauseIcon, BarChart3Icon } from "lucide-react";
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
import { botApi, type VolumeConfig } from "@/lib/botApi";

interface VolumeTabProps {
  isConnected: boolean;
}

interface VolumeConfigWithStatus extends VolumeConfig {
  id: string;
  status: "running" | "stopped";
  totalVolume: number;
  ordersExecuted: number;
}

const EXCHANGES = ["Binance", "Coinbase", "Kraken", "Bybit", "OKX"];
const PAIRS = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT"];

export function VolumeTab({ isConnected }: VolumeTabProps) {
  const [configs, setConfigs] = useState<VolumeConfigWithStatus[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [formData, setFormData] = useState<Partial<VolumeConfig>>({
    pair: "",
    exchange: "",
    targetVolume: 10000,
    minOrderSize: 100,
    maxOrderSize: 500,
    interval: 60,
  });

  const handleCreate = async () => {
    if (!formData.pair || !formData.exchange) {
      toast.error("Please select pair and exchange");
      return;
    }

    setIsCreating(true);
    try {
      const result = await botApi.createVolumeConfig(formData as VolumeConfig);
      setConfigs((prev) => [
        ...prev,
        {
          ...(formData as VolumeConfig),
          id: result.id,
          status: "stopped",
          totalVolume: 0,
          ordersExecuted: 0,
        },
      ]);
      toast.success("Volume maker created");
      setIsCreateOpen(false);
      setFormData({
        pair: "",
        exchange: "",
        targetVolume: 10000,
        minOrderSize: 100,
        maxOrderSize: 500,
        interval: 60,
      });
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    } finally {
      setIsCreating(false);
    }
  };

  const handleStart = async (configId: string) => {
    try {
      await botApi.startVolumeMaker(configId);
      setConfigs((prev) =>
        prev.map((c) => (c.id === configId ? { ...c, status: "running" as const } : c))
      );
      toast.success("Volume maker started");
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    }
  };

  const handleStop = async (configId: string) => {
    try {
      await botApi.stopVolumeMaker(configId);
      setConfigs((prev) =>
        prev.map((c) => (c.id === configId ? { ...c, status: "stopped" as const } : c))
      );
      toast.success("Volume maker stopped");
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    }
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-400">
        <div className="w-12 h-12 rounded-full border-2 border-slate-600 border-t-cyan-400 animate-spin mb-4" />
        <p>Awaiting connection to volume maker engine...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">Volume Maker</h3>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button className="bg-cyan-600 hover:bg-cyan-500">
              <PlusIcon className="w-4 h-4 mr-2" />
              Create Config
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-slate-900 border-slate-700">
            <DialogHeader>
              <DialogTitle className="text-slate-100">Create Volume Maker</DialogTitle>
              <DialogDescription className="text-slate-400">
                Configure automated volume generation parameters.
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

              <div className="space-y-2">
                <Label className="text-slate-300">Target Daily Volume ($)</Label>
                <Input
                  type="number"
                  value={formData.targetVolume || ""}
                  onChange={(e) => setFormData((p) => ({ ...p, targetVolume: Number(e.target.value) }))}
                  className="bg-slate-800 border-slate-600"
                  placeholder="10000"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-slate-300">Min Order Size ($)</Label>
                  <Input
                    type="number"
                    value={formData.minOrderSize || ""}
                    onChange={(e) => setFormData((p) => ({ ...p, minOrderSize: Number(e.target.value) }))}
                    className="bg-slate-800 border-slate-600"
                    placeholder="100"
                  />
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">Max Order Size ($)</Label>
                  <Input
                    type="number"
                    value={formData.maxOrderSize || ""}
                    onChange={(e) => setFormData((p) => ({ ...p, maxOrderSize: Number(e.target.value) }))}
                    className="bg-slate-800 border-slate-600"
                    placeholder="500"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-slate-300">Interval (seconds)</Label>
                <Input
                  type="number"
                  value={formData.interval || ""}
                  onChange={(e) => setFormData((p) => ({ ...p, interval: Number(e.target.value) }))}
                  className="bg-slate-800 border-slate-600"
                  placeholder="60"
                />
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
                {isCreating ? "Creating..." : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {configs.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-64 text-slate-400 border border-dashed border-slate-700 rounded-lg">
          <BarChart3Icon className="w-12 h-12 mb-4 opacity-50" />
          <p>No volume makers configured. Create one to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4">
          {configs.map((config) => (
            <div
              key={config.id}
              className="p-4 rounded-lg border border-slate-700 bg-slate-800/50"
            >
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-lg text-slate-100">{config.pair}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                    {config.exchange}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded ${
                      config.status === "running"
                        ? "bg-emerald-900/50 text-emerald-400"
                        : "bg-slate-700 text-slate-400"
                    }`}
                  >
                    {config.status}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  {config.status === "running" ? (
                    <Button size="sm" variant="outline" onClick={() => handleStop(config.id)}>
                      <PauseIcon className="w-4 h-4" />
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => handleStart(config.id)}>
                      <PlayIcon className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-4 gap-4 text-sm">
                <div className="p-3 rounded bg-slate-900/50">
                  <p className="text-slate-400 text-xs mb-1">Target Volume</p>
                  <p className="font-medium text-slate-200">${config.targetVolume.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded bg-slate-900/50">
                  <p className="text-slate-400 text-xs mb-1">Generated</p>
                  <p className="font-medium text-cyan-400">${config.totalVolume.toLocaleString()}</p>
                </div>
                <div className="p-3 rounded bg-slate-900/50">
                  <p className="text-slate-400 text-xs mb-1">Orders</p>
                  <p className="font-medium text-slate-200">{config.ordersExecuted}</p>
                </div>
                <div className="p-3 rounded bg-slate-900/50">
                  <p className="text-slate-400 text-xs mb-1">Interval</p>
                  <p className="font-medium text-slate-200">{config.interval}s</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
