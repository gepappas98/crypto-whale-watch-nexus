/* ══ HYPERLIQUID — Manipulation Scanner Panel ════════════════════════════════
 *  Renders HL on-chain alerts produced by useHLManipulationScanner.
 *  Designed to slot into WRScanner below the main coin table.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useState, useCallback, useRef } from 'react';
import { useHLManipulationScanner } from '@/hooks/useHLManipulationScanner';
import { useHLBlocks, useHLTxs, useAgeMsLive } from '@/hooks/useHyperliquid';
import type { AlertItem } from '@/lib/whaleRadarState';

const MAX_HL_ALERTS = 50;

// ── Alert row ─────────────────────────────────────────────────────────────────

function HLAlertRow({ alert, onPin }: { alert: AlertItem & { pinned: boolean }; onPin: () => void }) {
  const levelColor = {
    critical: 'border-l-wr-red bg-wr-red/[.04] text-wr-red',
    high:     'border-l-wr-amber bg-wr-amber/[.03] text-wr-amber',
    medium:   'border-l-wr-cyan text-wr-cyan',
    info:     'border-l-wr-muted text-wr-muted',
  }[alert.level];

  const tcColor = {
    C: 'bg-wr-red/20 text-wr-red',
    H: 'bg-wr-amber/20 text-wr-amber',
    M: 'bg-wr-cyan/10 text-wr-cyan',
    I: 'bg-wr-green-ghost text-wr-green-dim',
  }[alert.tc] ?? 'bg-wr-border/30 text-wr-muted';

  return (
    <div
      className={`px-3 py-2 border-b border-wr-border/40 border-l-2 relative animate-slide-in text-[8px]
        ${levelColor}
        ${alert.pinned ? '!border-l-wr-gold !bg-wr-gold/[.03]' : ''}`}
    >
      <button
        className={`absolute right-1.5 top-1 text-[9px] cursor-pointer bg-transparent border-none
          ${alert.pinned ? 'text-wr-gold opacity-90' : 'text-wr-gold opacity-20 hover:opacity-80'}`}
        onClick={onPin}
        title={alert.pinned ? 'Unpin' : 'Pin'}
      >
        {alert.pinned ? '📌' : '📍'}
      </button>
      <span className="text-[7px] text-wr-muted block mb-0.5">
        {new Date(alert.ts).toLocaleTimeString()}
      </span>
      <span>
        <span className={`inline-block text-[6px] px-1 mr-1 rounded-sm font-mono ${tcColor}`}>
          {alert.tc}
        </span>
        <strong className="text-wr-white">{alert.tag}</strong>
        <span className="text-wr-white/70 ml-1">{alert.text}</span>
      </span>
    </div>
  );
}

// ── Stats bar ─────────────────────────────────────────────────────────────────

function HLStatsBar() {
  const { blocks, age_ms, cached } = useHLBlocks();
  const { txs } = useHLTxs();
  const serverTs = age_ms !== undefined ? Date.now() - age_ms : undefined;
  const liveAge = useAgeMsLive(serverTs);

  const latestBlock = blocks[0];
  const totalTxs = txs.length;
  const avgBlockTx =
    blocks.length > 0
      ? Math.round(blocks.slice(0, 10).reduce((s, b) => s + b.txCount, 0) / Math.min(10, blocks.length))
      : 0;

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 bg-wr-bg3 border-b border-wr-border text-[7px] font-mono">
      <span className="flex items-center gap-1">
        <span className="w-1 h-1 rounded-full bg-wr-cyan animate-blink inline-block" />
        <span className="text-wr-muted">BLOCK:</span>
        <span className="text-wr-cyan">#{latestBlock?.height?.toLocaleString() ?? '—'}</span>
      </span>
      <span>
        <span className="text-wr-muted">TXS/BLK:</span>
        <span className="text-wr-white ml-1">{avgBlockTx}</span>
      </span>
      <span>
        <span className="text-wr-muted">RECENT TXS:</span>
        <span className="text-wr-white ml-1">{totalTxs}</span>
      </span>
      <div className="flex-1" />
      {serverTs && (
        <span className={`text-[6px] tracking-widest ${cached ? 'text-wr-cyan/60' : 'text-wr-green/60'}`}>
          {cached ? '⚡' : '✓'} {liveAge < 1000 ? `${liveAge}ms` : `${(liveAge / 1000).toFixed(1)}s`} ago
        </span>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface HLManipulationScannerProps {
  /** Called when new HL alerts should also appear in the global alert feed */
  onGlobalAlert?: (alert: AlertItem) => void;
  enabled?: boolean;
  megaTxUsd?: number;
  collapsed?: boolean;
}

