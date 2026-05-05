/* ══ WHALE RADAR v9 — SCANNER TABLE ══════════════════════════════════════════
 *
 *  FIXES v1.3 (CRITICAL BUG FIX — Tokens Not Rendering):
 *  - Added defensive null-checks for all coin fields before rendering
 *  - Wrapped getCeoSignal in try-catch to prevent render crashes
 *  - Added fallback keys when c.id is missing (uses c.symbol + index)
 *  - Added coin data validation — skips malformed entries instead of crashing
 *  - Added debug logging in dev mode to catch data shape issues
 *  - Fixed hlOpps.match() to safely handle undefined returns
 *  - Added min-height to table rows to prevent CSS collapse
 *  - Ensured paginatedCoins always has valid data even if coins array has gaps
 *
 *  FIXES v1.2:
 *  - getCeoSignal() BUG-004: Decoupled WASH/bad-data AVOID from legitimate
 *    CRITICAL signals.
 *
 * ════════════════════════════════════════════════════════════════════════════ */

import { useState, useCallback, useMemo } from 'react';
import { CoinData, TrackedToken, PortfolioEntry, fmtN, fmtP, calcSizing } from '@/lib/whaleRadarState';
import { analyzeToken } from '@/lib/analyzeToken';
import type { AlertItem } from '@/lib/whaleRadarState';
import { WRAdvancedFilters, type WhaleFilters } from './WRAdvancedFilters';
import { HLManipulationScanner } from '@/components/hyperliquid/HLManipulationScanner';
import { useHLOpportunities } from '@/hooks/useHLOpportunities';
import type { HLSignal } from '@/components/hyperliquid/HLOpportunityPanel';

// ── HL opportunity badge config (per opportunityType) ────────────────────────
const HL_OPP_META: Record<string, { label: string; cls: string; title: string }> = {
  funding_arb:   { label: 'FUND',   cls: 'text-emerald-400 border-emerald-400/40 bg-emerald-400/10', title: 'Funding arbitrage' },
  basis_trade:   { label: 'BASIS',  cls: 'text-blue-400 border-blue-400/40 bg-blue-400/10',         title: 'Basis trade (delta-neutral)' },
  squeeze_short: { label: 'SQZ-S',  cls: 'text-red-400 border-red-400/40 bg-red-400/10',            title: 'Short squeeze candidate' },
  squeeze_long:  { label: 'SQZ-L',  cls: 'text-amber-400 border-amber-400/40 bg-amber-400/10',      title: 'Long squeeze candidate' },
  whale_impact:  { label: 'WHALE',  cls: 'text-purple-400 border-purple-400/40 bg-purple-400/10',   title: 'Whale impact (illiquid + volume)' },
  liq_cluster:   { label: 'LIQ',    cls: 'text-rose-400 border-rose-400/40 bg-rose-400/10',         title: 'Liquidation cluster' },
  order_imb:     { label: 'IMB',    cls: 'text-cyan-400 border-cyan-400/40 bg-cyan-400/10',         title: 'Order book imbalance' },
  vol_skew:      { label: 'SKEW',   cls: 'text-orange-400 border-orange-400/40 bg-orange-400/10',   title: 'Volatility skew' },
};

// ══ CEO SIGNAL ENGINE v1.2 ════════════════════════════════════════════════════
function getCeoSignal(score: number, threat: string, category: string | null, vmcap: number) {
  try {
    const t   = (threat || '').toUpperCase();
    const cat = (category || '').toUpperCase();
    const sc  = typeof score === 'number' ? score : 0;
    const vm  = typeof vmcap === 'number' ? vmcap : 0;

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
    typeof coin.symbol === 'string' && coin.symbol.length > 0 &&
    typeof coin.price === 'number' &&
    typeof coin.score === 'number'
  );
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
}

interface AiRowData {
  symbol: string;
  text: string;
  loading: boolean;
}

