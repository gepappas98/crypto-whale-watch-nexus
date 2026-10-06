/* ══ useMarketData — scan engine state + orchestration ═══════════════════════
 * Owns all coin-scan state and operations. Index.tsx becomes a thin container
 * that wires this hook to UI components.
 *
 * Owned state:
 *   coins, prevVolumes, scanHistory, scanning, scanBadge, dataSource,
 *   apiCallCount, lastScanTs
 *
 * Injected (via params, not subscribed for re-render):
 *   apiKey       — CoinGecko key (string ref read on each scan)
 *   getBirdKey   — getter for current Birdeye key (avoids hook re-render on key change)
 *   addAlert     — alert sink callback (kept stable by caller)
 *
 * Cancellation: every scan creates a fresh AbortController; the previous one
 * is aborted. Unmount aborts in-flight requests.
 *
 * NOISE CONTROL (new):
 *   Before a coin is eligible to fire an alert or a recorded signal, it must
 *   pass applyPairFilters() (dead pairs / bad ticks / illiquid DEX pools /
 *   too-new tokens — see lib/pairFilters.ts). Coins that fail still show up
 *   in the main table with their real score; they just don't spam alerts.
 *
 *   Every alert that *does* pass filtering still has to clear
 *   alertCooldown.checkAndRecord() (per-symbol + global circuit breaker —
 *   see lib/alertCooldown.ts) before it reaches addAlert(). This stops a
 *   single flapping symbol, or a bad API snapshot, from flooding the feed.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runScan, isScanError } from '@/services/api';
import { getCeoSignalLabel, MCAP_MIN_RELIABLE } from '@/services/signals';
import { detect } from '@/lib/detection';
import { fetchBirdeyeToken } from '@/lib/birdeye';
import { fetchDexData } from '@/lib/dexscreener';
import { recordSignalOutcome, saveScan } from '@/lib/db';
import { applyPairFilters } from '@/lib/pairFilters';
import { alertCooldown } from '@/lib/alertCooldown';
import { dispatchNotification } from '@/lib/notifyChannels';
import { buildCouncilContext } from '@/lib/council/context';
import {
  buildReflection,
  loadCouncilMemory,
  runCouncil,
  saveCouncilDecision,
} from '@/lib/council/api';
import type { AgentId } from '@/types/council';
import { getSizingHint } from '@/lib/sizingHint';
import { getRemotePairListUrl, fetchRemotePairList } from '@/lib/nexus/remotePairList';
import {
  CoinData, CFG, ScanSnapshot, WhaleTrade, isSolToken,
} from '@/lib/whaleRadarState';

type AlertLevel = 'critical' | 'high' | 'medium' | 'info';
type AddAlert = (
  level: AlertLevel, tag: string, text: string, sizing?: string,
  coinId?: string | null, entryPrice?: number | null,
) => void;
type DataSource = 'live' | 'cached' | 'fallback';

const AUTO_COUNCIL_INTERVAL_MS = 30 * 60 * 1000;
const AUTO_COUNCIL_MAX_CANDIDATES = 3;
const AUTO_COUNCIL_FALLBACK_CANDIDATES = 1;
const AUTO_COUNCIL_DELAY_MS = 5000;

export interface UseMarketDataOptions {
  apiKey: string;
  /** Returns the latest Birdeye key without re-rendering the hook. */
  getBirdKey: () => string;
  /** Alert sink — callers should pass a stable ref-backed function. */
  addAlert: AddAlert;
  /** Optional initial state (e.g. from persistence). */
  initialPrevVolumes?: Record<string, number>;
  initialScanHistory?: ScanSnapshot[];
  /** Latest shared context used by the autonomous Council; read at execution time. */
  getCouncilContextExtras?: () => { whaleTrades?: WhaleTrade[]; regime?: import('@/lib/regime/types').RegimeReading | null };
}

export interface UseMarketDataResult {
  coins: CoinData[];
  setCoins: React.Dispatch<React.SetStateAction<CoinData[]>>;
  scanning: boolean;
  scanBadge: string;
  dataSource: DataSource;
  apiCallCount: number;
  lastScanTs: number;
  prevVolumes: Record<string, number>;
  setPrevVolumes: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  scanHistory: ScanSnapshot[];
  setScanHistory: React.Dispatch<React.SetStateAction<ScanSnapshot[]>>;
  triggerScan: () => Promise<void>;
  /** Symbols/global currently muted by the alert cooldown — for a status badge. */
  getAlertLocks: () => ReturnType<typeof alertCooldown.getActiveLocks>;
  /** Coins pairFilters.ts kept out of alerting on the most recent scan, with why —
   *  previously only logged to console.debug; exposed here so the UI can show it. */
  lastFiltered: { symbol: string; reason: string }[];
}

