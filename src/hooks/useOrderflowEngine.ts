/* ══ ORDERFLOW ENGINE — Real-time Binance WS edge engine ════════════════════
 *  Streams:
 *    - {symbol}@depth20@100ms     (spot orderbook top 20)
 *    - {symbol}@aggTrade           (spot trades)
 *    - {symbol}@forceOrder         (futures liquidations, fstream)
 *
 *  Derived:
 *    - orderbook imbalance (top20 bid size / ask size)
 *    - cumulative volume delta (rolling 60s)
 *    - buy/sell volume window
 *    - absorption (sell-vol high but price stable / buy-vol high but stalled)
 *    - spoofing (large book level appears then disappears < 2s)
 *    - liquidation pressure (long vs short, 60s)
 *    - signals: flow_bullish, flow_bearish, absorption_*, spoof_detected,
 *               short_squeeze, long_squeeze
 *
 *  No mocks. No REST. Reconnects on drop.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useEffect, useRef, useState } from "react";

export type OFSignal = {
  id: string;
  ts: number;
  symbol: string;
  type:
    | "BUY_PRESSURE"
    | "SELL_PRESSURE"
    | "HIDDEN_BUYER"
    | "HIDDEN_SELLER"
    | "FAKE_LIQUIDITY"
    | "SQUEEZE_UP"
    | "SQUEEZE_DOWN";
  detail: string;
  priority: number;
};

export type OFLiquidation = {
  ts: number;
  side: "long" | "short"; // long liquidated = forced sell; short liquidated = forced buy
  price: number;
  qty: number;
  usd: number;
};

export type OFLevel = [number, number]; // [price, size]

export type OrderflowState = {
  symbol: string;
  connected: boolean;
  lastUpdate: number;
  bids: OFLevel[]; // top 20, desc price
  asks: OFLevel[]; // top 20, asc price
  midPrice: number;
  spread: number;
  imbalance: number; // bidSize / askSize
  cvd: number; // rolling 60s
  buyVol: number; // rolling 60s
  sellVol: number; // rolling 60s
  liqLongUsd: number; // rolling 60s
  liqShortUsd: number;
  liquidations: OFLiquidation[]; // recent, capped 100
  signals: OFSignal[]; // recent, capped 50
  priceHistory: { ts: number; price: number }[]; // ~60s
  cvdHistory: { ts: number; cvd: number }[]; // ~60s
};

const WINDOW_MS = 60_000;
const SPOOF_TTL_MS = 2_000;
const SPOOF_MIN_USD = 250_000;

function emptyState(symbol: string): OrderflowState {
  return {
    symbol,
    connected: false,
    lastUpdate: 0,
    bids: [],
    asks: [],
    midPrice: 0,
    spread: 0,
    imbalance: 1,
    cvd: 0,
    buyVol: 0,
    sellVol: 0,
    liqLongUsd: 0,
    liqShortUsd: 0,
    liquidations: [],
    signals: [],
    priceHistory: [],
    cvdHistory: [],
  };
}

export function useOrderflowEngine(symbol: string) {
  const [state, setState] = useState<OrderflowState>(() => emptyState(symbol.toLowerCase()));
  const symRef = useRef(symbol.toLowerCase());

  // Mutable accumulators (avoid re-render on every WS msg)
  const tradesRef = useRef<{ ts: number; price: number; qty: number; isSell: boolean }[]>([]);
  const liqsRef = useRef<OFLiquidation[]>([]);
  const bidsRef = useRef<OFLevel[]>([]);
  const asksRef = useRef<OFLevel[]>([]);
  const signalsRef = useRef<OFSignal[]>([]);
  const priceHistRef = useRef<{ ts: number; price: number }[]>([]);
  const cvdHistRef = useRef<{ ts: number; cvd: number }[]>([]);
  // spoof tracking: key = `${side}:${price}` -> { size, ts }
  const spoofRef = useRef<Map<string, { size: number; firstSeen: number }>>(new Map());
  const lastSignalRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    symRef.current = symbol.toLowerCase();
    setState(emptyState(symRef.current));
    tradesRef.current = [];
    liqsRef.current = [];
    bidsRef.current = [];
    asksRef.current = [];
    signalsRef.current = [];
    priceHistRef.current = [];
    cvdHistRef.current = [];
    spoofRef.current.clear();
    lastSignalRef.current.clear();

    const sym = symRef.current;
    let spotWs: WebSocket | null = null;
    let futWs: WebSocket | null = null;
    let stopped = false;
    let spotRetry = 0;
    let futRetry = 0;
    let spotTimer: ReturnType<typeof setTimeout> | null = null;
    let futTimer: ReturnType<typeof setTimeout> | null = null;

    const emitSignal = (s: Omit<OFSignal, "ts" | "symbol" | "id">) => {
      const key = s.type;
      const now = Date.now();
      const last = lastSignalRef.current.get(key) ?? 0;
      if (now - last < 4000) return; // dedupe 4s per type
      lastSignalRef.current.set(key, now);
      const sig: OFSignal = {
        ...s,
        id: `${key}-${now}`,
        ts: now,
        symbol: sym.toUpperCase(),
      };
      signalsRef.current = [sig, ...signalsRef.current].slice(0, 50);
    };

    const computeAndEmit = () => {
      const now = Date.now();
      // Trim trades
      tradesRef.current = tradesRef.current.filter((t) => now - t.ts < WINDOW_MS);
      liqsRef.current = liqsRef.current.filter((l) => now - l.ts < WINDOW_MS);

      let buyVol = 0;
      let sellVol = 0;
      for (const t of tradesRef.current) {
        if (t.isSell) sellVol += t.qty;
        else buyVol += t.qty;
      }
      const cvd = buyVol - sellVol;

      let liqLongUsd = 0;
      let liqShortUsd = 0;
      for (const l of liqsRef.current) {
        if (l.side === "long") liqLongUsd += l.usd;
        else liqShortUsd += l.usd;
      }

      const bids = bidsRef.current;
      const asks = asksRef.current;
      const bidSum = bids.reduce((s, [, q]) => s + q, 0);
      const askSum = asks.reduce((s, [, q]) => s + q, 0);
      const imbalance = askSum > 0 ? bidSum / askSum : 1;
      const bestBid = bids[0]?.[0] ?? 0;
      const bestAsk = asks[0]?.[0] ?? 0;
      const midPrice = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : bestBid || bestAsk;
      const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;

      // Price history (rolling)
      if (midPrice > 0) {
        priceHistRef.current.push({ ts: now, price: midPrice });
        priceHistRef.current = priceHistRef.current.filter((p) => now - p.ts < WINDOW_MS);
      }
      cvdHistRef.current.push({ ts: now, cvd });
      cvdHistRef.current = cvdHistRef.current.filter((p) => now - p.ts < WINDOW_MS);

      // Price change over window
      const oldestPrice = priceHistRef.current[0]?.price ?? midPrice;
      const pricePct = oldestPrice ? ((midPrice - oldestPrice) / oldestPrice) * 100 : 0;
      const cvdRising =
        cvdHistRef.current.length > 5 &&
        cvd > (cvdHistRef.current[0]?.cvd ?? 0);
      const cvdFalling =
        cvdHistRef.current.length > 5 &&
        cvd < (cvdHistRef.current[0]?.cvd ?? 0);

      // Signals
      if (imbalance > 1.3 && cvdRising) {
        emitSignal({
          type: "BUY_PRESSURE",
          detail: `imb ${imbalance.toFixed(2)} · CVD↑ ${cvd.toFixed(2)}`,
          priority: 2,
        });
      }
      if (imbalance < 0.8 && cvdFalling) {
        emitSignal({
          type: "SELL_PRESSURE",
          detail: `imb ${imbalance.toFixed(2)} · CVD↓ ${cvd.toFixed(2)}`,
          priority: 2,
        });
      }
      // Absorption: heavy sell volume but price flat/up
      if (sellVol > buyVol * 1.4 && pricePct > -0.05) {
        emitSignal({
          type: "HIDDEN_BUYER",
          detail: `sell ${sellVol.toFixed(2)} absorbed · Δ${pricePct.toFixed(2)}%`,
          priority: 3,
        });
      }
      if (buyVol > sellVol * 1.4 && pricePct < 0.05) {
        emitSignal({
          type: "HIDDEN_SELLER",
          detail: `buy ${buyVol.toFixed(2)} absorbed · Δ${pricePct.toFixed(2)}%`,
          priority: 3,
        });
      }
      // Liquidation squeezes
      if (liqShortUsd > 250_000 && pricePct > 0.1) {
        emitSignal({
          type: "SQUEEZE_UP",
          detail: `$${(liqShortUsd / 1000).toFixed(0)}k shorts · +${pricePct.toFixed(2)}%`,
          priority: 1,
        });
      }
      if (liqLongUsd > 250_000 && pricePct < -0.1) {
        emitSignal({
          type: "SQUEEZE_DOWN",
          detail: `$${(liqLongUsd / 1000).toFixed(0)}k longs · ${pricePct.toFixed(2)}%`,
          priority: 1,
        });
      }

      setState({
        symbol: sym,
        connected: spotWs?.readyState === WebSocket.OPEN,
        lastUpdate: now,
        bids: bids.slice(0, 20),
        asks: asks.slice(0, 20),
        midPrice,
        spread,
        imbalance,
        cvd,
        buyVol,
        sellVol,
        liqLongUsd,
        liqShortUsd,
        liquidations: liqsRef.current.slice(-50).reverse(),
        signals: signalsRef.current,
        priceHistory: [...priceHistRef.current],
        cvdHistory: [...cvdHistRef.current],
      });
    };

    const tickInterval = setInterval(computeAndEmit, 1000);

    const connectSpot = () => {
      if (stopped) return;
      const url = `wss://stream.binance.com:9443/stream?streams=${sym}@depth20@100ms/${sym}@aggTrade`;
      try {
        spotWs = new WebSocket(url);
      } catch {
        spotTimer = setTimeout(connectSpot, Math.min(1000 * 2 ** spotRetry++, 15_000));
        return;
      }
      spotWs.onopen = () => {
        spotRetry = 0;
      };
      spotWs.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const stream: string = msg.stream || "";
          const data = msg.data || msg;
          if (stream.endsWith("@depth20@100ms") || data.bids) {
            const newBids: OFLevel[] = (data.bids || []).map((l: [string, string]) => [
              parseFloat(l[0]),
              parseFloat(l[1]),
            ]);
            const newAsks: OFLevel[] = (data.asks || []).map((l: [string, string]) => [
              parseFloat(l[0]),
              parseFloat(l[1]),
            ]);

            // Spoof detection: track levels worth > $250k that appear & disappear < 2s
            const now = Date.now();
            const px = (newBids[0]?.[0] ?? newAsks[0]?.[0] ?? 0);
            const detectSide = (prev: OFLevel[], next: OFLevel[], side: "bid" | "ask") => {
              const nextMap = new Map(next.map(([p, q]) => [p, q]));
              for (const [p, q] of next) {
                const usd = p * q;
                if (usd < SPOOF_MIN_USD) continue;
                const k = `${side}:${p}`;
                if (!spoofRef.current.has(k)) spoofRef.current.set(k, { size: q, firstSeen: now });
              }
              for (const [k, v] of spoofRef.current) {
                if (!k.startsWith(side + ":")) continue;
                const p = parseFloat(k.slice(side.length + 1));
                const stillThere = nextMap.get(p);
                if (!stillThere || stillThere < v.size * 0.3) {
                  const age = now - v.firstSeen;
                  if (age < SPOOF_TTL_MS && px * v.size >= SPOOF_MIN_USD) {
                    emitSignal({
                      type: "FAKE_LIQUIDITY",
                      detail: `${side === "bid" ? "bid" : "ask"} $${((px * v.size) / 1000).toFixed(0)}k pulled @ ${p}`,
                      priority: 2,
                    });
                  }
                  spoofRef.current.delete(k);
                }
              }
            };
            detectSide(bidsRef.current, newBids, "bid");
            detectSide(asksRef.current, newAsks, "ask");

            bidsRef.current = newBids;
            asksRef.current = newAsks;
          } else if (data.e === "aggTrade" || data.p) {
            tradesRef.current.push({
              ts: data.T || Date.now(),
              price: parseFloat(data.p),
              qty: parseFloat(data.q),
              isSell: !!data.m,
            });
          }
        } catch {
          /* ignore parse errors */
        }
      };
      spotWs.onclose = () => {
        if (stopped) return;
        spotTimer = setTimeout(connectSpot, Math.min(1000 * 2 ** spotRetry++, 15_000));
      };
      spotWs.onerror = () => {
        try {
          spotWs?.close();
        } catch {
          /* noop */
        }
      };
    };

    const connectFut = () => {
      if (stopped) return;
      const url = `wss://fstream.binance.com/ws/${sym}@forceOrder`;
      try {
        futWs = new WebSocket(url);
      } catch {
        futTimer = setTimeout(connectFut, Math.min(1000 * 2 ** futRetry++, 30_000));
        return;
      }
      futWs.onopen = () => {
        futRetry = 0;
      };
      futWs.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          const o = msg.o;
          if (!o) return;
          const price = parseFloat(o.ap || o.p);
          const qty = parseFloat(o.q);
          // Binance: SELL side = long position liquidated; BUY side = short liquidated
          const side: "long" | "short" = o.S === "SELL" ? "long" : "short";
          liqsRef.current.push({
            ts: o.T || Date.now(),
            side,
            price,
            qty,
            usd: price * qty,
          });
        } catch {
          /* ignore */
        }
      };
      futWs.onclose = () => {
        if (stopped) return;
        futTimer = setTimeout(connectFut, Math.min(1000 * 2 ** futRetry++, 30_000));
      };
      futWs.onerror = () => {
        try {
          futWs?.close();
        } catch {
          /* noop */
        }
      };
    };

    connectSpot();
    connectFut();

    return () => {
      stopped = true;
      clearInterval(tickInterval);
      if (spotTimer) clearTimeout(spotTimer);
      if (futTimer) clearTimeout(futTimer);
      try {
        spotWs?.close();
      } catch {
        /* noop */
      }
      try {
        futWs?.close();
      } catch {
        /* noop */
      }
    };
  }, [symbol]);

  return state;
}
