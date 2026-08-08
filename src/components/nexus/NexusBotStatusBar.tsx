import { useEffect, useState } from "react";
import { FlaskConical, Gauge } from "lucide-react";
import { useNexusBot } from "@/hooks/useNexusBot";
import { isDryRun } from "@/lib/nexus/bot";
import { checkOpenTradeSlot, getMaxOpenTrades, type SlotCheckResult } from "@/lib/nexus/openTradesLimit";

const POLL_MS = 8_000;

/** Small status strip for the Nexus Bot pages (Grid Studio, Volume Maker,
 *  Portfolio) — surfaces two things that otherwise fail silently: dry-run
 *  mode being on (so a "successful" grid creation doesn't confuse anyone
 *  into thinking real capital moved), and how many open-trade slots are
 *  left before FullTradesFilter-style blocking kicks in
 *  (see lib/nexus/openTradesLimit.ts). Renders nothing when the bot isn't
 *  connected — there's nothing meaningful to show yet. */
export function NexusBotStatusBar() {
  const { bot, connected } = useNexusBot();
  const [slot, setSlot] = useState<SlotCheckResult | null>(null);
  const dryRun = isDryRun();

  useEffect(() => {
    if (!bot) {
      setSlot(null);
      return;
    }
    let alive = true;
    const load = () => checkOpenTradeSlot(bot).then((s) => alive && setSlot(s)).catch(() => {});
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [bot]);

  if (!connected) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      {dryRun && (
        <span className="inline-flex items-center gap-1 rounded px-2 py-1 bg-blue-500/10 text-blue-500 border border-blue-500/30 font-medium">
          <FlaskConical className="w-3 h-3" /> DRY RUN — no real orders will be placed
        </span>
      )}
      {slot && (
        <span
          className={`inline-flex items-center gap-1 rounded px-2 py-1 border font-medium ${
            slot.hasFreeSlot
              ? "bg-muted/40 text-muted-foreground border-border"
              : "bg-destructive/10 text-destructive border-destructive/30"
          }`}
        >
          <Gauge className="w-3 h-3" />
          {slot.openCount < 0 ? "slots unknown" : `${slot.openCount}/${slot.maxOpenTrades ?? getMaxOpenTrades()} slots used`}
        </span>
      )}
    </div>
  );
}