export function useMarketData({
  apiKey,
  getBirdKey,
  addAlert,
  initialPrevVolumes = {},
  initialScanHistory = [],
  getCouncilContextExtras,
}: UseMarketDataOptions): UseMarketDataResult {
  const [coins,        setCoins]        = useState<CoinData[]>([]);
  const [lastFiltered, setLastFiltered] = useState<{ symbol: string; reason: string }[]>([]);
  const [scanning,     setScanning]     = useState(false);
  const [scanBadge,    setScanBadge]    = useState('IDLE');
  const [dataSource,   setDataSource]   = useState<DataSource>('live');
  const [apiCallCount, setApiCallCount] = useState(0);
  const [lastScanTs,   setLastScanTs]   = useState(0);
  const [prevVolumes,  setPrevVolumes]  = useState<Record<string, number>>(initialPrevVolumes);
  const [scanHistory,  setScanHistory]  = useState<ScanSnapshot[]>(initialScanHistory);

  // Autonomous Agent Council runner: restores the historical candidate→Council
  // flow without making the UI modal or manual button part of the dependency.
  const coinsRef = useRef<CoinData[]>([]);
  const councilBusyRef = useRef(false);
  const councilLastRunRef = useRef<Map<string, number>>(new Map());
  const autoCouncilRef = useRef<(() => Promise<void>) | null>(null);

  // Keep the latest scan available to the autonomous Council runner even while
  // enrichCoins updates individual rows asynchronously.
  useEffect(() => { coinsRef.current = coins; }, [coins]);

  // Stable ref for addAlert — caller may pass a fresh closure each render.
  const addAlertRef = useRef<AddAlert>(addAlert);
  useEffect(() => { addAlertRef.current = addAlert; }, [addAlert]);

  // Gate every alert through the cooldown/circuit-breaker before it reaches the UI sink.
  const guardedAddAlert = useCallback<AddAlert>((level, tag, text, sizing, coinId, entryPrice) => {
    const { allowed, reason } = alertCooldown.checkAndRecord(tag, level);
    if (!allowed) {
      console.debug(`[useMarketData] alert suppressed for ${tag}: ${reason}`);
      return;
    }
    addAlertRef.current(level, tag, text, sizing, coinId, entryPrice);
    // Fan out to Discord/Telegram if configured — see lib/notifyChannels.ts.
    // Only alerts that survived the cooldown gate reach here, so external
    // channels get the same noise reduction as the in-app feed.
    dispatchNotification(level, tag, text);
  }, []);

  const apiKeyRef = useRef(apiKey);
  useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);

  // Cancellable per-scan controller
  const scanAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { try { scanAbortRef.current?.abort(); } catch { /* already aborted/settled */ } }, []);

  // ── enrichCoins (Birdeye + DexScreener side-fetches) ──────────────────────
  const enrichCoins = useCallback(async (mapped: CoinData[]) => {
    const key = getBirdKey();
    const dexTargets = mapped.filter(c => c.vmcap > 50 && c.mcap < 2e9).slice(0, 15);
    const solTargets = mapped.filter(c => c.isSol && CFG.SOL_ADDRS[c.symbol]);

    for (const coin of dexTargets) {
      try {
        const dex = await fetchDexData(coin.symbol, coin.volume);
        if (!dex.dexHot && !dex.dsLiq) continue;
        setCoins(prev => prev.map(c => {
          if (c.symbol !== coin.symbol) return c;
          const det = detect({
            vmcap: c.vmcap, chg24: c.change, volSpike: c.volSpike,
            supplyPct: c.supplyPct, vol: c.volume, mcap: c.mcap,
            dexHot: dex.dexHot, dsLiq: dex.dsLiq, isSol: c.isSol, birdData: c.birdData,
          });
          return { ...c, dexHot: dex.dexHot, dsLiq: dex.dsLiq,
            score: det.score, threat: det.threat, category: det.category,
            confidence: det.confidence, reasons: det.reasons };
        }));
      } catch (err) {
        console.error('[useMarketData] dex enrich failed', { symbol: coin.symbol, error: (err as Error).message });
      }
    }

    if (!key) return;
    for (const coin of solTargets) {
      const addr = CFG.SOL_ADDRS[coin.symbol];
      try {
        const bird = await fetchBirdeyeToken(addr, coin.symbol, key);
        if (!bird) continue;
        setCoins(prev => prev.map(c => {
          if (c.symbol !== coin.symbol) return c;
          const det = detect({
            vmcap: c.vmcap, chg24: c.change, volSpike: c.volSpike,
            supplyPct: c.supplyPct, vol: c.volume, mcap: c.mcap,
            dexHot: c.dexHot, dsLiq: c.dsLiq, isSol: true, birdData: bird,
          });
          return { ...c, birdData: bird,
            score: det.score, threat: det.threat, category: det.category,
            confidence: det.confidence, reasons: det.reasons };
        }));
      } catch (err) {
        console.error('[useMarketData] birdeye enrich failed', { symbol: coin.symbol, error: (err as Error).message });
      }
    }
  }, [getBirdKey]);

  // ── processData (CG response → CoinData[]) ────────────────────────────────
  const processData = useCallback((data: unknown[]): CoinData[] => {
    const newVols: Record<string, number> = {};

    const mapped: CoinData[] = (data as Record<string, unknown>[]).flatMap((c, i) => {
      const vol = (c.total_volume as number) || (c.volume as number) || 0;
      // Read raw mcap; do NOT use || 1 fallback (BUG-001).
      const rawMcap = (c.market_cap as number) || (c.mcap as number) || 0;
      if (rawMcap < MCAP_MIN_RELIABLE) {
        newVols[(c.id as string)] = vol;
        return [];
      }
      const mcap = rawMcap;
      const vmcap = Math.round(Math.max(0, (vol / mcap) * 100));
      const chg24 = (c.price_change_percentage_24h as number) || (c.change_24h as number) || (c.change as number) || 0;
      const prevVol = prevVolumes[(c.id as string)] || vol;
      const volSpike = prevVol > 0 && prevVol !== vol ? vol / prevVol : 1;
      const supplyPct = c.total_supply
        ? (((c.circulating_supply as number) / (c.total_supply as number)) * 100)
        : null;
      const sym = ((c.symbol as string) || '').toUpperCase();
      const isSol = isSolToken(sym);

      newVols[(c.id as string)] = vol;

      const det = detect({
        vmcap, chg24, volSpike, supplyPct, vol, mcap,
        dexHot: false, dsLiq: null, isSol, birdData: null,
      });
      return [{
        rank: (c.rank as number) || (i + 1),
        id: c.id as string,
        symbol: sym,
        name: c.name as string,
        price: (c.current_price as number) || (c.price as number) || 0,
        change: chg24,
        volume: vol, mcap, vmcap, volSpike, supplyPct,
        score: det.score, threat: det.threat, category: det.category,
        confidence: det.confidence, reasons: det.reasons,
        dexHot: false, dsLiq: null, isSol, birdData: null,
        // Present when the scan request used include_platform=true (both the
        // server /api/scan proxy and the direct CoinGecko fallback do) —
        // chain slug -> contract address. This is the field the Insider Risk
        // Scanner's real-data path needs; see insiderRiskApi.ts's
        // InsiderRiskCoin comment for the gap this closes.
        platforms: (c.platforms as Record<string, string> | null | undefined) ?? null,
      }];
    });

    setPrevVolumes(newVols);
    setCoins(mapped);

    // Snapshot history — unfiltered, the table/history should show everything scanned.
    const critCount = mapped.filter(c => c.threat === 'CRITICAL').length;
    const highCount = mapped.filter(c => c.threat === 'HIGH').length;
    setScanHistory(prev => {
      const snap: ScanSnapshot = {
        ts: Date.now(),
        coins: mapped.map(c => ({
          symbol: c.symbol, score: c.score, threat: c.threat,
          category: c.category, price: c.price, change: c.change, vmcap: c.vmcap,
        })),
        critCount, highCount,
      };
      return [snap, ...prev].slice(0, CFG.HISTORY_MAX);
    });

    // ── Noise gate: only coins that pass pairFilters get to record signals / fire alerts.
    // (freqtrade pairlist-filter pattern — see lib/pairFilters.ts for what's rejected and why)
    const { passed: alertable, rejected } = applyPairFilters(mapped);
    setLastFiltered(rejected.map(r => ({ symbol: r.coin.symbol, reason: r.reason })));
    if (rejected.length) {
      console.debug(`[useMarketData] ${rejected.length} coin(s) filtered from alerting this scan`,
        rejected.slice(0, 5).map(r => `${r.coin.symbol}: ${r.reason}`));
    }

    // Keep the remote pairlist cache warm if configured — fire-and-forget,
    // respects its own internal TTL (see lib/nexus/remotePairList.ts), so
    // this is a no-op most scans. Without this, remoteWhitelistFilter in
    // pairFilters.ts would only ever see fresh data after a manual click
    // on Settings' "REFRESH REMOTE LIST" button.
    if (getRemotePairListUrl()) {
      fetchRemotePairList().catch(() => {});
    }

    // Record CEO signal outcomes (only valid scores, only alert-eligible coins)
    alertable
      .filter(c => c.score >= 35)
      .slice(0, 20)
      .forEach(c => {
        const signal = getCeoSignalLabel(c.score, c.threat, c.category || '', c.vmcap);
        recordSignalOutcome({
          symbol: c.symbol, coin_id: c.id, signal,
          score: c.score, category: c.category,
          vmcap: c.vmcap, entry_price: c.price,
          chg24: c.change, volSpike: c.volSpike, supplyPct: c.supplyPct,
          mcap: c.mcap, dexHot: c.dexHot, isSol: c.isSol,
        });
      });

    // Generate alerts for critical/high — gated by cooldown (see guardedAddAlert above)
    // sizing = real, backtested expectancy for this signal category (see lib/sizingHint.ts) —
    // the alert feed's `sizing` field existed but was never populated before this.
    // coinId/entryPrice (v9.37): these two call sites are the only ones with an
    // actual coin behind the alert, so they're the only ones that populate the
    // decision-outcome loop's price-tracking fields — see AlertItem's docstring.
    alertable.filter(c => c.threat === 'CRITICAL').slice(0, 3).forEach(c => {
      const signal = getCeoSignalLabel(c.score, c.threat, c.category || '', c.vmcap);
      guardedAddAlert('critical', c.symbol,
        `SCORE=${c.score}/100 VOL/MCAP=${c.vmcap.toFixed(0)}% ΔP=${c.change.toFixed(1)}% — ${c.reasons.join(' · ')}`,
        getSizingHint(signal).label, c.id, c.price);
    });
    alertable.filter(c => c.threat === 'HIGH' && c.category).slice(0, 3).forEach(c => {
      const signal = getCeoSignalLabel(c.score, c.threat, c.category || '', c.vmcap);
      guardedAddAlert('high', c.symbol,
        `[${c.category}] SCORE=${c.score}/100 — ${c.reasons.join(' · ')}`,
        getSizingHint(signal).label, c.id, c.price);
    });

    return mapped;
  }, [prevVolumes, guardedAddAlert]);

  // Stable refs so triggerScan never gets stale processData/enrichCoins
  const processDataRef = useRef(processData);
  const enrichCoinsRef = useRef(enrichCoins);
  useEffect(() => { processDataRef.current = processData; }, [processData]);
  useEffect(() => { enrichCoinsRef.current = enrichCoins; }, [enrichCoins]);

  // ── autonomous Agent Council ────────────────────────────────────────────
  const runAutoCouncil = useCallback(async () => {
    if (typeof window === 'undefined') return;
    if (localStorage.getItem('wr_council_enabled') === '0') return;
    if (councilBusyRef.current) return;

    const now = Date.now();
    const rankedCoins = coinsRef.current
      .filter((c) => Number.isFinite(c.score))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));

    const priorityCandidates = rankedCoins
      .filter((c) => c.score >= 70 || c.threat === 'CRITICAL' || c.threat === 'HIGH')
      .slice(0, AUTO_COUNCIL_MAX_CANDIDATES);

    // The downstream TCC treats Council as a freshness-gated input. If a scan
    // has no HIGH/CRITICAL/70+ candidate, keep one low-priority seat warm so
    // the Council still produces a fresh HOLD/NEUTRAL-style opinion instead of
    // going completely stale for hours. This does not change alert thresholds
    // or trading decisions; it only restores autonomous Council coverage.
    const candidates = priorityCandidates.length
      ? priorityCandidates
      : rankedCoins.slice(0, AUTO_COUNCIL_FALLBACK_CANDIDATES);

    if (!candidates.length) return;

    councilBusyRef.current = true;
    try {
      let llm: { provider: 'lovable' | 'anthropic' | 'openai' | 'openrouter' | 'groq' | 'custom'; apiKey?: string; model?: string; baseUrl?: string } = { provider: 'lovable' };
      try {
        const raw = localStorage.getItem('wr_council_llm');
        if (raw) llm = JSON.parse(raw);
      } catch { /* keep built-in default */ }

      for (const coin of candidates) {
        const lastLocal = councilLastRunRef.current.get(coin.symbol) ?? 0;
        if (now - lastLocal < AUTO_COUNCIL_INTERVAL_MS) continue;

        const memory = await loadCouncilMemory(coin.symbol, 1);
        const latest = memory[0]?.createdAt ? new Date(memory[0].createdAt).getTime() : 0;
        if (latest && now - latest < AUTO_COUNCIL_INTERVAL_MS) {
          councilLastRunRef.current.set(coin.symbol, latest);
          continue;
        }

        const extras = getCouncilContextExtras?.() ?? {};
        const ctx = buildCouncilContext(coin, extras);
        const transcript: { agent: AgentId; text: string }[] = [];
        let activeAgent: AgentId | null = null;
        let activeText = '';

        await runCouncil(
          ctx,
          'quick',
          memory,
          llm,
          {
            onAgentStart: (agent) => {
              activeAgent = agent;
              activeText = '';
            },
            onDelta: (agent, text) => {
              if (activeAgent === agent) activeText += text;
            },
            onAgentEnd: (agent) => {
              if (activeAgent === agent) {
                transcript.push({ agent, text: activeText });
                activeAgent = null;
                activeText = '';
              }
            },
            onDecision: (decision) => {
              void saveCouncilDecision(
                decision,
                ctx,
                transcript,
                'quick',
                buildReflection(memory),
              ).then((id) => {
                if (id) councilLastRunRef.current.set(coin.symbol, Date.now());
              });
            },
            onError: (message) => {
              console.warn('[auto-council]', coin.symbol, message);
            },
          },
        );

        // Prevent a second candidate from starting if the first one completed
        // without persistence due to an upstream failure; the DB freshness
        // check above remains the source of truth on the next cycle.
        councilLastRunRef.current.set(coin.symbol, Date.now());
      }
    } catch (error) {
      console.warn('[auto-council] runner failed:', error);
    } finally {
      councilBusyRef.current = false;
    }
  }, [getCouncilContextExtras]);

  useEffect(() => {
    autoCouncilRef.current = runAutoCouncil;
  }, [runAutoCouncil]);

  // ── triggerScan ───────────────────────────────────────────────────────────
  const triggerScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setScanBadge('SCANNING');

    try { scanAbortRef.current?.abort(); } catch { /* already aborted/settled */ }
    scanAbortRef.current = new AbortController();
    const signal = scanAbortRef.current.signal;

    try {
      const result = await runScan({ apiKey: apiKeyRef.current, signal });

      if (isScanError(result)) {
        if (result.kind === 'rate_limited') {
          setScanBadge(`WAIT ${result.cooldownSec ?? 60}s`);
          setScanning(false);
          return;
        }
        throw new Error(result.message);
      }

      const { data: scanData, source } = result;
      setDataSource(source);
      setApiCallCount(c => c + (source === 'live' ? 1 : 0));

      const mapped = processDataRef.current(scanData);
      setScanBadge(source === 'live' ? 'LIVE' : source === 'cached' ? 'CACHED' : 'DEGRADED');
      setLastScanTs(Date.now());

      saveScan(mapped).catch(() => {});
      enrichCoinsRef.current(mapped).catch(() => {});

      // Historical autonomous flow: after each market scan, evaluate the
      // strongest candidates in the background. The 30-minute per-symbol
      // freshness gate prevents repeated LLM calls and preserves the Council
      // freshness contract consumed by downstream systems.
      window.setTimeout(() => {
        void autoCouncilRef.current?.();
      }, AUTO_COUNCIL_DELAY_MS);
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      console.error('[useMarketData.triggerScan] failed', { error: (e as Error)?.message });
      setScanBadge('ERROR');
      setDataSource('fallback');
      guardedAddAlert('medium', 'API',
        'Scan failed: ' + (e instanceof Error ? e.message : 'Unknown'));
    } finally {
      setScanning(false);
    }
  }, [scanning, guardedAddAlert]);

  return useMemo(() => ({
    coins, setCoins,
    scanning, scanBadge, dataSource, apiCallCount, lastScanTs,
    prevVolumes, setPrevVolumes,
    scanHistory, setScanHistory,
    triggerScan,
    getAlertLocks: () => alertCooldown.getActiveLocks(),
    lastFiltered,
  }), [coins, scanning, scanBadge, dataSource, apiCallCount, lastScanTs, prevVolumes, scanHistory, triggerScan, lastFiltered]);
}
