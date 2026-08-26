/* ══ WHALE RADAR v9 — DB API Client ══════════════════════════════════════════
 *  Frontend service layer. All persistence goes through here.
 *  Falls back to localStorage if the API is unreachable (offline mode).
 *  Features: auto-retry with exponential backoff + jitter, toast notifications.
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { CoinData, PortfolioEntry, TrackedToken, AlertItem } from './whaleRadarState';
import { toast } from 'sonner';
import { handleRateLimit, isRateLimited, RL_KEYS } from './rateLimit';
import { saveSignal, computeSignalEval } from './signalStore';

const BASE = '/api';
let _dbOnline = true;
// null = not yet checked, true = available, false = confirmed offline this session
let _backendAvailable: boolean | null = null;
let _offlineToastShown = false;

// SECURITY: the server's shared API_AUTH_TOKEN must NEVER be shipped to the
// browser. Anything in a VITE_-prefixed variable is embedded in the public JS
// bundle and readable by every visitor. The client therefore sends no bearer
// token at all; protected /api/* routes must be reached from a server-side
// proxy (or edge function) that holds the secret, and the browser degrades to
// localStorage-only persistence when those routes reject it.

// ── Backend availability check ────────────────────────────────────────────────
// Call once on app mount. If the backend is unreachable, silently marks it
// offline for the session so no further error toasts are shown.
export async function initBackendCheck(): Promise<boolean> {
  if (_backendAvailable !== null) return _backendAvailable;
  try {
    const _healthAbort = new AbortController();
    const _healthTimer = setTimeout(() => _healthAbort.abort(), 4000);
    let res: Response;
    try {
      res = await fetch(BASE + '/health', { signal: _healthAbort.signal });
    } finally {
      clearTimeout(_healthTimer);
    }
    _backendAvailable = res.ok;
  } catch {
    _backendAvailable = false;
  }
  _dbOnline = _backendAvailable;
  if (!_backendAvailable && !_offlineToastShown) {
    _offlineToastShown = true;
    toast.info('Running without backend', {
      description: 'Persistence disabled — scan data will not be saved.',
      duration: 6000,
      id: 'backend-offline',
    });
  }
  return _backendAvailable;
}

// ── Retry config ──────────────────────────────────────────────────────────────
const MAX_RETRIES = 3;
const BASE_DELAY = 500;   // ms
const MAX_DELAY = 8000;   // ms

function jitteredDelay(attempt: number): number {
  const exp = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY);
  return exp * (0.5 + Math.random() * 0.5);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Internal fetch wrapper with auto-retry + rate-limit awareness ─────────────

async function api<T = unknown>(
  path: string,
  options?: RequestInit & { _silent?: boolean }
): Promise<T | null> {
  const silent = options?._silent ?? false;

  // Treat null (pending check) and false (confirmed offline) as offline.
  if (_backendAvailable !== true) return null;

  // Skip if backend is currently rate-limited
  if (isRateLimited(RL_KEYS.BACKEND)) {
    if (!silent) {
      toast.info('Backend cooling down', {
        description: 'Request skipped — rate limit active',
        duration: 2000,
        id: 'rl-skip-backend',
      });
    }
    return null;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const authHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      const res = await fetch(BASE + path, {
        headers: authHeaders,
        ...options,
      });

      // ── 429 Rate Limit ──
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        handleRateLimit('Backend API', RL_KEYS.BACKEND, retryAfter);
        _dbOnline = true; // server is reachable, just limiting
        return null;
      }

      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      _dbOnline = true;
      return (await res.json()) as T;
    } catch (err) {
      const msg = (err as Error).message;
      if (attempt < MAX_RETRIES) {
        const dly = jitteredDelay(attempt);
        console.warn(`[DB] ${path} attempt ${attempt + 1} failed (${msg}), retry in ${Math.round(dly)}ms`);
        await sleep(dly);
        continue;
      }
      _dbOnline = false;
      console.warn('[DB]', path, msg);
      if (!silent) {
        toast.error('API unreachable', {
          description: `${path} failed after ${MAX_RETRIES + 1} attempts`,
          duration: 4000,
        });
      }
      return null;
    }
  }
  return null;
}

/** True if the last API call succeeded. Use to show DB status badge. */
export function isDbOnline(): boolean { return _dbOnline; }

/** Ping the server. Returns true if reachable. */
export async function dbPing(): Promise<boolean> {
  const r = await api<{ ok: boolean }>('/health', { _silent: true });
  return r?.ok === true;
}

// ══ SCANS ════════════════════════════════════════════════════════════════════

export interface ScanSession {
  id: number;
  scanned_at: string;
  coin_count: number;
  crit_count: number;
  high_count: number;
}

export interface HistoricalCoin {
  symbol: string;
  score: number;
  threat: string;
  category: string | null;
  vmcap: number;
  price: number;
  change_24h: number;
  scanned_at: string;
}

export async function saveScan(coins: CoinData[]): Promise<number | null> {
  const r = await api<{ session_id: number }>('/scans', {
    method: 'POST',
    body: JSON.stringify({ coins }),
    _silent: true,
  });
  return r?.session_id ?? null;
}

