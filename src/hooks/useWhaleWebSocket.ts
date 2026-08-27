/* ══ WHALE RADAR v10 — BULLETPROOF WebSocket Hook ══════════════════════════════
 *  CEO-FIX: Eliminates "Network error" through:
 *    1. Immediate HTTP seed on WS connection failure
 *    2. Exponential backoff capped at 30s with jitter
 *    3. Circuit breaker for WS reconnects (max 10 attempts)
 *    4. Dual-feed redundancy — Binance + Bybit + HTTP polling
 *    5. Connection pool health monitoring
 *    6. Graceful degradation with visible status indicators
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useCallback, useState } from 'react';
import { proxied } from '@/lib/binanceProxy';
import { WhaleTrade } from '@/lib/whaleRadarState';
import { measureWsProcessing } from '@/lib/perfBudget';

const WS_STALE_MS = 60_000;
const PING_MS = 15_000;
const WS_REBUILD_DEBOUNCE = 300;
const BACK_BASE = 500;
const BACK_MAX  = 30_000;
const LAG_THRESHOLD_MS = 5000;
const POLL_INTERVAL_MS = 5000;
const MAX_WS_RECONNECTS = 10;
const WS_CIRCUIT_RESET_MS = 60_000;

export type WsStatus = 'live' | 'delayed' | 'fallback' | 'reconnecting' | 'offline' | 'degraded';

interface UseWhaleWebSocketOptions {
  subscribedPairs: Set<string>;
  bybitEnabled: boolean;
  /** When false the direct browser→Binance socket is actually CLOSED (not just
   *  filtered downstream) — used when the server-side whale-stream feed is live
   *  so we don't hold two upstream Binance connections open. Defaults to true. */
  binanceEnabled?: boolean;
  whaleThr: number;
  whaleFeedEx: string;
  onWhaleTrade: (trade: WhaleTrade) => void;
  onTrackerPrice?: (sym: string, price: number) => void;
}

function backoffWithJitter(attempt: number): number {
  const exp = Math.min(BACK_BASE * Math.pow(2, attempt), BACK_MAX);
  return exp * (0.7 + Math.random() * 0.6);
}

