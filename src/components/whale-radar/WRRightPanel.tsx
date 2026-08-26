/* ══ WHALE RADAR v9 — RIGHT PANEL ════════════════════════════════════════════
 *  Virtual-scrolled whale feed (max 50 DOM nodes) + alerts panel.
 *  v9.1: Added Hyperliquid Explorer sub-tab (server-cached, 300ms poll).
 *  v9.2: Added alert-cooldown status badge (see lib/alertCooldown.ts) — shows
 *        how many symbols/global lock are currently muting the alert feed.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { AlertItem, WhaleTrade, WalletEntry, fmtN } from '@/lib/whaleRadarState';
import { rankWalletsBySkill } from '@/lib/walletSkillScoring';
import { HLExplorer } from '@/components/hyperliquid/HLExplorer';
import { WRHistoryPanel } from '@/components/whale-radar/WRHistoryPanel';
import type { LockInfo } from '@/lib/alertCooldown';
import { toast } from '@/hooks/use-toast';
import { forwardSignalToStrategyTrader } from '@/lib/nexus/strategyTraderBridge';

/** "2h ago" / "5m ago" / "just now" — small enough not to warrant a shared util for one caller. */
function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0 || Number.isNaN(diffMs)) return '—';
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const VROW_H = 28;       // virtual row height in px
const MAX_DOM_ROWS = 50;  // cap rendered DOM nodes

interface WRRightPanelProps {
  whaleFeed: WhaleTrade[];
  alerts: AlertItem[];
  alertFilter: string;
  onAlertFilterChange: (f: string) => void;
  wallets: WalletEntry[];
  onAddWallet: (w: WalletEntry) => void;
  onRemoveWallet: (addr: string) => void;
  onTogglePin: (ts: number) => void;
  /** Logs the user's decision on an alert (v9.37 decision-outcome loop) —
   *  identified by ts, same reasoning as onTogglePin above: an index into
   *  the filtered/rendered list doesn't match the caller's full alerts
   *  array, so identity has to travel by something stable instead. */
  onLogOutcome: (ts: number, action: 'reviewed' | 'bought') => void;
  onClearAlerts: () => void;
  bybitEnabled: boolean;
  onToggleBybit: () => void;
  whaleFeedEx: string;
  onWhaleFeedExChange: (ex: string) => void;
  /** Active per-symbol / global alert-cooldown locks — see lib/alertCooldown.ts. Optional so this stays a non-breaking add. */
  alertLocks?: LockInfo[];
  /** Coins pairFilters.ts kept out of alerting on the most recent scan, with why — see lib/pairFilters.ts. */
  lastFiltered?: { symbol: string; reason: string }[];
}

