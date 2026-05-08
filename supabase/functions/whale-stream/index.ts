/* ══ WHALE STREAM v1 — Server-side Binance WS multiplexer + signal engine ════
 *  ARCHITECTURE
 *    • Per-instance singleton: ONE upstream Binance WS connection
 *    • Multiplexes subscriptions from all connected client WS sessions
 *    • Server-side signal engine: 1–5 min rolling windows
 *      - net flow (buy_usd - sell_usd)
 *      - whale count by tier (mid/big/mega)
 *      - max single trade
 *    • Client sub/unsub via JSON messages: { op:"sub"|"unsub", pairs:[...] }
 *    • Pushes per-client whale trades + periodic signal snapshots (1s)
 *
 *  CLIENT MESSAGE FORMAT
 *    { op:"sub",   pairs:["BTC","ETH"] }
 *    { op:"unsub", pairs:["BTC"] }
 *    { op:"thr",   value: 100000 }              // whale threshold (usdt)
 *    { op:"ping" }
 *
 *  SERVER MESSAGE FORMAT
 *    { type:"whale", trade:{...} }
 *    { type:"signal", sym, window:"1m"|"5m", netFlow, buyUsd, sellUsd,
 *                     count:{mid,big,mega}, maxUsd, ts }
 *    { type:"status", upstream:"connected"|"reconnecting"|"down" }
 *    { type:"pong" }
 * ═══════════════════════════════════════════════════════════════════════════ */

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, upgrade, connection, sec-websocket-key, sec-websocket-version, sec-websocket-protocol',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

interface WhaleTrade {
  ts: number;
  sym: string;
  side: 'BUY' | 'SELL';
  price: number;
  qty: number;
  usdt: number;
  cls: 'ws-mid' | 'ws-big' | 'ws-mega';
  ex: 'binance';
}

interface ClientSession {
  socket: WebSocket;
  pairs: Set<string>;        // symbols WITHOUT USDT suffix (BTC, ETH)
  thr: number;
  alive: boolean;
}

// ─── Per-instance state ────────────────────────────────────────────────────
const clients = new Set<ClientSession>();
const subRefCount = new Map<string, number>(); // symbol → number of clients subscribed
let upstream: WebSocket | null = null;
let upstreamStatus: 'connected' | 'reconnecting' | 'down' = 'down';
let reconnectAttempt = 0;
let reconnectTimer: number | null = null;
let upstreamReady = false;

// rolling trade buffers per symbol (5 min retention, signals computed at 1m & 5m)
const tradeBuf = new Map<string, WhaleTrade[]>();
const SIGNAL_WINDOW_5M = 5 * 60_000;

function backoff(attempt: number): number {
  return Math.min(500 * Math.pow(2, attempt), 30_000) * (0.7 + Math.random() * 0.6);
}

function broadcastStatus() {
  const msg = JSON.stringify({ type: 'status', upstream: upstreamStatus });
  for (const c of clients) {
    if (c.alive) try { c.socket.send(msg); } catch (_) { /* ignore */ }
  }
}

function ensureUpstream() {
  if (upstream && (upstream.readyState === 0 || upstream.readyState === 1)) return;
  if (subRefCount.size === 0) return;
  upstreamStatus = 'reconnecting';
  broadcastStatus();

  try {
    upstream = new WebSocket('wss://stream.binance.com:9443/stream');
  } catch (err) {
    console.error('[whale-stream] upstream construct failed', err);
    scheduleReconnect();
    return;
  }

  upstream.onopen = () => {
    upstreamReady = true;
    reconnectAttempt = 0;
    upstreamStatus = 'connected';
    broadcastStatus();
    // resubscribe everything
    const params = [...subRefCount.keys()].map(s => `${s.toLowerCase()}usdt@aggTrade`);
    if (params.length && upstream) {
      upstream.send(JSON.stringify({ method: 'SUBSCRIBE', params, id: Date.now() }));
    }
  };

  upstream.onmessage = (ev) => {
    let raw: { stream?: string; data?: { p: string; q: string; m: boolean; s: string; T: number } };
    try { raw = JSON.parse(ev.data); } catch (_) { return; }
    const d = raw.data;
    if (!d || !d.p || !d.q || !d.s) return;

    const price = parseFloat(d.p);
    const qty = parseFloat(d.q);
    const usdt = price * qty;
    const side: 'BUY' | 'SELL' = d.m ? 'SELL' : 'BUY';
    const sym = d.s.replace(/USDT$/, '');
    const ts = d.T || Date.now();

    // record into rolling buffer (always — signals depend on full flow, not just whales)
    let buf = tradeBuf.get(sym);
    if (!buf) { buf = []; tradeBuf.set(sym, buf); }
    buf.push({ ts, sym, side, price, qty, usdt, cls: 'ws-mid', ex: 'binance' });
    // trim
    const cutoff = ts - SIGNAL_WINDOW_5M;
    while (buf.length && buf[0].ts < cutoff) buf.shift();

    // fan out whale trade to subscribed clients above their threshold
    const cls: WhaleTrade['cls'] = usdt >= 5e6 ? 'ws-mega' : usdt >= 1e6 ? 'ws-big' : 'ws-mid';
    const trade: WhaleTrade = { ts, sym, side, price, qty, usdt, cls, ex: 'binance' };
    const payload = JSON.stringify({ type: 'whale', trade });

    for (const c of clients) {
      if (!c.alive || !c.pairs.has(sym)) continue;
      if (usdt < c.thr) continue;
      try { c.socket.send(payload); } catch (_) { /* ignore */ }
    }
  };

  upstream.onclose = () => {
    upstreamReady = false;
    upstreamStatus = 'down';
    broadcastStatus();
    scheduleReconnect();
  };

  upstream.onerror = (err) => {
    console.error('[whale-stream] upstream error', (err as ErrorEvent).message);
  };
}

