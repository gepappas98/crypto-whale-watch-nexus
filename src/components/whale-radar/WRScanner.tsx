/* ══ WHALE RADAR v9 — SCANNER TABLE ══════════════════════════════════════════
 *
 * FIXES v1.4 (TABLE RENDERING BUG FIX):
 * - Added `isolation: isolate` to table container to prevent z-index overlay masking
 * - Added explicit `min-height` and `visibility: visible` on tbody tr
 * - Fixed React key generation to prevent duplicate key warnings
 * - Added comprehensive null-checks on all coin fields before rendering
 * - Wrapped getCeoSignal and hlOpps.match in try-catch blocks
 * - Added coin validation with isValidCoin() function
 * - Added development-mode debug logging for data shape issues
 * - Fixed pagination logic edge cases
 *
 * FIXES v1.3:
 * - Added defensive null-checks for all coin fields before rendering
 * - Wrapped getCeoSignal in try-catch to prevent render crashes
 * - Added fallback keys when c.id is missing (uses c.symbol + index)
 *
 * FIXES v1.2:
 * - getCeoSignal() BUG-004: Decoupled WASH/bad-data AVOID from legitimate
 * CRITICAL signals.
 *
 * ════════════════════════════════════════════════════════════════════════════ */

import { useState, useCallback, useMemo } from 'react';
import { CoinData, TrackedToken, PortfolioEntry, fmtN, fmtP, calcSizing } from '@/lib/whaleRadarState';
import { analyzeToken } from '@/lib/analyzeToken';
import type { AlertItem } from '@/lib/whaleRadarState';
import { WRAdvancedFilters, type WhaleFilters } from './WRAdvancedFilters';
import { HLManipulationScanner } from '@/components/hyperliquid/HLManipulationScanner';
import { useHLOpportunities } from '@/hooks/useHLOpportunities';
import type { HLOppSignal } from '@/hooks/useHLOpportunities';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { getModel, predictConfidence } from '@/lib/mlScoring';
import { computeSymbolPerformance, type SymbolPerformance } from '@/lib/nexus/pairPerformance';

