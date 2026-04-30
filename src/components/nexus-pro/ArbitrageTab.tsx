import { useState } from "react";
import { ArrowRightIcon, TrendingUpIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { botApi, type ArbitrageOpportunity } from "@/lib/botApi";

interface ArbitrageTabProps {
  opportunities: ArbitrageOpportunity[];
  isConnected: boolean;
}

export function ArbitrageTab({ opportunities, isConnected }: ArbitrageTabProps) {
  const [selectedOpp, setSelectedOpp] = useState<ArbitrageOpportunity | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const handleExecute = async () => {
    if (!selectedOpp) return;

    setIsExecuting(true);
    try {
      const result = await botApi.executeArbitrage(selectedOpp.id);
      if (result.success) {
        toast.success(`Arbitrage executed successfully. TX: ${result.txId}`);
      } else {
        toast.error("Arbitrage execution failed");
      }
    } catch (err) {
      toast.error(`Error: ${(err as Error).message}`);
    } finally {
      setIsExecuting(false);
      setSelectedOpp(null);
    }
  };

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-400">
        <div className="w-12 h-12 rounded-full border-2 border-slate-600 border-t-cyan-400 animate-spin mb-4" />
        <p>Awaiting connection to arbitrage scanner...</p>
      </div>
    );
  }

  if (opportunities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-400">
        <TrendingUpIcon className="w-12 h-12 mb-4 opacity-50" />
        <p>No arbitrage opportunities detected. Scanning exchanges...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">Arbitrage Opportunities</h3>
        <span className="text-sm text-slate-400">{opportunities.length} active</span>
      </div>

      <div className="grid gap-4">
        {opportunities.map((opp) => (
          <div
            key={opp.id}
            className="p-4 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 transition-colors"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <span className="font-semibold text-lg text-slate-100">{opp.pair}</span>
                <span className="text-emerald-400 font-medium">+{opp.spreadPercent.toFixed(2)}%</span>
              </div>
              <Button
                size="sm"
                onClick={() => setSelectedOpp(opp)}
                className="bg-cyan-600 hover:bg-cyan-500"
              >
                Execute
              </Button>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <div className="flex-1 p-3 rounded bg-slate-900/50">
                <p className="text-slate-400 text-xs mb-1">Buy on</p>
                <p className="font-medium text-slate-200">{opp.buyExchange}</p>
                <p className="text-emerald-400">${opp.buyPrice.toLocaleString()}</p>
              </div>

              <ArrowRightIcon className="w-5 h-5 text-slate-500" />

              <div className="flex-1 p-3 rounded bg-slate-900/50">
                <p className="text-slate-400 text-xs mb-1">Sell on</p>
                <p className="font-medium text-slate-200">{opp.sellExchange}</p>
                <p className="text-red-400">${opp.sellPrice.toLocaleString()}</p>
              </div>

              <div className="flex-1 p-3 rounded bg-emerald-950/30 border border-emerald-800/50">
                <p className="text-slate-400 text-xs mb-1">Potential Profit</p>
                <p className="font-semibold text-emerald-400 text-lg">
                  ${opp.potentialProfit.toLocaleString()}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!selectedOpp} onOpenChange={() => setSelectedOpp(null)}>
        <DialogContent className="bg-slate-900 border-slate-700">
          <DialogHeader>
            <DialogTitle className="text-slate-100">Confirm Arbitrage Execution</DialogTitle>
            <DialogDescription className="text-slate-400">
              You are about to execute an arbitrage trade. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>

          {selectedOpp && (
            <div className="py-4 space-y-3">
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Pair</span>
                <span className="text-slate-200">{selectedOpp.pair}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Buy</span>
                <span className="text-slate-200">
                  {selectedOpp.buyExchange} @ ${selectedOpp.buyPrice.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">Sell</span>
                <span className="text-slate-200">
                  {selectedOpp.sellExchange} @ ${selectedOpp.sellPrice.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-sm pt-2 border-t border-slate-700">
                <span className="text-slate-400">Expected Profit</span>
                <span className="text-emerald-400 font-semibold">
                  ${selectedOpp.potentialProfit.toLocaleString()}
                </span>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setSelectedOpp(null)}>
              Cancel
            </Button>
            <Button
              onClick={handleExecute}
              disabled={isExecuting}
              className="bg-cyan-600 hover:bg-cyan-500"
            >
              {isExecuting ? "Executing..." : "Confirm Execution"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
