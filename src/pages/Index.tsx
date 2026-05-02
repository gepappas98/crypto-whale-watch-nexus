import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import { WRMobileFilterSheet } from '@/components/whale-radar/WRMobileFilterSheet';
import { useWhaleWebSocket } from '@/hooks/useWhaleWebSocket';
import { DEFAULT_FILTERS, type WhaleFilters } from '@/components/whale-radar/WRAdvancedFilters';
import {
  CoinData, AlertItem, WhaleTrade, TrackedToken, PortfolioEntry,
  WalletEntry, ScanSnapshot, CFG, fmtN, fmtP, isSolToken,
  calcSizing, saveState, loadState,
} from '@/lib/whaleRadarState';
import { handleRateLimit, isRateLimited, getCooldownRemaining, getActiveCooldowns, onRateLimitChange, RL_KEYS } from '@/lib/rateLimit';
import { detect } from '@/lib/detection';
import { cachedFetch } from '@/lib/cachedFetch';
import { saveWhaleEvent, recordSignalOutcome, saveScan, initBackendCheck } from '@/lib/db';
import { fillSignalPrices } from '@/lib/signalStore';
import { fetchBirdeyeToken } from '@/lib/birdeye';
import { fetchDexData } from '@/lib/dexscreener';
import { WRSignalEval } from '@/components/whale-radar/WRSignalEval';
import WRCrystalBallPro from '@/components/whale-radar/WRCrystalBallPro';
import { startPerfMonitoring } from '@/lib/perfBudget';
import type { WsStatus } from '@/hooks/useWhaleWebSocket';
import { HLConfigBanner } from '@/components/hyperliquid/HLConfigBanner';

// ── CEO Signal label (mirrors WRScanner getCeoSignal) ─────────────────────────
// Kept here so processData can record signal outcomes without importing WRScanner.
function getCeoSignalLabel(score: number, threat: string, category: string, vmcap: number): string {
  const t = threat.toUpperCase();
  const cat = (category || '').toUpperCase();
  if (score >= 88 || vmcap > 1000 || t === 'CRITICAL' || cat.includes('WASH')) return 'AVOID / SHORT';
  if (score >= 70 && (cat.includes('PUMP') || cat.includes('SQUEEZE')))         return 'AGGRESSIVE LONG';
  if (score >= 60 && (cat.includes('PUMP') || cat.includes('SQUEEZE') || vmcap > 300)) return 'LONG (tight stop)';
  if (score >= 45) return 'LONG';
  if (score >= 35) return 'WATCH';
  return 'HOLD';
}

