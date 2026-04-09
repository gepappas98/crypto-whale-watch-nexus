/* ══ WHALE RADAR v9 — DB API Client ══════════════════════════════════════════
 *  Frontend service layer. All persistence goes through here.
 *  Falls back to localStorage if the API is unreachable (offline mode).
 *  Features: auto-retry with exponential backoff + jitter, toast notifications.
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { CoinData, PortfolioEntry, TrackedToken, AlertItem } from './whaleRadarState';
import { toast } from 'sonner';

const BASE = '/api';
let _dbOnline = true;

// ── Retry config ──────────────────────────────────────────────────────────────
const MAX_RETRIES = 3;
const BASE_DELAY = 500;   // ms
const MAX_DELAY = 8000;   // ms

function jitteredDelay(attempt: number): number {
  const exp = Math.min(BASE_DELAY * Math.pow(2, attempt), MAX_DELAY);
  return exp * (0.5 + Math.random() * 0.5); // 50-100% of exponential value
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Internal fetch wrapper with auto-retry + jitter ───────────────────────────

async function api<T = unknown>(
  path: string,
  options?: RequestInit & { _silent?: boolean }
): Promise<T | null> {
  const silent = options?._silent ?? false;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(BASE + path, {
        headers: { 'Content-Type': 'application/json' },
        ...options,
      });
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
      // All retries exhausted
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
  });
  if (r) toast.success('Scan saved', { duration: 2000 });
  return r?.session_id ?? null;
}

export async function getScanSessions(): Promise<ScanSession[]> {
  return (await api<ScanSession[]>('/scans')) ?? [];
}

export async function getScanCoins(sessionId: number): Promise<CoinData[]> {
  return (await api<CoinData[]>(`/scans/${sessionId}`)) ?? [];
}

export async function getTokenHistory(symbol: string): Promise<HistoricalCoin[]> {
  return (await api<HistoricalCoin[]>(`/scans/symbol/${symbol}`)) ?? [];
}

export async function getTopThreats(): Promise<Record<string, unknown>[]> {
  return (await api<Record<string, unknown>[]>('/scans/threats/top')) ?? [];
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
  const rows = await api<PortfolioDbRow[]>('/portfolio');
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
  const rows = await api<Array<{ symbol: string; coin_id: string; base_price: number; last_price: number }>>('/tracked');
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

export async function saveAlert(alert: AlertItem): Promise<void> {
  if (alert.level === 'info') return;
  await api('/alerts', {
    method: 'POST',
    body: JSON.stringify({
      level: alert.level,
      tag: alert.tag,
      text: alert.text,
      sizing: alert.sizing ?? null,
      pinned: alert.pinned,
    }),
  });
}

export async function loadAlerts(): Promise<AlertItem[]> {
  const rows = await api<Array<{
    id: number; level: string; tag: string; text: string;
    sizing: string | null; pinned: boolean; created_at: string;
  }>>('/alerts');
  if (!rows) return [];
  return rows.map(r => ({
    ts: new Date(r.created_at).getTime(),
    level: r.level as AlertItem['level'],
    tag: r.tag,
    text: r.text,
    tc: new Date(r.created_at).toLocaleTimeString(),
    sizing: r.sizing,
    pinned: r.pinned,
  }));
}

export async function toggleAlertPin(dbId: number): Promise<void> {
  await api(`/alerts/${dbId}/pin`, { method: 'PATCH' });
}
