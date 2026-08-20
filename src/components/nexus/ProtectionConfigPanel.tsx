import { useState } from "react";
import { ShieldCheck, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  getProtectionConfig, setProtectionConfig, resetProtectionConfig,
  DEFAULT_PROTECTION_CONFIG,
} from "@/lib/nexus/protections";

/** Shows the thresholds canTrade() is ACTUALLY enforcing right now — until
 *  this panel, the only protection-config UI was ProtectionOptimizerPanel's
 *  one-directional "apply this AI suggestion" card. There was no way to see
 *  what's currently active (defaults? a past optimizer run? a hand-edited
 *  value?) or to revert one. getProtectionConfig()/resetProtectionConfig()
 *  already existed in protections.ts fully implemented; neither had a
 *  caller anywhere in the UI before this. Collapsed by default — this is a
 *  "check occasionally" reference, not something that needs to compete for
 *  attention with the optimizer suggestion or the active-locks banner. */
export function ProtectionConfigPanel() {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState(getProtectionConfig);

  const isDefault = JSON.stringify(config) === JSON.stringify(DEFAULT_PROTECTION_CONFIG);

  const reset = () => {
    resetProtectionConfig();
    setConfig(getProtectionConfig());
  };

  const toggle = (section: keyof typeof config) => {
    const next = { ...config, [section]: { ...config[section], enabled: !config[section].enabled } };
    setProtectionConfig(next);
    setConfig(next);
  };

  return (
    <Card className="p-3 space-y-2 text-xs">
      <button
        className="flex items-center justify-between w-full text-left"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
          Active protection config
          {!isDefault && <span className="text-[9px] font-normal text-blue-400 bg-blue-500/10 rounded px-1.5 py-0.5">customized</span>}
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 opacity-60" /> : <ChevronDown className="w-3.5 h-3.5 opacity-60" />}
      </button>

      {open && (
        <div className="space-y-2 pt-1">
          <Row
            label="Cooldown" enabled={config.cooldown.enabled}
            detail={`locks a pair for ${config.cooldown.lookbackMinutes}m after any trade closes`}
            onToggle={() => toggle("cooldown")}
          />
          <Row
            label="Stoploss Guard" enabled={config.stoplossGuard.enabled}
            detail={`${config.stoplossGuard.tradeLimit}+ stop-outs / ${config.stoplossGuard.lookbackMinutes}m → locks ${config.stoplossGuard.onlyPerPair ? "that pair" : "ALL pairs"} for ${config.stoplossGuard.lockMinutes}m`}
            onToggle={() => toggle("stoplossGuard")}
          />
          <Row
            label="Max Drawdown" enabled={config.maxDrawdown.enabled}
            detail={`drawdown > ${(config.maxDrawdown.maxAllowedDrawdown * 100).toFixed(0)}% / ${config.maxDrawdown.lookbackMinutes}m (min ${config.maxDrawdown.tradeLimit} trades) → locks ALL pairs for ${config.maxDrawdown.lockMinutes}m`}
            onToggle={() => toggle("maxDrawdown")}
          />
          <Row
            label="Low Profit Pairs" enabled={config.lowProfitPairs.enabled}
            detail={`net profit < ${(config.lowProfitPairs.requiredProfit * 100).toFixed(0)}% / ${config.lowProfitPairs.lookbackMinutes}m (min ${config.lowProfitPairs.tradeLimit} trades) → locks that pair for ${config.lowProfitPairs.lockMinutes}m`}
            onToggle={() => toggle("lowProfitPairs")}
          />

          <div className="flex items-center justify-between pt-1 border-t border-border/50">
            <p className="text-[10px] text-muted-foreground">
              {isDefault ? "Matches shipped defaults." : "Differs from shipped defaults (hand-edited or optimizer-applied)."}
            </p>
            <Button
              size="sm" variant="ghost" className="h-6 px-2 shrink-0"
              disabled={isDefault}
              onClick={reset}
            >
              <RotateCcw className="w-3 h-3 mr-1" /> Reset to defaults
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function Row({ label, enabled, detail, onToggle }: { label: string; enabled: boolean; detail: string; onToggle: () => void }) {
  return (
    <div className="flex items-start justify-between gap-2 bg-background/40 rounded px-2 py-1.5">
      <div className="min-w-0">
        <span className={`font-medium ${enabled ? "" : "text-muted-foreground line-through"}`}>{label}</span>
        <p className="text-[10px] text-muted-foreground">{detail}</p>
      </div>
      <Button size="sm" variant="ghost" className="h-6 px-2 shrink-0 text-[10px]" onClick={onToggle}>
        {enabled ? "ON" : "OFF"}
      </Button>
    </div>
  );
}
