/* ══ WHALE STREAM v2 — Server-side Binance WS multiplexer + signal engine ════
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
 *
 *  v2 LIFECYCLE FIXES (over v1)
 *    1. EdgeRuntime.waitUntil() — Supabase/Deno Deploy can suspend an
 *       isolate's background work (the upstream WS, reconnect timer, signal
 *       broadcaster all live at module scope, not tied to any one client's
 *       request/response) once it decides a request is "done." A WebSocket
 *       upgrade response doesn't automatically communicate "keep the whole
 *       isolate's background timers alive too." Each client session now
 *       registers a promise via EdgeRuntime.waitUntil() that only resolves
 *       when that client disconnects — as long as any client is connected,
 *       the runtime knows not to suspend the isolate hosting the shared
 *       upstream connection and timers. No-ops safely if EdgeRuntime isn't
 *       present (e.g. local `supabase functions serve`).
 *    2. Stale-instance guard — every upstream WS event handler used to
 *       mutate module-level state unconditionally. If a slow-closing old
 *       connection's onclose/onerror fired AFTER a replacement connection
 *       was already established (a real race: ensureUpstream() creates a
 *       new socket without waiting for an old one in the CLOSING state to
 *       finish closing), it would clobber the new connection's just-set
 *       'connected' status back to 'down' and schedule a redundant
 *       reconnect — thrashing. Every handler now captures the connection's
 *       own id and no-ops if it's no longer the current one.
 *    3. Connection-attempt timeout — `new WebSocket(...)` had no timeout:
 *       if it never fired onopen/onerror/onclose (a real failure mode on a
 *       stalled TCP handshake), the connection just hung in CONNECTING
 *       forever with no retry. Now force-abandoned after CONNECT_TIMEOUT_MS.
 *    4. Silent-death watchdog — aggTrade streams are usually continuous,
 *       but a half-open TCP connection (network partition on one side)
 *       can leave the socket reporting OPEN with no onclose/onerror ever
 *       firing while no data arrives. A periodic check now force-reconnects
 *       if 'connected' but no upstream message has arrived in STALE_MS
 *       despite active subscriptions.
 * ═══════════════════════════════════════════════════════════════════════════ */

// Deno Deploy / Supabase Edge Runtime global — not in the standard Deno lib
// types, so declared loosely here. Always feature-detected before use (see
// waitUntilAlive()) so this file still runs fine under `supabase functions
// serve` or any runtime that doesn't expose it.
declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

function waitUntilAlive(promise: Promise<unknown>): void {
  try {
    if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
      EdgeRuntime.waitUntil(promise);
    }
  } catch (_) {
    // EdgeRuntime referenced but not actually usable in this environment —
    // degrade to "isolate lifetime managed however the platform normally
    // would," not a hard failure.
  }
}

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
let upstreamId = 0; // incremented every time `upstream` is replaced — lets
                     // stale handlers from a superseded connection recognize
                     // themselves as stale and no-op (fix #2 above).
let upstreamStatus: 'connected' | 'reconnecting' | 'down' = 'down';
let reconnectAttempt = 0;
let reconnectTimer: number | null = null;
let upstreamReady = false;
let lastUpstreamMessageAt = 0;
let connectTimeoutTimer: number | null = null;

const CONNECT_TIMEOUT_MS = 10_000;
const STALE_MS = 45_000; // aggTrade traffic on any subscribed symbol should
                          // never realistically go this long with zero
                          // messages while the connection reports 'connected'
const MAX_RECONNECT_ATTEMPT = 20; // backoff() already caps the delay at 30s
                                   // via Math.min, but this keeps `attempt`
                                   // itself from growing unbounded over a
                                   // very long uptime with intermittent drops

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

function clearConnectTimeout() {
  if (connectTimeoutTimer != null) {
    clearTimeout(connectTimeoutTimer);
    connectTimeoutTimer = null;
  }
}

