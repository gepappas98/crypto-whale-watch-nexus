/* ══ WHALE RADAR v9 — TICKER ═════════════════════════════════════════════════ */
import { fmtP } from '@/lib/whaleRadarState';

interface WRTickerProps {
  coins: { symbol: string; change: number; price: number; isSol?: boolean }[];
}

export function WRTicker({ coins }: WRTickerProps) {
  const all = [...coins, ...coins];
  return (
    <div className="overflow-hidden border-b border-wr-border bg-wr-bg h-6 flex items-center">
      <div className="flex gap-8 animate-ticker whitespace-nowrap text-[9px] px-3">
        {all.map((c, i) => (
          <span key={i} className="text-wr-muted">
            {c.symbol}{c.isSol ? '◎' : ''}
            <span className={c.change >= 0 ? 'text-wr-green' : 'text-wr-red'}>
              {c.change >= 0 ? '+' : ''}{c.change.toFixed(1)}%
            </span>
            <span className="text-wr-white ml-1">${fmtP(c.price)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}