// ── HL opportunity badge config (per opportunityType) ────────────────────────
const HL_OPP_META: Record<string, { label: string; cls: string; title: string }> = {
  funding_arb: { label: 'FUND', cls: 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10', title: 'Funding arbitrage' },
  basis_trade: { label: 'BASIS', cls: 'text-blue-400 border-blue-400/40 bg-blue-400/10', title: 'Basis trade (delta-neutral)' },
  squeeze_short: { label: 'SQZ-S', cls: 'text-red-400 border-red-400/40 bg-red-400/10', title: 'Short squeeze candidate' },
  squeeze_long: { label: 'SQZ-L', cls: 'text-amber-400 border-amber-400/40 bg-amber-400/10', title: 'Long squeeze candidate' },
  whale_impact: { label: 'WHALE', cls: 'text-purple-400 border-purple-400/40 bg-purple-400/10', title: 'Whale impact (illiquid + volume)' },
  liq_cluster: { label: 'LIQ', cls: 'text-rose-400 border-rose-400/40 bg-rose-400/10', title: 'Liquidation cluster' },
  order_imb: { label: 'IMB', cls: 'text-cyan-400 border-cyan-400/40 bg-cyan-400/10', title: 'Order book imbalance' },
  vol_skew: { label: 'SKEW', cls: 'text-orange-400 border-orange-400/40 bg-orange-400/10', title: 'Volatility skew' },
};

// ── Stat tile for HL drawer ─────────────────────────────────────────────────
function Stat({ label, value, accent }: { label: string; value: string; accent?: 'amber' | 'green' | 'cyan' | 'red' | 'muted' }) {
  const cls =
    accent === 'amber' ? 'text-wr-amber'
    : accent === 'green' ? 'text-wr-green-dim'
    : accent === 'cyan' ? 'text-wr-cyan'
    : accent === 'red' ? 'text-wr-red'
    : 'text-wr-white';
  return (
    <div className="border border-wr-border rounded p-2 bg-wr-bg3/40">
      <div className="text-wr-muted text-[9px] uppercase tracking-wide">{label}</div>
      <div className={`font-mono font-bold text-[12px] ${cls}`}>{value}</div>
    </div>
  );
}

// ══ CEO SIGNAL ENGINE v1.2 ════════════════════════════════════════════════════
function getCeoSignal(score: number, threat: string, category: string | null, vmcap: number): { label: string; mark: string; cls: string } {
  try {
    const t = (threat || '').toUpperCase();
    const cat = (category || '').toUpperCase();
    const sc = typeof score === 'number' && !isNaN(score) ? score : 0;
    const vm = typeof vmcap === 'number' && !isNaN(vmcap) ? vmcap : 0;

    // 1. Wash trade or unreliable vmcap
    if (vm > 1000 || cat.includes('WASH')) {
      return { label: 'AVOID / SHORT', mark: '✕✕✕', cls: 'text-wr-red border-wr-red/40 bg-wr-red/5' };
    }

    // 2. Legitimate CRITICAL pump / squeeze
    if (t === 'CRITICAL' && (cat.includes('PUMP') || cat.includes('SQUEEZE'))) {
      return { label: 'AGGRESSIVE LONG', mark: '★★★★★', cls: 'text-wr-amber border-wr-amber/60 bg-wr-amber/10' };
    }

    // 3. Extreme score with no positive pattern
    if (sc >= 88) {
      return { label: 'AVOID / SHORT', mark: '✕✕✕', cls: 'text-wr-red border-wr-red/40 bg-wr-red/5' };
    }

    // 4. CRITICAL alone
    if (t === 'CRITICAL') {
      return { label: 'AVOID / SHORT', mark: '✕✕✕', cls: 'text-wr-red border-wr-red/40 bg-wr-red/5' };
    }

    // 5. HIGH threat pump/squeeze
    if (sc >= 70 && (cat.includes('PUMP') || cat.includes('SQUEEZE'))) {
      return { label: 'AGGRESSIVE LONG', mark: '★★★★★', cls: 'text-wr-amber border-wr-amber/60 bg-wr-amber/10' };
    }

    // 6. Moderate signals
    if (sc >= 60 && (cat.includes('PUMP') || cat.includes('SQUEEZE') || vm > 300)) {
      return { label: 'LONG (tight stop)', mark: '★★★★', cls: 'text-wr-amber border-wr-amber/40 bg-wr-amber/5' };
    }
    if (sc >= 45) {
      return { label: 'LONG', mark: '★★★', cls: 'text-wr-amber border-wr-amber/30 bg-transparent' };
    }
    if (sc >= 35) {
      return { label: 'WATCH', mark: '★★', cls: 'text-wr-muted border-wr-border bg-transparent' };
    }
    return { label: 'HOLD', mark: '★', cls: 'text-wr-muted border-wr-border bg-transparent' };
  } catch (e) {
    console.error('[WRScanner] getCeoSignal error:', e);
    return { label: 'ERROR', mark: '?', cls: 'text-wr-red border-wr-red/40 bg-wr-red/5' };
  }
}

// ── Validate coin data ──────────────────────────────────────────────────────
function isValidCoin(c: unknown): c is CoinData {
  if (!c || typeof c !== 'object') return false;
  const coin = c as Record<string, unknown>;
  return (
    typeof coin.symbol === 'string' &&
    coin.symbol.length > 0 &&
    typeof coin.price === 'number' &&
    !isNaN(coin.price) &&
    typeof coin.score === 'number' &&
    !isNaN(coin.score)
  );
}

// ── Generate stable unique key for coin row ─────────────────────────────────
function getCoinKey(c: CoinData, index: number): string {
  if (c.id && typeof c.id === 'string' && c.id.length > 0) {
    return c.id;
  }
  // Fallback: symbol + index to ensure uniqueness
  return `${c.symbol}-idx-${index}`;
}

interface WRScannerProps {
  coins: CoinData[];
  scanBadge: string;
  scanning: boolean;
  autoScan: boolean;
  autoPaused: boolean;
  watchlistOnly: boolean;
  tracked: Record<string, TrackedToken>;
  portfolio: Record<string, PortfolioEntry>;
  aiKey: string;
  vmcapThr: number;
  pchgThr: number;
  onScan: () => void;
  onToggleAuto: () => void;
  onTogglePause: () => void;
  onToggleWatchlist: () => void;
  onTrack: (id: string, symbol: string, price: number) => void;
  onUntrack: (symbol: string) => void;
  onVmcapChange: (v: number) => void;
  onPchgChange: (v: number) => void;
  onOpenModal: (m: string) => void;
  onAddAlert: (level: AlertItem['level'], tag: string, text: string) => void;
  advancedFilters: WhaleFilters;
  onAdvancedFiltersChange: (f: WhaleFilters) => void;
  page: number;
  onPageChange: (p: number) => void;
  hlScannerEnabled?: boolean;
  hlMegaTxUsd?: number;
  councilEnabled?: boolean;
  onLaunchCouncil?: (coin: CoinData) => void;
}

interface AiRowData {
  symbol: string;
  text: string;
  loading: boolean;
}

export function WRScanner({
  coins,
  scanBadge,
  scanning,
  autoScan,
  autoPaused,
  watchlistOnly,
  tracked,
  portfolio,
  aiKey,
  vmcapThr,
  pchgThr,
  onScan,
  onToggleAuto,
  onTogglePause,
  onToggleWatchlist,
  onTrack,
  onUntrack,
  onVmcapChange,
  onPchgChange,
  onOpenModal,
  onAddAlert,
  advancedFilters,
  onAdvancedFiltersChange,
  page,
  onPageChange,
  hlScannerEnabled = true,
  hlMegaTxUsd,
  councilEnabled = true,
  onLaunchCouncil,
}: WRScannerProps) {
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<string>('score');
  const [sortDir, setSortDir] = useState(-1);
  const [aiRows, setAiRows] = useState<Record<string, AiRowData>>({});
  const [showAdvFilters, setShowAdvFilters] = useState(false);
  const [hlOnly, setHlOnly] = useState(false);
  const [hlDrawer, setHlDrawer] = useState<{ symbol: string; opp: HLOppSignal; meta: typeof HL_OPP_META[string] } | null>(null);

  // ── HL perps opportunity overlay ──────────────────────────────────────────
  const hlOpps = useHLOpportunities({ enabled: hlScannerEnabled, minApy: 12 });

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir((d) => -d);
    else {
      setSortKey(key);
      setSortDir(-1);
    }
  };

  const removeAiRow = useCallback((sym: string) => {
    setAiRows((prev) => {
      const next = { ...prev };
      delete next[sym];
      return next;
    });
  }, []);

  const handleAiAnalyze = useCallback(
    async (coin: CoinData) => {
      if (!aiKey) {
        onAddAlert('info', 'AI', 'Enter Anthropic API key in ⚙ Settings');
        return;
      }
      setAiRows((prev) => ({ ...prev, [coin.symbol]: { symbol: coin.symbol, text: '', loading: true } }));
      try {
        const text = await analyzeToken(coin, aiKey);
        setAiRows((prev) => ({
          ...prev,
          [coin.symbol]: { symbol: coin.symbol, text: text || 'No response', loading: false },
        }));
      } catch (e) {
        setAiRows((prev) => ({
          ...prev,
          [coin.symbol]: { symbol: coin.symbol, text: 'AI analysis failed', loading: false },
        }));
      }
    },
    [aiKey, onAddAlert]
  );

  // ── Filter & sort with validation ────────────────────────────────────────
  const filtered = useMemo(() => {
    // Validate input array
    if (!Array.isArray(coins)) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[WRScanner] coins is not an array:', typeof coins);
      }
      return [];
    }

    // Filter out invalid coins
    const validCoins = coins.filter(isValidCoin);

    if (validCoins.length === 0) {
      if (process.env.NODE_ENV === 'development' && coins.length > 0) {
        console.warn('[WRScanner] No valid coins after validation. Sample coin:', coins[0]);
      }
      return [];
    }

    const searchUpper = search.toUpperCase();
    const searchLower = search.toLowerCase();

    return validCoins
      .filter((c) => {
        if (hlOnly && !hlOpps.bySymbol.has(c.symbol.toUpperCase())) return false;
        if (!search) return true;
        const symbolMatch = c.symbol.includes(searchUpper);
        const nameMatch = c.name ? c.name.toLowerCase().includes(searchLower) : false;
        return symbolMatch || nameMatch;
      })
      .sort((a, b) => {
        const av = (a as unknown as Record<string, unknown>)[sortKey];
        const bv = (b as unknown as Record<string, unknown>)[sortKey];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
        if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * sortDir;
        return 0;
      });
  }, [coins, search, sortKey, sortDir, hlOnly, hlOpps.bySymbol]);

  const PAGE_SIZE = 20;
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(Math.max(1, page), totalPages);

  const paginatedCoins = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;
    return filtered.slice(start, end);
  }, [filtered, currentPage]);

  // ── ML confidence + symbol performance — computed once per scan, not per row ──
  // predictConfidence() itself is cheap (a dot product), but getModel()/
  // computeSymbolPerformance() each read + aggregate localStorage; memoizing
  // on `coins` (which changes once per scan) keeps a page of 20 rows from
  // re-doing that work 20 times per render.
  const mlModel = useMemo(() => getModel(), [coins]);
  const perfBySymbol = useMemo(() => {
    const perf = computeSymbolPerformance();
    return new Map(perf.map((p) => [p.symbol, p]));
  }, [coins]);



  const badgeCls =
    scanBadge === 'LIVE'
      ? 'text-wr-green border-wr-green-dim bg-wr-green-ghost'
      : scanBadge === 'SCANNING'
        ? 'text-wr-cyan border-wr-cyan/30'
        : scanBadge === 'ERROR' || scanBadge === 'RATE LIMITED'
          ? 'text-wr-red border-wr-red/30'
          : 'text-wr-muted border-wr-border';

  return (
    <section className="border border-wr-border bg-wr-bg2 flex-1 flex flex-col overflow-hidden relative z-10" style={{ isolation: 'isolate' }}>
      {/* Header */}
      <header className="wr-panel-header">
        <h2 className="wr-panel-title">⬡ MANIPULATION SCANNER v9 — TOP 250</h2>
        <span className={`wr-badge ${badgeCls}`}>
          {scanBadge}
        </span>
      </header>

      {/* Controls */}
      <div className="quick-actions">
        <button className={`wr-btn ${scanning ? 'animate-ai-pulse' : ''}`} onClick={onScan} disabled={scanning}>
          {scanning ? <span className="animate-spin-fast inline-block">⟳</span> : '▶'} SCAN
        </button>
        <button className={`wr-btn ${autoScan ? 'active' : ''}`} onClick={onToggleAuto}>
          AUTO: {autoScan ? 'ON' : 'OFF'}
        </button>
        {autoScan && (
          <button className={`wr-btn ${autoPaused ? 'amber' : ''}`} onClick={onTogglePause}>
            {autoPaused ? '▶ RESUME' : '⏸ PAUSE'}
          </button>
        )}
        <button className={`wr-btn gold ${watchlistOnly ? 'active' : ''}`} onClick={onToggleWatchlist}>
          ☆ WL
        </button>
        <button className="wr-btn blue" onClick={() => onOpenModal('backtest')} title="Backtest [B]">
          📊 BT <span className="pro-badge">PRO</span>
        </button>
        <button className="wr-btn blue" onClick={() => onOpenModal('portfolio')} title="Portfolio [P]">
          💼 PTF <span className="pro-badge">PRO</span>
        </button>
        <button className="wr-btn ai" onClick={() => onOpenModal('sentiment')} title="AI Sentiment">
          ✦ SENT <span className="pro-badge">PRO</span>
        </button>
        <button
          className="wr-btn"
          onClick={() => onOpenModal('signal-eval')}
          title="Signal Eval — win rates [E]"
          style={{ borderColor: 'hsl(var(--wr-cyan) / 0.4)', color: 'hsl(var(--wr-cyan))' }}
        >
          📈 EVAL
        </button>
        <button
          className={`wr-btn ${showAdvFilters ? 'active' : ''}`}
          onClick={() => setShowAdvFilters((p) => !p)}
          title="Advanced filters"
        >
          ⚙ FILTERS
        </button>
        <button
          className={`wr-btn ${hlOnly ? 'active' : ''}`}
          onClick={() => { setHlOnly((p) => !p); onPageChange(1); }}
          title="Show only symbols with active Hyperliquid opportunities"
          style={{ borderColor: hlOnly ? 'hsl(var(--wr-amber))' : undefined, color: hlOnly ? 'hsl(var(--wr-amber))' : undefined }}
        >
          ⚡ HL ONLY {hlOpps.all.length > 0 && <span className="ml-1 opacity-70">({hlOpps.all.length})</span>}
        </button>
      </div>

      {/* Search & filters */}
      <div className="quick-actions border-t border-wr-border">
        <input
          type="text"
          className="wr-input"
          placeholder="🔍 Search symbol or name…"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            onPageChange(1);
          }}
        />

        <label className="flex items-center gap-2 text-[9px] text-wr-muted">
          VOL/MCAP≥
          <input
            type="range"
            min={0}
            max={500}
            step={10}
            value={vmcapThr}
            onChange={(e) => onVmcapChange(+e.target.value)}
          />
          <span className="text-wr-green-dim w-8">{vmcapThr}%</span>
        </label>
        <label className="flex items-center gap-2 text-[9px] text-wr-muted">
          24H≥
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={pchgThr}
            onChange={(e) => onPchgChange(+e.target.value)}
          />
          <span className="text-wr-green-dim w-8">{pchgThr}%</span>
        </label>
      </div>

      {showAdvFilters && (
        <div className="p-3 border-t border-wr-border bg-wr-bg3">
          <WRAdvancedFilters filters={advancedFilters} onChange={onAdvancedFiltersChange} />
        </div>
      )}

      {/* Table container with isolation to prevent z-index issues */}
      {/* touch-action: pan-y  → browser knows only vertical scrolling is wanted here,
          so it won't cancel a short tap on a child button thinking it might be a scroll. */}
      <div className="flex-1 overflow-auto scrollbar-thin relative" style={{ isolation: 'isolate', zIndex: 1, touchAction: 'pan-x pan-y', WebkitOverflowScrolling: 'touch' }}>
        <table className="wr-table">
          <thead>
            <tr>
              {[
                { key: 'rank', label: '#' },
                { key: 'symbol', label: 'TOKEN' },
                { key: 'price', label: 'PRICE' },
                { key: 'change', label: '24H%' },
                { key: 'volume', label: '24H VOL' },
                { key: 'mcap', label: 'MKT CAP' },
                { key: 'vmcap', label: 'VOL/MCAP ⚠' },
                { key: 'score', label: 'SCORE' },
                { key: 'threat', label: 'THREAT' },
                { key: 'category', label: 'CATEGORY' },
                { key: '', label: 'ACTIONS' },
                { key: '', label: 'CEO SIGNAL' },
              ].map((col, i) => (
                <th
                  key={col.key || `col-${i}`}
                  onClick={() => col.key && handleSort(col.key)}
                  className={sortKey === col.key ? 'text-wr-amber' : ''}
                >
                  {col.label}
                  {sortKey === col.key && (sortDir > 0 ? ' ▴' : ' ▾')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={12} className="text-center py-16 text-wr-muted">
                  {coins.length === 0 ? 'Click SCAN to begin surveillance' : 'No tokens match current filters'}
                </td>
              </tr>
            ) : (
              paginatedCoins.map((c, rowIdx) => {
                // ── Safety check (should not happen after validation) ────────
                if (!isValidCoin(c)) {
                  if (process.env.NODE_ENV === 'development') {
                    console.warn('[WRScanner] Invalid coin slipped through at index', rowIdx, c);
                  }
                  return null;
                }

                const rowKey = getCoinKey(c, rowIdx + (currentPage - 1) * PAGE_SIZE);
                const siz = calcSizing(c);
                const isTracked = !!tracked[c.symbol];
                const vmcapVal = typeof c.vmcap === 'number' && !isNaN(c.vmcap) ? c.vmcap : 0;
                const vmcapCls =
                  vmcapVal >= 800
                    ? 'text-wr-red'
                    : vmcapVal >= 400
                      ? 'text-wr-amber'
                      : vmcapVal >= 200
                        ? 'text-wr-cyan'
                        : 'text-wr-green-dim';
                const catCls = c.category ? `wr-cat-${c.category.toLowerCase()}` : '';
                const aiRow = aiRows[c.symbol];

                // ML confidence + track record — see mlModel/perfBySymbol memos above.
                // Both are optional/best-effort: null model (not trained yet) or no
                // performance history just means the badge doesn't render for that coin.
                const mlConf = mlModel
                  ? predictConfidence({
                      score: c.score, vmcap: c.vmcap, chg24: c.change, volSpike: c.volSpike,
                      supplyPct: c.supplyPct, mcap: c.mcap, dexHot: c.dexHot, isSol: c.isSol,
                    })
                  : null;
                const perf: SymbolPerformance | undefined = perfBySymbol.get(c.symbol);
                const showPerf = perf && perf.withOutcome >= 3; // lower floor than pairFilters.ts's 5-sample suppression gate — showing a number is lower-stakes than suppressing an alert on it

                // Safe HL opportunity lookup
                let hlOpp: HLOppSignal | undefined = undefined;
                let hlMeta: (typeof HL_OPP_META)[string] | null = null;
                try {
                  hlOpp = hlOpps.match(c.symbol);
                  hlMeta = hlOpp ? HL_OPP_META[hlOpp.opportunityType] : null;
                } catch (e) {
                  if (process.env.NODE_ENV === 'development') {
                    console.warn('[WRScanner] HL opp lookup failed for', c.symbol, e);
                  }
                }

                // BUG-FIX: <tr> does not support box-shadow in most browsers — it is
                // silently ignored. Use a border-left on the first <td> instead.
                const hlIsCritical = hlOpp?.level === 'critical';

                const changeVal = typeof c.change === 'number' && !isNaN(c.change) ? c.change : 0;
                const scoreVal = typeof c.score === 'number' && !isNaN(c.score) ? c.score : 0;
                const volSpikeVal = typeof c.volSpike === 'number' && !isNaN(c.volSpike) ? c.volSpike : 0;
                const confidenceVal = typeof c.confidence === 'number' && !isNaN(c.confidence) ? c.confidence : 0;

                return (
                  <tr
                    key={rowKey}
                    className=""
                    style={{ minHeight: '44px', visibility: 'visible' }}
                  >
                    <td
                      className="text-wr-muted text-[10px]"
                      style={hlIsCritical ? { borderLeft: '3px solid hsl(var(--wr-amber))' } : undefined}
                    >{c.rank || '—'}</td>
                    <td>
                      <div className="flex items-center gap-2">
                        <span className="text-wr-green font-semibold">{c.symbol}</span>
                        {c.isSol && <span className="text-wr-sol text-[8px]">◎</span>}
                        {c.dexHot && <span className="wr-badge bg-wr-blue/10 text-wr-blue border border-wr-blue/30">DEX</span>}
                        {mlConf != null && (
                          <span
                            className={`wr-badge border ${
                              mlConf >= 60
                                ? 'bg-wr-purple/10 text-wr-purple border-wr-purple/30'
                                : 'bg-wr-muted/10 text-wr-muted border-wr-muted/20'
                            }`}
                            title="ML confidence — see WRSignalEval's 'ML Confidence Model' panel for how this is trained and what it means"
                          >
                            🧠{mlConf.toFixed(0)}%
                          </span>
                        )}
                        {showPerf && perf && (
                          <span
                            className={`wr-badge border ${
                              perf.score >= 0
                                ? 'bg-wr-green/10 text-wr-green border-wr-green/30'
                                : 'bg-wr-red/10 text-wr-red border-wr-red/30'
                            }`}
                            title={`${perf.withOutcome} past signals on this symbol, ${perf.winRate ?? '—'}% win rate, ${perf.avgOutcomePct ?? '—'}% avg outcome`}
                          >
                            {perf.winRate ?? 0}%WR
                          </span>
                        )}
                        {hlOpp && hlMeta && (() => {
                          const _opp  = hlOpp!;
                          const _meta = hlMeta!;
                          const _sym  = c.symbol;

                          const openDrawer = (src: string) => {
                            try {
                              const payload = { symbol: _sym, opp: _opp, meta: _meta };
                              if (import.meta.env?.DEV) {
                                // eslint-disable-next-line no-console
                                console.log('[WRScanner] HL badge open', src, _sym);
                              }
                              setHlDrawer(payload);
                              try {
                                onAddAlert(
                                  _opp.level === 'critical' ? 'critical' : _opp.level === 'high' ? 'high' : 'medium',
                                  `HL·${_meta.label}`,
                                  `${_sym} · ${_opp.side} · ${_opp.expectedEdge} · APY ${_opp.apyEstimate.toFixed(1)}%`
                                );
                              } catch (err) {
                                // eslint-disable-next-line no-console
                                console.warn('[WRScanner] onAddAlert failed', err);
                              }
                            } catch (err) {
                              // eslint-disable-next-line no-console
                              console.error('[WRScanner] openDrawer crashed', err);
                            }
                          };

                          return (
                          <button
                            type="button"
                            aria-label={`Open ${_meta.title} details for ${_sym}`}
                            className={`wr-badge border ${_meta.cls} cursor-pointer hover:brightness-125 active:brightness-150 transition relative z-20 select-none`}
                            title={`${_meta.title} — tap for details`}
                            style={{
                              touchAction: 'manipulation',
                              WebkitTapHighlightColor: 'transparent',
                              minHeight: '32px',
                              padding: '4px 8px',
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              openDrawer('click');
                            }}
                          >
                            HL·{_meta.label}
                            {_opp.side !== 'NEUTRAL' && (
                              <span className="ml-1">{_opp.side === 'LONG' ? '↑' : '↓'}</span>
                            )}
                          </button>
                          );
                        })()}
                      </div>
                      <div className="text-wr-muted text-[9px] truncate max-w-[120px]">{c.name || '—'}</div>
                    </td>
                    <td className="text-wr-white">${fmtP(c.price)}</td>
                    <td className={changeVal > 0 ? 'text-wr-green-dim' : changeVal < 0 ? 'text-wr-red' : 'text-wr-muted'}>
                      {changeVal > 0 ? '+' : ''}{changeVal.toFixed(1)}%
                    </td>
                    <td className="text-wr-cyan">${fmtN(c.volume)}</td>
                    <td className="text-wr-white">${fmtN(c.mcap)}</td>
                    <td className={`font-semibold ${vmcapCls}`}>{vmcapVal.toFixed(0)}%</td>
                    <td className={scoreVal >= 70 ? 'text-wr-amber font-bold' : scoreVal >= 50 ? 'text-wr-orange' : 'text-wr-white'}>
                      {scoreVal.toFixed(0)}
                    </td>
                    <td>
                      <span className={`wr-badge ${c.threat === 'CRITICAL' ? 'wr-badge-critical' : c.threat === 'HIGH' ? 'wr-badge-high' : c.threat === 'MEDIUM' ? 'wr-badge-medium' : 'wr-badge-low'}`}>
                        {c.threat || '—'}
                      </span>
                    </td>
                    <td>
                      <span className={`wr-badge border ${catCls}`}>
                        {c.category ? c.category.substring(0, 5).toUpperCase() : '—'}
                      </span>
                    </td>
                    <td>
                      <button
                        className={`text-[10px] px-2 py-1 border ${isTracked ? 'text-wr-green border-wr-green/40 bg-wr-green/5' : 'text-wr-muted border-wr-border'}`}
                        onClick={() =>
                          isTracked
                            ? onUntrack(c.symbol)
                            : onTrack(c.id || c.symbol, c.symbol, c.price)
                        }
                      >
                        {isTracked ? '★' : '☆'}
                      </button>
                      <button
                        className="text-[10px] px-2 py-1 border border-wr-border text-wr-blue ml-1"
                        onClick={() => handleAiAnalyze(c)}
                        title="AI Analysis"
                      >
                        ✦
                      </button>
                      {councilEnabled && onLaunchCouncil && (
                        <button
                          className={`text-[9px] px-2 py-1 border ml-1 ${
                            scoreVal >= 70 || c.threat === 'CRITICAL' || c.threat === 'HIGH'
                              ? 'text-wr-purple border-wr-purple/60 bg-wr-purple/10 animate-pulse'
                              : 'text-wr-muted border-wr-border'
                          }`}
                          onClick={(e) => { e.stopPropagation(); onLaunchCouncil(c); }}
                          title="Launch Agent Council — AI trading desk"
                        >
                          ★AI
                        </button>
                      )}
                    </td>
                    <td>
                      <div className={`wr-badge border ${getCeoSignal(scoreVal, c.threat || '', c.category, vmcapVal).cls}`} title="CEO Signal™">
                        <span className="text-[7px]">{getCeoSignal(scoreVal, c.threat || '', c.category, vmcapVal).mark}</span>
                        <span className="text-[8px] ml-1">{getCeoSignal(scoreVal, c.threat || '', c.category, vmcapVal).label}</span>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="border-t border-wr-border px-4 py-2 bg-wr-bg text-center">
        <div className="text-[9px] text-wr-muted">
          {paginatedCoins.length > 0 && (
            <>
              {filtered.length} TOKENS · PAGE {currentPage}/{totalPages}
              <div className="mt-2 flex justify-center gap-2">
                <button
                  className="wr-btn text-[8px]"
                  onClick={() => onPageChange(Math.max(1, currentPage - 1))}
                  disabled={currentPage === 1}
                >
                  ◀ PREV
                </button>
                <button
                  className="wr-btn text-[8px]"
                  onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
                  disabled={currentPage === totalPages}
                >
                  NEXT ▶
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* AI Analysis Row */}
      {Object.values(aiRows).map((row) => (
        <div key={row.symbol} className="border-t border-wr-border p-3 bg-wr-bg3 text-[10px] text-wr-white">
          <div className="flex justify-between items-start gap-2">
            <div className="flex-1">
              <div className="text-wr-green font-bold mb-2">{row.symbol}</div>
              {row.loading ? (
                <div className="text-wr-muted animate-pulse">Analyzing…</div>
              ) : (
                <div className="text-wr-white">{row.text}</div>
              )}
            </div>
            <button
              className="text-wr-muted hover:text-wr-red text-[12px]"
              onClick={() => removeAiRow(row.symbol)}
            >
              ✕
            </button>
          </div>
        </div>
      ))}

      {/* HL Opportunity Detail Drawer */}
      <Sheet
        open={!!hlDrawer}
        onOpenChange={(o) => {
          if (!o) {
            setHlDrawer(null);
            // Radix Dialog/Sheet sometimes leaves `pointer-events: none` on <body>
            // after close, which freezes the entire page (no scroll, no taps).
            setTimeout(() => {
              document.body.style.pointerEvents = '';
              document.body.style.overflow = '';
            }, 0);
          }
        }}
      >
        <SheetContent
          side="right"
          className="bg-wr-bg2 border-wr-border text-wr-white w-full sm:max-w-md overflow-y-auto"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            document.body.style.pointerEvents = '';
            document.body.style.overflow = '';
          }}
        >
          {hlDrawer && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2 text-wr-white">
                  <span className={`wr-badge border ${hlDrawer.meta.cls}`}>HL·{hlDrawer.meta.label}</span>
                  <span className="text-wr-green font-bold">{hlDrawer.symbol}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${
                    hlDrawer.opp.side === 'LONG' ? 'text-wr-green border-wr-green-dim bg-wr-green-ghost'
                    : hlDrawer.opp.side === 'SHORT' ? 'text-wr-red border-wr-red/40 bg-wr-red/10'
                    : 'text-wr-muted border-wr-border'
                  }`}>{hlDrawer.opp.side}</span>
                </SheetTitle>
                <SheetDescription className="text-wr-muted text-[11px]">
                  {hlDrawer.meta.title}
                </SheetDescription>
              </SheetHeader>

              <div className="mt-4 space-y-4 text-[11px]">
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="Expected Edge" value={hlDrawer.opp.expectedEdge} accent="amber" />
                  <Stat label="APY Estimate" value={`${hlDrawer.opp.apyEstimate.toFixed(1)}%`} accent="green" />
                  <Stat label="Conviction" value={`${hlDrawer.opp.conviction}/100`} accent="cyan" />
                  <Stat label="Risk Score" value={`${hlDrawer.opp.riskScore}/100`} accent={hlDrawer.opp.riskScore > 60 ? 'red' : 'muted'} />
                  <Stat label="Funding" value={`${(hlDrawer.opp.fundingRate * 100).toFixed(4)}%`} />
                  <Stat label="Premium" value={`${(hlDrawer.opp.premium * 100).toFixed(3)}%`} />
                  <Stat label="Open Interest" value={`$${(hlDrawer.opp.openInterest / 1e6).toFixed(2)}M`} />
                  <Stat label="24h Volume" value={`$${(hlDrawer.opp.dailyVolume / 1e6).toFixed(2)}M`} />
                  <Stat label="Mark Price" value={`$${hlDrawer.opp.markPrice.toFixed(4)}`} />
                  <Stat label="Index Price" value={`$${hlDrawer.opp.indexPrice.toFixed(4)}`} />
                </div>

                <div>
                  <div className="text-wr-muted text-[9px] uppercase tracking-wide mb-1">Reason</div>
                  <div className="text-wr-white/90 leading-relaxed border border-wr-border rounded p-2 bg-wr-bg3/40">
                    {hlDrawer.opp.reason}
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    className="wr-btn flex-1"
                    onClick={() => {
                      onAddAlert(
                        hlDrawer.opp.level === 'critical' ? 'critical' : hlDrawer.opp.level === 'high' ? 'high' : 'medium',
                        `HL·${hlDrawer.meta.label}`,
                        `📌 ${hlDrawer.symbol} · ${hlDrawer.opp.side} · ${hlDrawer.opp.expectedEdge}`
                      );
                    }}
                  >
                    🔔 Pin Alert
                  </button>
                  <button className="wr-btn" onClick={() => setHlDrawer(null)}>
                    Close
                  </button>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}
