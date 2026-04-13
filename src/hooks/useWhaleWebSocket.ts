/* ══ WHALE RADAR v9 — WebSocket Hook for Binance + Bybit ═══════════════════
 *  Features: lag detection, fallback polling, exponential backoff + jitter,
 *  reconnecting banner, performance budget enforcement.
 *
 *  FIXES applied:
 *  #1  startFallbackPolling/stopFallbackPolling moved BEFORE the lag effect
 *      and accessed via stable refs — no stale-closure risk.
 *  #5  Cleanup nulls wsRef/ws2Ref before closing — prevents ghost reconnects
 *      from callbacks firing on an unmounted component.
 *  #6  Lag-check interval has empty deps and reads ready-state via refs —
 *      no longer recreated on every connect/disconnect cycle.
 *  #10 Pair changes and bybitEnabled toggle handled by separate effects —
 *      toggling Bybit no longer tears down and restarts the Binance feed.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useCallback, useState } from 'react';
import { WhaleTrade } from '@/lib/whaleRadarState';
import { measureWsProcessing } from '@/lib/perfBudget';

const WS_STALE_MS = 90_000;
const PING_MS = 30_000;
const WS_REBUILD_DEBOUNCE = 400;

const BACK_BASE = 1000;
const BACK_MAX  = 30_000;

const LAG_THRESHOLD_MS = 2000;
const POLL_INTERVAL_MS = 3000;

export type WsStatus = 'live' | 'delayed' | 'fallback' | 'reconnecting' | 'offline';

interface UseWhaleWebSocketOptions {
  subscribedPairs: Set<string>;
  bybitEnabled: boolean;
  whaleThr: number;
  whaleFeedEx: string;
  onWhaleTrade: (trade: WhaleTrade) => void;
  onTrackerPrice?: (sym: string, price: number) => void;
}

function backoffWithJitter(attempt: number): number {
  const exp = Math.min(BACK_BASE * Math.pow(2, attempt), BACK_MAX);
  return exp * (0.8 + Math.random() * 0.4);
}

export function useWhaleWebSocket({
  subscribedPairs, bybitEnabled, whaleThr, whaleFeedEx,
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
  const inFallbackMode = useRef(false);
  const pollTimer      = useRef<ReturnType<typeof setInterval> | null>(null);

  // FIX #6: mirror state into refs so the single stable lag interval can read
  // current values without being recreated on every connect/disconnect.
  const binanceReadyRef       = useRef(false);
  const bybitReadyRef         = useRef(false);
  const reconnectAttemptsRef  = useRef(0);
  binanceReadyRef.current      = binanceReady;
  bybitReadyRef.current        = bybitReady;
  reconnectAttemptsRef.current = reconnectAttempts;

  const optionsRef = useRef({ subscribedPairs, bybitEnabled, whaleThr, whaleFeedEx, onWhaleTrade, onTrackerPrice });
  optionsRef.current = { subscribedPairs, bybitEnabled, whaleThr, whaleFeedEx, onWhaleTrade, onTrackerPrice };

  // ── FIX #1: polling helpers defined BEFORE the lag effect ────────────────

  const startFallbackPolling = useCallback(() => {
    if (pollTimer.current) return;
    console.warn('[WS] Lag > 2s — switching to fallback HTTP polling');
    pollTimer.current = setInterval(async () => {
      try {
        const pairs = [...optionsRef.current.subscribedPairs].slice(0, 5);
        if (!pairs.length) return;
        const symbol = pairs[0];
        const res = await fetch(`https://api.binance.com/api/v3/trades?symbol=${symbol}USDT&limit=5`);
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
      } catch { /* ignore polling errors */ }
    }, POLL_INTERVAL_MS);
  }, []);

  const stopFallbackPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
      console.info('[WS] Resuming live WebSocket — fallback polling stopped');
    }
  }, []);

  // Stable refs so the long-running interval always calls the latest version
  const startFallbackPollingRef = useRef(startFallbackPolling);
  startFallbackPollingRef.current = startFallbackPolling;
  const stopFallbackPollingRef = useRef(stopFallbackPolling);
  stopFallbackPollingRef.current = stopFallbackPolling;

  // ── FIX #1 + #6: single stable lag interval, reads all state via refs ────
  useEffect(() => {
    lagCheckInterval.current = setInterval(() => {
      const binReady = binanceReadyRef.current;
      const byReady  = bybitReadyRef.current;
      const recon    = reconnectAttemptsRef.current;

      if (!binReady && !byReady) { setWsStatus('offline'); return; }
      if (recon >= 2)             { setWsStatus('reconnecting'); return; }

      const lag = lastMsgTime.current > 0 ? Date.now() - lastMsgTime.current : 0;
      setWsLagMs(lag);

      if (lag > LAG_THRESHOLD_MS && !inFallbackMode.current) {
        inFallbackMode.current = true;
        setWsStatus('fallback');
        startFallbackPollingRef.current();
      } else if (lag <= LAG_THRESHOLD_MS && lag > 500) {
        setWsStatus('delayed');
        if (inFallbackMode.current) { inFallbackMode.current = false; stopFallbackPollingRef.current(); }
      } else if (lag <= 500 && (binReady || byReady)) {
        setWsStatus('live');
        if (inFallbackMode.current) { inFallbackMode.current = false; stopFallbackPollingRef.current(); }
      }
    }, 1000);
    return () => { if (lagCheckInterval.current) clearInterval(lagCheckInterval.current); };
  }, []); // intentionally empty — all live state read from refs

  // ── Watchdogs ─────────────────────────────────────────────────────────────

  const startWsWatchdog = useCallback((ws: WebSocket) => {
    if (wsWatchdogTimer.current) clearTimeout(wsWatchdogTimer.current);
    wsWatchdogTimer.current = setTimeout(() => {
      if (wsRef.current === ws && optionsRef.current.subscribedPairs.size) scheduleRebuildWs(0);
    }, WS_STALE_MS);
  }, []);

  const startWs2Watchdog = useCallback((ws: WebSocket) => {
    if (ws2WatchdogTimer.current) clearTimeout(ws2WatchdogTimer.current);
    ws2WatchdogTimer.current = setTimeout(() => {
      if (ws2Ref.current === ws && optionsRef.current.bybitEnabled && optionsRef.current.subscribedPairs.size)
        scheduleRebuildWs2(0);
    }, WS_STALE_MS);
  }, []);

  // ── Binance rebuild ───────────────────────────────────────────────────────

  const rebuildWs = useCallback(() => {
    if (wsRebuildTimer.current) { clearTimeout(wsRebuildTimer.current); wsRebuildTimer.current = null; }

    // FIX #5: null the ref BEFORE closing so any pending onclose can't trigger a rebuild
    const old = wsRef.current;
    wsRef.current = null;
    if (pingInterval.current) clearInterval(pingInterval.current);
    if (wsWatchdogTimer.current) clearTimeout(wsWatchdogTimer.current);
    if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; try { old.close(); } catch (_) {} }

    const pairs = optionsRef.current.subscribedPairs;
    if (!pairs.size) { setBinanceReady(false); return; }

    const ws = new WebSocket('wss://stream.binance.com:9443/stream');
    wsRef.current = ws;
    setBinanceReady(false);

    ws.onopen = () => {
      if (wsRef.current !== ws) return;
      setBinanceReady(true);
      wsRetries.current = 0;
      setReconnectAttempts(0);
      ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [...pairs].map(p => p.toLowerCase() + '@aggTrade'), id: 1 }));
      pingInterval.current = setInterval(() => {
        if (wsRef.current === ws && ws.readyState === 1) ws.send(JSON.stringify({ method: 'ping' }));
      }, PING_MS);
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
          const cls   = usdt >= 5e6 ? 'ws-mega' : usdt >= 1e6 ? 'ws-big' : 'ws-mid';
          const trade: WhaleTrade = { ts: Date.now(), sym, side, price, qty, usdt, cls, ex: 'binance' };
          if (optionsRef.current.whaleFeedEx === 'all' || optionsRef.current.whaleFeedEx === 'binance')
            optionsRef.current.onWhaleTrade(trade);
        } catch (_) {}
      });
    };

    ws.onerror = () => { if (wsRef.current !== ws) return; };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      if (pingInterval.current) clearInterval(pingInterval.current);
      if (wsWatchdogTimer.current) clearTimeout(wsWatchdogTimer.current);
      setBinanceReady(false);
      if (pairs.size) {
        wsRetries.current++;
        setReconnectAttempts(wsRetries.current);
        scheduleRebuildWs(backoffWithJitter(wsRetries.current - 1));
      }
    };
  }, [startWsWatchdog]);

  // ── Bybit rebuild ─────────────────────────────────────────────────────────

  const rebuildWs2 = useCallback(() => {
    if (ws2RebuildTimer.current) { clearTimeout(ws2RebuildTimer.current); ws2RebuildTimer.current = null; }

    // FIX #5: null ref before close
    const old = ws2Ref.current;
    ws2Ref.current = null;
    if (ws2PingInterval.current) clearInterval(ws2PingInterval.current);
    if (ws2WatchdogTimer.current) clearTimeout(ws2WatchdogTimer.current);
    if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; try { old.close(); } catch (_) {} }

    if (!optionsRef.current.bybitEnabled || !optionsRef.current.subscribedPairs.size) {
      setBybitReady(false); return;
    }

    const ws = new WebSocket('wss://stream.bybit.com/v5/public/linear');
    ws2Ref.current = ws;
    setBybitReady(false);

    ws.onopen = () => {
      if (ws2Ref.current !== ws) return;
      setBybitReady(true);
      ws2Retries.current = 0;
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
            const side  = t.S === 'Buy' ? 'BUY' : 'SELL';
            optionsRef.current.onTrackerPrice?.(sym, price);
            if (usdt < optionsRef.current.whaleThr) return;
            const cls   = usdt >= 5e6 ? 'ws-mega' : usdt >= 1e6 ? 'ws-big' : 'ws-mid';
            const trade: WhaleTrade = { ts: Date.now(), sym, side, price, qty, usdt, cls, ex: 'bybit' };
            if (optionsRef.current.whaleFeedEx === 'all' || optionsRef.current.whaleFeedEx === 'bybit')
              optionsRef.current.onWhaleTrade(trade);
          });
        } catch (_) {}
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
        const dly = backoffWithJitter(ws2Retries.current - 1);
        ws2ReconnectTimer.current = setTimeout(() => {
          ws2ReconnectTimer.current = null;
          if (optionsRef.current.bybitEnabled) scheduleRebuildWs2(0);
        }, dly);
      }
    };
  }, [startWs2Watchdog]);

  // ── Debounced schedulers ──────────────────────────────────────────────────

  const scheduleRebuildWs = useCallback((delay?: number) => {
    if (wsRebuildTimer.current) clearTimeout(wsRebuildTimer.current);
    wsRebuildTimer.current = setTimeout(rebuildWs, delay ?? WS_REBUILD_DEBOUNCE);
  }, [rebuildWs]);

  const scheduleRebuildWs2 = useCallback((delay?: number) => {
    if (ws2RebuildTimer.current) clearTimeout(ws2RebuildTimer.current);
    ws2RebuildTimer.current = setTimeout(rebuildWs2, delay ?? WS_REBUILD_DEBOUNCE);
  }, [rebuildWs2]);

  // ── FIX #10: separate effect for pairs — only rebuilds Binance ────────────
  useEffect(() => {
    if (subscribedPairs.size) scheduleRebuildWs(300);
    return () => {
      // FIX #5: null before close
      const old = wsRef.current;
      wsRef.current = null;
      if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; try { old.close(); } catch (_) {} }
      if (pingInterval.current) clearInterval(pingInterval.current);
      if (wsWatchdogTimer.current) clearTimeout(wsWatchdogTimer.current);
      if (wsRebuildTimer.current) clearTimeout(wsRebuildTimer.current);
      stopFallbackPollingRef.current();
    };
  }, [subscribedPairs]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── FIX #10: separate effect for Bybit — only touches ws2 ────────────────
  useEffect(() => {
    if (bybitEnabled && subscribedPairs.size) {
      scheduleRebuildWs2(350);
    } else if (!bybitEnabled) {
      const old = ws2Ref.current;
      ws2Ref.current = null;
      if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; try { old.close(); } catch (_) {} }
      if (ws2PingInterval.current) clearInterval(ws2PingInterval.current);
      if (ws2WatchdogTimer.current) clearTimeout(ws2WatchdogTimer.current);
      if (ws2RebuildTimer.current) clearTimeout(ws2RebuildTimer.current);
      if (ws2ReconnectTimer.current) clearTimeout(ws2ReconnectTimer.current);
      setBybitReady(false);
    }
    return () => {
      const old = ws2Ref.current;
      ws2Ref.current = null;
      if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; try { old.close(); } catch (_) {} }
      if (ws2PingInterval.current) clearInterval(ws2PingInterval.current);
      if (ws2WatchdogTimer.current) clearTimeout(ws2WatchdogTimer.current);
      if (ws2RebuildTimer.current) clearTimeout(ws2RebuildTimer.current);
      if (ws2ReconnectTimer.current) clearTimeout(ws2ReconnectTimer.current);
    };
  }, [bybitEnabled, subscribedPairs]); // eslint-disable-line react-hooks/exhaustive-deps

  return { binanceReady, bybitReady, wsStatus, wsLagMs, reconnectAttempts };
}
