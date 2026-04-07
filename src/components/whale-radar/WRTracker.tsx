/* ══ WHALE RADAR v9 — PRICE TRACKER BAR ══════════════════════════════════════ */
import { TrackedToken, fmtP } from '@/lib/whaleRadarState';

interface WRTrackerProps {
  tracked: Record<string, TrackedToken>;
  onUntrack: (sym: string) => void;
}

export function WRTracker({ tracked, onUntrack }: WRTrackerProps) {
  const entries = Object.entries(tracked);

  return (
    <div className="border-t border-wr-border bg-wr-bg3 px-3 py-1 flex gap-1.5 items-center flex-wrap">
      <span className="text-[8px] text-wr-muted tracking-[2px]">▸ TRACKING:</span>
      {entries.length === 0 ? (
        <span className="text-wr-muted text-[9px]">click + to track price</span>
      ) : (
        entries.map(([sym, t]) => {
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
