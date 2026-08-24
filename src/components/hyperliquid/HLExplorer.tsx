/* HYPERLIQUID EXPLORER - FIXED
 * Now includes a "Perpetuals" tab with real trading data:
 *   - Mark prices, oracle prices, funding rates, open interest
 *   - 24h volume, premium, max leverage
 * Existing tabs (Blocks, Txs, Wallets, Leaderboard) remain unchanged.
 */

import { useState } from 'react';
import { useHLBlocks, useHLTxs, useHLLeaderboard, useHLMarkets, useAgeMsLive } from '@/hooks/useHyperliquid';
import { shortAddr, fmtAgo } from '@/lib/hyperliquid';
import { HLWalletTracker } from './HLWalletTracker';
import { HLManipulationScanner } from './HLManipulationScanner';
import { TechnicalContextBadge } from '@/components/trading/TechnicalContextBadge';

const SUB_TABS = [
  { id: 'perps', label: 'Perpetuals' },
  { id: 'blocks', label: 'Blocks' },
  { id: 'txs', label: 'Transactions' },
  { id: 'wallets', label: 'Wallets' },
  { id: 'leaderboard', label: 'Leaderboard' },
] as const;

// ── Perpetuals Table ──────────────────────────────────────────────────────

function HLPerpsTable() {
  const { markets, summary, isFirstLoad, error } = useHLMarkets();

  if (isFirstLoad) {
    return (
      <div className="p-8 text-center text-wr-muted">
        <div className="animate-pulse">Loading Hyperliquid perpetuals...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8 text-center text-wr-red">
        ⚠ {error.message}
      </div>
    );
  }

  const fmtPrice = (n: number) => n >= 1000 ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : n.toFixed(4);
  const fmtPct = (n: number) => (n * 100).toFixed(4) + '%';
  const fmtNum = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toFixed(0);
  };

  return (
    <div>
      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <div className="bg-wr-surface rounded-lg p-3 border border-wr-border">
            <p className="text-xs text-wr-muted">Total OI</p>
            <p className="text-lg font-bold font-mono">${fmtNum(summary.totalOI)}</p>
          </div>
          <div className="bg-wr-surface rounded-lg p-3 border border-wr-border">
            <p className="text-xs text-wr-muted">24h Volume</p>
            <p className="text-lg font-bold font-mono">${fmtNum(summary.totalVolume24h)}</p>
          </div>
          <div className="bg-wr-surface rounded-lg p-3 border border-wr-border">
            <p className="text-xs text-wr-muted">Avg Funding</p>
            <p className="text-lg font-bold font-mono">{fmtPct(summary.avgFundingRate)}</p>
          </div>
          <div className="bg-wr-surface rounded-lg p-3 border border-wr-border">
            <p className="text-xs text-wr-muted">Markets</p>
            <p className="text-lg font-bold font-mono">{summary.marketCount}</p>
          </div>
        </div>
      )}

      {/* Markets table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-wr-muted border-b border-wr-border">
              <th className="text-left p-2">Asset</th>
              <th className="text-right p-2">Mark</th>
              <th className="text-right p-2">Oracle</th>
              <th className="text-right p-2">Premium</th>
              <th className="text-right p-2">Funding</th>
              <th className="text-right p-2">OI</th>
              <th className="text-right p-2">24h Vol</th>
              <th className="text-right p-2">Max Lev</th>
              <th className="text-right p-2">Live TA</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m, idx) => {
              // Map HL perp symbol → Yahoo ticker. kPEPE/kBONK/kSHIB skipped (no spot equiv).
              const yahooSym = /^k[A-Z]/.test(m.symbol) ? null : `${m.symbol}-USD`;
              return (
                <tr key={m.symbol} className="border-b border-wr-border/50 hover:bg-wr-surface/50">
                  <td className="p-2 font-mono font-bold">{m.symbol}</td>
                  <td className="p-2 text-right font-mono">{fmtPrice(m.markPrice)}</td>
                  <td className="p-2 text-right font-mono text-wr-muted">{fmtPrice(m.oraclePrice)}</td>
                  <td className="p-2 text-right font-mono">
                    <span className={m.premium > 0 ? 'text-wr-green' : 'text-wr-red'}>
                      {fmtPct(m.premium)}
                    </span>
                  </td>
                  <td className="p-2 text-right font-mono">
                    <span className={m.fundingRate > 0 ? 'text-wr-green' : 'text-wr-red'}>
                      {fmtPct(m.fundingRate)}
                    </span>
                  </td>
                  <td className="p-2 text-right font-mono">${fmtNum(m.openInterest)}</td>
                  <td className="p-2 text-right font-mono">${fmtNum(m.dayVolume)}</td>
                  <td className="p-2 text-right font-mono">{m.maxLeverage}x</td>
                  <td className="p-2 text-right">
                    {yahooSym && idx < 15 ? <TechnicalContextBadge symbol={yahooSym} /> : <span className="text-wr-muted text-[10px]">—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Blocks Table (unchanged) ──────────────────────────────────────────────

function HLBlockTable() {
  const { blocks, age_ms, cached } = useHLBlocks();
  const serverTs = age_ms !== undefined ? Date.now() - age_ms : undefined;
  const liveAge = useAgeMsLive(serverTs);

  return (
    <div>
      <div className="flex items-center justify-between mb-2 text-xs text-wr-muted">
        <span>{blocks.length} blocks</span>
        {serverTs && (
          <span>{cached ? '⚡' : '✓'} {liveAge < 1000 ? `${liveAge}ms` : `${(liveAge / 1000).toFixed(1)}s`} ago</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-wr-muted border-b border-wr-border">
              <th className="text-left p-2">Height</th>
              <th className="text-left p-2">Hash</th>
              <th className="text-right p-2">Txs</th>
              <th className="text-right p-2">Time</th>
            </tr>
          </thead>
          <tbody>
            {blocks.slice(0, 20).map((b) => (
              <tr key={b.height} className="border-b border-wr-border/50 hover:bg-wr-surface/50">
                <td className="p-2 font-mono">#{b.height.toLocaleString()}</td>
                <td className="p-2 font-mono text-wr-muted">{shortAddr(b.hash, 8, 6)}</td>
                <td className="p-2 text-right font-mono">{b.txCount}</td>
                <td className="p-2 text-right font-mono text-wr-muted">{fmtAgo(b.time)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Tx Table (unchanged) ──────────────────────────────────────────────────

function HLTxTable() {
  const { txs, age_ms, cached } = useHLTxs();
  const serverTs = age_ms !== undefined ? Date.now() - age_ms : undefined;
  const liveAge = useAgeMsLive(serverTs);

  return (
    <div>
      <div className="flex items-center justify-between mb-2 text-xs text-wr-muted">
        <span>{txs.length} transactions</span>
        {serverTs && (
          <span>{cached ? '⚡' : '✓'} {liveAge < 1000 ? `${liveAge}ms` : `${(liveAge / 1000).toFixed(1)}s`} ago</span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-wr-muted border-b border-wr-border">
              <th className="text-left p-2">Hash</th>
              <th className="text-left p-2">From</th>
              <th className="text-right p-2">Value</th>
              <th className="text-right p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {txs.slice(0, 20).map((tx) => (
              <tr key={tx.hash} className="border-b border-wr-border/50 hover:bg-wr-surface/50">
                <td className="p-2 font-mono">{shortAddr(tx.hash, 8, 6)}</td>
                <td className="p-2 font-mono text-wr-muted">{shortAddr(tx.from, 6, 4)}</td>
                <td className="p-2 text-right font-mono">{tx.value ?? '—'}</td>
                <td className="p-2 text-right">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] ${
                    tx.status === 'success' ? 'bg-wr-green/20 text-wr-green' :
                    tx.status === 'failure' ? 'bg-wr-red/20 text-wr-red' :
                    'bg-wr-amber/20 text-wr-amber'
                  }`}>
                    {tx.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Leaderboard Table (unchanged) ─────────────────────────────────────────

function HLLeaderTable() {
  const { entries, isFirstLoad, error } = useHLLeaderboard();

  if (isFirstLoad) {
    return <div className="p-8 text-center text-wr-muted animate-pulse">Loading leaderboard...</div>;
  }
  if (error) {
    return <div className="p-8 text-center text-wr-red">⚠ {error.message}</div>;
  }
  if (entries.length === 0) {
    return <div className="p-8 text-center text-wr-muted">No leaderboard data</div>;
  }

  const fmtUsd = (n: number) => {
    if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
    if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
    return `$${n.toFixed(0)}`;
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-wr-muted border-b border-wr-border">
            <th className="text-left p-2">#</th>
            <th className="text-left p-2">Address</th>
            <th className="text-right p-2">24h Vol</th>
            <th className="text-right p-2">24h PnL</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.rank} className="border-b border-wr-border/50 hover:bg-wr-surface/50">
              <td className="p-2 font-mono">#{e.rank}</td>
              <td className="p-2 font-mono">{shortAddr(e.address)}</td>
              <td className="p-2 text-right font-mono">{fmtUsd(e.volume24h)}</td>
              <td className={`p-2 text-right font-mono ${e.pnl24h >= 0 ? 'text-wr-green' : 'text-wr-red'}`}>
                {e.pnl24h >= 0 ? '+' : ''}{fmtUsd(e.pnl24h)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main Explorer ─────────────────────────────────────────────────────────

interface HLExplorerProps {
  isActive?: boolean;
}

export function HLExplorer({ isActive = true }: HLExplorerProps) {
  const [subTab, setSubTab] = useState<'perps' | 'blocks' | 'txs' | 'wallets' | 'leaderboard'>('perps');

  return (
    <div className="space-y-4">
      {/* Tab bar */}
      <div className="flex gap-1 border-b border-wr-border">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setSubTab(t.id as typeof subTab)}
            className={`px-3 py-2 text-xs font-medium transition-colors ${
              subTab === t.id
                ? 'text-wr-cyan border-b-2 border-wr-cyan'
                : 'text-wr-muted hover:text-wr-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {subTab === 'perps' && <HLPerpsTable />}
      {subTab === 'blocks' && <HLBlockTable />}
      {subTab === 'txs' && <HLTxTable />}
      {subTab === 'wallets' && <HLWalletTracker />}
      {subTab === 'leaderboard' && <HLLeaderTable />}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-wr-muted pt-2 border-t border-wr-border">
        <span>Data via api.hyperliquid.xyz (trading) + hypurrscan.io (explorer)</span>
        <span>⚡ 3s poll · stale-while-revalidate</span>
      </div>
    </div>
  );
}

export { HLBlockTable, HLTxTable };
