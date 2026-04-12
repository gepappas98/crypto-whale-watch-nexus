/* ══ WHALE RADAR v9 — ADVANCED FILTERS ═══════════════════════════════════════
 *  Dropdowns for min threshold, chain, and transaction type filtering.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useCallback } from 'react';

export interface WhaleFilters {
  minThreshold: number;       // USD value: 0 = all, 100000, 500000, 1000000
  chain: string;              // 'all' | 'ethereum' | 'solana' | 'bsc' | 'polygon'
  txType: string;             // 'all' | 'buy' | 'sell' | 'swap' | 'bridge'
}

export const DEFAULT_FILTERS: WhaleFilters = {
  minThreshold: 0,
  chain: 'all',
  txType: 'all',
};

interface WRAdvancedFiltersProps {
  filters: WhaleFilters;
  onChange: (filters: WhaleFilters) => void;
  compact?: boolean;
}

const THRESHOLDS = [
  { value: 0, label: 'ALL' },
  { value: 100_000, label: '$100K+' },
  { value: 500_000, label: '$500K+' },
  { value: 1_000_000, label: '$1M+' },
  { value: 5_000_000, label: '$5M+' },
];

const CHAINS = [
  { value: 'all', label: 'ALL CHAINS' },
  { value: 'ethereum', label: 'ETH' },
  { value: 'solana', label: 'SOL' },
  { value: 'bsc', label: 'BSC' },
  { value: 'polygon', label: 'POLY' },
];

const TX_TYPES = [
  { value: 'all', label: 'ALL TYPES' },
  { value: 'buy', label: 'BUY' },
  { value: 'sell', label: 'SELL' },
  { value: 'swap', label: 'SWAP' },
  { value: 'bridge', label: 'BRIDGE' },
];

export function WRAdvancedFilters({ filters, onChange, compact }: WRAdvancedFiltersProps) {
  const update = useCallback((patch: Partial<WhaleFilters>) => {
    onChange({ ...filters, ...patch });
  }, [filters, onChange]);

  const btnCls = (active: boolean) =>
    `text-[8px] px-1.5 py-0.5 border cursor-pointer font-mono tracking-widest transition-all min-h-[28px] min-w-[28px]
     ${active
      ? 'bg-wr-green-ghost border-wr-green text-wr-green'
      : 'border-wr-border text-wr-muted hover:border-wr-green-dim hover:text-wr-green'}`;

  if (compact) {
    return (
      <div className="flex gap-1 items-center flex-wrap">
        <select
          className="wr-input text-[8px] h-7 py-0 px-1 min-w-[70px] bg-wr-bg border-wr-border text-wr-white"
          value={filters.minThreshold}
          onChange={e => update({ minThreshold: +e.target.value })}
        >
          {THRESHOLDS.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <select
          className="wr-input text-[8px] h-7 py-0 px-1 min-w-[70px] bg-wr-bg border-wr-border text-wr-white"
          value={filters.chain}
          onChange={e => update({ chain: e.target.value })}
        >
          {CHAINS.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        <select
          className="wr-input text-[8px] h-7 py-0 px-1 min-w-[70px] bg-wr-bg border-wr-border text-wr-white"
          value={filters.txType}
          onChange={e => update({ txType: e.target.value })}
        >
          {TX_TYPES.map(t => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-2">
      {/* Min Threshold */}
      <div>
        <div className="text-[7px] text-wr-muted tracking-[0.2em] mb-1">MIN THRESHOLD</div>
        <div className="flex gap-1 flex-wrap">
          {THRESHOLDS.map(t => (
            <button
              key={t.value}
              className={btnCls(filters.minThreshold === t.value)}
              onClick={() => update({ minThreshold: t.value })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {/* Chain */}
      <div>
        <div className="text-[7px] text-wr-muted tracking-[0.2em] mb-1">CHAIN</div>
        <div className="flex gap-1 flex-wrap">
          {CHAINS.map(c => (
            <button
              key={c.value}
              className={btnCls(filters.chain === c.value)}
              onClick={() => update({ chain: c.value })}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>
      {/* TX Type */}
      <div>
        <div className="text-[7px] text-wr-muted tracking-[0.2em] mb-1">TRANSACTION TYPE</div>
        <div className="flex gap-1 flex-wrap">
          {TX_TYPES.map(t => (
            <button
              key={t.value}
              className={btnCls(filters.txType === t.value)}
              onClick={() => update({ txType: t.value })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
