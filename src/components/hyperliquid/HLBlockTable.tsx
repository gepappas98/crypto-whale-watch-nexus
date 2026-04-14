/* ══ HYPERLIQUID — Real-time Block Table ══════════════════════════════════════
 *  300ms poll, instant cached response, live ms timestamps.
 *  Skeleton ONLY on first load — subsequent updates replace rows in-place.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';
import { useHLBlocks, useHLTxs, useAgeMsLive } from '@/hooks/useHyperliquid';
import { fmtAgo, shortAddr, type HLBlock, type HLTx } from '@/lib/hyperliquid';
import { Skeleton } from '@/components/ui/skeleton';

// ── Skeleton row for first-load ───────────────────────────────────────────────

function BlockSkeleton() {
  return (
    <div className="px-3 py-1.5 border-b border-wr-border/40 grid grid-cols-[60px_80px_1fr_50px] gap-2 items-center">
      <Skeleton className="h-2.5 w-12 bg-wr-border/50" />
      <Skeleton className="h-2.5 w-16 bg-wr-border/50" />
      <Skeleton className="h-2.5 w-24 bg-wr-border/50" />
      <Skeleton className="h-2.5 w-8 bg-wr-border/50" />
    </div>
  );
}

function TxSkeleton() {
  return (
    <div className="px-3 py-1.5 border-b border-wr-border/40 grid grid-cols-[90px_1fr_60px_50px] gap-2 items-center">
      <Skeleton className="h-2.5 w-20 bg-wr-border/50" />
      <Skeleton className="h-2.5 w-28 bg-wr-border/50" />
      <Skeleton className="h-2.5 w-14 bg-wr-border/50" />
      <Skeleton className="h-2.5 w-10 bg-wr-border/50" />
    </div>
  );
}

// ── Live age badge ─────────────────────────────────────────────────────────────

interface AgeBadgeProps {
  serverTs: number | undefined;
  cached: boolean;
  stale?: boolean;
}

export function AgeBadge({ serverTs, cached, stale }: AgeBadgeProps) {
  const age = useAgeMsLive(serverTs);

  if (!serverTs) return null;

  const label = age < 1000 ? `${age}ms ago` : `${(age / 1000).toFixed(1)}s ago`;
  const color = stale
    ? 'text-wr-amber border-wr-amber/40'
    : cached
    ? 'text-wr-cyan border-wr-cyan/30'
    : 'text-wr-green border-wr-green/30';

  return (
    <span
      className={`text-[7px] font-mono border px-1.5 py-0.5 rounded tracking-widest transition-colors ${color}`}
      title={stale ? 'Stale data' : cached ? 'Served from cache' : 'Fresh fetch'}
    >
      {stale ? '⚠ ' : cached ? '⚡ ' : '✓ '}updated {label}
    </span>
  );
}

// ── Live ms timestamp ─────────────────────────────────────────────────────────

function LiveTs({ epochMs }: { epochMs: number }) {
  const [label, setLabel] = useState(() => fmtAgo(epochMs));
  const timerRef = useRef<number>(0);

  useEffect(() => {
    const tick = () => {
      setLabel(fmtAgo(epochMs));
      const diff = Date.now() - epochMs;
      // Tick faster when recent, slow down when old
      const interval = diff < 5_000 ? 100 : diff < 60_000 ? 500 : 5_000;
      timerRef.current = window.setTimeout(tick, interval);
    };
    tick();
    return () => clearTimeout(timerRef.current);
  }, [epochMs]);

  return <>{label}</>;
}

// ── Block Table ───────────────────────────────────────────────────────────────

interface HLBlockTableProps {
  onBlockClick?: (block: HLBlock) => void;
}

export function HLBlockTable({ onBlockClick }: HLBlockTableProps) {
  const { blocks, age_ms: _age, cached, stale, isFirstLoad, error } = useHLBlocks();
  const serverTs = blocks.length > 0 ? Date.now() - (_age ?? 0) : undefined;

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="wr-panel-header">
        <span className="wr-panel-title flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-wr-green animate-blink inline-block" />
          🔗 LATEST BLOCKS
        </span>
        <AgeBadge serverTs={serverTs} cached={cached} stale={stale} />
      </div>

      {/* Column headers */}
      <div className="px-3 py-1 border-b border-wr-border bg-wr-bg3 grid grid-cols-[60px_80px_1fr_50px] gap-2 text-[7px] text-wr-muted tracking-[2px]">
        <span>HEIGHT</span>
        <span>TIME</span>
        <span>HASH</span>
        <span className="text-right">TXS</span>
      </div>

      {/* Rows */}
      <div className="max-h-52 overflow-y-auto scrollbar-thin">
        {isFirstLoad ? (
          Array.from({ length: 8 }).map((_, i) => <BlockSkeleton key={i} />)
        ) : error ? (
          <div className="text-center text-wr-red text-[9px] py-6 tracking-widest px-3">
            ⚠ {error.message}
          </div>
        ) : blocks.length === 0 ? (
          <div className="text-center text-wr-muted text-[9px] py-6 tracking-widest">
            No blocks yet
          </div>
        ) : (
          blocks.slice(0, 30).map((b) => (
            <div
              key={b.height}
              className={`px-3 py-1.5 border-b border-wr-border/40 grid grid-cols-[60px_80px_1fr_50px] gap-2 items-center text-[8px] animate-slide-in
                ${onBlockClick ? 'cursor-pointer hover:bg-wr-green/5 transition-colors' : ''}`}
              onClick={() => onBlockClick?.(b)}
            >
              <span className="text-wr-cyan font-mono font-bold">#{b.height.toLocaleString()}</span>
              <span className="text-wr-muted font-mono">
                <LiveTs epochMs={b.time} />
              </span>
              <span className="text-wr-white/60 font-mono truncate text-[7px]">
                {shortAddr(b.hash, 8, 6)}
              </span>
              <span className="text-right text-wr-green font-mono">{b.txCount}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Tx Table ──────────────────────────────────────────────────────────────────

export function HLTxTable() {
  const { txs, age_ms: _age, cached, isFirstLoad, error } = useHLTxs();
  const serverTs = txs.length > 0 ? Date.now() - (_age ?? 0) : undefined;

  const statusColor = (s: HLTx['status']) =>
    s === 'success' ? 'text-wr-green' : s === 'failure' ? 'text-wr-red' : 'text-wr-amber';

  return (
    <div className="flex flex-col">
      <div className="wr-panel-header">
        <span className="wr-panel-title flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-wr-cyan animate-blink inline-block" />
          📋 RECENT TXS
        </span>
        <AgeBadge serverTs={serverTs} cached={cached} stale={false} />
      </div>

      <div className="px-3 py-1 border-b border-wr-border bg-wr-bg3 grid grid-cols-[90px_1fr_60px_50px] gap-2 text-[7px] text-wr-muted tracking-[2px]">
        <span>HASH</span>
        <span>FROM</span>
        <span>ACTION</span>
        <span className="text-right">STATUS</span>
      </div>

      <div className="max-h-52 overflow-y-auto scrollbar-thin">
        {isFirstLoad ? (
          Array.from({ length: 8 }).map((_, i) => <TxSkeleton key={i} />)
        ) : error ? (
          <div className="text-center text-wr-red text-[9px] py-6 tracking-widest px-3">
            ⚠ {error.message}
          </div>
        ) : txs.length === 0 ? (
          <div className="text-center text-wr-muted text-[9px] py-6 tracking-widest">
            No transactions
          </div>
        ) : (
          txs.slice(0, 40).map((tx) => (
            <div
              key={tx.hash}
              className="px-3 py-1.5 border-b border-wr-border/40 grid grid-cols-[90px_1fr_60px_50px] gap-2 items-center text-[8px] animate-slide-in hover:bg-wr-bg3 transition-colors"
            >
              <a
                href={`https://app.hypurrscan.io/tx/${tx.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-wr-cyan font-mono hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {shortAddr(tx.hash, 6, 4)}
              </a>
              <span className="text-wr-white/70 font-mono truncate text-[7px]">
                {shortAddr(tx.from, 6, 4)}
              </span>
              <span className="text-wr-amber font-mono uppercase text-[7px]">
                {tx.action ?? '—'}
              </span>
              <span className={`text-right font-mono text-[7px] uppercase ${statusColor(tx.status)}`}>
                {tx.status}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