export function WRRightPanel({
  whaleFeed, alerts, alertFilter, onAlertFilterChange,
  wallets, onAddWallet, onRemoveWallet, onTogglePin, onLogOutcome, onClearAlerts,
  bybitEnabled, onToggleBybit, whaleFeedEx, onWhaleFeedExChange,
  alertLocks = [],
  lastFiltered = [],
}: WRRightPanelProps) {
  const [walletInput, setWalletInput] = useState('');
  const [walletLabel, setWalletLabel] = useState('');
  // Skill-scored wallets (closed trades found) sort to the top; wallets
  // with no scored history yet keep their add-order at the bottom, same
  // "rank, don't hide" convention rankByPerformance() uses for symbols.
  const rankedWallets = useMemo(() => rankWalletsBySkill(wallets), [wallets]);
  const [activeTab, setActiveTab] = useState<'whales' | 'wallets' | 'hl' | 'history'>('whales');

  const handleAddWallet = () => {
    const addr = walletInput.trim();
    if (!addr || addr.length < 32) return;
    onAddWallet({ address: addr, label: walletLabel.trim() || addr.slice(0, 8) + '...' });
    setWalletInput('');
    setWalletLabel('');
  };

  // Exchange filter
  const filteredWhaleFeed = useMemo(() => {
    if (whaleFeedEx === 'all') return whaleFeed;
    return whaleFeed.filter(w => w.ex === whaleFeedEx);
  }, [whaleFeed, whaleFeedEx]);

  // ── Virtual scrolling state ───────────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);

  const handleScroll = useCallback(() => {
    if (scrollRef.current) setScrollTop(scrollRef.current.scrollTop);
  }, []);

  const totalItems = filteredWhaleFeed.length;
  const totalHeight = totalItems * VROW_H;

  const { startIdx, endIdx, visibleItems } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / VROW_H) - 2);
    const visible = Math.min(MAX_DOM_ROWS, Math.ceil(192 / VROW_H) + 4);
    const end = Math.min(totalItems, start + visible);
    return {
      startIdx: start,
      endIdx: end,
      visibleItems: filteredWhaleFeed.slice(start, end),
    };
  }, [scrollTop, filteredWhaleFeed, totalItems]);

  // Auto-scroll to top on new trades when user is near the top; otherwise show
  // a "NEW TRADES" badge so we never silently bury a fresh mega-trade.
  const [hasNewTrades, setHasNewTrades] = useState(false);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (el.scrollTop < 60) {
      el.scrollTop = 0;
      setHasNewTrades(false);
    } else {
      setHasNewTrades(true);
    }
  }, [filteredWhaleFeed.length]);

  const scrollFeedToTop = useCallback(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setHasNewTrades(false);
  }, []);

  // ── Alert cooldown status (freqtrade-protections-style lock indicator) ────
  const globalLock = useMemo(() => alertLocks.find(l => l.scope === 'global'), [alertLocks]);
  const symbolLocks = useMemo(() => alertLocks.filter(l => l.scope === 'symbol'), [alertLocks]);
  const lockTooltip = useMemo(() => {
    if (!alertLocks.length) return '';
    return alertLocks
      .map(l => l.scope === 'global'
        ? `GLOBAL: ${l.reason}`
        : `${l.symbol}: ${l.reason}`)
      .join('\n');
  }, [alertLocks]);

  return (
    <div className="flex flex-col border-l border-wr-border bg-wr-bg2 wr-right-panel min-h-0">
      {/* Whale Trades / Wallet Tracker / Hyperliquid tabs */}
      <div className="flex border-b border-wr-border bg-wr-bg">
        <button
          className={`flex-1 py-1.5 text-[8px] tracking-[2px] text-center cursor-pointer border-b-2 transition-all font-mono
            ${activeTab === 'whales' ? 'text-wr-green border-wr-green' : 'text-wr-muted border-transparent'}`}
          onClick={() => setActiveTab('whales')}
        >
          🐳 WHALE TRADES
        </button>
        <button
          className={`flex-1 py-1.5 text-[8px] tracking-[2px] text-center cursor-pointer border-b-2 transition-all font-mono
            ${activeTab === 'wallets' ? 'text-wr-sol border-wr-sol' : 'text-wr-muted border-transparent'}`}
          onClick={() => setActiveTab('wallets')}
        >
          🐳 WALLETS <span className="pro-badge">PRO</span>
        </button>
        <button
          className={`flex-1 py-1.5 text-[8px] tracking-[2px] text-center cursor-pointer border-b-2 transition-all font-mono
            ${activeTab === 'hl' ? 'text-wr-cyan border-wr-cyan' : 'text-wr-muted border-transparent'}`}
          onClick={() => setActiveTab('hl')}
        >
          🔗 HL
        </button>
        <button
          className={`flex-1 py-1.5 text-[8px] tracking-[2px] text-center cursor-pointer border-b-2 transition-all font-mono
            ${activeTab === 'history' ? 'text-wr-amber border-wr-amber' : 'text-wr-muted border-transparent'}`}
          onClick={() => setActiveTab('history')}
        >
          📜 HISTORY
        </button>
      </div>

      {/* ── Hyperliquid Explorer (full panel, no alerts below) ── */}
      {activeTab === 'hl' && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <HLExplorer isActive />
        </div>
      )}

      {/* ── Scan History (full panel, no alerts below) — see WRHistoryPanel.tsx
           for the "logic existed but never reached the UI" gap this closes. ── */}
      {activeTab === 'history' && (
        <div className="flex-1 overflow-hidden flex flex-col">
          <WRHistoryPanel isActive={activeTab === 'history'} />
        </div>
      )}

      {activeTab !== 'hl' && activeTab !== 'history' && (
        <>
      {activeTab === 'whales' ? (
        <div className="border-b border-wr-border">
          <div className="wr-panel-header">
            <span className="wr-panel-title">🐳 WHALE TRADES — LIVE</span>
            <span className="text-[7px] text-wr-muted font-mono">{totalItems} trades</span>
          </div>
          {/* Exchange filter tabs */}
          <div className="px-2 py-1 border-b border-wr-border flex gap-1 items-center">
            {[
              { key: 'all', label: 'ALL' },
              { key: 'binance', label: 'BINANCE' },
              { key: 'bybit', label: 'BYBIT' },
              { key: 'okx', label: 'OKX' },
              { key: 'kraken', label: 'KRAKEN' },
            ].map(ex => (
              <button
                key={ex.key}
                className={`text-[8px] px-1.5 py-0.5 border cursor-pointer font-mono tracking-widest transition-all
                  ${whaleFeedEx === ex.key
                    ? 'bg-wr-green-ghost border-wr-green text-wr-green'
                    : 'border-wr-border text-wr-muted hover:border-wr-green-dim hover:text-wr-green'}`}
                onClick={() => onWhaleFeedExChange(ex.key)}
              >
                {ex.label}
              </button>
            ))}
            <div className="flex-1" />
            <button
              className={`text-[8px] px-1.5 py-0.5 border cursor-pointer font-mono tracking-widest transition-all
                ${bybitEnabled
                  ? 'bg-wr-amber/10 border-wr-amber text-wr-amber'
                  : 'border-wr-border text-wr-muted'}`}
              onClick={onToggleBybit}
              title="Toggle Bybit WebSocket"
            >
              BBT: {bybitEnabled ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Virtual-scrolled whale feed */}
          <div
            ref={scrollRef}
            className="max-h-48 overflow-y-auto scrollbar-thin relative"
            onScroll={handleScroll}
          >
            {hasNewTrades && (
              <button
                onClick={scrollFeedToTop}
                className="sticky top-1 left-1/2 -translate-x-1/2 z-10 text-[8px] tracking-widest font-mono px-2 py-0.5 bg-wr-green text-wr-bg border border-wr-green animate-pulse cursor-pointer"
              >
                ↑ NEW TRADES
              </button>
            )}
            {totalItems === 0 ? (
              <div className="text-center text-wr-muted text-[9px] py-6 tracking-widest">
                {whaleFeed.length === 0 ? 'Add a pair to monitor whale trades' : 'No trades for selected exchange'}
              </div>
            ) : (
              <div style={{ height: totalHeight, position: 'relative' }}>
                {visibleItems.map((w, i) => (
                  <div
                    key={startIdx + i}
                    className="px-3 py-1.5 border-b border-wr-border/40 grid grid-cols-[46px_1fr_auto] gap-1.5 items-center"
                    style={{
                      position: 'absolute',
                      top: (startIdx + i) * VROW_H,
                      left: 0,
                      right: 0,
                      height: VROW_H,
                    }}
                  >
                    <span className="text-[8px] text-wr-muted">{new Date(w.ts).toLocaleTimeString()}</span>
                    <span className="text-[9px] text-wr-white">
                      <span className={`text-[7px] mr-1 ${w.ex === 'bybit' ? 'text-wr-amber' : w.ex === 'okx' ? 'text-wr-cyan' : w.ex === 'kraken' ? 'text-wr-purple' : 'text-wr-green-dim'}`}>
                        {w.ex === 'bybit' ? 'BBT' : w.ex === 'okx' ? 'OKX' : w.ex === 'kraken' ? 'KRK' : 'BNC'}
                      </span>
                      {w.sym} {w.side}
                    </span>
                    <span className={`text-[10px] text-right ${w.usdt >= 5e6 ? 'text-wr-red font-bold' : w.usdt >= 1e6 ? 'text-wr-amber' : 'text-wr-cyan'}`}>
                      ${fmtN(w.usdt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="border-b border-wr-border">
          <div className="wr-panel-header">
            <span className="wr-panel-title text-wr-sol">🐳 LIVE WALLET TRACKER</span>
          </div>
          <div className="p-2 space-y-2 border-b border-wr-border">
            <input
              className="wr-input text-[9px]"
              placeholder="Solana wallet address..."
              value={walletInput}
              onChange={e => setWalletInput(e.target.value)}
            />
            <div className="flex gap-1.5">
              <input
                className="wr-input flex-1 text-[9px]"
                placeholder="Label (optional)"
                value={walletLabel}
                onChange={e => setWalletLabel(e.target.value)}
              />
              <button className="wr-btn sol text-[8px]" onClick={handleAddWallet}>+ TRACK</button>
            </div>
          </div>
          <div className="max-h-48 overflow-y-auto scrollbar-thin">
            {wallets.length === 0 ? (
              <div className="text-center text-wr-muted text-[9px] py-6 tracking-widest px-3">
                Add Solana wallet addresses to track whale/dev wallet flows in real-time
              </div>
            ) : (
              rankedWallets.map((w) => (
                <div key={w.address} className="px-3 py-2 border-b border-wr-border/40 flex items-center gap-2 animate-slide-in">
                  <div className={`wr-dot wr-dot-sol ${w.recentTxCount24h ? 'animate-pulse' : ''}`} title={w.recentTxCount24h ? `${w.recentTxCount24h} tx in last 24h` : 'no recent activity'} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[9px] text-wr-white truncate">{w.label}</div>
                    <div className="text-[7px] text-wr-muted truncate">{w.address}</div>
                    <div className="text-[7px] text-wr-cyan flex items-center gap-2 mt-0.5 flex-wrap">
                      {w.balanceSol != null ? <span>{w.balanceSol.toFixed(3)} SOL</span> : <span className="text-wr-muted">loading…</span>}
                      {w.recentTxCount24h != null && <span className="text-wr-muted">{w.recentTxCount24h} tx/24h</span>}
                      {w.lastActivity && <span className="text-wr-muted">· {timeAgo(w.lastActivity)}</span>}
                    </div>
                    <div className="text-[7px] flex items-center gap-2 mt-0.5">
                      {w.closedTrades ? (
                        <span
                          className={w.skillScore != null && w.skillScore >= 50 ? 'text-wr-green' : 'text-wr-amber'}
                          title={`${w.closedTrades} closed round-trip(s) this session's scan actually cost-basis-matched; more history builds a steadier score`}
                        >
                          🎯 {w.skillScore?.toFixed(0) ?? '—'} · {w.winRate != null ? `${(w.winRate * 100).toFixed(0)}% win` : ''} · {w.avgProfitSol != null ? `${w.avgProfitSol >= 0 ? '+' : ''}${w.avgProfitSol.toFixed(3)} SOL avg` : ''}
                        </span>
                      ) : (
                        <span className="text-wr-muted">no closed trades scanned yet</span>
                      )}
                    </div>
                  </div>
                  <button className="wr-btn red text-[7px] px-1 py-0" onClick={() => onRemoveWallet(w.address)}>✕</button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Alerts Panel */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="wr-panel-header">
          <span className="wr-panel-title">🚨 MANIPULATION ALERTS</span>
          <div className="flex items-center gap-1.5">
            {lastFiltered.length > 0 && (
              <span
                title={lastFiltered.slice(0, 10).map(f => `${f.symbol}: ${f.reason}`).join('\n') + (lastFiltered.length > 10 ? `\n…+${lastFiltered.length - 10} more` : '')}
                className="text-[7px] px-1.5 py-0.5 border border-wr-border text-wr-muted font-mono tracking-widest cursor-help"
              >
                🔍 {lastFiltered.length} FILTERED
              </span>
            )}
            {alertLocks.length > 0 && (
              <span
                title={lockTooltip}
                className={`text-[7px] px-1.5 py-0.5 border font-mono tracking-widest cursor-help
                  ${globalLock
                    ? 'border-wr-red text-wr-red bg-wr-red/10 animate-pulse'
                    : 'border-wr-amber text-wr-amber bg-wr-amber/10'}`}
              >
                {globalLock ? '🔒 GLOBAL MUTE' : `🔇 ${symbolLocks.length} MUTED`}
              </span>
            )}
            <button className="wr-btn red text-[7px] px-1.5 py-0.5" onClick={onClearAlerts}>CLR</button>
          </div>
        </div>

        <div className="px-2 py-1 border-b border-wr-border flex gap-1 items-center flex-wrap">
          {['ALL', 'C', 'H', 'M', 'I', 'PIN'].map(f => (
            <button
              key={f}
              className={`text-[8px] px-1.5 py-0.5 border cursor-pointer font-mono tracking-widest transition-all
                ${alertFilter === f
                  ? 'bg-wr-green-ghost border-wr-green text-wr-green'
                  : 'border-wr-border text-wr-muted hover:border-wr-green-dim hover:text-wr-green'}`}
              onClick={() => onAlertFilterChange(f)}
            >
              {f === 'C' ? 'CRIT' : f === 'H' ? 'HIGH' : f === 'M' ? 'MED' : f === 'PIN' ? '📌' : f}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {alerts.length === 0 ? (
            <div className="text-center text-wr-muted text-[9px] py-6 tracking-widest">
              No alerts triggered
            </div>
          ) : (
            alerts.slice(0, 80).map((a, i) => (
              <div
                key={`${a.ts}-${a.tag}-${a.tc}-${i}`}
                className={`px-3 py-1.5 border-l-[3px] border-b border-wr-border/40 text-[9px] leading-relaxed animate-slide-in relative
                  ${a.level === 'critical' ? 'border-l-wr-red bg-wr-red/[.03]'
                    : a.level === 'high' ? 'border-l-wr-amber bg-wr-amber/[.02]'
                    : a.level === 'medium' ? 'border-l-wr-cyan'
                    : 'border-l-wr-muted'}
                  ${a.pinned ? '!border-l-wr-gold !bg-wr-gold/[.03]' : ''}`}
              >
                <button
                  className={`absolute right-1 top-1 text-[9px] cursor-pointer bg-transparent border-none text-wr-gold ${a.pinned ? 'opacity-90' : 'opacity-25 hover:opacity-90'}`}
                  onClick={() => onTogglePin(a.ts)}
                >
                  {a.pinned ? '📌' : '📍'}
                </button>
                <span className="text-[7px] text-wr-muted block mb-0.5">{new Date(a.ts).toLocaleTimeString()}</span>
                <span className="text-wr-white">
                  <span className={`inline-block text-[7px] px-1 mr-1
                    ${a.tc === 'C' ? 'bg-wr-red/20 text-wr-red'
                      : a.tc === 'H' ? 'bg-wr-amber/20 text-wr-amber'
                      : a.tc === 'M' ? 'bg-wr-cyan/10 text-wr-cyan'
                      : 'bg-wr-green-ghost text-wr-green-dim'}`}
                  >{a.tc}</span>
                  <strong>{a.tag}</strong>: {a.text}
                </span>
                {a.sizing && (
                  <span className="block text-[7px] text-wr-purple/80 mt-0.5 pl-0.5" title="Based on this signal category's real recorded outcomes — see the Risk Metrics panel for the full breakdown">
                    ⚖ {a.sizing}
                  </span>
                )}
                {/* Decision-outcome loop (v9.37): only shown once the alert has
                    round-tripped to the server (dbId set) — same gate as the
                    pin button's persistence, since there's no row to log a
                    decision against otherwise. Once a decision is logged, show
                    it as read-only status instead of re-showing both buttons —
                    logging again would just reset the outcome (see the
                    server's ON CONFLICT DO UPDATE), which isn't useful to
                    invite by accident on every render. */}
                {a.dbId != null && (
                  a.decision == null ? (
                    <span className="flex gap-2 mt-0.5 pl-0.5">
                      <button
                        className="text-[7px] text-wr-muted hover:text-wr-cyan bg-transparent border-none cursor-pointer underline decoration-dotted"
                        title="Log that you looked at this and decided not to act on it"
                        onClick={() => onLogOutcome(a.ts, 'reviewed')}
                      >
                        🔍 Reviewed
                      </button>
                      <button
                        className="text-[7px] text-wr-muted hover:text-wr-green bg-transparent border-none cursor-pointer underline decoration-dotted"
                        title={a.coinId ? 'Log that you acted on this — forward 24h price will be tracked' : 'Log that you acted on this (no coin attached to this alert, so no forward price can be tracked)'}
                        onClick={() => onLogOutcome(a.ts, 'bought')}
                      >
                        💰 I Bought
                      </button>
                    </span>
                  ) : (
                    <span className="block text-[7px] text-wr-muted mt-0.5 pl-0.5">
                      {a.decision === 'bought' ? '💰 Bought' : '🔍 Reviewed'}
                      {a.decision === 'bought' && a.outcomePct != null && (
                        <span className={a.outcomePct >= 0 ? 'text-wr-green' : 'text-wr-red'}>
                          {' '}— {a.outcomePct >= 0 ? '+' : ''}{a.outcomePct.toFixed(1)}% (24h)
                        </span>
                      )}
                      {a.decision === 'bought' && a.outcomePct == null && a.coinId && (
                        <span> — 24h outcome pending</span>
                      )}
                    </span>
                  )
                )}
                {a.level === 'critical' && (
                  <button
                    className="block text-[7px] text-wr-cyan/90 hover:text-wr-cyan mt-0.5 pl-0.5 bg-transparent border-none cursor-pointer underline decoration-dotted"
                    title="Manually forward this symbol to freqtrade's forceentry — subject to the server's own cooldown lock and dry-run default, never sent automatically"
                    onClick={async () => {
                      try {
                        const result = await forwardSignalToStrategyTrader({ pair: `${a.tag}/USDT`, entryTag: 'whale-radar-manual' });
                        toast({
                          title: result.dryRun ? 'Sent (dry-run)' : 'Sent to Strategy Trader',
                          description: result.dryRun ? `${a.tag} — simulated, no real order placed` : `${a.tag} — forceentry accepted`,
                        });
                      } catch (err) {
                        toast({ title: 'Strategy Trader forward failed', description: (err as Error).message, variant: 'destructive' });
                      }
                    }}
                  >
                    🎯 Send to Strategy Trader
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}