function ensureUpstream() {
  if (upstream && (upstream.readyState === 0 || upstream.readyState === 1)) return;
  if (subRefCount.size === 0) return;
  upstreamStatus = 'reconnecting';
  broadcastStatus();

  const id = ++upstreamId; // this connection's identity — every handler
                            // below checks `id === upstreamId` before
                            // touching shared state (fix #2)
  let socket: WebSocket;
  try {
    socket = new WebSocket('wss://stream.binance.com:9443/stream');
  } catch (err) {
    console.error('[whale-stream] upstream construct failed', err);
    scheduleReconnect();
    return;
  }
  upstream = socket;

  clearConnectTimeout();
  connectTimeoutTimer = setTimeout(() => {
    if (id !== upstreamId) return; // superseded already, nothing to do
    connectTimeoutTimer = null;
    if (socket.readyState === 0) {
      console.warn('[whale-stream] upstream connect timed out, forcing retry');
      try { socket.close(); } catch (_) { /* ignore */ }
      // socket.close() on a still-CONNECTING socket may not reliably fire
      // onclose in every runtime — drive the retry from here directly
      // rather than assuming onclose will.
      upstreamReady = false;
      upstreamStatus = 'down';
      broadcastStatus();
      scheduleReconnect();
    }
  }, CONNECT_TIMEOUT_MS) as unknown as number;

  socket.onopen = () => {
    if (id !== upstreamId) return; // stale — a newer connection replaced this one
    clearConnectTimeout();
    upstreamReady = true;
    reconnectAttempt = 0;
    lastUpstreamMessageAt = Date.now();
    upstreamStatus = 'connected';
    broadcastStatus();
    // resubscribe everything
    const params = [...subRefCount.keys()].map(s => `${s.toLowerCase()}usdt@aggTrade`);
    if (params.length) {
      socket.send(JSON.stringify({ method: 'SUBSCRIBE', params, id: Date.now() }));
    }
  };

  socket.onmessage = (ev) => {
    if (id !== upstreamId) return; // stale
    lastUpstreamMessageAt = Date.now();

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

  socket.onclose = () => {
    if (id !== upstreamId) return; // stale — already superseded, don't
                                    // clobber the replacement's state or
                                    // double-schedule a reconnect
    clearConnectTimeout();
    upstreamReady = false;
    upstreamStatus = 'down';
    broadcastStatus();
    scheduleReconnect();
  };

  socket.onerror = (err) => {
    if (id !== upstreamId) return; // stale
    console.error('[whale-stream] upstream error', (err as ErrorEvent).message);
  };
}

function scheduleReconnect() {
  if (reconnectTimer != null) return;
  if (subRefCount.size === 0) return;
  const attempt = Math.min(reconnectAttempt++, MAX_RECONNECT_ATTEMPT);
  const delay = backoff(attempt);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    ensureUpstream();
  }, delay) as unknown as number;
}

// Silent-death watchdog: a half-open TCP connection can leave the socket
// reporting readyState OPEN with no onclose/onerror ever firing while no
// data actually arrives — onclose-driven reconnect (fix in ensureUpstream)
// never triggers in that failure mode, so this checks elapsed time instead.
// Piggybacks on the existing 1s signal-broadcast timer rather than adding a
// second interval.
function checkUpstreamHealth() {
  if (upstreamStatus !== 'connected') return;
  if (subRefCount.size === 0) return;
  if (lastUpstreamMessageAt === 0) return; // just connected, hasn't had a
                                            // chance to receive anything yet
  if (Date.now() - lastUpstreamMessageAt <= STALE_MS) return;

  console.warn(`[whale-stream] no upstream messages in ${STALE_MS}ms with active subscriptions — forcing reconnect`);
  const staleId = upstreamId;
  upstreamId++; // immediately invalidate the stale connection's handlers
                // before touching it, so its own onclose (if it ever does
                // fire) is a guaranteed no-op
  try { upstream?.close(); } catch (_) { /* ignore */ }
  if (staleId === upstreamId - 1) {
    upstreamReady = false;
    upstreamStatus = 'down';
    broadcastStatus();
    scheduleReconnect();
  }
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

// signal broadcaster + upstream health check — runs every 1s
const signalTimer = setInterval(() => {
  checkUpstreamHealth();
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

  // Fix #1: tell the Edge Runtime not to suspend this isolate's background
  // work (the shared upstream connection, reconnect timer, signal
  // broadcaster all live at module scope) while this client is connected.
  // Resolves in cleanup() below, once this specific client disconnects —
  // as long as ANY client session's promise is still pending, the runtime
  // knows the isolate has real background work to keep alive.
  let resolveSessionDone: () => void = () => {};
  waitUntilAlive(new Promise<void>((resolve) => { resolveSessionDone = resolve; }));

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
    resolveSessionDone();
  };
  socket.onclose = cleanup;
  socket.onerror = cleanup;

  return response;
});

// keep ref so timer survives if linter complains
void signalTimer;