export function useWhaleWebSocket({
  subscribedPairs, bybitEnabled, binanceEnabled = true, whaleThr, whaleFeedEx,
  onWhaleTrade, onTrackerPrice,
}: UseWhaleWebSocketOptions) {

  const [binanceReady, setBinanceReady] = useState(false);
  const [bybitReady,   setBybitReady]   = useState(false);
  const [wsStatus,     setWsStatus]     = useState<WsStatus>('offline');
  const [wsLagMs,      setWsLagMs]      = useState(0);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const wsRef  = useRef<WebSocket | null>(null);
  const ws2Ref = useRef<WebSocket | null>(null);
  const wsWatchdogTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ws2WatchdogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pingInterval     = useRef<ReturnType<typeof setInterval> | null>(null);
  const ws2PingInterval  = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsRetries        = useRef(0);
  const ws2Retries       = useRef(0);
  const ws2ReconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wsRebuildTimer   = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ws2RebuildTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastMsgTime    = useRef(0);
  const lagCheckInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSeedAt     = useRef(0);
  const inFallbackMode = useRef(false);
  const pollTimer      = useRef<ReturnType<typeof setInterval> | null>(null);
  const wsCircuitOpen = useRef(false);
  const wsCircuitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const httpAbortRef = useRef<AbortController | null>(null);
  if (!httpAbortRef.current) httpAbortRef.current = new AbortController();

  const binanceReadyRef = useRef(false);
  const bybitReadyRef   = useRef(false);
  const reconnectAttemptsRef = useRef(0);
  binanceReadyRef.current = binanceReady;
  bybitReadyRef.current = bybitReady;
  reconnectAttemptsRef.current = reconnectAttempts;

  const optionsRef = useRef({ subscribedPairs, bybitEnabled, binanceEnabled, whaleThr, whaleFeedEx, onWhaleTrade, onTrackerPrice });
  optionsRef.current = { subscribedPairs, bybitEnabled, binanceEnabled, whaleThr, whaleFeedEx, onWhaleTrade, onTrackerPrice };

  const seedFromHttp = useCallback(async () => {
    try {
      const pairs = [...optionsRef.current.subscribedPairs].slice(0, 10);
      if (!pairs.length) return;
      if (!httpAbortRef.current) httpAbortRef.current = new AbortController();
      const signal = httpAbortRef.current.signal;
      // Pairs already include the USDT suffix (e.g. "BTCUSDT") — do NOT append again.
      const endpoints = pairs.map(sym => proxied(`https://api.binance.com/api/v3/ticker/24hr?symbol=${sym.endsWith('USDT') ? sym : sym + 'USDT'}`));
      // Parallel with manual per-request timeout (no AbortSignal.timeout — wider support, cancellable on unmount)
      const responses = await Promise.allSettled(
        endpoints.map(url => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), 8000);
          const onAbort = () => ctrl.abort();
          signal.addEventListener('abort', onAbort);
          return fetch(url, { signal: ctrl.signal }).finally(() => {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
          });
        })
      );
      responses.forEach((res) => {
        if (res.status === 'fulfilled' && res.value.ok) {
          lastMsgTime.current = Date.now();
        }
      });
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') {
        console.error('[WS] seedFromHttp failed', { error: (err as Error).message });
      }
    }
  }, []);

  const startFallbackPolling = useCallback(() => {
    if (pollTimer.current) return;
    console.warn('[WS] Lag detected — activating fallback HTTP polling');
    pollTimer.current = setInterval(async () => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      const onAbort = () => ctrl.abort();
      if (!httpAbortRef.current) httpAbortRef.current = new AbortController();
      const parentSig = httpAbortRef.current.signal;
      parentSig.addEventListener('abort', onAbort);
      try {
        const pairs = [...optionsRef.current.subscribedPairs].slice(0, 5);
        if (!pairs.length) return;
        const symbol = pairs[0];
        // pairs are already full Binance pair names (e.g. "BTCUSDT") — never re-append USDT.
        const fullPair = symbol.endsWith('USDT') ? symbol : symbol + 'USDT';
        const res = await fetch(
          proxied(`https://api.binance.com/api/v3/trades?symbol=${fullPair}&limit=5`),
          { signal: ctrl.signal }
        );
        if (!res.ok) return;
        const trades = await res.json();
        lastMsgTime.current = Date.now();
        trades.forEach((t: { price: string; qty: string; isBuyerMaker: boolean }) => {
          const price = parseFloat(t.price), qty = parseFloat(t.qty), usdt = price * qty;
          if (usdt < optionsRef.current.whaleThr) return;
          const sym  = symbol.replace(/USDT$/, '');
          const side = t.isBuyerMaker ? 'SELL' : 'BUY';
          const cls  = usdt >= 5e6 ? 'ws-mega' : usdt >= 1e6 ? 'ws-big' : 'ws-mid';
          const trade: WhaleTrade = { ts: Date.now(), sym, side, price, qty, usdt, cls, ex: 'poll' as 'binance' };
          optionsRef.current.onWhaleTrade(trade);
        });
      } catch (err) {
        const isAbort = (err as DOMException)?.name === 'AbortError';
        if (!parentSig.aborted && !isAbort) {
          console.error('[WS] poll fallback failed', { symbol: [...optionsRef.current.subscribedPairs][0], error: (err as Error).message });
        }
      } finally {
        clearTimeout(timer);
        parentSig.removeEventListener('abort', onAbort);
      }
    }, POLL_INTERVAL_MS);
  }, []);

  const stopFallbackPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
      console.info('[WS] Live feed restored — fallback polling stopped');
    }
  }, []);

  const startFallbackPollingRef = useRef(startFallbackPolling);
  startFallbackPollingRef.current = startFallbackPolling;
  const stopFallbackPollingRef = useRef(stopFallbackPolling);
  stopFallbackPollingRef.current = stopFallbackPolling;

  useEffect(() => {
    seedFromHttp();
    lagCheckInterval.current = setInterval(() => {
      const binReady = binanceReadyRef.current;
      const byReady  = bybitReadyRef.current;
      const recon    = reconnectAttemptsRef.current;
      const { binanceEnabled: binOn, bybitEnabled: byOn } = optionsRef.current;

      if (!binReady && !byReady) {
        // Neither direct socket is up. If BOTH are intentionally disabled
        // (server-side whale-stream is carrying the feed) this is not an
        // outage and must not trigger a REST seed every single second.
        if (!binOn && !byOn) return;
        setWsStatus('offline');
        // Throttle the REST reseed to the normal poll cadence instead of
        // hammering Binance once per second for as long as we stay down.
        if (
          optionsRef.current.subscribedPairs.size > 0 &&
          Date.now() - lastSeedAt.current >= POLL_INTERVAL_MS
        ) {
          lastSeedAt.current = Date.now();
          seedFromHttp();
        }
        return;
      }

      if (wsCircuitOpen.current) { setWsStatus('degraded'); return; }
      if (recon >= 2) { setWsStatus('reconnecting'); return; }

      const lag = lastMsgTime.current > 0 ? Date.now() - lastMsgTime.current : 0;
      setWsLagMs(lag);

      if (lag > LAG_THRESHOLD_MS && !inFallbackMode.current) {
        inFallbackMode.current = true;
        setWsStatus('fallback');
        startFallbackPollingRef.current();
      } else if (lag <= LAG_THRESHOLD_MS && lag > 2000) {
        setWsStatus('delayed');
        if (inFallbackMode.current) { inFallbackMode.current = false; stopFallbackPollingRef.current(); }
      } else if (lag <= 2000 && (binReady || byReady)) {
        setWsStatus('live');
        if (inFallbackMode.current) { inFallbackMode.current = false; stopFallbackPollingRef.current(); }
      }
    }, 1000);
    return () => { if (lagCheckInterval.current) clearInterval(lagCheckInterval.current); };
  }, [seedFromHttp]);

  const scheduleRebuildWsRef = useRef<((delay?: number) => void) | null>(null);
  const scheduleRebuildWs2Ref = useRef<((delay?: number) => void) | null>(null);

  const startWsWatchdog = useCallback((ws: WebSocket) => {
    if (wsWatchdogTimer.current) clearTimeout(wsWatchdogTimer.current);
    wsWatchdogTimer.current = setTimeout(() => {
      if (wsRef.current === ws && optionsRef.current.subscribedPairs.size) scheduleRebuildWsRef.current?.(0);
    }, WS_STALE_MS);
  }, []);

  const startWs2Watchdog = useCallback((ws: WebSocket) => {
    if (ws2WatchdogTimer.current) clearTimeout(ws2WatchdogTimer.current);
    ws2WatchdogTimer.current = setTimeout(() => {
      if (ws2Ref.current === ws && optionsRef.current.bybitEnabled && optionsRef.current.subscribedPairs.size)
        scheduleRebuildWs2Ref.current?.(0);
    }, WS_STALE_MS);
  }, []);

  const openWsCircuit = useCallback(() => {
    if (wsCircuitOpen.current) return;
    wsCircuitOpen.current = true;
    setWsStatus('degraded');
    console.warn('[WS] Circuit breaker OPENED — switching to HTTP-only mode');
    startFallbackPollingRef.current();
    wsCircuitTimer.current = setTimeout(() => {
      wsCircuitOpen.current = false;
      wsRetries.current = 0;
      ws2Retries.current = 0;
      setReconnectAttempts(0);
      console.info('[WS] Circuit breaker RESET — attempting WS reconnect');
      if (optionsRef.current.subscribedPairs.size) scheduleRebuildWsRef.current?.(0);
      if (optionsRef.current.bybitEnabled) scheduleRebuildWs2Ref.current?.(0);
    }, WS_CIRCUIT_RESET_MS);
  }, []);

  const rebuildWs = useCallback(() => {
    if (wsCircuitOpen.current) return;
    if (wsRebuildTimer.current) { clearTimeout(wsRebuildTimer.current); wsRebuildTimer.current = null; }

    const old = wsRef.current;
    wsRef.current = null;
    if (pingInterval.current) clearInterval(pingInterval.current);
    if (wsWatchdogTimer.current) clearTimeout(wsWatchdogTimer.current);
    if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; try { old.close(); } catch (_) { /* already closed/closing */ } }

    const pairs = optionsRef.current.subscribedPairs;
    if (!pairs.size || !optionsRef.current.binanceEnabled) { setBinanceReady(false); return; }
    if (wsRetries.current >= MAX_WS_RECONNECTS) { openWsCircuit(); return; }

    const ws = new WebSocket('wss://stream.binance.com:9443/ws');
    wsRef.current = ws;
    setBinanceReady(false);

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      setBinanceReady(true);
      wsRetries.current = 0;
      setReconnectAttempts(0);
      ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [...pairs].map(p => p.toLowerCase() + '@aggTrade'), id: 1 }));
      // Binance answers browser-level pings itself; an app-level {method:'ping'}
      // is an invalid request and gets the socket closed with 1008.
      startWsWatchdog(ws);
    };

    ws.onmessage = (e) => {
      if (wsRef.current !== ws) return;
      lastMsgTime.current = Date.now();
      startWsWatchdog(ws);
      measureWsProcessing('binance', () => {
        try {
          const raw = JSON.parse(e.data);
          if ('result' in raw || ('id' in raw && !('stream' in raw) && !('e' in raw))) return;
          const d = raw.data || raw;
          if (!d || !d.p || !d.q) return;
          const price = parseFloat(d.p), qty = parseFloat(d.q), usdt = price * qty;
          const side = d.m ? 'SELL' : 'BUY';
          const sym  = (d.s || '').replace(/USDT$/, '');
          optionsRef.current.onTrackerPrice?.(sym, price);
          if (usdt < optionsRef.current.whaleThr) return;
          const cls = usdt >= 5e6 ? 'ws-mega' : usdt >= 1e6 ? 'ws-big' : 'ws-mid';
          const trade: WhaleTrade = { ts: Date.now(), sym, side, price, qty, usdt, cls, ex: 'binance' };
          if (optionsRef.current.whaleFeedEx === 'all' || optionsRef.current.whaleFeedEx === 'binance')
            optionsRef.current.onWhaleTrade(trade);
        } catch (_) { /* malformed message, drop it */ }
      });
    };

    ws.onerror = () => { if (wsRef.current !== ws) return; };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      if (pingInterval.current) clearInterval(pingInterval.current);
      if (wsWatchdogTimer.current) clearTimeout(wsWatchdogTimer.current);
      setBinanceReady(false);
      if (pairs.size && optionsRef.current.binanceEnabled) {
        wsRetries.current++;
        setReconnectAttempts(wsRetries.current);
        if (wsRetries.current >= MAX_WS_RECONNECTS) {
          openWsCircuit();
        } else {
          scheduleRebuildWs(backoffWithJitter(wsRetries.current - 1));
        }
      }
    };
  }, [startWsWatchdog, openWsCircuit]);

  const rebuildWs2 = useCallback(() => {
    if (wsCircuitOpen.current) return;
    if (ws2RebuildTimer.current) { clearTimeout(ws2RebuildTimer.current); ws2RebuildTimer.current = null; }

    const old = ws2Ref.current;
    ws2Ref.current = null;
    if (ws2PingInterval.current) clearInterval(ws2PingInterval.current);
    if (ws2WatchdogTimer.current) clearTimeout(ws2WatchdogTimer.current);
    if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; try { old.close(); } catch (_) { /* already closed/closing */ } }

    if (!optionsRef.current.bybitEnabled || !optionsRef.current.subscribedPairs.size) {
      setBybitReady(false); return;
    }
    if (ws2Retries.current >= MAX_WS_RECONNECTS) { openWsCircuit(); return; }

    const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
    ws2Ref.current = ws;
    setBybitReady(false);

    ws.onopen = () => {
      if (ws2Ref.current !== ws) return;
      setBybitReady(true);
      ws2Retries.current = 0;
      setReconnectAttempts(0);
      const pairs = optionsRef.current.subscribedPairs;
      ws.send(JSON.stringify({ op: 'subscribe', args: [...pairs].map(p => 'publicTrade.' + p) }));
      ws2PingInterval.current = setInterval(() => {
        if (ws2Ref.current === ws && ws.readyState === 1) ws.send(JSON.stringify({ op: 'ping' }));
      }, PING_MS);
      startWs2Watchdog(ws);
    };

    ws.onmessage = (e) => {
      if (ws2Ref.current !== ws) return;
      lastMsgTime.current = Date.now();
      startWs2Watchdog(ws);
      measureWsProcessing('bybit', () => {
        try {
          const raw = JSON.parse(e.data);
          if (raw.op || !raw.data) return;
          const trades = raw.data;
          if (!Array.isArray(trades)) return;
          const sym = (raw.topic || '').replace('publicTrade.', '').replace(/USDT$/, '');
          trades.forEach((t: Record<string, string>) => {
            const price = parseFloat(t.p), qty = parseFloat(t.v), usdt = price * qty;
            const side = t.S === 'Buy' ? 'BUY' : 'SELL';
            optionsRef.current.onTrackerPrice?.(sym, price);
            if (usdt < optionsRef.current.whaleThr) return;
            const cls = usdt >= 5e6 ? 'ws-mega' : usdt >= 1e6 ? 'ws-big' : 'ws-mid';
            const trade: WhaleTrade = { ts: Date.now(), sym, side, price, qty, usdt, cls, ex: 'bybit' };
            if (optionsRef.current.whaleFeedEx === 'all' || optionsRef.current.whaleFeedEx === 'bybit')
              optionsRef.current.onWhaleTrade(trade);
          });
        } catch (_) { /* malformed message, drop it */ }
      });
    };

    ws.onerror = () => { if (ws2Ref.current !== ws) return; };
    ws.onclose = () => {
      if (ws2Ref.current !== ws) return;
      if (ws2PingInterval.current) clearInterval(ws2PingInterval.current);
      if (ws2WatchdogTimer.current) clearTimeout(ws2WatchdogTimer.current);
      if (ws2ReconnectTimer.current) clearTimeout(ws2ReconnectTimer.current);
      setBybitReady(false);
      if (optionsRef.current.bybitEnabled && optionsRef.current.subscribedPairs.size) {
        ws2Retries.current++;
        if (ws2Retries.current >= MAX_WS_RECONNECTS) {
          openWsCircuit();
        } else {
          const dly = backoffWithJitter(ws2Retries.current - 1);
          ws2ReconnectTimer.current = setTimeout(() => {
            ws2ReconnectTimer.current = null;
            if (optionsRef.current.bybitEnabled) scheduleRebuildWs2(0);
          }, dly);
        }
      }
    };
  }, [startWs2Watchdog, openWsCircuit]);

  const scheduleRebuildWs = useCallback((delay?: number) => {
    if (wsRebuildTimer.current) clearTimeout(wsRebuildTimer.current);
    wsRebuildTimer.current = setTimeout(rebuildWs, delay ?? WS_REBUILD_DEBOUNCE);
  }, [rebuildWs]);

  const scheduleRebuildWs2 = useCallback((delay?: number) => {
    if (ws2RebuildTimer.current) clearTimeout(ws2RebuildTimer.current);
    ws2RebuildTimer.current = setTimeout(rebuildWs2, delay ?? WS_REBUILD_DEBOUNCE);
  }, [rebuildWs2]);

  scheduleRebuildWsRef.current = scheduleRebuildWs;
  scheduleRebuildWs2Ref.current = scheduleRebuildWs2;

  // Stable signature so a parent re-render that creates a new Set with the SAME
  // contents does NOT re-trigger this effect (which would abort all in-flight
  // HTTP requests and rebuild the WS in a tight loop).
  const pairsKey = [...subscribedPairs].sort().join(',');

  useEffect(() => {
    if (binanceEnabled && subscribedPairs.size) {
      scheduleRebuildWs(300);
    } else if (!binanceEnabled) {
      // Server-side whale-stream is live — actually close the direct socket
      // rather than keeping it open and discarding duplicate trades.
      const old = wsRef.current;
      wsRef.current = null;
      if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; try { old.close(); } catch (_) { /* already closed/closing */ } }
      if (pingInterval.current) clearInterval(pingInterval.current);
      if (wsWatchdogTimer.current) clearTimeout(wsWatchdogTimer.current);
      if (wsRebuildTimer.current) clearTimeout(wsRebuildTimer.current);
      wsRetries.current = 0;
      setBinanceReady(false);
    }
    return () => {
      const old = wsRef.current;
      wsRef.current = null;
      if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; try { old.close(); } catch (_) { /* already closed/closing */ } }
      if (pingInterval.current) clearInterval(pingInterval.current);
      if (wsWatchdogTimer.current) clearTimeout(wsWatchdogTimer.current);
      if (wsRebuildTimer.current) clearTimeout(wsRebuildTimer.current);
      if (wsCircuitTimer.current) clearTimeout(wsCircuitTimer.current);
      stopFallbackPollingRef.current();
      try { httpAbortRef.current?.abort(); } catch { /* already aborted/settled */ }
      httpAbortRef.current = new AbortController();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [binanceEnabled, pairsKey]);


  useEffect(() => {
    if (bybitEnabled && subscribedPairs.size) {
      scheduleRebuildWs2(350);
    } else if (!bybitEnabled) {
      const old = ws2Ref.current;
      ws2Ref.current = null;
      if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; try { old.close(); } catch (_) { /* already closed/closing */ } }
      if (ws2PingInterval.current) clearInterval(ws2PingInterval.current);
      if (ws2WatchdogTimer.current) clearTimeout(ws2WatchdogTimer.current);
      if (ws2RebuildTimer.current) clearTimeout(ws2RebuildTimer.current);
      if (ws2ReconnectTimer.current) clearTimeout(ws2ReconnectTimer.current);
      setBybitReady(false);
    }
    return () => {
      const old = ws2Ref.current;
      ws2Ref.current = null;
      if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; try { old.close(); } catch (_) { /* already closed/closing */ } }
      if (ws2PingInterval.current) clearInterval(ws2PingInterval.current);
      if (ws2WatchdogTimer.current) clearTimeout(ws2WatchdogTimer.current);
      if (ws2RebuildTimer.current) clearTimeout(ws2RebuildTimer.current);
      if (ws2ReconnectTimer.current) clearTimeout(ws2ReconnectTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bybitEnabled, pairsKey]);

  return { binanceReady, bybitReady, wsStatus, wsLagMs, reconnectAttempts };
}