function scheduleReconnect() {
  if (reconnectTimer != null) return;
  if (subRefCount.size === 0) return;
  const delay = backoff(reconnectAttempt++);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureUpstream();
  }, delay) as unknown as number;
}

function subscribeUpstream(syms: string[]) {
  const fresh: string[] = [];
  for (const s of syms) {
    const cur = subRefCount.get(s) || 0;
    if (cur === 0) fresh.push(s);
    subRefCount.set(s, cur + 1);
  }
  if (fresh.length && upstream && upstreamReady) {
    upstream.send(JSON.stringify({
      method: 'SUBSCRIBE',
      params: fresh.map(s => `${s.toLowerCase()}usdt@aggTrade`),
      id: Date.now(),
    }));
  }
  ensureUpstream();
}

function unsubscribeUpstream(syms: string[]) {
  const drop: string[] = [];
  for (const s of syms) {
    const cur = subRefCount.get(s) || 0;
    if (cur <= 1) { subRefCount.delete(s); drop.push(s); tradeBuf.delete(s); }
    else subRefCount.set(s, cur - 1);
  }
  if (drop.length && upstream && upstreamReady) {
    upstream.send(JSON.stringify({
      method: 'UNSUBSCRIBE',
      params: drop.map(s => `${s.toLowerCase()}usdt@aggTrade`),
      id: Date.now(),
    }));
  }
}

// ─── Signal computation ────────────────────────────────────────────────────
function computeSignal(sym: string, windowMs: number) {
  const buf = tradeBuf.get(sym);
  if (!buf || !buf.length) return null;
  const now = Date.now();
  const cutoff = now - windowMs;
  let buyUsd = 0, sellUsd = 0, maxUsd = 0;
  const count = { mid: 0, big: 0, mega: 0 };
  for (let i = buf.length - 1; i >= 0; i--) {
    const t = buf[i];
    if (t.ts < cutoff) break;
    if (t.side === 'BUY') buyUsd += t.usdt; else sellUsd += t.usdt;
    if (t.usdt > maxUsd) maxUsd = t.usdt;
    if (t.usdt >= 5e6) count.mega++;
    else if (t.usdt >= 1e6) count.big++;
    else if (t.usdt >= 1e5) count.mid++;
  }
  return {
    sym,
    window: windowMs === 60_000 ? '1m' : '5m',
    netFlow: buyUsd - sellUsd,
    buyUsd, sellUsd, count, maxUsd, ts: now,
  };
}

// signal broadcaster — runs every 1s, sends to subscribed clients
const signalTimer = setInterval(() => {
  if (clients.size === 0) return;
  for (const sym of subRefCount.keys()) {
    const s1 = computeSignal(sym, 60_000);
    const s5 = computeSignal(sym, 300_000);
    if (!s1 && !s5) continue;
    for (const c of clients) {
      if (!c.alive || !c.pairs.has(sym)) continue;
      try {
        if (s1) c.socket.send(JSON.stringify({ type: 'signal', ...s1 }));
        if (s5) c.socket.send(JSON.stringify({ type: 'signal', ...s5 }));
      } catch (_) { /* ignore */ }
    }
  }
}, 1000);

// ─── HTTP / WS upgrade handler ─────────────────────────────────────────────
Deno.serve((req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const upgrade = req.headers.get('upgrade') || '';
  if (upgrade.toLowerCase() !== 'websocket') {
    return new Response(JSON.stringify({
      service: 'whale-stream',
      clients: clients.size,
      symbols: subRefCount.size,
      upstream: upstreamStatus,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const { socket, response } = Deno.upgradeWebSocket(req);
  const session: ClientSession = { socket, pairs: new Set(), thr: 100_000, alive: false };

  socket.onopen = () => {
    session.alive = true;
    clients.add(session);
    try { socket.send(JSON.stringify({ type: 'status', upstream: upstreamStatus })); } catch (_) {}
  };

  socket.onmessage = (ev) => {
    let msg: { op?: string; pairs?: string[]; value?: number };
    try { msg = JSON.parse(ev.data); } catch (_) { return; }
    if (!msg.op) return;

    switch (msg.op) {
      case 'sub': {
        const next = (msg.pairs || []).map(p => p.toUpperCase()).filter(p => !session.pairs.has(p));
        next.forEach(p => session.pairs.add(p));
        if (next.length) subscribeUpstream(next);
        break;
      }
      case 'unsub': {
        const drop = (msg.pairs || []).map(p => p.toUpperCase()).filter(p => session.pairs.has(p));
        drop.forEach(p => session.pairs.delete(p));
        if (drop.length) unsubscribeUpstream(drop);
        break;
      }
      case 'thr': {
        if (typeof msg.value === 'number' && msg.value > 0) session.thr = msg.value;
        break;
      }
      case 'ping': {
        try { socket.send(JSON.stringify({ type: 'pong' })); } catch (_) {}
        break;
      }
    }
  };

  const cleanup = () => {
    if (!session.alive) return;
    session.alive = false;
    clients.delete(session);
    if (session.pairs.size) unsubscribeUpstream([...session.pairs]);
  };
  socket.onclose = cleanup;
  socket.onerror = cleanup;

  return response;
});

// keep ref so timer survives if linter complains
void signalTimer;
