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
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runScan, isScanError } from '@/services/api';
import { getCeoSignalLabel, MCAP_MIN_RELIABLE } from '@/services/signals';
import { detect } from '@/lib/detection';
import { fetchBirdeyeToken } from '@/lib/birdeye';
import { fetchDexData } from '@/lib/dexscreener';
import { recordSignalOutcome, saveScan } from '@/lib/db';
import {
  CoinData, CFG, ScanSnapshot, isSolToken,
} from '@/lib/whaleRadarState';

type AlertLevel = 'critical' | 'high' | 'medium' | 'info';
type AddAlert = (level: AlertLevel, tag: string, text: string, sizing?: string) => void;
type DataSource = 'live' | 'cached' | 'fallback';

export interface UseMarketDataOptions {
  apiKey: string;
  /** Returns the latest Birdeye key without re-rendering the hook. */
  getBirdKey: () => string;
  /** Alert sink — callers should pass a stable ref-backed function. */
  addAlert: AddAlert;
  /** Optional initial state (e.g. from persistence). */
  initialPrevVolumes?: Record<string, number>;
  initialScanHistory?: ScanSnapshot[];
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
}

export function useMarketData({
  apiKey,
  getBirdKey,
  addAlert,
  initialPrevVolumes = {},
  initialScanHistory = [],
}: UseMarketDataOptions): UseMarketDataResult {
  const [coins,        setCoins]        = useState<CoinData[]>([]);
  const [scanning,     setScanning]     = useState(false);
  const [scanBadge,    setScanBadge]    = useState('IDLE');
  const [dataSource,   setDataSource]   = useState<DataSource>('live');
  const [apiCallCount, setApiCallCount] = useState(0);
  const [lastScanTs,   setLastScanTs]   = useState(0);
  const [prevVolumes,  setPrevVolumes]  = useState<Record<string, number>>(initialPrevVolumes);
  const [scanHistory,  setScanHistory]  = useState<ScanSnapshot[]>(initialScanHistory);

  // Stable ref for addAlert — caller may pass a fresh closure each render.
  const addAlertRef = useRef<AddAlert>(addAlert);
  useEffect(() => { addAlertRef.current = addAlert; }, [addAlert]);

  const apiKeyRef = useRef(apiKey);
  useEffect(() => { apiKeyRef.current = apiKey; }, [apiKey]);

  // Cancellable per-scan controller
  const scanAbortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { try { scanAbortRef.current?.abort(); } catch {} }, []);

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
      }];
    });

    setPrevVolumes(newVols);
    setCoins(mapped);

    // Snapshot history
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

    // Record CEO signal outcomes (only valid scores)
    mapped
      .filter(c => c.score >= 35)
      .slice(0, 20)
      .forEach(c => {
        const signal = getCeoSignalLabel(c.score, c.threat, c.category || '', c.vmcap);
        recordSignalOutcome({
          symbol: c.symbol, coin_id: c.id, signal,
          score: c.score, category: c.category,
          vmcap: c.vmcap, entry_price: c.price,
        });
      });

    // Generate alerts for critical/high
    mapped.filter(c => c.threat === 'CRITICAL').slice(0, 3).forEach(c => {
      addAlertRef.current('critical', c.symbol,
        `SCORE=${c.score}/100 VOL/MCAP=${c.vmcap.toFixed(0)}% ΔP=${c.change.toFixed(1)}% — ${c.reasons.join(' · ')}`);
    });
    mapped.filter(c => c.threat === 'HIGH' && c.category).slice(0, 3).forEach(c => {
      addAlertRef.current('high', c.symbol,
        `[${c.category}] SCORE=${c.score}/100 — ${c.reasons.join(' · ')}`);
    });

    return mapped;
  }, [prevVolumes]);

  // Stable refs so triggerScan never gets stale processData/enrichCoins
  const processDataRef = useRef(processData);
  const enrichCoinsRef = useRef(enrichCoins);
  useEffect(() => { processDataRef.current = processData; }, [processData]);
  useEffect(() => { enrichCoinsRef.current = enrichCoins; }, [enrichCoins]);

  // ── triggerScan ───────────────────────────────────────────────────────────
  const triggerScan = useCallback(async () => {
    if (scanning) return;
    setScanning(true);
    setScanBadge('SCANNING');

    try { scanAbortRef.current?.abort(); } catch {}
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
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      console.error('[useMarketData.triggerScan] failed', { error: (e as Error)?.message });
      setScanBadge('ERROR');
      setDataSource('fallback');
      addAlertRef.current('medium', 'API',
        'Scan failed: ' + (e instanceof Error ? e.message : 'Unknown'));
    } finally {
      setScanning(false);
    }
  }, [scanning]);

  return useMemo(() => ({
    coins, setCoins,
    scanning, scanBadge, dataSource, apiCallCount, lastScanTs,
    prevVolumes, setPrevVolumes,
    scanHistory, setScanHistory,
    triggerScan,
  }), [coins, scanning, scanBadge, dataSource, apiCallCount, lastScanTs, prevVolumes, scanHistory, triggerScan]);
}
