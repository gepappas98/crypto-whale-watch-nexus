/* ══ HYPERLIQUID — Manipulation Scanner Panel v2.0 ════════════════════════════
 * Renders HL on-chain alerts + opportunity signals.
 * Now includes integrated HLOpportunityPanel for perps profit opportunities.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useState, useCallback, useRef } from 'react';
import { useHLManipulationScanner } from '@/hooks/useHLManipulationScanner';
import { useHLBlocks, useHLTxs, useAgeMsLive } from '@/hooks/useHyperliquid';
import { HLOpportunityPanel } from './HLOpportunityPanel';
import type { AlertItem } from '@/lib/whaleRadarState';
import { Zap, Shield, TrendingUp, ChevronDown, ChevronUp, Settings, BarChart3, Bell } from 'lucide-react';

const MAX_HL_ALERTS = 50;

// ── Alert row ─────────────────────────────────────────────────────────────────

function HLAlertRow({ alert, onPin }: { alert: AlertItem & { pinned: boolean }; onPin: () => void }) {
  const levelColor = {
    critical: 'border-l-wr-red bg-wr-red/[.04] text-wr-red',
    high: 'border-l-wr-amber bg-wr-amber/[.03] text-wr-amber',
    medium: 'border-l-wr-cyan text-wr-cyan',
    info: 'border-l-wr-muted text-wr-muted',
  }[alert.level];

  const tcColor = {
    C: 'bg-wr-red/20 text-wr-red',
    H: 'bg-wr-amber/20 text-wr-amber',
    M: 'bg-wr-cyan/10 text-wr-cyan',
    I: 'bg-wr-green-ghost text-wr-green-dim',
  }[alert.tc] ?? 'bg-wr-border/30 text-wr-muted';

  return (
    <div className={`flex items-start gap-2 px-3 py-2 border-l-2 text-[10px] ${levelColor} hover:bg-wr-bg3/40 transition-colors`}>
      <button
        onClick={onPin}
        className={`mt-0.5 shrink-0 ${alert.pinned ? 'text-wr-amber' : 'text-wr-muted/30 hover:text-wr-muted'}`}
        title={alert.pinned ? 'Unpin' : 'Pin'}
      >
        <Zap className="w-3 h-3" />
      </button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[9px] text-wr-muted font-mono">{new Date(alert.ts).toLocaleTimeString()}</span>
          <span className={`px-1 py-0 rounded text-[8px] font-bold ${tcColor}`}>{alert.tc}</span>
          <span className="font-bold">{alert.tag}</span>
        </div>
        <div className="text-wr-white/90 leading-tight">{alert.text}</div>
      </div>
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
    <div className="flex items-center justify-between px-3 py-1.5 border-b border-wr-border/40 bg-wr-bg3/20 text-[9px] text-wr-muted font-mono">
      <div className="flex items-center gap-4">
        <span>BLOCK: <span className="text-wr-white">#{latestBlock?.height?.toLocaleString() ?? '—'}</span></span>
        <span>TXS/BLK: <span className="text-wr-white">{avgBlockTx}</span></span>
        <span>RECENT TXS: <span className="text-wr-white">{totalTxs}</span></span>
      </div>
      {serverTs && (
        <div className="flex items-center gap-1">
          <span>{cached ? '⚡' : '✓'}</span>
          <span>{liveAge < 1000 ? `${liveAge}ms` : `${(liveAge / 1000).toFixed(1)}s`} ago</span>
        </div>
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
  showOpportunities?: boolean;
  minApy?: number;
}

export function HLManipulationScanner({
  onGlobalAlert,
  enabled = true,
  megaTxUsd,
  collapsed: initialCollapsed = false,
  showOpportunities = true,
  minApy = 12,
}: HLManipulationScannerProps) {
  const [hlAlerts, setHlAlerts] = useState<(AlertItem & { pinned: boolean })[]>([]);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [filter, setFilter] = useState<'ALL' | 'C' | 'H' | 'M'>('ALL');
  const [activeTab, setActiveTab] = useState<'alerts' | 'opportunities'>('opportunities');
  const [showSettings, setShowSettings] = useState(false);
  const [hlMegaTxUsd, setHlMegaTxUsd] = useState(megaTxUsd ?? 300_000);
  const [hlMinApy, setHlMinApy] = useState(minApy);
  const seenKeys = useRef<Set<string>>(new Set());

  const handleAlert = useCallback(
    (alert: AlertItem) => {
      const key = `${alert.tc}-${alert.tag}-${alert.text.slice(0, 30)}`;
      if (seenKeys.current.has(key)) return;
      seenKeys.current.add(key);
      if (seenKeys.current.size > 200) {
        seenKeys.current = new Set([...seenKeys.current].slice(-100));
      }

      const pinnable = { ...alert, pinned: false };
      setHlAlerts((prev) => [pinnable, ...prev].slice(0, MAX_HL_ALERTS));
      onGlobalAlert?.(alert);
    },
    [onGlobalAlert],
  );

  const { opportunities } = useHLManipulationScanner({
    enabled,
    megaTxUsd: hlMegaTxUsd,
    onAlert: handleAlert,
    minApy: hlMinApy,
  });

  const togglePin = useCallback((idx: number) => {
    setHlAlerts((prev) => prev.map((a, i) => (i === idx ? { ...a, pinned: !a.pinned } : a)));
  }, []);

  const filtered = hlAlerts.filter((a) => filter === 'ALL' || a.tc === filter);
  const counts = {
    C: hlAlerts.filter((a) => a.tc === 'C').length,
    H: hlAlerts.filter((a) => a.tc === 'H').length,
    M: hlAlerts.filter((a) => a.tc === 'M').length,
  };

  return (
    <div className="flex flex-col h-full border border-wr-border bg-wr-bg2 rounded-sm">
      {/* Header */}
      <div className="wr-panel-header flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <Shield className="w-4 h-4 text-wr-cyan" />
          <span className="wr-panel-title text-[11px] font-bold tracking-wide">
            HYPERLIQUID SCANNER
          </span>
          {counts.C > 0 && (
            <span className="px-1.5 py-0 rounded bg-wr-red/20 text-wr-red text-[9px] font-bold">
              {counts.C} CRIT
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="p-1 rounded hover:bg-wr-bg3 transition-colors"
            title="Settings"
          >
            <Settings className="w-3 h-3 text-wr-muted" />
          </button>
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="p-1 rounded hover:bg-wr-bg3 transition-colors"
          >
            {collapsed ? <ChevronDown className="w-3 h-3 text-wr-muted" /> : <ChevronUp className="w-3 h-3 text-wr-muted" />}
          </button>
        </div>
      </div>

      {/* Settings panel */}
      {showSettings && !collapsed && (
        <div className="px-3 py-2 border-b border-wr-border/40 bg-wr-bg3/30">
          <div className="flex items-center gap-3 text-[10px]">
            <label className="text-wr-muted">Mega TX:</label>
            <select
              value={hlMegaTxUsd}
              onChange={(e) => setHlMegaTxUsd(Number(e.target.value))}
              className="bg-wr-bg2 border border-wr-border rounded px-2 py-1 text-wr-white text-[10px]"
            >
              <option value={100_000}>$100K</option>
              <option value={300_000}>$300K</option>
              <option value={500_000}>$500K</option>
              <option value={1_000_000}>$1M</option>
            </select>
            <label className="text-wr-muted ml-2">Min APY:</label>
            <select
              value={hlMinApy}
              onChange={(e) => setHlMinApy(Number(e.target.value))}
              className="bg-wr-bg2 border border-wr-border rounded px-2 py-1 text-wr-white text-[10px]"
            >
              <option value={5}>5%</option>
              <option value={12}>12%</option>
              <option value={25}>25%</option>
              <option value={50}>50%</option>
            </select>
          </div>
        </div>
      )}

      {/* Tab bar */}
      {!collapsed && showOpportunities && (
        <div className="flex items-center border-b border-wr-border/40">
          <button
            onClick={() => setActiveTab('opportunities')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold transition-colors ${
              activeTab === 'opportunities'
                ? 'text-wr-amber border-b-2 border-wr-amber bg-wr-amber/5'
                : 'text-wr-muted hover:text-wr-white'
            }`}
          >
            <TrendingUp className="w-3 h-3" />
            OPPORTUNITIES
            {opportunities.length > 0 && (
              <span className="ml-1 px-1 rounded bg-wr-amber/20 text-wr-amber text-[8px]">
                {opportunities.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('alerts')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold transition-colors ${
              activeTab === 'alerts'
                ? 'text-wr-cyan border-b-2 border-wr-cyan bg-wr-cyan/5'
                : 'text-wr-muted hover:text-wr-white'
            }`}
          >
            <Bell className="w-3 h-3" />
            ALERTS
            {hlAlerts.length > 0 && (
              <span className="ml-1 px-1 rounded bg-wr-cyan/20 text-wr-cyan text-[8px]">
                {hlAlerts.length}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Content */}
      {!collapsed && (
        <>
          {activeTab === 'opportunities' && showOpportunities ? (
            <HLOpportunityPanel
              enabled={enabled}
              minApy={hlMinApy}
              maxSignals={12}
            />
          ) : (
            <>
              {/* Live stats */}
              <HLStatsBar />

              {/* Filter tabs */}
              <div className="flex items-center gap-1 px-3 py-1 border-b border-wr-border/40">
                {(['ALL', 'C', 'H', 'M'] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFilter(f)}
                    className={`px-2 py-0.5 rounded text-[9px] font-mono transition-colors ${
                      filter === f
                        ? 'bg-wr-cyan/20 text-wr-cyan'
                        : 'text-wr-muted hover:text-wr-white'
                    }`}
                  >
                    {f === 'ALL' ? 'ALL' : `${f} (${counts[f as keyof typeof counts]})`}
                  </button>
                ))}
                {hlAlerts.length > 0 && (
                  <button
                    onClick={() => setHlAlerts([])}
                    className="ml-auto text-[9px] text-wr-muted hover:text-wr-red transition-colors"
                  >
                    Clear
                  </button>
                )}
              </div>

              {/* Alert list */}
              <div className="flex-1 overflow-auto scrollbar-thin">
                {filtered.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-32 text-wr-muted text-[10px]">
                    <BarChart3 className="w-5 h-5 mb-2 opacity-30" />
                    {enabled
                      ? 'Monitoring Hyperliquid on-chain activity…'
                      : 'Scanner disabled — enable in settings'}
                  </div>
                ) : (
                  filtered.map((a, i) => (
                    <HLAlertRow
                      key={`${a.ts}-${i}`}
                      alert={a}
                      onPin={() => togglePin(hlAlerts.indexOf(a))}
                    />
                  ))
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
