/* ══ WHALE RADAR v9 — PRICE TRACKER BAR ══════════════════════════════════════
 *  Tracked symbols are now ordered by rankByPerformance() (freqtrade
 *  PerformanceFilter-style ranking, lib/nexus/pairPerformance.ts) instead of
 *  plain object-insertion order — the best-performing tracked symbols show
 *  first. That function existed with no consumer anywhere in the app before
 *  this; a symbol with no track record yet just falls to the end, unranked,
 *  same as everywhere else this module is used. */
import { useMemo } from 'react';
import { TrackedToken, fmtP } from '@/lib/whaleRadarState';
import { rankByPerformance } from '@/lib/nexus/pairPerformance';

interface WRTrackerProps {
  tracked: Record<string, TrackedToken>;
  onUntrack: (sym: string) => void;
}

export function WRTracker({ tracked, onUntrack }: WRTrackerProps) {
  const entries = Object.entries(tracked);

  const orderedSymbols = useMemo(
    () => rankByPerformance(entries.map(([sym]) => sym)),
    // entries.length as a cheap change-signal; tracked itself is a fresh object each
    // render from its owner's state, so depending on it directly would re-sort every render.
    [entries.length, Object.keys(tracked).join(',')],
  );

  return (
    <div className="border-t border-wr-border bg-wr-bg3 px-3 py-1 flex gap-1.5 items-center flex-wrap">
      <span className="text-[8px] text-wr-muted tracking-[2px]">▸ TRACKING:</span>
      {entries.length === 0 ? (
        <span className="text-wr-muted text-[9px]">click + to track price</span>
      ) : (
        orderedSymbols.map((sym) => {
          const t = tracked[sym];
          if (!t) return null; // stale entry from a since-untracked symbol between renders
          const sess = ((t.price - t.basePrice) / t.basePrice) * 100;
          return (
            <div key={sym} className="flex items-center gap-1 px-1.5 py-0.5 bg-wr-bg border border-wr-border text-[9px] animate-slide-in">
              <span className="font-head text-[8px] text-wr-white tracking-widest">{sym}</span>
              <span className="text-wr-cyan">${fmtP(t.price)}</span>
              <span className={sess >= 0 ? 'text-wr-green' : 'text-wr-red'}>
                {sess >= 0 ? '+' : ''}{sess.toFixed(2)}%
              </span>
              <button className="text-wr-muted hover:text-wr-red cursor-pointer text-xs bg-transparent border-none font-mono" onClick={() => onUntrack(sym)}>×</button>
            </div>
          );
        })
      )}
    </div>
  );
}
