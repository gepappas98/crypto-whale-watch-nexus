import { ShieldAlert, Unlock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useProtections } from "@/hooks/useProtections";
import { clearLock, clearAllLocks, type ProtectionLock } from "@/lib/nexus/protections";

const SOURCE_LABEL: Record<ProtectionLock["source"], string> = {
  cooldown: "Cooldown",
  stoploss_guard: "Stoploss Guard",
  max_drawdown: "Max Drawdown",
  low_profit_pairs: "Low Profit Pairs",
};

function timeLeft(until: number): string {
  const ms = until - Date.now();
  if (ms <= 0) return "expiring";
  const mins = Math.ceil(ms / 60_000);
  if (mins < 60) return `${mins}m left`;
  return `${Math.ceil(mins / 60)}h left`;
}

/** Renders nothing when there are no active locks — never shows an empty
 *  warning card. Drop this into any Nexus bot page (Grid Studio, Volume
 *  Maker, Portfolio) to surface why the bot is refusing new entries. */
export function ProtectionBanner() {
  const { locks, refresh } = useProtections();
  if (locks.length === 0) return null;

  return (
    <Card className="p-3 border-yellow-500/40 bg-yellow-500/5 space-y-2">
      <div className="flex items-center justify-between gap-2 text-xs font-semibold text-yellow-500">
        <div className="flex items-center gap-2">
          <ShieldAlert className="w-4 h-4" />
          Protection engine has blocked {locks.length} scope{locks.length > 1 ? "s" : ""} from trading
        </div>
        {/* clearAllLocks() already existed in protections.ts with no caller —
         *  only per-lock Clear was wired below. With several locks active at
         *  once (e.g. a MaxDrawdown ALL-PAIRS lock plus a few per-pair
         *  cooldowns) clearing them one at a time was the only option. */}
        {locks.length > 1 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 shrink-0 text-yellow-500 hover:text-yellow-400"
            onClick={() => {
              clearAllLocks();
              refresh();
            }}
          >
            <Unlock className="w-3 h-3 mr-1" /> Clear All
          </Button>
        )}
      </div>
      <div className="space-y-1.5">
        {locks.map((lock, i) => (
          <div
            key={`${lock.pair}-${lock.source}-${i}`}
            className="flex items-center justify-between gap-2 text-xs bg-background/40 rounded px-2 py-1.5"
          >
            <div className="min-w-0">
              <span className="font-mono font-medium">{lock.pair === "*" ? "ALL PAIRS" : lock.pair}</span>
              <span className="text-muted-foreground"> · {SOURCE_LABEL[lock.source]} · {timeLeft(lock.until)}</span>
              <p className="text-[10px] text-muted-foreground truncate">{lock.reason}</p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2 shrink-0"
              onClick={() => {
                clearLock(lock.pair, lock.source);
                refresh();
              }}
            >
              <Unlock className="w-3 h-3 mr-1" /> Clear
            </Button>
          </div>
        ))}
      </div>
    </Card>
  );
}
