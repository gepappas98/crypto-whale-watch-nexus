/* ══ useWhaleStream — Phase 3 client for whale-stream edge function ═════════
 *  Drop-in alternative to useWhaleWebSocket. Connects to the server-side
 *  Binance multiplexer and consumes both whale trades AND aggregated signals.
 *
 *  - Auto-reconnect with exponential backoff + jitter
 *  - Cancellable on unmount
 *  - Publishes signals via onSignal callback (1m & 5m rolling)
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState, useCallback } from 'react';
import { WhaleTrade } from '@/lib/whaleRadarState';

export interface StreamSignal {
  sym: string;
  window: '1m' | '5m';
  netFlow: number;
  buyUsd: number;
  sellUsd: number;
  count: { mid: number; big: number; mega: number };
  maxUsd: number;
  ts: number;
}

export type StreamStatus = 'live' | 'reconnecting' | 'offline' | 'degraded';

interface Options {
  subscribedPairs: Set<string>;
  whaleThr: number;
  onWhaleTrade: (t: WhaleTrade) => void;
  onSignal?: (s: StreamSignal) => void;
  enabled?: boolean;
}

const PROJECT_ID = import.meta.env.VITE_SUPABASE_PROJECT_ID as string;
const PING_MS = 20_000;
const MAX_ATTEMPTS = 10;

function backoff(attempt: number): number {
  return Math.min(500 * Math.pow(2, attempt), 30_000) * (0.7 + Math.random() * 0.6);
}

export function useWhaleStream({
  subscribedPairs, whaleThr, onWhaleTrade, onSignal, enabled = true,
}: Options) {
  const [status, setStatus] = useState<StreamStatus>('offline');
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const subbedRef = useRef<Set<string>>(new Set());
  const thrRef = useRef(whaleThr);
  const cbRef = useRef({ onWhaleTrade, onSignal });
  cbRef.current = { onWhaleTrade, onSignal };
  thrRef.current = whaleThr;

  const send = useCallback((obj: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === 1) {
      try { ws.send(JSON.stringify(obj)); return true; } catch (_) { return false; }
    }
    return false;
  }, []);

  const connect = useCallback(() => {
    if (!enabled) { setStatus('offline'); return; }
    if (!PROJECT_ID) {
      if (!(globalThis as { __wsProjectIdWarned?: boolean }).__wsProjectIdWarned) {
        (globalThis as { __wsProjectIdWarned?: boolean }).__wsProjectIdWarned = true;
        console.warn('[whale-stream] VITE_SUPABASE_PROJECT_ID is missing — stream disabled');
      }
      setStatus('offline');
      return;
    }
    if (wsRef.current && (wsRef.current.readyState === 0 || wsRef.current.readyState === 1)) return;

    const url = `wss://${PROJECT_ID}.functions.supabase.co/whale-stream`;
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch (err) {
      console.error('[whale-stream] construct failed', err);
      scheduleReconnect();
      return;
    }
    wsRef.current = ws;
    setStatus('reconnecting');

    ws.onopen = () => {
      attemptRef.current = 0;
      setReconnectAttempts(0);
      setStatus('live');
      // sync subscriptions + threshold
      send({ op: 'thr', value: thrRef.current });
      const pairs = [...subbedRef.current];
      if (pairs.length) send({ op: 'sub', pairs });
      pingTimer.current = setInterval(() => send({ op: 'ping' }), PING_MS);
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case 'whale':
            if (msg.trade) cbRef.current.onWhaleTrade(msg.trade as WhaleTrade);
            break;
          case 'signal':
            cbRef.current.onSignal?.(msg as StreamSignal);
            break;
          case 'status':
            if (msg.upstream === 'connected') setStatus('live');
            else if (msg.upstream === 'reconnecting') setStatus('reconnecting');
            else setStatus('degraded');
            break;
        }
      } catch (_) { /* ignore */ }
    };

    ws.onclose = () => {
      if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null; }
      if (wsRef.current === ws) wsRef.current = null;
      setStatus('offline');
      scheduleReconnect();
    };

    ws.onerror = () => { /* close handler will fire */ };
  }, [enabled, send]);

  const scheduleReconnect = useCallback(() => {
    if (!enabled) return;
    if (reconnectTimer.current) return;
    if (attemptRef.current >= MAX_ATTEMPTS) { setStatus('degraded'); return; }
    const delay = backoff(attemptRef.current++);
    setReconnectAttempts(attemptRef.current);
    reconnectTimer.current = setTimeout(() => {
      reconnectTimer.current = null;
      connect();
    }, delay);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connect, enabled]);

  // initial connect
  useEffect(() => {
    if (!enabled) return;
    connect();
    return () => {
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
      if (pingTimer.current) { clearInterval(pingTimer.current); pingTimer.current = null; }
      const ws = wsRef.current;
      wsRef.current = null;
      if (ws) { ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null; try { ws.close(); } catch (_) { /* already closed/closing */ } }
    };
  }, [enabled, connect]);

  // sync subscription diff
  useEffect(() => {
    const desired = new Set([...subscribedPairs].map(p => p.toUpperCase()));
    const current = subbedRef.current;
    const toAdd: string[] = [];
    const toDrop: string[] = [];
    desired.forEach(p => { if (!current.has(p)) toAdd.push(p); });
    current.forEach(p => { if (!desired.has(p)) toDrop.push(p); });
    subbedRef.current = desired;
    if (toAdd.length) send({ op: 'sub', pairs: toAdd });
    if (toDrop.length) send({ op: 'unsub', pairs: toDrop });
  }, [subscribedPairs, send]);

  // sync threshold
  useEffect(() => { send({ op: 'thr', value: whaleThr }); }, [whaleThr, send]);

  return { status, reconnectAttempts };
}