export function HLManipulationScanner({
  onGlobalAlert,
  enabled = true,
  megaTxUsd,
  collapsed: initialCollapsed = false,
}: HLManipulationScannerProps) {
  const [hlAlerts, setHlAlerts] = useState<(AlertItem & { pinned: boolean })[]>([]);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [filter, setFilter] = useState<'ALL' | 'C' | 'H' | 'M'>('ALL');
  const seenKeys = useRef<Set<string>>(new Set());

  const handleAlert = useCallback(
    (alert: AlertItem) => {
      // Dedup by tag+text fingerprint to prevent duplicate rows during re-renders
      const key = `${alert.tc}-${alert.tag}-${alert.text.slice(0, 30)}`;
      if (seenKeys.current.has(key)) return;
      seenKeys.current.add(key);
      // Trim the set to avoid unbounded growth
      if (seenKeys.current.size > 200) {
        seenKeys.current = new Set([...seenKeys.current].slice(-100));
      }

      const pinnable = { ...alert, pinned: false };
      setHlAlerts(prev => [pinnable, ...prev].slice(0, MAX_HL_ALERTS));
      onGlobalAlert?.(alert);
    },
    [onGlobalAlert],
  );

  useHLManipulationScanner({ enabled, megaTxUsd, onAlert: handleAlert });

  const togglePin = useCallback((idx: number) => {
    setHlAlerts(prev => prev.map((a, i) => i === idx ? { ...a, pinned: !a.pinned } : a));
  }, []);

  const filtered = hlAlerts.filter(a => filter === 'ALL' || a.tc === filter);
  const counts = {
    C: hlAlerts.filter(a => a.tc === 'C').length,
    H: hlAlerts.filter(a => a.tc === 'H').length,
    M: hlAlerts.filter(a => a.tc === 'M').length,
  };

  return (
    <div className="border-t border-wr-border bg-wr-bg">

      {/* Header */}
      <button
        className="w-full flex items-center gap-2 px-3 py-1.5 wr-panel-header cursor-pointer hover:bg-wr-bg3 transition-colors text-left"
        onClick={() => setCollapsed(p => !p)}
      >
        <span className="wr-panel-title text-wr-cyan flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full inline-block ${enabled ? 'bg-wr-cyan animate-blink' : 'bg-wr-muted'}`} />
          🔗 HL ON-CHAIN SCANNER
        </span>
        <span className="flex items-center gap-1 ml-1">
          {counts.C > 0 && <span className="text-[7px] px-1 bg-wr-red/20 text-wr-red rounded font-mono">{counts.C}C</span>}
          {counts.H > 0 && <span className="text-[7px] px-1 bg-wr-amber/20 text-wr-amber rounded font-mono">{counts.H}H</span>}
          {counts.M > 0 && <span className="text-[7px] px-1 bg-wr-cyan/10 text-wr-cyan rounded font-mono">{counts.M}M</span>}
        </span>
        <div className="flex-1" />
        <span className="text-[8px] text-wr-muted font-mono">{collapsed ? '▼' : '▲'}</span>
      </button>

      {!collapsed && (
        <>
          {/* Live stats */}
          <HLStatsBar />

          {/* Filter tabs */}
          <div className="flex border-b border-wr-border px-2 py-1 gap-1">
            {(['ALL', 'C', 'H', 'M'] as const).map(f => (
              <button
                key={f}
                className={`text-[7px] px-1.5 py-0.5 border cursor-pointer font-mono tracking-widest transition-all
                  ${filter === f
                    ? 'bg-wr-cyan/10 border-wr-cyan text-wr-cyan'
                    : 'border-wr-border text-wr-muted hover:border-wr-cyan/40'}`}
                onClick={() => setFilter(f)}
              >
                {f === 'ALL' ? 'ALL' : f === 'C' ? '🔴 CRIT' : f === 'H' ? '🟡 HIGH' : '🔵 MED'}
              </button>
            ))}
            <div className="flex-1" />
            {hlAlerts.length > 0 && (
              <button
                className="text-[7px] text-wr-muted/60 hover:text-wr-muted font-mono border border-transparent hover:border-wr-border px-1.5 cursor-pointer transition-colors"
                onClick={() => { setHlAlerts([]); seenKeys.current.clear(); }}
                title="Clear alerts"
              >
                CLR
              </button>
            )}
          </div>

          {/* Alert list */}
          <div className="max-h-44 overflow-y-auto scrollbar-thin">
            {filtered.length === 0 ? (
              <div className="text-center text-wr-muted text-[9px] py-5 tracking-widest">
                {enabled
                  ? 'Monitoring Hyperliquid on-chain activity…'
                  : 'Scanner disabled — enable in settings'}
              </div>
            ) : (
              filtered.map((a, i) => (
                <HLAlertRow key={i} alert={a} onPin={() => togglePin(hlAlerts.indexOf(a))} />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}
