import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useMarketData } from '@/hooks/useMarketData';
import btcQr from '@/assets/btc-qr.jpg';
import { WRHeader } from '@/components/whale-radar/WRHeader';
import { WRTicker } from '@/components/whale-radar/WRTicker';
import { WRScanner } from '@/components/whale-radar/WRScanner';
import { WRRightPanel } from '@/components/whale-radar/WRRightPanel';
import { WRStatsBar } from '@/components/whale-radar/WRStatsBar';
import { WRTracker } from '@/components/whale-radar/WRTracker';
import { WRSettingsPanel } from '@/components/whale-radar/WRSettingsPanel';
import { WROnboarding } from '@/components/whale-radar/WROnboarding';
import { WRModal } from '@/components/whale-radar/WRModal';
import { WRKeyboardHelp } from '@/components/whale-radar/WRKeyboardHelp';
import { WRAlertBell } from '@/components/whale-radar/WRAlertBell';
import { WRCoinGeckoStatus } from '@/components/whale-radar/WRCoinGeckoStatus';
import { RegimePanel } from '@/components/regime/RegimePanel';
import { WhaleHeatmap } from '@/components/whale-radar/WhaleHeatmap';
import { useRegimeEngine } from '@/hooks/useRegimeEngine';
import { WRMobileFilterSheet } from '@/components/whale-radar/WRMobileFilterSheet';
import { useWhaleWebSocket } from '@/hooks/useWhaleWebSocket';
import { useWhaleStream, type StreamSignal } from '@/hooks/useWhaleStream';
import { useExchangeFeed } from '@/hooks/useExchangeFeed';
import { useWalletActivity } from '@/hooks/useWalletActivity';
import { useWalletSkillScoring } from '@/hooks/useWalletSkillScoring';
import { okxAdapter } from '@/lib/exchanges/okx';
import { krakenAdapter } from '@/lib/exchanges/kraken';
import type { NormalizedTrade } from '@/lib/exchanges/types';
import { DEFAULT_FILTERS, type WhaleFilters } from '@/components/whale-radar/WRAdvancedFilters';
import {
  CoinData, AlertItem, WhaleTrade, TrackedToken, PortfolioEntry,
  WalletEntry, ScanSnapshot, CFG, fmtN, fmtP, isSolToken,
  calcSizing, saveState, loadState,
} from '@/lib/whaleRadarState';
import { handleRateLimit, getActiveCooldowns, onRateLimitChange } from '@/lib/rateLimit';
import { saveWhaleEvent, initBackendCheck, saveAlert, loadAlerts, toggleAlertPin, logAlertOutcome, savePortfolioEntry, deletePortfolioEntry, loadPortfolio, saveTrackedToken, deleteTrackedToken, loadTracked } from '@/lib/db';
import { sendPush } from '@/lib/pushBridge';
import { fillSignalPrices } from '@/lib/signalStore';
import { WRSignalEval } from '@/components/whale-radar/WRSignalEval';
import WRCrystalBallPro from '@/components/whale-radar/WRCrystalBallPro';
import { startPerfMonitoring } from '@/lib/perfBudget';
import { WRCouncilPanel } from '@/components/whale-radar/WRCouncilPanel';
import type { CouncilLlmSettings } from '@/lib/council/api';
import type { WsStatus } from '@/hooks/useWhaleWebSocket';
import { HLConfigBanner } from '@/components/hyperliquid/HLConfigBanner';
import { analyzeSentiment } from '@/lib/analyzeToken';

// Scan engine, signal computation and CG fetching live in:
//   - @/hooks/useMarketData  (state + orchestration)
//   - @/services/api         (cancellable fetchers)
//   - @/services/signals     (pure scoring functions)
// (pure functions, easier to test, keeps Index.tsx as a thin container).