export async function getScanSessions(): Promise<ScanSession[]> {
  return (await api<ScanSession[]>('/scans', { _silent: true })) ?? [];
}

export async function getScanCoins(sessionId: number): Promise<CoinData[]> {
  return (await api<CoinData[]>(`/scans/${sessionId}`, { _silent: true })) ?? [];
}

export async function getTokenHistory(symbol: string): Promise<HistoricalCoin[]> {
  return (await api<HistoricalCoin[]>(`/scans/symbol/${symbol}`, { _silent: true })) ?? [];
}

export interface TopThreatRow {
  symbol: string;
  peak_score: number;
  appearances: number;
  worst_threat: string;
  last_seen: string;
}

export async function getTopThreats(): Promise<TopThreatRow[]> {
  return (await api<TopThreatRow[]>('/scans/threats/top', { _silent: true })) ?? [];
}

// ══ PORTFOLIO ════════════════════════════════════════════════════════════════

/** Raw DB row shape (snake_case from PostgreSQL) */
interface PortfolioDbRow {
  symbol: string;
  amount: number;
  entry_price: number;
  current_price: number | null;
  pnl_pct: number | null;
  pnl_usd: number | null;
}

/** Load portfolio from DB. Falls back to localStorage. */
export async function loadPortfolio(): Promise<Record<string, PortfolioEntry>> {
  const rows = await api<PortfolioDbRow[]>('/portfolio', { _silent: true });
  if (rows) {
    return Object.fromEntries(
      rows.map(r => [r.symbol, { amount: Number(r.amount), entryPrice: Number(r.entry_price) }])
    );
  }
  try {
    const raw = localStorage.getItem('wr_v9_portfolio');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export async function savePortfolioEntry(
  symbol: string,
  entry: PortfolioEntry
): Promise<void> {
  try {
    const existing = JSON.parse(localStorage.getItem('wr_v9_portfolio') || '{}');
    existing[symbol] = entry;
    localStorage.setItem('wr_v9_portfolio', JSON.stringify(existing));
  } catch { /* ignore */ }

  await api('/portfolio', {
    method: 'POST',
    body: JSON.stringify({ symbol, amount: entry.amount, entry_price: entry.entryPrice }),
  });
}

export async function deletePortfolioEntry(symbol: string): Promise<void> {
  try {
    const existing = JSON.parse(localStorage.getItem('wr_v9_portfolio') || '{}');
    delete existing[symbol];
    localStorage.setItem('wr_v9_portfolio', JSON.stringify(existing));
  } catch { /* ignore */ }

  await api(`/portfolio/${symbol}`, { method: 'DELETE' });
}

// ══ TRACKED TOKENS (WATCHLIST) ════════════════════════════════════════════════

export async function loadTracked(): Promise<Record<string, TrackedToken>> {
  const rows = await api<Array<{ symbol: string; coin_id: string; base_price: number; last_price: number }>>('/tracked', { _silent: true });
  if (rows) {
    return Object.fromEntries(
      rows.map(r => [
        r.symbol,
        { id: r.coin_id, price: Number(r.last_price), basePrice: Number(r.base_price), lastPrice: Number(r.last_price) },
      ])
    );
  }
  try {
    const raw = localStorage.getItem('wr_v9_tracked');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

export async function saveTrackedToken(
  symbol: string,
  token: TrackedToken
): Promise<void> {
  try {
    const existing = JSON.parse(localStorage.getItem('wr_v9_tracked') || '{}');
    existing[symbol] = token;
    localStorage.setItem('wr_v9_tracked', JSON.stringify(existing));
  } catch { /* ignore */ }

  await api('/tracked', {
    method: 'POST',
    body: JSON.stringify({ symbol, coin_id: token.id, base_price: token.basePrice }),
  });
}

export async function deleteTrackedToken(symbol: string): Promise<void> {
  try {
    const existing = JSON.parse(localStorage.getItem('wr_v9_tracked') || '{}');
    delete existing[symbol];
    localStorage.setItem('wr_v9_tracked', JSON.stringify(existing));
  } catch { /* ignore */ }

  await api(`/tracked/${symbol}`, { method: 'DELETE' });
}

// ══ ALERTS ════════════════════════════════════════════════════════════════════

/** Returns the new alert's backend row id (or null if unsaved — offline,
 *  filtered as 'info', or the request failed), same convention as
 *  saveScan()'s session_id. The server already returns the full inserted
 *  row on POST — this was previously discarded, which is why pin-toggling
 *  never persisted (toggleAlertPin() had no id to call with). */
export async function saveAlert(alert: AlertItem): Promise<number | null> {
  if (alert.level === 'info') return null;
  const row = await api<{ id: number }>('/alerts', {
    method: 'POST',
    body: JSON.stringify({
      level: alert.level,
      tag: alert.tag,
      text: alert.text,
      sizing: alert.sizing ?? null,
      pinned: alert.pinned,
      coin_id: alert.coinId ?? null,
      entry_price: alert.entryPrice ?? null,
    }),
  });
  return row?.id ?? null;
}

export async function loadAlerts(): Promise<AlertItem[]> {
  const rows = await api<Array<{
    id: number; level: string; tag: string; text: string;
    sizing: string | null; pinned: boolean; created_at: string;
    coin_id: string | null; entry_price: string | null;
    action: 'reviewed' | 'bought' | null; outcome_24h_pct: string | null;
  }>>('/alerts', { _silent: true });
  if (!rows) return [];
  return rows.map(r => ({
    ts: new Date(r.created_at).getTime(),
    level: r.level as AlertItem['level'],
    tag: r.tag,
    text: r.text,
    tc: r.level === 'critical' ? 'C' : r.level === 'high' ? 'H' : r.level === 'medium' ? 'M' : 'I',
    sizing: r.sizing,
    pinned: r.pinned,
    dbId: r.id,
    coinId: r.coin_id,
    entryPrice: r.entry_price != null ? parseFloat(r.entry_price) : null,
    decision: r.action,
    outcomePct: r.outcome_24h_pct != null ? parseFloat(r.outcome_24h_pct) : null,
  }));
}

export async function toggleAlertPin(dbId: number): Promise<void> {
  await api(`/alerts/${dbId}/pin`, { method: 'PATCH' });
}

/** Log the user's decision on an alert — closes the decision-outcome loop
 *  (v9.37). coinId/entryPrice only matter for action='bought' (the server
 *  drops them for 'reviewed' regardless); pass the alert's own coinId/
 *  entryPrice through unchanged when calling this for a 'bought' decision. */
export async function logAlertOutcome(
  dbId: number,
  action: 'reviewed' | 'bought',
  coinId?: string | null,
  entryPrice?: number | null,
): Promise<void> {
  await api(`/alerts/${dbId}/outcome`, {
    method: 'POST',
    body: JSON.stringify({ action, coin_id: coinId ?? null, entry_price: entryPrice ?? null }),
  });
}

// ══ WHALE EVENTS ══════════════════════════════════════════════════════════════
// Persists live trades from the WebSocket feed.
// Caller (Index.tsx) throttles to 1 write per symbol per 30s.

export interface WhaleEventPayload {
  symbol: string;
  side: string;
  price: number;
  qty: number;
  usdt: number;
  exchange: string;
}

export async function saveWhaleEvent(payload: WhaleEventPayload): Promise<void> {
  // Fire-and-forget — we don't block the trade feed on DB latency
  api('/whale-events', {
    method: 'POST',
    body: JSON.stringify({
      symbol: payload.symbol,
      side: payload.side,
      price: payload.price,
      qty: payload.qty,
      usdt: payload.usdt,
      exchange: payload.exchange,
    }),
    _silent: true,
  }).catch(() => { /* ignore persistence errors silently */ });
}

// ══ SIGNAL OUTCOMES ═══════════════════════════════════════════════════════════
// Records CEO Signal Engine fires so we can measure actual profit/loss.
// The server deduplicates via UNIQUE INDEX on (symbol, signal, hour).

export interface SignalOutcomePayload {
  symbol: string;
  coin_id: string | null;
  signal: string;     // 'AGGRESSIVE LONG' | 'LONG (tight stop)' | 'LONG' | 'WATCH' | 'AVOID / SHORT'
  score: number;
  category: string | null;
  vmcap: number;
  entry_price: number;
  /** Optional raw feature snapshot at fire time — local-only, used by lib/mlScoring.ts.
   *  Not sent to the backend (backend schema is fixed); omit and everything still works
   *  exactly as before, just without ML-eligibility for that record. */
  chg24?: number;
  volSpike?: number;
  supplyPct?: number | null;
  mcap?: number;
  dexHot?: boolean;
  isSol?: boolean;
}

export async function recordSignalOutcome(payload: SignalOutcomePayload): Promise<void> {
  if (payload.signal === 'HOLD') return;

  // Always save to localStorage first (works offline, zero latency, no data loss)
  saveSignal(payload);

  // Also send to backend when available (belt-and-suspenders for cross-device sync)
  api('/signal-outcomes', {
    method: 'POST',
    body: JSON.stringify(payload),
    _silent: true,
  }).catch(() => {});
}

// ══ SIGNAL EVAL ═══════════════════════════════════════════════════════════════

export interface SignalEvalRow {
  signal: string;
  fires: number;
  with_outcome: number;
  avg_1h_pct: number | null;
  avg_4h_pct: number | null;
  avg_24h_pct: number | null;
  positive_4h: number;
  profitable_4h: number;
  win_rate_4h: number | null;
  avg_score: number | null;
  last_fire: string | null;
}

export async function loadSignalEval(): Promise<SignalEvalRow[]> {
  // Try backend first (cross-device, historical)
  if (_backendAvailable !== false) {
    const rows = await api<SignalEvalRow[]>('/signal-outcomes/eval', { _silent: true });
    if (rows && rows.length > 0) return rows;
  }
  // Fall back to local signalStore — always works, browser-persisted
  return computeSignalEval();
}
