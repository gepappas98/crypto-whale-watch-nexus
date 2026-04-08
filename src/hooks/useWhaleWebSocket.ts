/* ══ WHALE RADAR v9 — WebSocket Hook for Binance + Bybit ═══════════════════ */
import { useEffect, useRef, useCallback, useState } from 'react';
import { WhaleTrade, fmtN, fmtP } from '@/lib/whaleRadarState';

const WS_STALE_MS = 90_000;
const PING_MS = 30_000;
const BACK_BASE = 2000;
const BACK_MAX = 60_000;
const WS_REBUILD_DEBOUNCE = 400;
const WFEED_MAX = 150;

interface UseWhaleWebSocketOptions {
  subscribedPairs: Set<string>;
  bybitEnabled: boolean;
  whaleThr: number;
  whaleFeedEx: string; // 'all' | 'binance' | 'bybit'
  onWhaleTrade: (trade: WhaleTrade) => void;
  onTrackerPrice?: (sym: string, price: number) => void;
}

export function useWhaleWebSocket({
  subscribedPairs, bybitEnabled, whaleThr, whaleFeedEx,
  onWhaleTrade, onTrackerPrice,
}: UseWhaleWebSocketOptions) {
  const [binanceReady, setBinanceReady] = useState(false);
  const [bybitReady, setBybitReady] = useState(false);

  // Refs for WS instances
  const wsRef = useRef<WebSocket | null>(null);
  const ws2Ref = useRef<WebSocket | null>(null);

  // Separate watchdog timers (Issue #2)
  const wsWatchdogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ws2WatchdogTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Separate ping intervals
  const pingInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const ws2PingInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Retry counters
  const wsRetries = useRef(0);
  const ws2Retries = useRef(0);

  // Rebuild debounce timers
  const wsRebuildTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ws2RebuildTimer = useRef<ReturnType<typeof setTimeout> | null>(null); // Issue #5

  // Stable refs for callbacks and options
  const optionsRef = useRef({ subscribedPairs, bybitEnabled, whaleThr, whaleFeedEx, onWhaleTrade, onTrackerPrice });
  optionsRef.current = { subscribedPairs, bybitEnabled, whaleThr, whaleFeedEx, onWhaleTrade, onTrackerPrice };

  // ── Binance watchdog (separate timer, Issue #2) ──
  const startWsWatchdog = useCallback((ws: WebSocket) => {
    if (wsWatchdogTimer.current) clearTimeout(wsWatchdogTimer.current);
    wsWatchdogTimer.current = setTimeout(() => {
      if (wsRef.current === ws && optionsRef.current.subscribedPairs.size) {
        scheduleRebuildWs(0);
      }
    }, WS_STALE_MS);
  }, []);

  // ── Bybit watchdog (separate timer, Issue #2) ──
  const startWs2Watchdog = useCallback((ws: WebSocket) => {
    if (ws2WatchdogTimer.current) clearTimeout(ws2WatchdogTimer.current);
    ws2WatchdogTimer.current = setTimeout(() => {
      // Issue #3: check bybitEnabled before reconnecting
      if (ws2Ref.current === ws && optionsRef.current.bybitEnabled && optionsRef.current.subscribedPairs.size) {
        scheduleRebuildWs2(0);
      }
    }, WS_STALE_MS);
  }, []);

  // ── Binance rebuild ──
  const rebuildWs = useCallback(() => {
    if (wsRebuildTimer.current) { clearTimeout(wsRebuildTimer.current); wsRebuildTimer.current = null; }
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
      ws.send(JSON.stringify({ method: 'SUBSCRIBE', params: [...pairs].map(p => p.toLowerCase() + '@aggTrade'), id: 1 }));
      pingInterval.current = setInterval(() => { if (wsRef.current === ws && ws.readyState === 1) ws.send(JSON.stringify({ method: 'ping' })); }, PING_MS);
      startWsWatchdog(ws);
    };

    ws.onmessage = (e) => {
      if (wsRef.current !== ws) return;
      startWsWatchdog(ws);
      try {
        const raw = JSON.parse(e.data);
        if ('result' in raw || ('id' in raw && !('stream' in raw) && !('e' in raw))) return;
        const d = raw.data || raw;
        if (!d || !d.p || !d.q) return;
        const price = parseFloat(d.p), qty = parseFloat(d.q), usdt = price * qty;
        const side = d.m ? 'SELL' : 'BUY';
        const sym = (d.s || '').replace(/USDT$/, '');
        optionsRef.current.onTrackerPrice?.(sym, price);
        if (usdt < optionsRef.current.whaleThr) return;
        const cls = usdt >= 5e6 ? 'ws-mega' : usdt >= 1e6 ? 'ws-big' : 'ws-mid';
        const trade: WhaleTrade = { ts: Date.now(), sym, side, price, qty, usdt, cls, ex: 'binance' };
        // Issue #4: filter by exchange
        if (optionsRef.current.whaleFeedEx === 'all' || optionsRef.current.whaleFeedEx === 'binance') {
          optionsRef.current.onWhaleTrade(trade);
        }
      } catch (_) {}
    };

    ws.onerror = () => { if (wsRef.current !== ws) return; };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      if (pingInterval.current) clearInterval(pingInterval.current);
      if (wsWatchdogTimer.current) clearTimeout(wsWatchdogTimer.current);
      setBinanceReady(false);
      if (pairs.size) {
        wsRetries.current++;
        const dly = Math.min(BACK_BASE * Math.pow(1.5, wsRetries.current - 1), BACK_MAX);
        scheduleRebuildWs(dly);
      }
    };
  }, [startWsWatchdog]);

  // ── Bybit rebuild (Issue #5: debounced) ──
  const rebuildWs2 = useCallback(() => {
    if (ws2RebuildTimer.current) { clearTimeout(ws2RebuildTimer.current); ws2RebuildTimer.current = null; }
    const old = ws2Ref.current;
    ws2Ref.current = null;
    if (ws2PingInterval.current) clearInterval(ws2PingInterval.current);
    if (ws2WatchdogTimer.current) clearTimeout(ws2WatchdogTimer.current);
    if (old) { old.onopen = old.onmessage = old.onerror = old.onclose = null; try { old.close(); } catch (_) {} }

    // Issue #3: guard against rebuild when bybit is disabled
    if (!optionsRef.current.bybitEnabled || !optionsRef.current.subscribedPairs.size) {
      setBybitReady(false);
      return;
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
      ws2PingInterval.current = setInterval(() => { if (ws2Ref.current === ws && ws.readyState === 1) ws.send(JSON.stringify({ op: 'ping' })); }, PING_MS);
      startWs2Watchdog(ws);
    };

    ws.onmessage = (e) => {
      if (ws2Ref.current !== ws) return;
      startWs2Watchdog(ws);
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
          // Issue #4: filter by exchange
          if (optionsRef.current.whaleFeedEx === 'all' || optionsRef.current.whaleFeedEx === 'bybit') {
            optionsRef.current.onWhaleTrade(trade);
          }
        });
      } catch (_) {}
    };

    ws.onerror = () => { if (ws2Ref.current !== ws) return; };
    ws.onclose = () => {
      if (ws2Ref.current !== ws) return;
      if (ws2PingInterval.current) clearInterval(ws2PingInterval.current);
      if (ws2WatchdogTimer.current) clearTimeout(ws2WatchdogTimer.current);
      setBybitReady(false);
      // Issue #3: check bybitEnabled before scheduling reconnect
      if (optionsRef.current.bybitEnabled && optionsRef.current.subscribedPairs.size) {
        ws2Retries.current++;
        setTimeout(() => {
          // Issue #3: re-check before executing
          if (optionsRef.current.bybitEnabled) {
            scheduleRebuildWs2(0);
          }
        }, Math.min(BACK_BASE * Math.pow(1.5, ws2Retries.current - 1), BACK_MAX));
      }
    };
  }, [startWs2Watchdog]);

  // ── Debounced schedulers ──
  const scheduleRebuildWs = useCallback((delay?: number) => {
    if (wsRebuildTimer.current) clearTimeout(wsRebuildTimer.current);
    wsRebuildTimer.current = setTimeout(rebuildWs, delay ?? WS_REBUILD_DEBOUNCE);
  }, [rebuildWs]);

  // Issue #5: Debounce Bybit rebuild
  const scheduleRebuildWs2 = useCallback((delay?: number) => {
    if (ws2RebuildTimer.current) clearTimeout(ws2RebuildTimer.current);
    ws2RebuildTimer.current = setTimeout(rebuildWs2, delay ?? WS_REBUILD_DEBOUNCE);
  }, [rebuildWs2]);

  // React to pair/config changes
  useEffect(() => {
    if (subscribedPairs.size) {
      scheduleRebuildWs(300);
      if (bybitEnabled) scheduleRebuildWs2(350);
    }
    return () => {
      // Cleanup on unmount
      [wsRef.current, ws2Ref.current].forEach(w => {
        if (w) { w.onclose = w.onerror = null; try { w.close(); } catch (_) {} }
      });
      if (pingInterval.current) clearInterval(pingInterval.current);
      if (ws2PingInterval.current) clearInterval(ws2PingInterval.current);
      if (wsWatchdogTimer.current) clearTimeout(wsWatchdogTimer.current);
      if (ws2WatchdogTimer.current) clearTimeout(ws2WatchdogTimer.current);
      if (wsRebuildTimer.current) clearTimeout(wsRebuildTimer.current);
      if (ws2RebuildTimer.current) clearTimeout(ws2RebuildTimer.current);
    };
  }, [subscribedPairs, bybitEnabled]);

  return { binanceReady, bybitReady };
}
