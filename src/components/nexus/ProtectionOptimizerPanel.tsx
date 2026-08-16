import { useMemo, useState } from "react";
import { Sparkles, Check, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  optimizeProtectionThresholds, applyBestCandidate,
  type OptimizationResult,
} from "@/lib/nexus/protectionOptimizer";
import { setProtectionConfig } from "@/lib/nexus/protections";

/** Surfaces the hyperopt-style grid-search suggestion from
 *  protectionOptimizer.ts. Deliberately never auto-applies anything — the
 *  optimizer tunes against PAST trades, which is a suggestion to review,
 *  not a guarantee for future ones (same caveat freqtrade gives about
 *  hyperopt overfitting). Renders nothing until there's enough trade
 *  history to search over, and nothing once dismissed for this session. */
export function ProtectionOptimizerPanel() {
  const [dismissed, setDismissed] = useState(false);
  const [applied, setApplied] = useState(false);
  // Re-run only on mount — this is a "review occasionally" tool, not
  // something that needs to react to every trade in real time. Once
  // applied/dismissed the component returns null below and unmounts, so a
  // fresh mount later naturally re-runs this.
  const { results, insufficientData, tradeCount } = useMemo(() => optimizeProtectionThresholds(), []);

  if (dismissed || applied) return null;
  if (insufficientData) {
    return (
      <Card className="p-3 text-xs text-muted-foreground border-dashed">
        <Sparkles className="w-3.5 h-3.5 inline mr-1.5 opacity-60" />
        Threshold optimizer needs at least 15 closed bot trades to suggest anything
        ({tradeCount}/15 recorded so far).
      </Card>
    );
  }
  if (results.length === 0) return null;

  const best: OptimizationResult = results[0];
  const improvesOnCurrent = best.simulatedNetProfit > 0;

  const applyBest = () => {
    const next = applyBestCandidate();
    if (!next) return; // shouldn't happen here (results.length > 0 already checked above), but stay defensive
    setProtectionConfig(next);
    setApplied(true);
  };

  return (
    <Card className="p-3 border-blue-500/40 bg-blue-500/5 space-y-2 text-xs">
      <div className="flex items-center gap-2 font-semibold text-blue-500">
        <Sparkles className="w-4 h-4" />
        Protection threshold suggestion (from {best.tradesTotal} closed trades)
      </div>
      <p className="text-muted-foreground">
        Replaying your trade history, these thresholds would have{" "}
        <span className={improvesOnCurrent ? "text-wr-green" : "text-destructive"}>
          {improvesOnCurrent ? "improved" : "changed"} net PnL to {best.simulatedNetProfit >= 0 ? "+" : ""}
          {(best.simulatedNetProfit * 100).toFixed(2)}%
        </span>{" "}
        by blocking {best.tradesBlocked} of {best.tradesTotal} trades.
      </p>
      <div className="grid grid-cols-3 gap-2 bg-background/40 rounded px-2 py-1.5 font-mono">
        <div>
          <div className="text-[9px] text-muted-foreground">MAX DD</div>
          <div>{(best.candidate.maxDrawdown.maxAllowedDrawdown * 100).toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground">STOP LIMIT</div>
          <div>{best.candidate.stoplossGuard.tradeLimit}</div>
        </div>
        <div>
          <div className="text-[9px] text-muted-foreground">LOW-PROFIT MIN</div>
          <div>{(best.candidate.lowProfitPairs.requiredProfit * 100).toFixed(1)}%</div>
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground">
        This is a fit to past trades, not a guarantee for future ones — review before applying.
      </p>
      <div className="flex gap-2">
        <Button size="sm" className="h-7 px-2" onClick={applyBest}>
          <Check className="w-3 h-3 mr-1" /> Apply to Protection Engine
        </Button>
        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setDismissed(true)}>
          <X className="w-3 h-3 mr-1" /> Dismiss
        </Button>
      </div>
    </Card>
  );
}