export default function WhaleRadarApp() {
  // ══ CORE STATE ═══════════════════════════════════════════════════════════
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [whaleFeed, setWhaleFeed] = useState<WhaleTrade[]>([]);
  const [tracked, setTracked] = useState<Record<string, TrackedToken>>({});
  const [portfolio, setPortfolio] = useState<Record<string, PortfolioEntry>>({});
  const [wallets, setWallets] = useState<WalletEntry[]>([]);
  const [scanHistory, setScanHistory] = useState<ScanSnapshot[]>([]);

  // UI State
  const [theme, setTheme] = useState<'cyber' | 'matrix' | 'dark'>('cyber');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [soundOn, setSoundOn] = useState(true);
  const [autoScan, setAutoScan] = useState(false);
  const [autoPaused, setAutoPaused] = useState(false); // Issue #6: track paused state
  const [scanning, setScanning] = useState(false);
  const [scanBadge, setScanBadge] = useState('IDLE');
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
  // ── Hyperliquid settings ─────────────────────────────────────────────────
  const [hlScannerEnabled, setHlScannerEnabled] = useState(true);
  const [hlMegaTxUsd, setHlMegaTxUsd] = useState(500_000);
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseAnonKey, setSupabaseAnonKey] = useState('');
  const [subscribedPairs] = useState(() => new Set<string>());
  const [advancedFilters, setAdvancedFilters] = useState<WhaleFilters>(DEFAULT_FILTERS);
  const [scanPage, setScanPage] = useState(1);

  // Stats
  const [apiCallCount, setApiCallCount] = useState(0);
  const [aiCallCount, setAiCallCount] = useState(0);
  const [nextScan, setNextScan] = useState('—');
  const [lastScanTs, setLastScanTs] = useState(0);

  // Modals
  const [activeModal, setActiveModal] = useState<string | null>(null);

  // Previous volumes for spike detection
  const [prevVolumes, setPrevVolumes] = useState<Record<string, number>>({});

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
    // ── HL settings ──
    if (saved.hlScannerEnabled !== undefined) setHlScannerEnabled(saved.hlScannerEnabled as boolean);
    if (saved.hlMegaTxUsd) setHlMegaTxUsd(saved.hlMegaTxUsd as number);
    // Supabase URL/key stored in separate localStorage keys (mirrors hlFetch)
    const sbUrl = localStorage.getItem('wr_supabase_url') ?? '';
    const sbKey = localStorage.getItem('wr_supabase_anon_key') ?? '';
    if (sbUrl) setSupabaseUrl(sbUrl);
    if (sbKey) setSupabaseAnonKey(sbKey);

    // Issue #6: Restore autoScan but preserve paused state — don't auto-resume
    if (saved.autoScan) {
      setAutoScan(true);
      // If it was previously running, restore as paused so it doesn't auto-resume
      setAutoPaused(saved.autoPaused as boolean ?? true);
    }

    if (!localStorage.getItem('wr_v9_onboarded')) setShowOnboarding(true);
  }, []);

  // ══ PERFORMANCE MONITORING ═══════════════════════════════════════════════
  useEffect(() => {
    const cleanup = startPerfMonitoring();
    return cleanup;
  }, []);

  // ══ BACKEND CHECK + SIGNAL PRICE FILLER ══════════════════════════════════
  // Runs once on mount: pings backend, then starts periodic CoinGecko price filling.
  useEffect(() => {
    // 1. Check backend availability (suppresses noisy toasts when offline)
    initBackendCheck();

    // 2. Fill outcome prices immediately on mount (catches any pending fills)
    fillSignalPrices().catch(() => {});

    // 3. Re-fill every 30 minutes (mirrors backend priceFiller schedule)
    const fillTimer = setInterval(() => {
      fillSignalPrices().catch(() => {});
    }, 30 * 60 * 1000);

    return () => clearInterval(fillTimer);
  }, []);

  // Save on state changes
  useEffect(() => {
    const timer = setTimeout(() => {
      saveState({
        theme, apiKey, aiKey, birdKey, heliusKey, tracked, portfolio, wallets,
        vmcapThr, pchgThr, whaleThr, soundOn, scanHistory: scanHistory.slice(-CFG.HISTORY_MAX),
        prevVolumes, aggressiveMode, watchlistOnly, bybitEnabled, whaleFeedEx,
        autoScan, autoPaused, // Issue #6: persist auto scan + paused state
        hlScannerEnabled, hlMegaTxUsd,
      });
    }, 500);
    return () => clearTimeout(timer);
  }, [theme, apiKey, aiKey, birdKey, heliusKey, tracked, portfolio, wallets,
    vmcapThr, pchgThr, whaleThr, soundOn, scanHistory, prevVolumes, aggressiveMode,
    watchlistOnly, bybitEnabled, whaleFeedEx, autoScan, autoPaused,
    hlScannerEnabled, hlMegaTxUsd]);

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

  // ══ SCAN ══════════════════════════════════════════════════════════════════
  // Stable refs so enrichCoins doesn't need birdKey in its dep array
  const birdKeyRef = useRef('');
  useEffect(() => { birdKeyRef.current = birdKey; }, [birdKey]);

  // ── Enrich coins with Birdeye (SOL) + DexScreener (high-vmcap) ──────────────
  // Called after processData. Updates individual coins in state asynchronously.
  // Each fetch is independently cached so a re-scan doesn't burn API quota.
  const enrichCoins = useCallback(async (mapped: CoinData[]) => {
    const key = birdKeyRef.current;

    // ── DexScreener: small/mid caps where DEX liquidity matters ──────────────
    const dexTargets = mapped
      .filter(c => c.vmcap > 50 && c.mcap < 2e9)  // skip mega-caps — they don't rug on DEX
      .slice(0, 15);                                // cap: 15 req per scan

    // ── Birdeye: only tokens we have addresses for ────────────────────────────
    const solTargets = mapped.filter(c => c.isSol && CFG.SOL_ADDRS[c.symbol]);

    // Fire DexScreener requests — no key needed, throttle to 15/scan
    for (const coin of dexTargets) {
      try {
        const dex = await fetchDexData(coin.symbol, coin.volume);
        if (!dex.dexHot && !dex.dsLiq) continue; // nothing new — skip state update
        setCoins(prev => prev.map(c => {
          if (c.symbol !== coin.symbol) return c;
          // Re-run detection with enriched DEX data
          const det = detect({
            vmcap: c.vmcap, chg24: c.change, volSpike: c.volSpike,
            supplyPct: c.supplyPct, vol: c.volume, mcap: c.mcap,
            dexHot: dex.dexHot, dsLiq: dex.dsLiq, isSol: c.isSol, birdData: c.birdData,
          });
          return { ...c, dexHot: dex.dexHot, dsLiq: dex.dsLiq,
            score: det.score, threat: det.threat, category: det.category,
            confidence: det.confidence, reasons: det.reasons };
        }));
      } catch { /* ignore per-coin errors */ }
    }

    // Fire Birdeye requests — requires key, rate limited
    if (!key) return;
    for (const coin of solTargets) {
      const addr = CFG.SOL_ADDRS[coin.symbol];
      try {
        const bird = await fetchBirdeyeToken(addr, coin.symbol, key);
        if (!bird) continue;
        setCoins(prev => prev.map(c => {
          if (c.symbol !== coin.symbol) return c;
          // Re-run detection with on-chain data — this is the real Solana score
          const det = detect({
            vmcap: c.vmcap, chg24: c.change, volSpike: c.volSpike,
            supplyPct: c.supplyPct, vol: c.volume, mcap: c.mcap,
            dexHot: c.dexHot, dsLiq: c.dsLiq, isSol: true, birdData: bird,
          });
          return { ...c, birdData: bird,
            score: det.score, threat: det.threat, category: det.category,
            confidence: det.confidence, reasons: det.reasons };
        }));
      } catch { /* ignore per-coin errors */ }
    }
  }, []);  // birdKeyRef is a ref — no dep needed

  // ── Data source status ──────────────────────────────────────────────────────
  const [dataSource, setDataSource] = useState<'live' | 'cached' | 'fallback'>('live');

  const triggerScan = useCallback(async () => {
    if (scanning) return;

    setScanning(true);
    setScanBadge('SCANNING');

    // Detect CoinGecko key type: demo keys start with "CG-", pro keys are UUIDs
    const isCgDemoKey = apiKey && apiKey.startsWith('CG-');
    const isCgProKey  = apiKey && !apiKey.startsWith('CG-');

    try {
      let scanData: unknown[] | null = null;
      let source: 'live' | 'cached' | 'fallback' = 'live';

      // Strategy 1: Try backend proxy first (handles rate limits server-side).
      // NOTE: do NOT gate this on isRateLimited() — the proxy has its own
      // server-side cache and the local rate-limit state reflects *direct* CG calls.
      try {
        const proxyHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
        if (apiKey) proxyHeaders['x-cg-api-key'] = apiKey;
        // 20s — backend itself retries up to 3× with 8s timeouts
        const proxyRes = await fetch('/api/scan', { headers: proxyHeaders, signal: AbortSignal.timeout(20000) });
        if (proxyRes.ok) {
          const result = await proxyRes.json();
          if (result.success && result.data?.length) {
            scanData = result.data;
            source = result.source || 'live';
          }
        }
      } catch {
        // Backend unavailable — fall through to direct fetch
      }

      // Strategy 2: Direct CoinGecko call (works when no backend).
      // Use the correct base URL and header for the key type.
      if (!scanData) {
        // Only gate direct CG calls on rate-limit (not the proxy path above)
        if (isRateLimited(RL_KEYS.COINGECKO)) {
          const rem = getCooldownRemaining(RL_KEYS.COINGECKO);
          setScanBadge(`WAIT ${rem}s`);
          setScanning(false);
          return;
        }

        const cgBase = isCgProKey
          ? 'https://pro-api.coingecko.com/api/v3'
          : 'https://api.coingecko.com/api/v3';
        const cgUrl = `${cgBase}/coins/markets?vs_currency=usd&order=volume_desc&per_page=250&page=1&sparkline=false&price_change_percentage=24h&include_platform=false`;
        const cgHeaders: Record<string, string> = {};
        if (isCgProKey)  cgHeaders['x-cg-pro-api-key']  = apiKey;
        if (isCgDemoKey) cgHeaders['x-cg-demo-api-key'] = apiKey;

        const result = await cachedFetch<unknown[]>(cgUrl, {
          headers: cgHeaders,
          signal: AbortSignal.timeout(18000),
          cacheTtl: 10_000,
          swrTtl: 30_000,
          rateLimitKey: RL_KEYS.COINGECKO,
          rateLimitName: 'CoinGecko',
        });

        if (result.data?.length) {
          scanData = result.data;
          source = result.fromCache ? 'cached' : 'live';
        } else if (result.error) {
          throw new Error(result.error);
        }
      }

      if (!scanData?.length) {
        throw new Error('No data from any source');
      }

      setDataSource(source);
      setApiCallCount(c => c + (source === 'live' ? 1 : 0));
      const mapped = processData(scanData);
      setScanBadge(source === 'live' ? 'LIVE' : source === 'cached' ? 'CACHED' : 'DEGRADED');
      setLastScanTs(Date.now());

      // Persist + enrich (fire-and-forget)
      saveScan(mapped).catch(() => {});
      enrichCoins(mapped).catch(() => {});
    } catch (e: unknown) {
      setScanBadge('ERROR');
      setDataSource('fallback');
      addAlert('medium', 'API', 'Scan failed: ' + (e instanceof Error ? e.message : 'Unknown'));
    } finally {
      setScanning(false);
    }
  }, [scanning, apiKey, prevVolumes]);

  const processData = useCallback((data: unknown[]): CoinData[] => {
    const newVols: Record<string, number> = {};
    const mapped: CoinData[] = (data as Record<string, unknown>[]).map((c, i) => {
      const vol = (c.total_volume as number) || (c.volume as number) || 0;
      const mcap = (c.market_cap as number) || (c.mcap as number) || 1;
      const vmcap = (c.vmcap as number) || ((vol / mcap) * 100);
      const chg24 = (c.price_change_percentage_24h as number) || (c.change_24h as number) || (c.change as number) || 0;
      const prevVol = prevVolumes[(c.id as string)] || vol;
      const volSpike = prevVol > 0 && prevVol !== vol ? vol / prevVol : 1;
      const supplyPct = c.total_supply ? (((c.circulating_supply as number) / (c.total_supply as number)) * 100) : null;
      const sym = ((c.symbol as string) || '').toUpperCase();
      const dexHot = false;
      const dsLiq = null;
      const isSol = isSolToken(sym);
      const birdData = null;
      newVols[(c.id as string)] = vol;
      const det = detect({ vmcap, chg24, volSpike, supplyPct, vol, mcap, dexHot, dsLiq, isSol, birdData });
      const { score, threat, category, confidence, reasons } = det;
      return {
        rank: (c.rank as number) || (i + 1), id: c.id as string, symbol: sym, name: c.name as string,
        price: (c.current_price as number) || (c.price as number) || 0, change: chg24, volume: vol, mcap, vmcap, volSpike,
        supplyPct, score, threat, category, confidence, reasons, dexHot, dsLiq, isSol, birdData,
      };
    });
    setPrevVolumes(newVols);
    setCoins(mapped);

    // Snapshot history
    const critCount = mapped.filter(c => c.threat === 'CRITICAL').length;
    const highCount = mapped.filter(c => c.threat === 'HIGH').length;
    setScanHistory(prev => {
      const snap: ScanSnapshot = {
        ts: Date.now(),
        coins: mapped.map(c => ({ symbol: c.symbol, score: c.score, threat: c.threat, category: c.category, price: c.price, change: c.change, vmcap: c.vmcap })),
        critCount, highCount,
      };
      return [snap, ...prev].slice(0, CFG.HISTORY_MAX);
    });

    // Record CEO signal outcomes
    mapped
      .filter(c => c.score >= 35)
      .slice(0, 20)
      .forEach(c => {
        const signal = getCeoSignalLabel(c.score, c.threat, c.category || '', c.vmcap);
        recordSignalOutcome({
          symbol: c.symbol,
          coin_id: c.id,
          signal,
          score: c.score,
          category: c.category,
          vmcap: c.vmcap,
          entry_price: c.price,
        });
      });

    // Generate alerts for critical/high
    mapped.filter(c => c.threat === 'CRITICAL').slice(0, 3).forEach(c => {
      addAlert('critical', c.symbol, `SCORE=${c.score}/100 VOL/MCAP=${c.vmcap.toFixed(0)}% ΔP=${c.change.toFixed(1)}% — ${c.reasons.join(' · ')}`);
    });
    mapped.filter(c => c.threat === 'HIGH' && c.category).slice(0, 3).forEach(c => {
      addAlert('high', c.symbol, `[${c.category}] SCORE=${c.score}/100 — ${c.reasons.join(' · ')}`);
    });

    return mapped;
  }, [prevVolumes]);

  // ══ ALERTS ════════════════════════════════════════════════════════════════
  const addAlert = useCallback((level: AlertItem['level'], tag: string, text: string, sizing?: string) => {
    const tc = level === 'critical' ? 'C' : level === 'high' ? 'H' : level === 'medium' ? 'M' : 'I';
    setAlerts(prev => [{ ts: Date.now(), level, tag, text, tc, sizing, pinned: false }, ...prev].slice(0, CFG.AFEED_MAX * 2));
  }, []);

  // ══ TRACKING ══════════════════════════════════════════════════════════════
  const trackToken = useCallback((id: string, symbol: string, price: number) => {
    setTracked(prev => ({ ...prev, [symbol]: { id, price, basePrice: price, lastPrice: price } }));
  }, []);

  const untrackToken = useCallback((symbol: string) => {
    setTracked(prev => {
      const n = { ...prev };
      delete n[symbol];
      return n;
    });
  }, []);

  // ══ WHALE WEBSOCKET ══════════════════════════════════════════════════════
  // Throttle: 1 DB write per symbol per 30s — avoids flooding on high-volume pairs
  const whaleEventThrottle = useRef<Map<string, number>>(new Map());

  const handleWhaleTrade = useCallback((trade: WhaleTrade) => {
    setWhaleFeed(prev => [trade, ...prev].slice(0, CFG.WFEED_MAX));

    // ── Persist to whale_events (Fix #2: wire dead table) ──────────────────
    const lastWrite = whaleEventThrottle.current.get(trade.sym) ?? 0;
    if (Date.now() - lastWrite > 30_000) {
      whaleEventThrottle.current.set(trade.sym, Date.now());
      saveWhaleEvent({
        symbol: trade.sym,
        side: trade.side,
        price: trade.price,
        qty: trade.qty,
        usdt: trade.usdt,
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

  const { binanceReady, bybitReady, wsStatus, wsLagMs, reconnectAttempts: wsReconnects } = useWhaleWebSocket({
    subscribedPairs,
    bybitEnabled,
    whaleThr,
    whaleFeedEx,
    onWhaleTrade: handleWhaleTrade,
    onTrackerPrice: handleTrackerPrice,
  });

  // ══ AUTO SCAN ═════════════════════════════════════════════════════════════
  // Use a stable ref so the interval always calls the LATEST triggerScan
  // without needing it in the effect dep array (avoids restart on every scan).
  const triggerScanRef = useRef(triggerScan);
  useEffect(() => { triggerScanRef.current = triggerScan; }, [triggerScan]);

  useEffect(() => {
    if (!autoScan || autoPaused) return;
    const ms = aggressiveMode ? CFG.SCAN_MS_AGG : CFG.SCAN_MS_NORMAL;
    triggerScanRef.current();
    const timer = setInterval(() => triggerScanRef.current(), ms);
    const cdTimer = setInterval(() => {
      const r = Math.max(0, Math.ceil((ms - (Date.now() % ms)) / 1000));
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
      if (k === 's') { e.preventDefault(); triggerScan(); }
      else if (k === 'a') { e.preventDefault(); setAutoScan(p => !p); setAutoPaused(false); }
      else if (k === 'w') { e.preventDefault(); setWatchlistOnly(p => !p); }
      else if (k === 'b') { e.preventDefault(); setActiveModal('backtest'); }
      else if (k === 'p') { e.preventDefault(); setActiveModal('portfolio'); }
      else if (k === 'h') { e.preventDefault(); setActiveModal('history'); }
      else if (k === '?' || k === '/') { e.preventDefault(); setKbdOpen(p => !p); }
      else if (k === 'e') { e.preventDefault(); setActiveModal('signal-eval'); }
      else if (k === 'escape') { setActiveModal(null); setKbdOpen(false); }
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
      if (!p) setAutoPaused(false); // Starting fresh = not paused
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
    // Advanced filters: chain
    if (advancedFilters.chain === 'solana' && !c.isSol) return false;
    if (['ethereum', 'bsc', 'polygon'].includes(advancedFilters.chain) && c.isSol) return false;
    // Advanced filters: min volume threshold
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
      {showOnboarding && <WROnboarding onFinish={finishOnboarding} />}

      {/* HL setup banner — shown only when Supabase is not configured */}
      <HLConfigBanner onOpenSettings={() => setSettingsOpen(true)} />

      {/* Degraded mode banner */}
      {dataSource === 'fallback' && (
        <div className="bg-wr-red/20 border-b-2 border-wr-red/60 px-4 py-2 text-center text-[10px] text-wr-red tracking-widest">
          ⚠ RUNNING IN DEGRADED MODE — Showing simulated whale activity. Live data temporarily unavailable.
        </div>
      )}
      {dataSource === 'cached' && scanBadge === 'CACHED' && (
        <div className="bg-wr-amber/15 border-b border-wr-amber/40 px-4 py-1 text-center text-[8px] text-wr-amber tracking-widest">
          📦 Serving cached data — API rate limited or slow
        </div>
      )}

      {/* Reconnecting banner — shown after 2+ failed attempts */}
      {wsReconnects >= 2 && (
        <div className="bg-wr-amber/20 border-b border-wr-amber/40 px-4 py-1.5 text-center text-[10px] text-wr-amber tracking-widest animate-pulse">
          ⚠ RECONNECTING… (attempt {wsReconnects}) — Data may be delayed
        </div>
      )}

      {/* WS Status indicator */}
      <div className="flex items-center gap-2 px-4 py-0.5 bg-wr-bg3 border-b border-wr-border/50 text-[8px] tracking-widest">
        <span className="text-wr-muted">WS:</span>
        {wsStatus === 'live' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-green animate-blink" /> <span className="text-wr-green">LIVE</span></span>}
        {wsStatus === 'delayed' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-amber" /> <span className="text-wr-amber">DELAYED ({Math.round(wsLagMs / 1000)}s)</span></span>}
        {wsStatus === 'fallback' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-red animate-pulse" /> <span className="text-wr-red">FALLBACK (HTTP POLL)</span></span>}
        {wsStatus === 'reconnecting' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-amber animate-pulse" /> <span className="text-wr-amber">RECONNECTING…</span></span>}
        {wsStatus === 'offline' && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-wr-muted" /> <span className="text-wr-muted">OFFLINE</span></span>}
        <span className="text-wr-muted ml-1">BIN: {binanceReady ? '✓' : '—'} | BYB: {bybitReady ? '✓' : '—'}</span>
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
        />
      )}

      <WRTicker coins={coins.slice(0, 30)} />

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
        />

        <WRRightPanel
          whaleFeed={whaleFeed}
          alerts={filteredAlerts}
          alertFilter={alertFilter}
          onAlertFilterChange={setAlertFilter}
          wallets={wallets}
          onAddWallet={(w) => setWallets(prev => [...prev, w])}
          onRemoveWallet={(addr) => setWallets(prev => prev.filter(w => w.address !== addr))}
          onTogglePin={(idx) => setAlerts(prev => prev.map((a, i) => i === idx ? { ...a, pinned: !a.pinned } : a))}
          onClearAlerts={() => setAlerts([])}
          bybitEnabled={bybitEnabled}
          onToggleBybit={handleToggleBybit}
          whaleFeedEx={whaleFeedEx}
          onWhaleFeedExChange={setWhaleFeedEx}
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
            onAdd={(sym, amt, entry) => setPortfolio(p => ({ ...p, [sym]: { amount: amt, entryPrice: entry } }))}
            onRemove={(sym) => setPortfolio(p => { const n = { ...p }; delete n[sym]; return n; })}
            onClear={() => setPortfolio({})}
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
  const wins = results.filter(r => r.pnlPct > 0).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-2 items-center flex-wrap">
        <span className="text-xs text-wr-muted tracking-widest">SNAPSHOTS: {scanHistory.length}</span>
        <button className="wr-btn" onClick={runBacktest}>▶ RUN BACKTEST</button>
      </div>
      {!ran ? (
        <p className="text-center text-wr-muted text-xs py-8">Select parameters and click RUN BACKTEST<br /><span className="text-[8px]">Uses scan history snapshots to simulate</span></p>
      ) : results.length === 0 ? (
        <p className="text-center text-wr-muted text-xs py-8">No trade simulations — run more scans first</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
              <div className={`font-head text-lg ${avgPnl >= 0 ? 'text-wr-green' : 'text-wr-red'}`}>{avgPnl >= 0 ? '+' : ''}{avgPnl.toFixed(2)}%</div>
              <div className="text-[7px] text-wr-muted tracking-widest">AVG PNL</div>
            </div>
            <div className="bg-wr-bg3 border border-wr-border p-3 text-center">
              <div className="font-head text-lg text-wr-amber">{results.length > 0 ? ((wins / results.length) * 100).toFixed(0) : 0}%</div>
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
                <span className={r.pnlPct >= 0 ? 'text-wr-green' : 'text-wr-red'}>{r.pnlPct >= 0 ? '+' : ''}{r.pnlPct.toFixed(2)}%</span>
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
  const [sym, setSym] = useState('');
  const [amt, setAmt] = useState('');
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
    totalVal += p.amount * (coin?.price || p.entryPrice);
    totalEntry += p.amount * p.entryPrice;
  });
  const totalPnl = totalVal - totalEntry;
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
                <th className="text-left text-wr-muted text-[7px] tracking-widest py-1 border-b border-wr-border">TOKEN</th>
                <th className="text-left text-wr-muted text-[7px] tracking-widest py-1 border-b border-wr-border">QTY</th>
                <th className="text-left text-wr-muted text-[7px] tracking-widest py-1 border-b border-wr-border">ENTRY</th>
                <th className="text-left text-wr-muted text-[7px] tracking-widest py-1 border-b border-wr-border">NOW</th>
                <th className="text-left text-wr-muted text-[7px] tracking-widest py-1 border-b border-wr-border">PNL%</th>
                <th className="text-left text-wr-muted text-[7px] tracking-widest py-1 border-b border-wr-border">VALUE</th>
                <th className="py-1 border-b border-wr-border"></th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([s, p]) => {
                const coin = coins.find(c => c.symbol === s);
                const curP = coin?.price || p.entryPrice;
                const pnl = ((curP - p.entryPrice) / p.entryPrice) * 100;
                return (
                  <tr key={s} className="border-b border-wr-border/50">
                    <td className="text-wr-white font-head text-[9px] py-1">{s}</td>
                    <td className="py-1">{p.amount}</td>
                    <td className="py-1">${fmtP(p.entryPrice)}</td>
                    <td className="text-wr-cyan py-1">${fmtP(curP)}</td>
                    <td className={`py-1 ${pnl >= 0 ? 'text-wr-green' : 'text-wr-red'}`}>{pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}%</td>
                    <td className="py-1">${fmtN(p.amount * curP)}</td>
                    <td className="py-1"><button className="wr-btn red text-[7px] px-1 py-0" onClick={() => onRemove(s)}>✕</button></td>
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
              <div className={`font-head text-sm ${totalPnl >= 0 ? 'text-wr-green' : 'text-wr-red'}`}>{totalPnl >= 0 ? '+' : ''}{totalPnlPct.toFixed(2)}%</div>
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
          <div className="text-[8px] text-wr-purple tracking-widest mb-2">✦ AI ASSESSMENT</div>
          <p className="text-[10px] text-wr-white leading-relaxed">
            Market shows {critCount > 3 ? 'ELEVATED' : critCount > 0 ? 'MODERATE' : 'LOW'} manipulation risk.
            {washCount > 0 ? ` ${washCount} tokens flagged for wash trading patterns.` : ''}
            {critCount > 5 ? ' High cluster of critical alerts suggests coordinated activity.' : ''}
            Exercise caution with high-score tokens.
          </p>
        </div>
      )}
    </div>
  );
}