export default function WhaleRadarApp() {
  // ══ CORE STATE ═══════════════════════════════════════════════════════════
  // Owned by useMarketData below: coins, scanHistory.
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [whaleFeed, setWhaleFeed] = useState<WhaleTrade[]>([]);
  const [tracked, setTracked] = useState<Record<string, TrackedToken>>({});
  const [portfolio, setPortfolio] = useState<Record<string, PortfolioEntry>>({});
  const [wallets, setWallets] = useState<WalletEntry[]>([]);
  useWalletActivity(wallets, setWallets);
  useWalletSkillScoring(wallets, setWallets);

  // UI State
  const [theme, setTheme] = useState<'cyber' | 'matrix' | 'dark'>('cyber');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [autoScan, setAutoScan] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false);
  // Owned by useMarketData below: scanning, scanBadge.
  const [kbdOpen, setKbdOpen] = useState(false);
  const [alertFilter, setAlertFilter] = useState('ALL');
  const [watchlistOnly, setWatchlistOnly] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [copiedBtc, setCopiedBtc] = useState(false);

  // API keys
  const [apiKey, setApiKey] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [birdKey, setBirdKey] = useState('');
  const [heliusKey, setHeliusKey] = useState('');

  // Config
  const [vmcapThr, setVmcapThr] = useState(200);
  const [pchgThr, setPchgThr] = useState(15);
  const [whaleThr, setWhaleThr] = useState(150000);
  const [aggressiveMode, setAggressiveMode] = useState(false);

  // WebSocket config
  const [bybitEnabled, setBybitEnabled] = useState(false);
  const [whaleFeedEx, setWhaleFeedEx] = useState('all');
  const [hlScannerEnabled, setHlScannerEnabled] = useState(true);
  const [hlMegaTxUsd, setHlMegaTxUsd] = useState(500_000);
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [subscribedPairs, setSubscribedPairs] = useState<Set<string>>(() => new Set(['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT']));
  const [advancedFilters, setAdvancedFilters] = useState<WhaleFilters>(DEFAULT_FILTERS);
  const [scanPage, setScanPage] = useState(1);

  // Stats
  // Owned by useMarketData below: apiCallCount, lastScanTs.
  const [aiCallCount, setAiCallCount] = useState(0);
  const [nextScan, setNextScan] = useState('—');

  // Modals
  const [activeModal, setActiveModal] = useState<string | null>(null);

  // ── Agent Council ────────────────────────────────────────────────────────
  const [councilEnabled, setCouncilEnabled] = useState(() => localStorage.getItem('wr_council_enabled') !== '0');
  const [councilCoin, setCouncilCoin] = useState<CoinData | null>(null);
  const [councilLlm, setCouncilLlm] = useState<CouncilLlmSettings>(() => {
    try {
      const raw = localStorage.getItem('wr_council_llm');
      if (raw) return JSON.parse(raw) as CouncilLlmSettings;
    } catch { /* ignore */ }
    return { provider: 'lovable' };
  });
  const updateCouncilLlm = useCallback((patch: Partial<CouncilLlmSettings>) => {
    setCouncilLlm(prev => {
      const next = { ...prev, ...patch };
      localStorage.setItem('wr_council_llm', JSON.stringify(next));
      return next;
    });
  }, []);
  const toggleCouncil = useCallback((v: boolean) => {
    setCouncilEnabled(v);
    localStorage.setItem('wr_council_enabled', v ? '1' : '0');
  }, []);


  // Owned by useMarketData below: prevVolumes (for vol-spike calc).

  // ══ PERSISTENCE ═══════════════════════════════════════════════════════════
  useEffect(() => {
    const saved = loadState();
    if (saved.theme) setTheme(saved.theme as 'cyber' | 'matrix' | 'dark');
    if (saved.apiKey) setApiKey(saved.apiKey as string);
    if (saved.aiKey) setAiKey(saved.aiKey as string);
    if (saved.birdKey) setBirdKey(saved.birdKey as string);
    if (saved.heliusKey) setHeliusKey(saved.heliusKey as string);
    if (saved.tracked) setTracked(saved.tracked as Record<string, TrackedToken>);
    if (saved.portfolio) setPortfolio(saved.portfolio as Record<string, PortfolioEntry>);
    if (saved.wallets) setWallets(saved.wallets as WalletEntry[]);
    if (saved.vmcapThr) setVmcapThr(saved.vmcapThr as number);
    if (saved.pchgThr) setPchgThr(saved.pchgThr as number);
    if (saved.whaleThr) setWhaleThr(saved.whaleThr as number);
    if (saved.soundOn !== undefined) setSoundOn(saved.soundOn as boolean);
    if (saved.scanHistory) setScanHistory(saved.scanHistory as ScanSnapshot[]);
    if (saved.prevVolumes) setPrevVolumes(saved.prevVolumes as Record<string, number>);
    if (saved.bybitEnabled) setBybitEnabled(saved.bybitEnabled as boolean);
    if (saved.whaleFeedEx) setWhaleFeedEx(saved.whaleFeedEx as string);
    if (saved.hlScannerEnabled !== undefined) setHlScannerEnabled(saved.hlScannerEnabled as boolean);
    if (saved.hlMegaTxUsd) setHlMegaTxUsd(saved.hlMegaTxUsd as number);
    const sbUrl = localStorage.getItem('wr_supabase_url') ?? '';
    const sbKey = localStorage.getItem('wr_supabase_anon_key') ?? '';
    if (sbUrl) setSupabaseUrl(sbUrl);
    if (sbKey) setSupabaseAnonKey(sbKey);
    if (saved.autoScan) {
      setAutoScan(true);
      setAutoPaused(saved.autoPaused as boolean ?? true);
    }
  }, []);

  // ══ PERFORMANCE MONITORING ═══════════════════════════════════════════════
  useEffect(() => {
    const cleanup = startPerfMonitoring();
    return cleanup;
  }, []);

  // ══ BACKEND CHECK + SIGNAL PRICE FILLER ══════════════════════════════════
  useEffect(() => {
    initBackendCheck().then((ok) => {
      if (!ok) return;
      // DB-first hydration with localStorage already loaded as fallback
      loadAlerts().then(rows => { if (rows.length) setAlerts(prev => [...rows, ...prev].slice(0, CFG.AFEED_MAX * 2)); }).catch(() => {});
      loadPortfolio().then(p => { if (Object.keys(p).length) setPortfolio(p); }).catch(() => {});
      loadTracked().then(t => { if (Object.keys(t).length) setTracked(t); }).catch(() => {});
    });
    fillSignalPrices().catch(() => {});
    const fillTimer = setInterval(() => {
      fillSignalPrices().catch(() => {});
    }, 30 * 60 * 1000);
    return () => clearInterval(fillTimer);
  }, []);

  // saveState effect moved below useMarketData (it depends on prevVolumes/scanHistory).

  // ══ THEME ═════════════════════════════════════════════════════════════════
  useEffect(() => {
    document.body.classList.remove('theme-matrix', 'theme-dark');
    if (theme === 'matrix') document.body.classList.add('theme-matrix');
    else if (theme === 'dark') document.body.classList.add('theme-dark');
  }, [theme]);

  // ══ RATE LIMIT STATE ═══════════════════════════════════════════════════════
  const [rateLimitInfo, setRateLimitInfo] = useState<{ key: string; source: string; remaining: number }[]>([]);

  useEffect(() => {
    const tick = setInterval(() => setRateLimitInfo(getActiveCooldowns()), 1000);
    const unsub = onRateLimitChange(() => setRateLimitInfo(getActiveCooldowns()));
    return () => { clearInterval(tick); unsub(); };
  }, []);

  // ══ ALERTS (declared before useMarketData so it can inject the alert sink) ═
  // Throttled auto-push for CRITICAL alerts — server/routes/push.ts's own
  // comment flagged this as the one deliberate follow-up not bundled with
  // the push-notification feature itself: "nothing calls this
  // automatically yet (e.g. on a CRITICAL alert)". Client-side throttle
  // only (not per-subscriber, not persisted across reloads) — enough to
  // stop a burst of critical alerts from firing a dozen pushes in a few
  // seconds. sendPush() is a broadcast no-op when nobody's subscribed, so
  // an occasional call with zero subscribers just costs one HTTP round
  // trip, not an error.
  const lastCriticalPushRef = useRef(0);
  const CRITICAL_PUSH_MIN_GAP_MS = 60_000;

  const addAlert = useCallback((
    level: AlertItem['level'], tag: string, text: string, sizing?: string,
    coinId?: string | null, entryPrice?: number | null,
  ) => {
    const tc = level === 'critical' ? 'C' : level === 'high' ? 'H' : level === 'medium' ? 'M' : 'I';
    const newItem: AlertItem = { ts: Date.now(), level, tag, text, tc, sizing, pinned: false, coinId, entryPrice };
    setAlerts(prev => [newItem, ...prev].slice(0, CFG.AFEED_MAX * 2));
    // Patch in the backend row id once it resolves, matched by ts (unique
    // per alert at creation time) — this is what lets a later pin-toggle
    // actually persist instead of only updating local state. See db.ts's
    // saveAlert()/toggleAlertPin() docstrings for why this was missing.
    saveAlert(newItem).then((dbId) => {
      if (dbId == null) return;
      setAlerts(prev => prev.map(a => (a.ts === newItem.ts ? { ...a, dbId } : a)));
    }).catch(() => {});

    if (level === 'critical' && Date.now() - lastCriticalPushRef.current > CRITICAL_PUSH_MIN_GAP_MS) {
      lastCriticalPushRef.current = Date.now();
      sendPush({ title: `🚨 ${tag}`, body: text.slice(0, 160), tag: 'whale-radar-critical', url: '/' }).catch(() => {});
    }
  }, []);

  // ══ SCAN ENGINE (extracted to useMarketData hook) ═════════════════════════
  // Stable getter for Birdeye key — avoids hook re-render whenever birdKey changes.
  const birdKeyRef = useRef('');
  useEffect(() => { birdKeyRef.current = birdKey; }, [birdKey]);
  const getBirdKey = useCallback(() => birdKeyRef.current, []);

  const {
    coins, setCoins,
    scanning, scanBadge, dataSource, apiCallCount, lastScanTs,
    prevVolumes, setPrevVolumes,
    scanHistory, setScanHistory,
    triggerScan,
    getAlertLocks,
    lastFiltered,
  } = useMarketData({ apiKey, getBirdKey, addAlert });

  // ══ REGIME ENGINE — lifted here (not owned by RegimePanel) so the same
  // reading can also feed the AI Council's REGIME DESK agent below without
  // running collectSignals() a second time. ═══════════════════════════════
  const regimeLocal = useMemo(() => ({ coins, whales: whaleFeed }), [coins, whaleFeed]);
  const {
    reading: regimeReading,
    history: regimeHistory,
    weights: regimeWeights,
    setWeights: setRegimeWeights,
    restoreDefaults: restoreRegimeDefaults,
    loading: regimeLoading,
    refresh: refreshRegime,
  } = useRegimeEngine(regimeLocal);

  // ══ ALERT COOLDOWN STATUS (polled — module-level state, not reactive) ═════
  const [alertLocks, setAlertLocks] = useState<ReturnType<typeof getAlertLocks>>([]);
  useEffect(() => {
    const t = setInterval(() => setAlertLocks(getAlertLocks()), 5000);
    return () => clearInterval(t);
  }, [getAlertLocks]);

  // Save persisted state on changes (depends on hook-owned scanHistory/prevVolumes).
  useEffect(() => {
    const timer = setTimeout(() => {
      saveState({
        theme, apiKey, aiKey, birdKey, heliusKey, tracked, portfolio, wallets,
        vmcapThr, pchgThr, whaleThr, soundOn, scanHistory: scanHistory.slice(-CFG.HISTORY_MAX),
        prevVolumes, aggressiveMode, watchlistOnly, bybitEnabled, whaleFeedEx,
        autoScan, autoPaused,
        hlScannerEnabled, hlMegaTxUsd,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [theme, apiKey, aiKey, birdKey, heliusKey, tracked, portfolio, wallets,
    vmcapThr, pchgThr, whaleThr, soundOn, scanHistory, prevVolumes, aggressiveMode,
    watchlistOnly, bybitEnabled, whaleFeedEx, autoScan, autoPaused,
    hlScannerEnabled, hlMegaTxUsd]);


  // ══ TRACKING ══════════════════════════════════════════════════════════════
  const trackToken = useCallback((id: string, symbol: string, price: number) => {
    const token: TrackedToken = { id, price, basePrice: price, lastPrice: price };
    setTracked(prev => ({ ...prev, [symbol]: token }));
    saveTrackedToken(symbol, token).catch(() => {});
  }, []);

  const untrackToken = useCallback((symbol: string) => {
    setTracked(prev => {
      const n = { ...prev };
      delete n[symbol];
      return n;
    });
    deleteTrackedToken(symbol).catch(() => {});
  }, []);

  // ══ WHALE WEBSOCKET ══════════════════════════════════════════════════════
  const whaleEventThrottle = useRef<Map<string, number>>(new Map());

  const handleWhaleTrade = useCallback((trade: WhaleTrade) => {
    setWhaleFeed(prev => [trade, ...prev].slice(0, CFG.WFEED_MAX));

    const lastWrite = whaleEventThrottle.current.get(trade.sym) ?? 0;
    if (Date.now() - lastWrite > 30_000) {
      whaleEventThrottle.current.set(trade.sym, Date.now());
      saveWhaleEvent({
        symbol:   trade.sym,
        side:     trade.side,
        price:    trade.price,
        qty:      trade.qty,
        usdt:     trade.usdt,
        exchange: trade.ex,
      });
    }
  }, []);

  const handleTrackerPrice = useCallback((sym: string, price: number) => {
    setTracked(prev => {
      if (!prev[sym]) return prev;
      return { ...prev, [sym]: { ...prev[sym], price, lastPrice: prev[sym].price } };
    });
  }, []);

  // ── Phase 3: server-side Binance multiplexer (whale-stream edge fn) ──
  // Stream owns Binance whales + 1m/5m signals. Legacy hook keeps Bybit + tracker prices.
  const streamLive = useRef(false);
  const [latestSignals, setLatestSignals] = useState<Record<string, StreamSignal>>({});

  const handleStreamSignal = useCallback((s: StreamSignal) => {
    setLatestSignals(prev => ({ ...prev, [`${s.sym}:${s.window}`]: s }));
  }, []);

  // Keep subscribedPairs in sync with tracked tokens (defaults + tracked symbols).
  useEffect(() => {
    const pairs = new Set(['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT']);
    Object.keys(tracked).forEach(sym => pairs.add(sym + 'USDT'));
    setSubscribedPairs(pairs);
  }, [tracked]);

  // Bare symbols (without USDT) for whale-stream edge fn which appends 'usdt' itself.
  const subscribedSymbols = useMemo(
    () => new Set([...subscribedPairs].map(p => p.replace(/USDT$/, ''))),
    [subscribedPairs]
  );

  const { status: streamStatus, reconnectAttempts: streamReconnects } = useWhaleStream({
    subscribedPairs: subscribedSymbols,
    whaleThr,
    onWhaleTrade: handleWhaleTrade,
    onSignal: handleStreamSignal,
    enabled: whaleFeedEx === 'all' || whaleFeedEx === 'binance',
  });
  streamLive.current = streamStatus === 'live';

  // Defense-in-depth for the brief handoff window while useWhaleWebSocket's
  // own effect teardown is in flight after streamStatus flips to 'live' —
  // the connection itself is now actually closed at that point (see
  // binanceEnabled passed below), this filter just guards against any
  // trade that arrives in the moment before that teardown completes.
  const handleLegacyWhale = useCallback((t: WhaleTrade) => {
    if (t.ex === 'binance' && streamLive.current) return;
    handleWhaleTrade(t);
  }, [handleWhaleTrade]);

  const { binanceReady, bybitReady, wsStatus: legacyWsStatus, wsLagMs, reconnectAttempts: legacyReconnects } = useWhaleWebSocket({
    subscribedPairs,
    bybitEnabled,
    whaleThr,
    whaleFeedEx,
    onWhaleTrade:    handleLegacyWhale,
    onTrackerPrice:  handleTrackerPrice,
    // v9.39: this hook's own direct-to-Binance connection is now actually
    // closed (not just data-discarded afterward, see handleLegacyWhale
    // above, which stays as a defense-in-depth guard for the brief handoff
    // window while this effect's teardown is in flight) whenever the
    // server-side stream (useWhaleStream.ts, above) is live — no more
    // permanently-open second connection to the exact same upstream. Not
    // gated on whaleFeedEx: onTrackerPrice needs Binance price ticks
    // regardless of which exchange is selected for whale-trade display, so
    // the only thing that should turn this leg off is genuine redundancy
    // with the server stream, not the feed-exchange selector.
    binanceEnabled: streamStatus !== 'live',
  });

  // ── OKX feed (new exchange, generic adapter-driven hook — see hooks/useExchangeFeed.ts) ──
  // Independent of the legacy Binance/Bybit hook; feeds the same handleWhaleTrade sink.
  // Genuinely additive — no legacy dupe-suppression needed since OKX isn't covered elsewhere.
  const handleOkxTrade = useCallback((t: NormalizedTrade) => {
    const cls = t.usdt >= 5e6 ? 'ws-mega' : t.usdt >= 1e6 ? 'ws-big' : 'ws-mid';
    handleWhaleTrade({ ts: t.ts, sym: t.sym, side: t.side, price: t.price, qty: t.qty, usdt: t.usdt, cls, ex: t.ex });
  }, [handleWhaleTrade]);

  const { status: okxStatus } = useExchangeFeed({
    adapter: okxAdapter,
    pairs: subscribedPairs,
    minUsd: whaleThr,
    enabled: whaleFeedEx === 'all' || whaleFeedEx === 'okx',
    onTrade: handleOkxTrade,
  });
  void okxStatus; // exposed for a future per-exchange status indicator

  // ── Kraken feed — same pattern as OKX above, second exchange proving out
  // the generic adapter (see hooks/useExchangeFeed.ts). Was fully implemented
  // in lib/exchanges/kraken.ts but never actually instantiated anywhere.
  const handleKrakenTrade = useCallback((t: NormalizedTrade) => {
    const cls = t.usdt >= 5e6 ? 'ws-mega' : t.usdt >= 1e6 ? 'ws-big' : 'ws-mid';
    handleWhaleTrade({ ts: t.ts, sym: t.sym, side: t.side, price: t.price, qty: t.qty, usdt: t.usdt, cls, ex: t.ex });
  }, [handleWhaleTrade]);

  const { status: krakenStatus } = useExchangeFeed({
    adapter: krakenAdapter,
    pairs: subscribedPairs,
    minUsd: whaleThr,
    enabled: whaleFeedEx === 'all' || whaleFeedEx === 'kraken',
    onTrade: handleKrakenTrade,
  });
  void krakenStatus;

  // Composite status: stream takes precedence when active
  const wsStatus: WsStatus = streamStatus === 'live'
    ? 'live'
    : streamStatus === 'reconnecting'
      ? (legacyWsStatus === 'live' ? 'delayed' : 'reconnecting')
      : legacyWsStatus;
  const wsReconnects = streamReconnects + legacyReconnects;
  void latestSignals; // exposed for future signal UI panel

  // ══ AUTO SCAN ═════════════════════════════════════════════════════════════
  const triggerScanRef = useRef(triggerScan);
  useEffect(() => { triggerScanRef.current = triggerScan; }, [triggerScan]);

  useEffect(() => {
    if (!autoScan || autoPaused) return;
    const ms = aggressiveMode ? CFG.SCAN_MS_AGG : CFG.SCAN_MS_NORMAL;
    triggerScanRef.current();
    const timer   = setInterval(() => triggerScanRef.current(), ms);
    const effectStart = Date.now();
    const cdTimer = setInterval(() => {
      const elapsed = (Date.now() - effectStart) % ms;
      const r = Math.max(0, Math.ceil((ms - elapsed) / 1000));
      setNextScan(r > 0 ? r + 's' : 'NOW');
    }, 1000);
    return () => { clearInterval(timer); clearInterval(cdTimer); };
  }, [autoScan, autoPaused, aggressiveMode]);

  // ══ KEYBOARD SHORTCUTS ════════════════════════════════════════════════════
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName.toLowerCase();
      if (['input', 'select', 'textarea'].includes(tag)) return;
      const k = e.key.toLowerCase();
      if (k === 's')              { e.preventDefault(); triggerScan(); }
      else if (k === 'a')         { e.preventDefault(); setAutoScan(p => !p); setAutoPaused(false); }
      else if (k === 'w')         { e.preventDefault(); setWatchlistOnly(p => !p); }
      else if (k === 'b')         { e.preventDefault(); setActiveModal('backtest'); }
      else if (k === 'p')         { e.preventDefault(); setActiveModal('portfolio'); }
      else if (k === 'h')         { e.preventDefault(); setActiveModal('history'); }
      else if (k === '?' || k === '/') { e.preventDefault(); setKbdOpen(p => !p); }
      else if (k === 'e')         { e.preventDefault(); setActiveModal('signal-eval'); }
      else if (k === 'escape')    { setActiveModal(null); setKbdOpen(false); }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [triggerScan]);

  // ══ ONBOARDING ════════════════════════════════════════════════════════════
  const finishOnboarding = useCallback(() => {
    setShowOnboarding(false);
    localStorage.setItem('wr_v9_onboarded', '1');
  }, []);

  // ══ TOGGLE HANDLERS ══════════════════════════════════════════════════════
  const handleToggleAuto = useCallback(() => {
    setAutoScan(p => {
      if (!p) setAutoPaused(false);
      return !p;
    });
  }, []);

  const handleTogglePause = useCallback(() => {
    setAutoPaused(p => !p);
  }, []);

  const handleToggleBybit = useCallback(() => {
    setBybitEnabled(p => !p);
  }, []);

  // ══ FILTERED COINS ════════════════════════════════════════════════════════
  const filteredCoins = coins.filter(c => {
    if (c.vmcap < vmcapThr && Math.abs(c.change) < pchgThr && c.score < 20) return false;
    if (watchlistOnly && !tracked[c.symbol]) return false;
    if (advancedFilters.chain === 'solana' && !c.isSol) return false;
    if (['ethereum', 'bsc', 'polygon'].includes(advancedFilters.chain) && c.isSol) return false;
    if (advancedFilters.minThreshold > 0 && c.volume < advancedFilters.minThreshold) return false;
    return true;
  });

  // ══ FILTERED ALERTS ═══════════════════════════════════════════════════════
  const filteredAlerts = alerts.filter(a => {
    if (alertFilter === 'PIN') return a.pinned;
    if (alertFilter !== 'ALL' && a.tc !== alertFilter) return false;
    return true;
  });

  return (
    <div className="min-h-screen flex flex-col">
      {/* SEO: crawlable static content (visually hidden, indexable by search engines) */}
      <section className="sr-only" aria-hidden="false">
        <h1>Whale Radar — Real-Time Crypto Whale Tracker &amp; Market Manipulation Detector</h1>
        <p>
          Whale Radar is a free, real-time cryptocurrency whale tracker and AI-powered
          market manipulation detector. We monitor large orders across Binance, Bybit,
          and Solana DEXs via live WebSocket feeds, and integrate Hyperliquid perpetual
          markets for funding rates, L2 order books, and opportunity scanning. Detect
          pumps, dumps, wash trading, short squeezes, and insider activity as they happen.
          Unlike paid services such as Whale Alert, Whale Radar is free, browser-based,
          and includes Hyperliquid whale explorer plus on-chain Solana gem hunting in one
          unified dashboard.
        </p>
        <h2>Features</h2>
        <ul>
          <li>Binance whale alerts — live large-order detection on spot and perpetuals</li>
          <li>Bybit whale trades — real-time WebSocket feed with custom size thresholds</li>
          <li>Solana whale detector — Birdeye and DexScreener enrichment for memecoins</li>
          <li>Hyperliquid whale explorer — markets, funding, L2 book, opportunity scanner</li>
          <li>Market manipulation detector — pump, dump, wash, squeeze, insider patterns</li>
          <li>On-chain whale scanner, free — no API key, no subscription</li>
          <li>Custom alerts, sound notifications, portfolio tracking, signal backtesting</li>
        </ul>
        <h2>Sections</h2>
        <ul>
          <li><a href="/">Whale Radar dashboard</a></li>
          <li><a href="/orderflow">Order flow panel</a></li>
          <li><a href="/nexus/whale">Nexus whale watch</a></li>
          <li><a href="/nexus/arbitrage">Arbitrage command center</a></li>
        </ul>
      </section>

      {showOnboarding && <WROnboarding onFinish={finishOnboarding} />}

      <HLConfigBanner onOpenSettings={() => setSettingsOpen(true)} />

      {dataSource === 'fallback' && (
        <div className="bg-wr-red/20 border-b-2 border-wr-red/60 px-4 py-2 text-center text-[10px] text-wr-red tracking-widest">
          ⚠ SCAN FAILED — Keeping last live snapshot on screen. No simulated whale data is ever shown. Retry shortly.
        </div>
      )}
      {dataSource === 'cached' && scanBadge === 'CACHED' && (
        <div className="bg-wr-amber/15 border-b border-wr-amber/40 px-4 py-1 text-center text-[8px] text-wr-amber tracking-widest">
          📦 Serving cached data — API rate limited or slow
        </div>
      )}

      {wsReconnects >= 2 && (
        <div className="bg-wr-amber/20 border-b border-wr-amber/40 px-4 py-1.5 text-center text-[10px] text-wr-amber tracking-widest animate-pulse">
          ⚠ RECONNECTING… (attempt {wsReconnects}) — Data may be delayed
        </div>
      )}

      <div className="flex items-center gap-2 px-4 py-0.5 bg-wr-bg3 border-b border-wr-border/50 text-[8px] tracking-widest">
        <span className="text-wr-muted">WS:</span>
        {wsStatus === 'live'         && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-green animate-blink" /> <span className="text-wr-green">LIVE</span></span>}
        {wsStatus === 'delayed'      && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-amber" /> <span className="text-wr-amber">DELAYED ({Math.round(wsLagMs / 1000)}s)</span></span>}
        {wsStatus === 'fallback'     && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-red animate-pulse" /> <span className="text-wr-red">FALLBACK (HTTP POLL)</span></span>}
        {wsStatus === 'reconnecting' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-amber animate-pulse" /> <span className="text-wr-amber">RECONNECTING…</span></span>}
        {wsStatus === 'offline'      && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-muted" /> <span className="text-wr-muted">OFFLINE</span></span>}
        <span className="text-wr-muted ml-1">BIN: {binanceReady ? '✓' : '—'} | BYB: {bybitReady ? '✓' : '—'}</span>
        <span className="text-wr-muted mx-1">|</span>
        <WRCoinGeckoStatus dataSource={dataSource} scanBadge={scanBadge} lastScanTs={lastScanTs} scanning={scanning} />
        <div className="flex-1" />
        <WRAlertBell whaleFeed={whaleFeed} />
        <WRMobileFilterSheet
          filters={advancedFilters}
          onChange={setAdvancedFilters}
          vmcapThr={vmcapThr}
          pchgThr={pchgThr}
          onVmcapChange={setVmcapThr}
          onPchgChange={setPchgThr}
        />
      </div>

      <WRHeader
        scanCount={coins.length}
        alertCount={alerts.length}
        nextScan={autoScan ? (autoPaused ? 'PAUSED' : nextScan) : '—'}
        aiCallCount={aiCallCount}
        scanning={scanning}
        soundOn={soundOn}
        onToggleSound={() => setSoundOn(p => !p)}
        onToggleSettings={() => setSettingsOpen(p => !p)}
        onToggleKbd={() => setKbdOpen(p => !p)}
      />

      {settingsOpen && (
        <WRSettingsPanel
          apiKey={apiKey} onApiKeyChange={setApiKey}
          aiKey={aiKey} onAiKeyChange={setAiKey}
          birdKey={birdKey} onBirdKeyChange={setBirdKey}
          heliusKey={heliusKey} onHeliusKeyChange={setHeliusKey}
          theme={theme} onThemeChange={setTheme}
          aggressiveMode={aggressiveMode} onAggressiveModeChange={setAggressiveMode}
          whaleThr={whaleThr} onWhaleThrChange={setWhaleThr}
          hlScannerEnabled={hlScannerEnabled}
          onHlScannerEnabledChange={setHlScannerEnabled}
          hlMegaTxUsd={hlMegaTxUsd}
          onHlMegaTxUsdChange={setHlMegaTxUsd}
          supabaseUrl={supabaseUrl}
          onSupabaseUrlChange={(v) => {
            setSupabaseUrl(v);
            if (v.startsWith('https://')) localStorage.setItem('wr_supabase_url', v);
            else localStorage.removeItem('wr_supabase_url');
          }}
          supabaseAnonKey={supabaseAnonKey}
          onSupabaseAnonKeyChange={(v) => {
            setSupabaseAnonKey(v);
            if (v.length > 20) localStorage.setItem('wr_supabase_anon_key', v);
            else localStorage.removeItem('wr_supabase_anon_key');
          }}
          councilEnabled={councilEnabled}
          onCouncilEnabledChange={toggleCouncil}
          councilProvider={councilLlm.provider}
          councilKey={councilLlm.apiKey ?? ''}
          councilModel={councilLlm.model ?? ''}
          councilBaseUrl={councilLlm.baseUrl ?? ''}
          onCouncilLlmChange={(p) => updateCouncilLlm(p as Partial<CouncilLlmSettings>)}
        />
      )}

      <WRTicker coins={coins.slice(0, 30)} />

      <RegimePanel
        reading={regimeReading}
        history={regimeHistory}
        weights={regimeWeights}
        setWeights={setRegimeWeights}
        restoreDefaults={restoreRegimeDefaults}
        loading={regimeLoading}
        refresh={refreshRegime}
        addAlert={addAlert}
      />

      <WhaleHeatmap whaleFeed={whaleFeed} coins={coins} />


      <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] flex-1 min-h-0">
        <WRScanner
          coins={filteredCoins}
          scanBadge={scanBadge}
          scanning={scanning}
          autoScan={autoScan}
          autoPaused={autoPaused}
          watchlistOnly={watchlistOnly}
          tracked={tracked}
          portfolio={portfolio}
          aiKey={aiKey}
          vmcapThr={vmcapThr}
          pchgThr={pchgThr}
          onScan={triggerScan}
          onToggleAuto={handleToggleAuto}
          onTogglePause={handleTogglePause}
          onToggleWatchlist={() => setWatchlistOnly(p => !p)}
          onTrack={trackToken}
          onUntrack={untrackToken}
          onVmcapChange={setVmcapThr}
          onPchgChange={setPchgThr}
          onOpenModal={setActiveModal}
          onAddAlert={addAlert}
          advancedFilters={advancedFilters}
          onAdvancedFiltersChange={setAdvancedFilters}
          page={scanPage}
          onPageChange={setScanPage}
          hlScannerEnabled={hlScannerEnabled}
          hlMegaTxUsd={hlMegaTxUsd}
          councilEnabled={councilEnabled}
          onLaunchCouncil={setCouncilCoin}
        />

        <WRRightPanel
          whaleFeed={whaleFeed}
          alerts={filteredAlerts}
          alertFilter={alertFilter}
          onAlertFilterChange={setAlertFilter}
          wallets={wallets}
          onAddWallet={(w) => setWallets(prev => [...prev, w])}
          onRemoveWallet={(addr) => setWallets(prev => prev.filter(w => w.address !== addr))}
          onTogglePin={(ts) => {
            setAlerts(prev => prev.map((a) => {
              if (a.ts !== ts) return a;
              // Fire-and-forget the persisted toggle — local state flips
              // immediately either way, this just makes the pin survive a
              // reload instead of silently reverting (see db.ts).
              if (a.dbId != null) toggleAlertPin(a.dbId).catch(() => {});
              return { ...a, pinned: !a.pinned };
            }));
          }}
          onLogOutcome={(ts, action) => {
            setAlerts(prev => prev.map((a) => {
              if (a.ts !== ts || a.dbId == null) return a;
              // Same fire-and-forget-then-reconcile shape as onTogglePin
              // above: flip local state immediately, persist in the
              // background. coinId/entryPrice are whatever this alert was
              // created with — undefined for market-wide/coin-less alerts,
              // which the server already treats as "no price to track".
              logAlertOutcome(a.dbId, action, a.coinId, a.entryPrice).catch(() => {});
              return { ...a, decision: action };
            }));
          }}
          onClearAlerts={() => setAlerts([])}
          bybitEnabled={bybitEnabled}
          onToggleBybit={handleToggleBybit}
          whaleFeedEx={whaleFeedEx}
          onWhaleFeedExChange={setWhaleFeedEx}
          alertLocks={alertLocks}
          lastFiltered={lastFiltered}
        />
      </div>

      <WRStatsBar
        alertsToday={alerts.length}
        apiCallCount={apiCallCount}
        apiKey={apiKey}
        lastScanTs={lastScanTs}
        historyCount={scanHistory.length}
        portfolioValue={Object.entries(portfolio).reduce((s, [sym, p]) => {
          const coin = coins.find(c => c.symbol === sym);
          return s + p.amount * (coin?.price || p.entryPrice);
        }, 0)}
        rateLimits={rateLimitInfo}
      />

      <WRTracker tracked={tracked} onUntrack={untrackToken} />

      <WRCrystalBallPro />

      {kbdOpen && <WRKeyboardHelp onClose={() => setKbdOpen(false)} />}

      {councilEnabled && councilCoin && (
        <WRCouncilPanel
          coin={councilCoin}
          whaleTrades={whaleFeed}
          regime={regimeReading}
          llm={councilLlm}
          onClose={() => setCouncilCoin(null)}
        />
      )}

      {activeModal === 'backtest' && (
        <WRModal title="📊 BACKTESTING MODULE" onClose={() => setActiveModal(null)}>
          <BacktestContent scanHistory={scanHistory} />
        </WRModal>
      )}

      {activeModal === 'portfolio' && (
        <WRModal title="💼 PORTFOLIO MANAGER" onClose={() => setActiveModal(null)}>
          <PortfolioContent
            portfolio={portfolio}
            coins={coins}
            onAdd={(sym, amt, entry) => {
              const e = { amount: amt, entryPrice: entry };
              setPortfolio(p => ({ ...p, [sym]: e }));
              savePortfolioEntry(sym, e).catch(() => {});
            }}
            onRemove={(sym) => {
              setPortfolio(p => { const n = { ...p }; delete n[sym]; return n; });
              deletePortfolioEntry(sym).catch(() => {});
            }}
            onClear={() => {
              Object.keys(portfolio).forEach(s => deletePortfolioEntry(s).catch(() => {}));
              setPortfolio({});
            }}
          />
        </WRModal>
      )}

      {activeModal === 'sentiment' && (
        <WRModal title="✦ AI MARKET SENTIMENT" onClose={() => setActiveModal(null)}>
          <SentimentContent coins={coins} aiKey={aiKey} />
        </WRModal>
      )}

      {activeModal === 'signal-eval' && (
        <WRModal title="📈 SIGNAL EVAL — PROFIT PROOF" onClose={() => setActiveModal(null)}>
          <WRSignalEval />
        </WRModal>
      )}

      {/* ══ TIP THE CEO ══ */}
      <div className="border-t border-wr-border bg-wr-bg2/80 py-8 px-4">
        <div className="max-w-md mx-auto text-center space-y-4">
          <div className="text-[9px] tracking-[0.3em] text-wr-muted uppercase">Support the Developer</div>
          <h3 className="font-head text-lg text-wr-cyan">
            ☕ Found Whale Radar useful?
          </h3>
          <p className="text-[11px] text-wr-muted leading-relaxed">
            If this tool helped your trading or development workflow, consider tipping the CEO. Every sat counts. 🙏
          </p>
          <div className="inline-block bg-white rounded-xl p-3 shadow-lg shadow-wr-cyan/10">
            <img
              src={btcQr}
              alt="BTC Donation QR Code"
              className="w-48 h-48 object-contain"
            />
          </div>
          <div className="space-y-1">
            <div className="text-[8px] tracking-widest text-wr-muted uppercase">BTC Address</div>
            <button
              onClick={() => {
                navigator.clipboard.writeText('bc1q0d0ccaxuw065ezdulr68azp2fjhc0avaqf0pyz');
                setCopiedBtc(true);
                setTimeout(() => setCopiedBtc(false), 2000);
              }}
              className="font-mono text-[10px] text-wr-green bg-wr-bg3 border border-wr-border rounded px-3 py-2 hover:border-wr-cyan transition-colors cursor-pointer select-all break-all max-w-xs mx-auto block"
              title="Click to copy"
            >
              bc1q0d0ccaxuw065ezdulr68azp2fjhc0avaqf0pyz
            </button>
            <div className={`text-[9px] h-4 transition-opacity ${copiedBtc ? 'text-wr-green opacity-100' : 'opacity-0'}`}>
              ✓ Copied to clipboard!
            </div>
          </div>
          <div className="text-[8px] text-wr-muted/50 pt-2">WHALE RADAR v9 — Built with 🔥 by the CEO</div>
        </div>
      </div>
    </div>
  );
}

/* ══ BACKTEST CONTENT ═════════════════════════════════════════════════════════ */
function BacktestContent({ scanHistory }: { scanHistory: ScanSnapshot[] }) {
  const [results, setResults] = useState<{ sym: string; threat: string; pnlPct: number; ts: number }[]>([]);
  const [ran, setRan] = useState(false);

  const runBacktest = () => {
    if (scanHistory.length < 2) return;
    const res: typeof results = [];
    for (let i = 0; i < scanHistory.length - 1; i++) {
      const snap = scanHistory[i];
      const next = scanHistory[i + 1];
      const nextMap: Record<string, number> = {};
      (next.coins || []).forEach(c => { if (c.symbol && c.price) nextMap[c.symbol] = c.price; });
      (snap.coins || []).filter(c => c.threat === 'CRITICAL' || c.threat === 'HIGH').slice(0, 5).forEach(c => {
        const exitP = nextMap[c.symbol!];
        if (c.price && exitP) {
          res.push({ sym: c.symbol!, threat: c.threat!, pnlPct: ((exitP - c.price) / c.price) * 100, ts: snap.ts });
        }
      });
    }
    setResults(res);
    setRan(true);
  };

  const avgPnl = results.length ? results.reduce((s, r) => s + r.pnlPct, 0) / results.length : 0;
  const wins   = results.filter(r => r.pnlPct > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-xs text-wr-muted tracking-widest">SNAPSHOTS: {scanHistory.length}</span>
        <button className="wr-btn" onClick={runBacktest}>▶ RUN BACKTEST</button>
      </div>
      {!ran ? (
        <p className="text-center text-wr-muted text-xs py-8">
          Select parameters and click RUN BACKTEST<br />
          <span className="text-[8px]">Uses scan history snapshots to simulate</span>
        </p>
      ) : results.length === 0 ? (
        <p className="text-center text-wr-muted text-xs py-8">No trade simulations — run more scans first</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
              <div className={`font-head text-lg ${avgPnl >= 0 ? 'text-wr-green' : 'text-wr-red'}`}>
                {avgPnl >= 0 ? '+' : ''}{avgPnl.toFixed(2)}%
              </div>
              <div className="text-[7px] text-wr-muted tracking-widest">AVG PNL</div>
            </div>
            <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
              <div className="font-head text-lg text-wr-amber">
                {results.length > 0 ? ((wins / results.length) * 100).toFixed(0) : 0}%
              </div>
              <div className="text-[7px] text-wr-muted tracking-widest">WIN RATE</div>
            </div>
            <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
              <div className="font-head text-lg text-wr-white">{results.length}</div>
              <div className="text-[7px] text-wr-muted tracking-widest">TRADES</div>
            </div>
          </div>
          <div className="text-[7px] text-wr-muted tracking-widest">SIMULATED — NOT FINANCIAL ADVICE</div>
          <div className="max-h-60 overflow-y-auto scrollbar-thin space-y-0.5">
            {results.slice(0, 30).map((r, i) => (
              <div key={i} className="grid grid-cols-4 gap-2 text-[9px] py-1 border-b border-wr-border/50">
                <span className="text-wr-muted">{new Date(r.ts).toLocaleTimeString()}</span>
                <span className="text-wr-white font-head text-[8px]">{r.sym}</span>
                <span className={`wr-badge wr-badge-${r.threat.toLowerCase()}`}>{r.threat}</span>
                <span className={r.pnlPct >= 0 ? 'text-wr-green' : 'text-wr-red'}>
                  {r.pnlPct >= 0 ? '+' : ''}{r.pnlPct.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/* ══ PORTFOLIO CONTENT ════════════════════════════════════════════════════════ */
function PortfolioContent({ portfolio, coins, onAdd, onRemove, onClear }: {
  portfolio: Record<string, PortfolioEntry>;
  coins: CoinData[];
  onAdd: (sym: string, amt: number, entry: number) => void;
  onRemove: (sym: string) => void;
  onClear: () => void;
}) {
  const [sym, setSym]     = useState('');
  const [amt, setAmt]     = useState('');
  const [entry, setEntry] = useState('');

  const handleAdd = () => {
    const s = sym.trim().toUpperCase();
    const a = parseFloat(amt);
    const e = parseFloat(entry);
    if (!s || isNaN(a) || isNaN(e) || a <= 0 || e <= 0) return;
    onAdd(s, a, e);
    setSym(''); setAmt(''); setEntry('');
  };

  const entries = Object.entries(portfolio);
  let totalVal = 0, totalEntry = 0;
  entries.forEach(([s, p]) => {
    const coin = coins.find(c => c.symbol === s);
    totalVal   += p.amount * (coin?.price || p.entryPrice);
    totalEntry += p.amount * p.entryPrice;
  });
  const totalPnl    = totalVal - totalEntry;
  const totalPnlPct = totalEntry > 0 ? (totalPnl / totalEntry) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap items-center">
        <input className="wr-input w-20" placeholder="SYMBOL" value={sym} onChange={e => setSym(e.target.value)} style={{ textTransform: 'uppercase' }} />
        <input className="wr-input w-20" placeholder="AMOUNT" value={amt} onChange={e => setAmt(e.target.value)} />
        <input className="wr-input w-20" placeholder="ENTRY $" value={entry} onChange={e => setEntry(e.target.value)} />
        <button className="wr-btn" onClick={handleAdd}>+ ADD</button>
        <button className="wr-btn red" onClick={onClear}>CLR ALL</button>
      </div>
      {entries.length === 0 ? (
        <p className="text-center text-wr-muted text-xs py-8">No holdings — add manually above</p>
      ) : (
        <>
          <table className="w-full text-[9px] border-collapse">
            <thead>
              <tr>
                {['TOKEN','QTY','ENTRY','NOW','PNL%','VALUE',''].map(h => (
                  <th key={h} className="text-left text-wr-muted text-[7px] tracking-widest py-1 border-b border-wr-border">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map(([s, p]) => {
                const coin = coins.find(c => c.symbol === s);
                const curP = coin?.price || p.entryPrice;
                const pnl  = ((curP - p.entryPrice) / p.entryPrice) * 100;
                return (
                  <tr key={s} className="border-b border-wr-border/50">
                    <td className="text-wr-white font-head text-[9px] py-1">{s}</td>
                    <td className="py-1">{p.amount}</td>
                    <td className="py-1">${fmtP(p.entryPrice)}</td>
                    <td className="text-wr-cyan py-1">${fmtP(curP)}</td>
                    <td className={`py-1 ${pnl >= 0 ? 'text-wr-green' : 'text-wr-red'}`}>
                      {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%
                    </td>
                    <td className="py-1">${fmtN(p.amount * curP)}</td>
                    <td className="py-1">
                      <button className="wr-btn red text-[7px] px-1 py-0" onClick={() => onRemove(s)}>✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-wr-bg3 border border-wr-border p-2 text-center">
              <div className="font-head text-sm text-wr-white">${fmtN(totalVal)}</div>
              <div className="text-[7px] text-wr-muted tracking-widest">TOTAL VALUE</div>
            </div>
            <div className="bg-wr-bg3 border border-wr-border p-2 text-center">
              <div className={`font-head text-sm ${totalPnl >= 0 ? 'text-wr-green' : 'text-wr-red'}`}>
                {totalPnl >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%
              </div>
              <div className="text-[7px] text-wr-muted tracking-widest">TOTAL PNL</div>
            </div>
            <div className="bg-wr-bg3 border border-wr-border p-2 text-center">
              <div className="font-head text-sm text-wr-white">{entries.length}</div>
              <div className="text-[7px] text-wr-muted tracking-widest">HOLDINGS</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ══ SENTIMENT CONTENT ════════════════════════════════════════════════════════ */
function SentimentContent({ coins, aiKey }: { coins: CoinData[]; aiKey: string }) {
  const critCount = coins.filter(c => c.threat === 'CRITICAL').length;
  const highCount = coins.filter(c => c.threat === 'HIGH').length;
  const washCount = coins.filter(c => c.category === 'WASH').length;

  // analyzeSentiment() (lib/analyzeToken.ts) is a real Claude call — the
  // same pattern WRScanner's per-coin "AI ANALYZE" already uses — that
  // existed with no caller. This modal previously showed canned template
  // text under an "✦ AI ASSESSMENT" label without ever calling AI at all,
  // even though it already required an AI key to display anything.
  const [text, setText] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const run = useCallback(async () => {
    if (!aiKey || coins.length === 0) return;
    setLoading(true);
    setError(false);
    try {
      const result = await analyzeSentiment(coins, aiKey);
      setText(result);
      setError(!result || result.startsWith('AI error') || result.startsWith('AI rate limited'));
    } catch {
      setText('AI analysis failed');
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [aiKey, coins]);

  // Fetch once when the modal opens with a usable coin list — not on every
  // render, and analyzeSentiment()'s own cache (keyed by the risk-count
  // signature, see analyzeToken.ts) keeps a re-open right after from
  // spending a second API call on an unchanged picture.
  useEffect(() => { void run(); }, [run]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
          <div className="text-[7px] text-wr-muted tracking-widest mb-1">CRITICAL</div>
          <div className="font-head text-xl text-wr-red">{critCount}</div>
        </div>
        <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
          <div className="text-[7px] text-wr-muted tracking-widest mb-1">HIGH</div>
          <div className="font-head text-xl text-wr-amber">{highCount}</div>
        </div>
        <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
          <div className="text-[7px] text-wr-muted tracking-widest mb-1">WASH</div>
          <div className="font-head text-xl text-wr-purple">{washCount}</div>
        </div>
      </div>
      {!aiKey ? (
        <p className="text-center text-wr-muted text-xs py-4">Enter AI key in ⚙ Settings to enable sentiment analysis</p>
      ) : (
        <div className="border-t border-wr-purple/30 pt-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[8px] text-wr-purple tracking-widest">✦ AI ASSESSMENT</div>
            <button className="wr-btn text-[7px] px-1.5" onClick={() => void run()} disabled={loading}>
              {loading ? '…' : '↻ REGENERATE'}
            </button>
          </div>
          {loading && !text ? (
            <p className="text-[10px] text-wr-muted py-2">Analyzing {coins.length} scanned tokens…</p>
          ) : (
            <p className={`text-[10px] leading-relaxed whitespace-pre-line ${error ? 'text-wr-amber' : 'text-wr-white'}`}>
              {text ?? 'No response'}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
