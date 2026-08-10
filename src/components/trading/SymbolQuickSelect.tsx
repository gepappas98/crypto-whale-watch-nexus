/* ══ TRADING HUB — SYMBOL QUICK SELECT ═══════════════════════════════════════
 *  Every Trading Hub page (Technical, Patterns, Backtest, Timeframes,
 *  Sentiment) already accepted an arbitrary symbol via free-text input —
 *  the backend (trading-bridge edge function, Yahoo Finance-style tickers)
 *  never actually restricted anything to BTC-USD. What was missing was any
 *  quick way to switch: a blank box pre-filled with "BTC-USD" reads as
 *  "this is the only symbol" even though it isn't. This is a small shared
 *  chip row so every page gets the same one-click majors list instead of
 *  five different implementations.
 * ═══════════════════════════════════════════════════════════════════════════ */

export interface SymbolQuickSelectProps {
  value: string;
  onSelect: (symbol: string) => void;
  className?: string;
}

/** Yahoo Finance-style tickers — matches what tradingApi/trading-bridge
 *  already expects (confirmed via yahooPrice() in lib/trading-api.ts). */
export const QUICK_SYMBOLS = [
  'BTC-USD', 'ETH-USD', 'SOL-USD', 'BNB-USD',
  'XRP-USD', 'ADA-USD', 'DOGE-USD', 'AVAX-USD',
] as const;

export function SymbolQuickSelect({ value, onSelect, className = '' }: SymbolQuickSelectProps) {
  return (
    <div className={`flex gap-1 flex-wrap ${className}`}>
      {QUICK_SYMBOLS.map((s) => {
        const active = value.toUpperCase() === s;
        return (
          <button
            key={s}
            type="button"
            onClick={() => onSelect(s)}
            className={`text-[10px] px-2 py-1 rounded border font-mono transition-colors ${
              active
                ? 'bg-primary text-primary-foreground border-primary'
                : 'border-border text-muted-foreground hover:border-primary/50 hover:text-foreground'
            }`}
          >
            {s.replace('-USD', '')}
          </button>
        );
      })}
    </div>
  );
}