export function WRScanner({
  coins, scanBadge, scanning, autoScan, autoPaused, watchlistOnly, tracked, portfolio,
  aiKey, vmcapThr, pchgThr,
  onScan, onToggleAuto, onTogglePause, onToggleWatchlist, onTrack, onUntrack,
  onVmcapChange, onPchgChange, onOpenModal, onAddAlert,
  advancedFilters, onAdvancedFiltersChange, page, onPageChange,
  hlScannerEnabled = true, hlMegaTxUsd,
}: WRScannerProps) {
  const [search, setSearch]     = useState('');
  const [sortKey, setSortKey]   = useState<string>('score');
  const [sortDir, setSortDir]   = useState(-1);
  const [aiRows, setAiRows]     = useState<Record<string, AiRowData>>({});
  const [showAdvFilters, setShowAdvFilters] = useState(false);

  // ── HL perps opportunity overlay ──────────────────────────────────────────
  const hlOpps = useHLOpportunities({ enabled: hlScannerEnabled, minApy: 12 });

  const handleSort = (key: string) => {
    if (sortKey === key) setSortDir(d => -d);
    else { setSortKey(key); setSortDir(-1); }
  };

  const removeAiRow = useCallback((sym: string) => {
    setAiRows(prev => {
      const next = { ...prev };
      delete next[sym];
      return next;
    });
  }, []);

  const handleAiAnalyze = useCallback(async (coin: CoinData) => {
    if (!aiKey) {
      onAddAlert('info', 'AI', 'Enter Anthropic API key in ⚙ Settings');
      return;
    }
    setAiRows(prev => ({ ...prev, [coin.symbol]: { symbol: coin.symbol, text: '', loading: true } }));
    try {
      const text = await analyzeToken(coin, aiKey);
      setAiRows(prev => ({
        ...prev,
        [coin.symbol]: { symbol: coin.symbol, text: text || 'No response', loading: false },
      }));
    } catch (e) {
      setAiRows(prev => ({
        ...prev,
        [coin.symbol]: { symbol: coin.symbol, text: 'AI analysis failed', loading: false },
      }));
    }
  }, [aiKey, onAddAlert]);

  // ── Filter & sort with validation ────────────────────────────────────────
  const filtered = useMemo(() => {
    const validCoins = Array.isArray(coins) ? coins.filter(isValidCoin) : [];

    if (validCoins.length === 0) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[WRScanner] No valid coins. Raw coins:', coins);
      }
      return [];
    }

    const searchUpper = search.toUpperCase();
    const searchLower = search.toLowerCase();

    return validCoins
      .filter(c => {
        if (!search) return true;
        return c.symbol.includes(searchUpper) || c.name.toLowerCase().includes(searchLower);
      })
      .sort((a, b) => {
        const av = (a as unknown as Record<string, unknown>)[sortKey];
        const bv = (b as unknown as Record<string, unknown>)[sortKey];
        if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sortDir;
        if (typeof av === 'string' && typeof bv === 'string') return av.localeCompare(bv) * sortDir;
        return 0;
      });
  }, [coins, search, sortKey, sortDir]);

  const PAGE_SIZE   = 20;
  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedCoins = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, currentPage]);

  // ── Debug logging ─────────────────────────────────────────────────────────
  if (process.env.NODE_ENV === 'development') {
    useMemo(() => {
      console.log('[WRScanner] coins:', coins?.length, 'filtered:', filtered.length, 'page:', currentPage, 'paginated:', paginatedCoins.length);
    }, [coins, filtered, currentPage, paginatedCoins]);
  }

  const badgeCls = scanBadge === 'LIVE'    ? 'text-wr-green border-wr-green-dim bg-wr-green-ghost'
    : scanBadge === 'SCANNING'             ? 'text-wr-cyan border-wr-cyan/30'
    : scanBadge === 'ERROR' || scanBadge === 'RATE LIMITED' ? 'text-wr-red border-wr-red/30'
    : 'text-wr-muted border-wr-border';

  return (
    <div className="flex flex-col border border-wr-border bg-wr-bg2 min-h-0">
      <div className="wr-panel-header">
        <span className="wr-panel-title">⬡ MANIPULATION SCANNER v9 — TOP 250</span>
        <div className="flex gap-2 items-center flex-wrap">
          <span className={`text-[8px] px-1.5 py-0.5 border tracking-widest ${badgeCls}`}>{scanBadge}</span>
        </div>
      </div>

      <div className="quick-actions">
        <button className="wr-btn" onClick={onScan} disabled={scanning} title="Scan now [S]">
          {scanning
            ? <span className="inline-block w-2.5 h-2.5 border border-wr-border border-t-wr-green rounded-full animate-spin-fast mr-1" />
            : '▶'} SCAN
        </button>
        <button className={`wr-btn ${autoScan ? 'active' : ''}`} onClick={onToggleAuto} title="Toggle auto [A]">
          AUTO: {autoScan ? 'ON' : 'OFF'}
        </button>
        {autoScan && (
          <button
            className={`wr-btn ${autoPaused ? 'text-wr-amber border-wr-amber/50' : ''}`}
            onClick={onTogglePause}
            title="Pause/resume auto scan"
          >
            {autoPaused ? '▶ RESUME' : '⏸ PAUSE'}
          </button>
        )}
        <button className={`wr-btn blue ${watchlistOnly ? 'active' : ''}`} onClick={onToggleWatchlist} title="Watchlist only [W]">
          ☆ WL
        </button>
        <button className="wr-btn ai" onClick={() => onOpenModal('backtest')} title="Backtest [B]">
          📊 BT <span className="pro-badge">PRO</span>
        </button>
        <button className="wr-btn sol" onClick={() => onOpenModal('portfolio')} title="Portfolio [P]">
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
          className={`wr-btn text-[8px] hidden lg:inline-flex ${showAdvFilters ? 'active' : ''}`}
          onClick={() => setShowAdvFilters(p => !p)}
          title="Advanced filters"
        >
          ⚙ FILTERS
        </button>

        <div className="flex-1" />

        <input
          className="wr-input max-w-[160px]"
          placeholder="Filter symbol / name…"
          value={search}
          onChange={e => { setSearch(e.target.value); onPageChange(1); }}
        />

        <div className="hidden lg:flex items-center gap-1.5">
          <label className="text-[8px] text-wr-green-dim tracking-widest">VOL/MCAP≥</label>
          <input
            type="range" className="w-16 h-0.5 accent-wr-green"
            min={50} max={1000} step={25}
            value={vmcapThr}
            onChange={e => onVmcapChange(+e.target.value)}
          />
          <span className="text-[10px] text-wr-amber w-10">{vmcapThr}%</span>
        </div>
        <div className="hidden lg:flex items-center gap-1.5">
          <label className="text-[8px] text-wr-green-dim tracking-widest">24H≥</label>
          <input
            type="range" className="w-16 h-0.5 accent-wr-green"
            min={5} max={60} step={5}
            value={pchgThr}
            onChange={e => onPchgChange(+e.target.value)}
          />
          <span className="text-[10px] text-wr-amber w-8">{pchgThr}%</span>
        </div>
      </div>

      {showAdvFilters && (
        <div className="border-b border-wr-border bg-wr-bg3/50 hidden lg:block">
          <WRAdvancedFilters filters={advancedFilters} onChange={onAdvancedFiltersChange} />
        </div>
      )}

      <div className="flex-1 overflow-auto scrollbar-thin">
        <table className="wr-table">
          <thead>
            <tr>
              {[
                { key: 'rank',     label: '#' },
                { key: 'symbol',   label: 'TOKEN' },
                { key: 'price',    label: 'PRICE' },
                { key: 'change',   label: '24H%' },
                { key: 'volume',   label: '24H VOL' },
                { key: 'mcap',     label: 'MKT CAP' },
                { key: 'vmcap',    label: 'VOL/MCAP ⚠' },
                { key: 'score',    label: 'SCORE' },
                { key: 'threat',   label: 'THREAT' },
                { key: 'category', label: 'CATEGORY' },
                { key: '',         label: 'ACTIONS' },
                { key: '',         label: 'CEO SIGNAL' },
              ].map(col => (
                <th
                  key={col.label}
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
                <td colSpan={12} className="text-center text-wr-muted text-xs py-12 tracking-widest">
                  {coins.length === 0 ? 'Click SCAN to begin surveillance' : 'No tokens match current filters'}
                </td>
              </tr>
            ) : paginatedCoins.map((c, rowIdx) => {
              // ── Defensive: skip invalid coins ────────────────────────────
              if (!isValidCoin(c)) {
                console.warn('[WRScanner] Skipping invalid coin at index', rowIdx, c);
                return null;
              }

              const rowKey = c.id || `${c.symbol}-${rowIdx}`;
              const siz        = calcSizing(c);
              const isTracked  = !!tracked[c.symbol];
              const vmcapCls   = (c.vmcap || 0) >= 800 ? 'text-wr-red'
                               : (c.vmcap || 0) >= 400 ? 'text-wr-amber'
                               : (c.vmcap || 0) >= 200 ? 'text-wr-cyan'
                               : 'text-wr-green-dim';
              const catCls     = c.category ? `wr-cat-${c.category.toLowerCase()}` : '';
              const aiRow      = aiRows[c.symbol];

              // Safe HL opportunity lookup
              let hlOpp: HLSignal | undefined = undefined;
              let hlMeta: typeof HL_OPP_META[string] | null = null;
              try {
                hlOpp = hlOpps.match(c.symbol);
                hlMeta = hlOpp ? HL_OPP_META[hlOpp.opportunityType] : null;
              } catch (e) {
                console.warn('[WRScanner] HL opp lookup failed for', c.symbol, e);
              }

              const hlRowGlow  = hlOpp?.level === 'critical' ? 'shadow-[inset_3px_0_0_0_hsl(var(--wr-amber))]' : '';

              return (
                <React.Fragment key={rowKey}>
                  <tr
                    className={`${c.threat === 'CRITICAL' ? 'animate-flash-red' : c.threat === 'HIGH' ? 'animate-flash-amber' : ''} ${aiRow ? 'border-b-0' : ''} ${hlRowGlow}`}
                    style={{ minHeight: '40px' }}
                  >
                    <td className="text-wr-muted text-[8px]">{c.rank || '—'}</td>
                    <td>
                      <div className="font-head text-[10px] text-wr-white tracking-widest flex items-center flex-wrap gap-1">
                        <span>{c.symbol}</span>
                        {c.isSol   && <span className="text-wr-sol text-[7px]">◎</span>}
                        {c.dexHot  && <span className="text-[7px] px-0.5 bg-wr-blue/10 border border-wr-blue/30 text-wr-blue">DEX</span>}
                        {hlOpp && hlMeta && (
                          <span
                            className={`text-[7px] px-1 py-px border font-mono tracking-wider inline-flex items-center gap-0.5 ${hlMeta.cls}`}
                            title={`HL ${hlMeta.title} · ${hlOpp.side} · ${hlOpp.expectedEdge}${hlOpp.apyEstimate ? ` · ~${hlOpp.apyEstimate.toFixed(0)}% APY` : ''} · conv ${hlOpp.conviction}%`}
                          >
                            HL·{hlMeta.label}
                            {hlOpp.side !== 'NEUTRAL' && (
                              <span className="opacity-80">{hlOpp.side === 'LONG' ? '↑' : '↓'}</span>
                            )}
                          </span>
                        )}
                      </div>
                      <div className="text-[8px] text-wr-muted">{c.name || '—'}</div>
                    </td>
                    <td className="text-wr-cyan">${fmtP(c.price || 0)}</td>
                    <td className={c.change >= 0 ? 'text-wr-green' : 'text-wr-red'}>
                      {c.change >= 0 ? '+' : ''}{(c.change || 0).toFixed(2)}%
                    </td>
                    <td className="text-wr-white">{fmtN(c.volume || 0)}</td>
                    <td className="text-wr-muted">{fmtN(c.mcap || 0)}</td>
                    <td>
                      <span className={vmcapCls}>{(c.vmcap || 0).toFixed(0)}%</span>
                      <div className="text-[7px] text-wr-muted">VS:×{(c.volSpike || 0).toFixed(1)}</div>
                    </td>
                    <td>
                      <div className="text-[9px] text-wr-amber">{(c.score || 0)}/100</div>
                      <div className="flex gap-0.5 mt-0.5">
                        {Array.from({ length: 10 }).map((_, i) => (
                          <div
                            key={i}
                            className={`w-1 h-1 rounded-[1px] ${i < Math.ceil((c.score || 0) / 10) ? 'bg-wr-amber' : 'bg-wr-border'}`}
                            style={{ background: i < Math.ceil((c.score || 0) / 10) ? 'hsl(var(--wr-amber))' : 'hsl(var(--wr-border))' }}
                          />
                        ))}
                      </div>
                      <div className="text-[7px] text-wr-muted mt-0.5">CONF:{c.confidence || 0}%</div>
                    </td>
                    <td>
                      <span className={`wr-badge wr-badge-${(c.threat || 'low').toLowerCase()}`}>
                        {c.threat || 'LOW'}
                      </span>
                    </td>
                    <td>
                      {c.category ? (
                        <span className={`wr-badge ${catCls}`}>{c.category}</span>
                      ) : (
                        <span className="text-wr-muted text-[7px]">—</span>
                      )}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        <button
                          className={`wr-btn text-[8px] px-1.5 py-0.5 ${isTracked ? 'active' : ''}`}
                          onClick={() => isTracked ? onUntrack(c.symbol) : onTrack(c.id || c.symbol, c.symbol, c.price || 0)}
                          title={isTracked ? 'Untrack' : 'Track price'}
                        >
                          {isTracked ? '✓' : '+'}
                        </button>
                        <button
                          className="wr-btn ai text-[8px] px-1.5 py-0.5"
                          onClick={() => handleAiAnalyze(c)}
                          title="AI Analysis"
                        >
                          ✦
                        </button>
                      </div>
                    </td>
                    <td className="text-right">
                      {(() => {
                        const sig = getCeoSignal(c.score || 0, c.threat || 'LOW', c.category, c.vmcap || 0);
                        return (
                          <div className={`inline-flex items-center gap-1 border px-2 py-0.5 text-[8px] font-mono tracking-wider ${sig.cls}`}>
                            {sig.label} <span className="text-[10px]">{sig.mark}</span>
                          </div>
                        );
                      })()}
                    </td>
                  </tr>
                  {aiRow && (
                    <tr key={`ai-${c.symbol}`} className="bg-wr-purple/[.04] border-t-0">
                      <td colSpan={12} className="p-0">
                        <div className="px-3 py-2 border-l-2 border-l-wr-purple">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[8px] text-wr-purple tracking-widest">✦ AI ANALYSIS</span>
                            <span className="text-[7px] text-wr-muted">{c.symbol}</span>
                            <div className="flex-1" />
                            <button
                              className="text-[8px] px-1.5 py-0.5 bg-transparent border border-wr-border text-wr-muted hover:text-wr-red hover:border-wr-red cursor-pointer font-mono"
                              onClick={() => removeAiRow(c.symbol)}
                            >
                              ✕
                            </button>
                          </div>
                          {aiRow.loading ? (
                            <span className="text-[9px] text-wr-purple animate-pulse">analyzing {c.symbol}…</span>
                          ) : (
                            <p className="text-[9px] text-wr-white leading-relaxed whitespace-pre-wrap">{aiRow.text}</p>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between px-3 py-2 border-t border-wr-border bg-wr-bg3/50">
          <span className="text-[8px] text-wr-muted tracking-widest">
            {filtered.length} TOKENS · PAGE {currentPage}/{totalPages}
          </span>
          <div className="flex gap-1">
            <button
              className="wr-btn text-[8px] px-2 py-0.5 min-h-[28px]"
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              disabled={currentPage <= 1}
            >
              ◀ PREV
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5)          pageNum = i + 1;
              else if (currentPage <= 3)    pageNum = i + 1;
              else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
              else                          pageNum = currentPage - 2 + i;
              return (
                <button
                  key={pageNum}
                  className={`text-[8px] px-1.5 py-0.5 border cursor-pointer font-mono min-h-[28px] min-w-[28px]
                    ${currentPage === pageNum
                      ? 'bg-wr-green-ghost border-wr-green text-wr-green'
                      : 'border-wr-border text-wr-muted hover:border-wr-green-dim'}`}
                  onClick={() => onPageChange(pageNum)}
                >
                  {pageNum}
                </button>
              );
            })}
            <button
              className="wr-btn text-[8px] px-2 py-0.5 min-h-[28px]"
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              disabled={currentPage >= totalPages}
            >
              NEXT ▶
            </button>
          </div>
        </div>
      )}

      <HLManipulationScanner
        collapsed
        enabled={hlScannerEnabled}
        megaTxUsd={hlMegaTxUsd}
        showOpportunities
        minApy={12}
        onGlobalAlert={(alert) => onAddAlert(alert.level, alert.tag, alert.text)}
      />
    </div>
  );
}
