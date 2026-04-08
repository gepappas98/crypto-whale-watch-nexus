/* ══ WHALE RADAR v9 — DB API Client ══════════════════════════════════════════
 *  Frontend service layer. All persistence goes through here.
 *  Falls back to localStorage if the API is unreachable (offline mode).
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { CoinData, PortfolioEntry, TrackedToken, AlertItem } from './whaleRadarState';

const BASE = '/api';
let _dbOnline = true;

// ── Internal fetch wrapper ────────────────────────────────────────────────────

async function api<T = unknown>(
  path: string,
  options?: RequestInit
): Promise<T | null> {
  try {
    const res = await fetch(BASE + path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    _dbOnline = true;
    return (await res.json()) as T;
  } catch (err) {
    _dbOnline = false;
    console.warn('[DB]', path, (err as Error).message);
    return null;
  }
}

/** True if the last API call succeeded. Use to show DB status badge. */
export function isDbOnline(): boolean { return _dbOnline; }

/** Ping the server. Returns true if reachable. */
export async function dbPing(): Promise<boolean> {
  const r = await api<{ ok: boolean }>('/health');
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

/**
 * Persist a completed scan to PostgreSQL.
 * Call this at the end of every scan in Index.tsx / WRScanner.
 */
export async function saveScan(coins: CoinData[]): Promise<number | null> {
  const r = await api<{ session_id: number }>('/scans', {
    method: 'POST',
    body: JSON.stringify({ coins }),
  });
  return r?.session_id ?? null;
}

/** List of recent scan session headers (last 50). */
export async function getScanSessions(): Promise<ScanSession[]> {
  return (await api<ScanSession[]>('/scans')) ?? [];
}

/** Full coin list for a specific session. */
export async function getScanCoins(sessionId: number): Promise<CoinData[]> {
  return (await api<CoinData[]>(`/scans/${sessionId}`)) ?? [];
}

/** Score/threat history for a token — used in backtesting. */
export async function getTokenHistory(symbol: string): Promise<HistoricalCoin[]> {
  return (await api<HistoricalCoin[]>(`/scans/symbol/${symbol}`)) ?? [];
}

/** Top manipulation threats across all stored history. */
export async function getTopThreats(): Promise<Record<string, unknown>[]> {
  return (await api<Record<string, unknown>[]>('/scans/threats/top')) ?? [];
}

// ══ PORTFOLIO ════════════════════════════════════════════════════════════════

export interface PortfolioRow extends PortfolioEntry {
  symbol: string;
  current_price: number | null;
  pnl_pct: number | null;
  pnl_usd: number | null;
}

/** Load portfolio from DB. Falls back to localStorage. */
export async function loadPortfolio(): Promise<Record<string, PortfolioEntry>> {
  const rows = await api<PortfolioRow[]>('/portfolio');
  if (rows) {
    return Object.fromEntries(
      rows.map(r => [r.symbol, { amount: Number(r.amount), entryPrice: Number(r.entry_price) }])
    );
  }
  // localStorage fallback
  try {
    const raw = localStorage.getItem('wr_v9_portfolio');
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

/** Upsert a portfolio position. */
export async function savePortfolioEntry(
  symbol: string,
  entry: PortfolioEntry
): Promise<void> {
  // Always write localStorage as fallback
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

/** Delete a portfolio position. */
export async function deletePortfolioEntry(symbol: string): Promise<void> {
  try {
    const existing = JSON.parse(localStorage.getItem('wr_v9_portfolio') || '{}');
    delete existing[symbol];
    localStorage.setItem('wr_v9_portfolio', JSON.stringify(existing));
  } catch { /* ignore */ }

  await api(`/portfolio/${symbol}`, { method: 'DELETE' });
}

// ══ TRACKED TOKENS (WATCHLIST) ════════════════════════════════════════════════

/** Load tracked tokens from DB. Falls back to localStorage. */
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

/** Add a token to the watchlist. */
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

/** Remove a token from the watchlist. */
export async function deleteTrackedToken(symbol: string): Promise<void> {
  try {
    const existing = JSON.parse(localStorage.getItem('wr_v9_tracked') || '{}');
    delete existing[symbol];
    localStorage.setItem('wr_v9_tracked', JSON.stringify(existing));
  } catch { /* ignore */ }

  await api(`/tracked/${symbol}`, { method: 'DELETE' });
}

// ══ ALERTS ════════════════════════════════════════════════════════════════════

/** Persist a non-info alert to the DB. */
export async function saveAlert(alert: AlertItem): Promise<void> {
  if (alert.level === 'info') return; // info alerts are ephemeral
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

/** Load persisted alerts (last 100). */
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

/** Toggle pin on a stored alert. */
export async function toggleAlertPin(dbId: number): Promise<void> {
  await api(`/alerts/${dbId}/pin`, { method: 'PATCH' });
}
