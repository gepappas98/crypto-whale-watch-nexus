/* ══ HYPERLIQUID — Wallet & Whale Tracker ═════════════════════════════════════
 *  Caches address lookups for 2s, uses rpc.hypurrscan.io for direct balances.
 *  Shows "data updated Xms ago" badge so users feel the speed.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useState, useCallback } from 'react';
import { useHLAddress, useHLBalance, useAgeMsLive } from '@/hooks/useHyperliquid';
import { shortAddr, hexToHype, fmtAgo } from '@/lib/hyperliquid';
import { Skeleton } from '@/components/ui/skeleton';
import { AgeBadge } from './HLBlockTable';

// ── Types ─────────────────────────────────────────────────────────────────────

interface TrackedWallet {
  address: string;
  label: string;
  addedAt: number;
}

// ── Single wallet row ─────────────────────────────────────────────────────────

interface WalletRowProps {
  wallet: TrackedWallet;
  onRemove: (addr: string) => void;
  isSelected: boolean;
  onSelect: (addr: string) => void;
}

function WalletRow({ wallet, onRemove, isSelected, onSelect }: WalletRowProps) {
  const { stats, isLoading, isFetching, error, age_ms, cached } =
    useHLAddress(wallet.address);
  const { hexBalance, isLoading: balLoading } = useHLBalance(wallet.address);

  // Compute live age from when the server fetched (not when we received it)
  const serverTs = age_ms !== undefined ? Date.now() - age_ms : undefined;
  const displayAge = useAgeMsLive(serverTs);

  const ageLabel =
    displayAge < 1000
      ? `${displayAge}ms`
      : `${(displayAge / 1000).toFixed(1)}s`;

  return (
    <div
      className={`border-b border-wr-border/40 transition-colors cursor-pointer
        ${isSelected ? 'bg-wr-cyan/5 border-l-2 border-l-wr-cyan' : 'hover:bg-wr-bg3'}`}
      onClick={() => onSelect(wallet.address)}
    >
      <div className="px-3 py-2 flex items-center gap-2">
        {/* Status dot */}
        <div
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0
            ${isFetching ? 'bg-wr-amber animate-pulse' : error ? 'bg-wr-red' : 'bg-wr-cyan'}`}
        />

        {/* Main info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-wr-white font-mono">{wallet.label}</span>
            {cached && (
              <span className="text-[6px] text-wr-cyan/60 border border-wr-cyan/20 px-1 rounded font-mono">
                CACHE
              </span>
            )}
          </div>
          <div className="text-[7px] text-wr-muted font-mono">
            {shortAddr(wallet.address, 8, 6)}
          </div>
        </div>

        {/* Balance */}
        <div className="text-right flex-shrink-0">
          {balLoading ? (
            <Skeleton className="h-2.5 w-14 bg-wr-border/50" />
          ) : (
            <div className="text-[8px] text-wr-green font-mono">
              {hexToHype(hexBalance ?? undefined)}
            </div>
          )}
          {serverTs && (
            <div className="text-[6px] text-wr-muted/60 font-mono">{ageLabel} ago</div>
          )}
        </div>

        {/* Remove btn */}
        <button
          className="text-wr-muted hover:text-wr-red text-[10px] font-mono flex-shrink-0 ml-1 transition-colors bg-transparent border-none cursor-pointer"
          onClick={(e) => { e.stopPropagation(); onRemove(wallet.address); }}
          title="Remove"
        >
          ✕
        </button>
      </div>

      {/* Stats row (visible when selected) */}
      {isSelected && (
        <div className="px-3 pb-2 animate-slide-in">
          {isLoading ? (
            <div className="flex gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-20 bg-wr-border/40 rounded" />
              ))}
            </div>
          ) : error ? (
            <div className="text-[8px] text-wr-red/80 py-1">⚠ {error.message}</div>
          ) : stats ? (
            <div className="grid grid-cols-3 gap-2 mt-1">
              <StatChip label="24h VOL" value={stats.volume24h != null ? `$${fmtCompact(stats.volume24h)}` : '—'} color="text-wr-cyan" />
              <StatChip label="24h PNL" value={stats.pnl24h != null ? `${stats.pnl24h >= 0 ? '+' : ''}$${fmtCompact(Math.abs(stats.pnl24h))}` : '—'} color={stats.pnl24h != null ? (stats.pnl24h >= 0 ? 'text-wr-green' : 'text-wr-red') : 'text-wr-muted'} />
              <StatChip label="TXS" value={stats.txCount?.toLocaleString() ?? '—'} color="text-wr-amber" />
              {stats.lastSeen && (
                <StatChip label="LAST SEEN" value={fmtAgo(stats.lastSeen)} color="text-wr-muted" />
              )}
              {stats.rank && (
                <StatChip label="RANK" value={`#${stats.rank}`} color="text-wr-cyan" />
              )}
              {stats.tags && stats.tags.length > 0 && (
                <div className="col-span-3 flex gap-1 flex-wrap">
                  {stats.tags.map(t => (
                    <span key={t} className="text-[6px] font-mono border border-wr-cyan/30 text-wr-cyan px-1 py-0.5 rounded uppercase">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="text-[8px] text-wr-muted py-1">No data available</div>
          )}

          {/* Age badge */}
          {serverTs && (
            <div className="mt-1.5">
              <AgeBadge serverTs={serverTs} cached={cached} />
            </div>
          )}

          {/* Hypurrscan link */}
          <a
            href={`https://app.hypurrscan.io/address/${wallet.address}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[7px] text-wr-muted/60 hover:text-wr-cyan font-mono mt-1 inline-block transition-colors"
            onClick={e => e.stopPropagation()}
          >
            View on Hypurrscan ↗
          </a>
        </div>
      )}
    </div>
  );
}

// ── Stat chip ─────────────────────────────────────────────────────────────────

function StatChip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-wr-bg3 border border-wr-border rounded px-2 py-1">
      <div className="text-[6px] text-wr-muted tracking-widest">{label}</div>
      <div className={`text-[8px] font-mono font-bold mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}

function fmtCompact(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(2);
}

// ── Main component ────────────────────────────────────────────────────────────

interface HLWalletTrackerProps {
  /** Optional: pre-populate with wallets from parent state */
  initialWallets?: TrackedWallet[];
  onWalletsChange?: (wallets: TrackedWallet[]) => void;
}

export function HLWalletTracker({ initialWallets = [], onWalletsChange }: HLWalletTrackerProps) {
  const [wallets, setWallets] = useState<TrackedWallet[]>(initialWallets);
  const [input, setInput]     = useState('');
  const [label, setLabel]     = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const updateWallets = useCallback((next: TrackedWallet[]) => {
    setWallets(next);
    onWalletsChange?.(next);
  }, [onWalletsChange]);

  const handleAdd = () => {
    const addr = input.trim();
    if (!addr || addr.length < 10) return;
    if (wallets.some(w => w.address.toLowerCase() === addr.toLowerCase())) return;
    updateWallets([
      ...wallets,
      { address: addr, label: label.trim() || shortAddr(addr, 6, 4), addedAt: Date.now() },
    ]);
    setInput('');
    setLabel('');
  };

  const handleRemove = useCallback((addr: string) => {
    updateWallets(wallets.filter(w => w.address !== addr));
    if (selected === addr) setSelected(null);
  }, [wallets, selected, updateWallets]);

  const handleSelect = useCallback((addr: string) => {
    setSelected(prev => prev === addr ? null : addr);
  }, []);

  return (
    <div className="flex flex-col">
      {/* Header */}
      <div className="wr-panel-header">
        <span className="wr-panel-title text-wr-cyan">
          🔗 HL WALLET TRACKER
        </span>
        <span className="text-[7px] text-wr-muted font-mono">
          {wallets.length} tracked · 2s cache
        </span>
      </div>

      {/* Add form */}
      <div className="p-2 space-y-1.5 border-b border-wr-border bg-wr-bg3">
        <input
          className="wr-input text-[9px] w-full"
          placeholder="Hyperliquid address (0x…)"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <div className="flex gap-1.5">
          <input
            className="wr-input flex-1 text-[9px]"
            placeholder="Label (optional)"
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
          />
          <button
            className="wr-btn cyan text-[8px]"
            onClick={handleAdd}
            disabled={!input.trim()}
          >
            + TRACK
          </button>
        </div>
      </div>

      {/* Wallet list */}
      <div className="max-h-80 overflow-y-auto scrollbar-thin">
        {wallets.length === 0 ? (
          <div className="text-center text-wr-muted text-[9px] py-8 tracking-widest px-4 leading-relaxed">
            Add Hyperliquid wallet addresses above to track balances, PnL, and activity in real-time.
            <br />
            <span className="text-[7px] text-wr-muted/60 mt-1 block">
              Data cached for 2s via edge function → rpc.hypurrscan.io
            </span>
          </div>
        ) : (
          wallets.map(w => (
            <WalletRow
              key={w.address}
              wallet={w}
              onRemove={handleRemove}
              isSelected={selected === w.address}
              onSelect={handleSelect}
            />
          ))
        )}
      </div>
    </div>
  );
}
