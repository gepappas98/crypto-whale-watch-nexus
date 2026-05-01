/* ══ HYPERLIQUID EXPLORER TAB ════════════════════════════════════════════════
 *  Combines real-time block table, tx feed and HL wallet tracker.
 *  All data flows through the Supabase Edge Function cache (never direct).
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useState, useEffect } from 'react';
import { HLBlockTable, HLTxTable } from './HLBlockTable';
import { HLWalletTracker } from './HLWalletTracker';
import { useHLLeaderboard, usePrefetchHL } from '@/hooks/useHyperliquid';
import { shortAddr, fmtAgo } from '@/lib/hyperliquid';

// ── Sub-tab type ──────────────────────────────────────────────────────────────

type HLSubTab = 'blocks' | 'txs' | 'wallets' | 'leaderboard';

const SUB_TABS: { key: HLSubTab; label: string; icon: string }[] = [
  { key: 'blocks',      label: 'BLOCKS',      icon: '🔗' },
  { key: 'txs',         label: 'TXS',         icon: '📋' },
  { key: 'wallets',     label: 'WALLETS',     icon: '👁' },
  { key: 'leaderboard', label: 'TOP TRADERS', icon: '🏆' },
];

// ── Leaderboard table ─────────────────────────────────────────────────────────

function HLLeaderboard() {
  const { entries, isFirstLoad, error } = useHLLeaderboard();

  if (isFirstLoad) {
    return (
      <div className="space-y-0">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="px-3 py-2 border-b border-wr-border/40 flex items-center gap-3">
            <div className="w-5 h-2.5 bg-wr-border/50 rounded animate-pulse" />
            <div className="flex-1 h-2.5 bg-wr-border/50 rounded animate-pulse" />
            <div className="w-16 h-2.5 bg-wr-border/50 rounded animate-pulse" />
            <div className="w-14 h-2.5 bg-wr-border/50 rounded animate-pulse" />
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center text-wr-red text-[9px] py-8 tracking-widest">
        ⚠ {error.message}
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-center text-wr-muted text-[9px] py-8 tracking-widest">
        No leaderboard data
      </div>
    );
  }

  const fmtUsd = (n: number) => {
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  };

  return (
    <div>
      <div className="px-3 py-1 border-b border-wr-border bg-wr-bg3 grid grid-cols-[30px_1fr_80px_80px] gap-2 text-[7px] text-wr-muted tracking-[2px]">
        <span>#</span>
        <span>ADDRESS</span>
        <span className="text-right">24H VOL</span>
        <span className="text-right">24H PNL</span>
      </div>
      <div className="max-h-96 overflow-y-auto scrollbar-thin">
        {entries.map((e) => (
          <div
            key={e.address}
            className="px-3 py-1.5 border-b border-wr-border/40 grid grid-cols-[30px_1fr_80px_80px] gap-2 items-center hover:bg-wr-bg3 transition-colors"
          >
            <span className={`text-[8px] font-mono font-bold
              ${e.rank === 1 ? 'text-wr-amber' : e.rank === 2 ? 'text-wr-white/60' : e.rank === 3 ? 'text-[#cd7f32]' : 'text-wr-muted'}`}>
              #{e.rank}
            </span>
            <a
              href={`https://app.hypurrscan.io/address/${e.address}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[8px] text-wr-cyan font-mono hover:underline truncate"
            >
              {shortAddr(e.address)}
            </a>
            <span className="text-right text-[8px] text-wr-white font-mono">
              {fmtUsd(e.volume24h)}
            </span>
            <span className={`text-right text-[8px] font-mono font-bold
              ${e.pnl24h >= 0 ? 'text-wr-green' : 'text-wr-red'}`}>
              {e.pnl24h >= 0 ? '+' : ''}{fmtUsd(e.pnl24h)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main explorer ─────────────────────────────────────────────────────────────

interface HLExplorerProps {
  /** When false the component is mounted but data fetching pauses (no active polling) */
  isActive?: boolean;
}

export function HLExplorer({ isActive = true }: HLExplorerProps) {
  const [subTab, setSubTab] = useState<HLSubTab>('blocks');
  const prefetch = usePrefetchHL();

  // Pre-warm the cache as soon as this component mounts / becomes active
  useEffect(() => {
    if (isActive) prefetch();
  }, [isActive, prefetch]);

  return (
    <div className="flex flex-col h-full border-t border-wr-border bg-wr-bg">

      {/* Tab bar */}
      <div className="flex border-b border-wr-border bg-wr-bg shrink-0">
        {SUB_TABS.map(t => (
          <button
            key={t.key}
            className={`flex-1 py-1.5 text-[8px] tracking-[2px] text-center cursor-pointer border-b-2 transition-all font-mono
              ${subTab === t.key
                ? 'text-wr-cyan border-wr-cyan'
                : 'text-wr-muted border-transparent hover:text-wr-white/60'}`}
            onClick={() => setSubTab(t.key)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {subTab === 'blocks'      && <HLBlockTable />}
        {subTab === 'txs'         && <HLTxTable />}
        {subTab === 'wallets'     && <HLWalletTracker />}
        {subTab === 'leaderboard' && <HLLeaderboard />}
      </div>

      {/* Footer: attribution + cache info */}
      <div className="px-3 py-1.5 border-t border-wr-border/50 bg-wr-bg3 flex items-center gap-3 shrink-0">
        <span className="text-[7px] text-wr-muted/50 font-mono tracking-widest">
          Data via
        </span>
        <a
          href="https://hypurrscan.io"
          target="_blank"
          rel="noopener noreferrer"
          className="text-[7px] text-wr-cyan/60 hover:text-wr-cyan font-mono transition-colors"
        >
          hypurrscan.io ↗
        </a>
        <div className="flex-1" />
        <span className="text-[6px] text-wr-muted/40 font-mono">
          ⚡ server-cache · 300ms poll · stale-while-revalidate
        </span>
      </div>
    </div>
  );
}
