/* ══ useExchangeFeed — generic adapter-driven WS connection ══════════════════
 *
 *  Ported concept from freqtrade's exchange_ws.py: one connection manager
 *  that works against ANY exchange because all the exchange-specific
 *  knowledge (URL, subscribe frame, message parsing) lives behind the
 *  ExchangeAdapter interface (lib/exchanges/types.ts), not in this hook.
 *
 *  This is intentionally simpler than the hand-hardened Binance/Bybit logic
 *  in useWhaleWebSocket.ts (no lag-tracking, no v10 circuit-breaker tuning)
 *  — it exists so a NEW exchange (OKX, Kraken, whatever's next) is "write
 *  one adapter file", not "duplicate 200 lines of reconnect plumbing".
 *  Battle-test it the same way the legacy hook was battle-tested before
 *  leaning on it for anything critical.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { useEffect, useRef, useState } from 'react';
import type { ExchangeAdapter, NormalizedTrade } from '@/lib/exchanges/types';

export type ExchangeFeedStatus = 'idle' | 'connecting' | 'live' | 'reconnecting' | 'error';

export interface UseExchangeFeedOptions {
  adapter: ExchangeAdapter;
  /** Canonical 'BTCUSDT'-style pairs — each adapter converts to its own format internally. */
  pairs: Set<string> | string[];
  minUsd: number;
  enabled: boolean;
  onTrade: (trade: NormalizedTrade) => void;
}

export interface UseExchangeFeedResult {
  status: ExchangeFeedStatus;
  reconnectAttempts: number;
}

const MAX_BACKOFF_MS = 30_000;

export function useExchangeFeed({
  adapter, pairs, minUsd, enabled, onTrade,
}: UseExchangeFeedOptions): UseExchangeFeedResult {
  const [status, setStatus] = useState<ExchangeFeedStatus>('idle');
  const [reconnectAttempts, setReconnectAttempts] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptsRef = useRef(0);

  // Stable refs so a trade-handler identity change or minUsd tweak doesn't force a reconnect.
  const onTradeRef = useRef(onTrade);
  useEffect(() => { onTradeRef.current = onTrade; }, [onTrade]);
  const minUsdRef = useRef(minUsd);
  useEffect(() => { minUsdRef.current = minUsd; }, [minUsd]);

  const pairKey = Array.from(pairs).sort().join(',');

  useEffect(() => {
    const closeSocket = () => {
      const ws = wsRef.current;
      if (ws) {
        ws.onopen = ws.onmessage = ws.onerror = ws.onclose = null;
        try { ws.close(); } catch { /* already closed */ }
        wsRef.current = null;
      }
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    if (!enabled || !pairKey) {
      closeSocket();
      setStatus('idle');
      return;
    }

    let cancelled = false;
    const pairList = pairKey.split(',');

    function connect() {
      if (cancelled) return;
      setStatus(attemptsRef.current > 0 ? 'reconnecting' : 'connecting');

      let ws: WebSocket;
      try {
        ws = new WebSocket(adapter.wsUrl);
      } catch {
        setStatus('error');
        return;
      }
      wsRef.current = ws;

      ws.onopen = () => {
        if (cancelled) return;
        attemptsRef.current = 0;
        setReconnectAttempts(0);
        setStatus('live');
        try {
          ws.send(adapter.buildSubscribeMessage(pairList));
        } catch (err) {
          console.error(`[useExchangeFeed:${adapter.id}] subscribe send failed`, (err as Error)?.message);
        }
      };

      ws.onmessage = (e) => {
        const trade = adapter.parseMessage(typeof e.data === 'string' ? e.data : '', minUsdRef.current);
        if (trade) onTradeRef.current(trade);
      };

      ws.onerror = () => {
        try { ws.close(); } catch { /* noop */ }
      };

      ws.onclose = () => {
        if (cancelled) return;
        attemptsRef.current += 1;
        setReconnectAttempts(attemptsRef.current);
        setStatus('reconnecting');
        const delay = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(attemptsRef.current, 5));
        timerRef.current = setTimeout(connect, delay);
      };
    }

    connect();

    return () => {
      cancelled = true;
      closeSocket();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adapter, enabled, pairKey]);

  return { status, reconnectAttempts };
}
