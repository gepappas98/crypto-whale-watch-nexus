/* ══ WHALE RADAR v9 — Client-Side Signal Store ════════════════════════════════
 *  localStorage-based signal outcome tracking. Works with OR without a backend.
 *  Pipeline:
 *    1. saveSignal()       — called on every scan for coins with score ≥ 35
 *    2. fillSignalPrices() — fetches real CoinGecko prices at 1h / 4h / 24h marks
 *    3. computeSignalEval()— computes win-rate table identical to backend SQL
 *
 *  Dedup: same (symbol, signal) pair recorded at most once per clock-hour.
 *  Retention: last 500 records, 30-day eval window (matches backend).
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { SignalEvalRow, SignalOutcomePayload } from './db';

const STORE_KEY   = 'wr_v9_signals';
const MAX_RECORDS = 500;
const HOUR_MS     = 60 * 60 * 1000;
const DAY_MS      = 24 * HOUR_MS;

// ── Internal record shape ─────────────────────────────────────────────────────

export interface SignalRecord {
  id: string;
  symbol: string;
  coin_id: string | null;
  signal: string;
  score: number;
  category: string | null;
  vmcap: number;
  entry_price: number;
  fired_at: number;          // ms epoch
  price_1h: number | null;
  price_4h: number | null;
  price_24h: number | null;
  outcome_1h: number | null;
  outcome_4h: number | null;
  outcome_24h: number | null;
  filled_1h_at: number | null;
  filled_4h_at: number | null;
  filled_24h_at: number | null;
  /** Optional raw feature snapshot at fire time — used by lib/mlScoring.ts.
   *  Records saved before this field existed simply won't be ML-eligible. */
  chg24?: number;
  volSpike?: number;
  supplyPct?: number | null;
  mcap?: number;
  dexHot?: boolean;
  isSol?: boolean;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

function loadRecords(): SignalRecord[] {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEY) || '[]') as SignalRecord[];
  } catch { return []; }
}

/**
 * Public read-only access to the raw, per-fire records (ordered newest-first,
 * matching internal storage order). Used by lib/backtestMetrics.ts to compute
 * sequential/risk stats (drawdown, Sharpe) that a pre-aggregated eval table
 * can't reconstruct.
 */
export function getAllSignalRecords(): SignalRecord[] {
  return loadRecords();
}

function persistRecords(records: SignalRecord[]): void {
  const trimmed = records.slice(0, MAX_RECORDS);
  const payload = JSON.stringify(trimmed);
  try {
    localStorage.setItem(STORE_KEY, payload);
  } catch (e) {
    // Bug #13 fix: quota exceeded — evict the oldest half and retry once,
    // then notify the user rather than silently dropping the write.
    try {
      const half = trimmed.slice(0, Math.floor(trimmed.length / 2));
      localStorage.setItem(STORE_KEY, JSON.stringify(half));
      console.warn('[SignalStore] localStorage quota hit — evicted oldest 50% of records');
    } catch {
      console.error('[SignalStore] localStorage write failed even after eviction:', e);
    }
  }
}

function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ── 1. Save a signal fire ─────────────────────────────────────────────────────
// Dedup: only one record per (symbol, signal, clock-hour).

export function saveSignal(payload: SignalOutcomePayload): void {
  if (!payload.symbol || !payload.signal || payload.signal === 'HOLD') return;

  const records = loadRecords();
  const now = Date.now();
  const hourBucket = Math.floor(now / HOUR_MS);

  // Skip if same signal already recorded for this coin in the current hour
  const dup = records.some(
    r =>
      r.symbol === payload.symbol &&
      r.signal === payload.signal &&
      Math.floor(r.fired_at / HOUR_MS) === hourBucket
  );
  if (dup) return;

  const rec: SignalRecord = {
    id: uid(),
    symbol: payload.symbol,
    coin_id: payload.coin_id ?? null,
    signal: payload.signal,
    score: payload.score,
    category: payload.category ?? null,
    vmcap: payload.vmcap,
    entry_price: payload.entry_price,
    fired_at: now,
    price_1h: null,  price_4h: null,  price_24h: null,
    outcome_1h: null, outcome_4h: null, outcome_24h: null,
    filled_1h_at: null, filled_4h_at: null, filled_24h_at: null,
    chg24: payload.chg24,
    volSpike: payload.volSpike,
    supplyPct: payload.supplyPct,
    mcap: payload.mcap,
    dexHot: payload.dexHot,
    isSol: payload.isSol,
  };

  // Prepend, trim to MAX_RECORDS
  persistRecords([rec, ...records]);
}

// ── 2. Fetch current prices from CoinGecko (free tier, no key needed) ─────────

async function fetchCgPrices(coinIds: string[]): Promise<Record<string, number>> {
  if (!coinIds.length) return {};
  try {
    // Batch max 50 IDs per request (CoinGecko limit)
    const batches = [];
    for (let i = 0; i < coinIds.length; i += 50) {
      batches.push(coinIds.slice(i, i + 50));
    }
    const results: Record<string, number> = {};
    for (const batch of batches) {
      const url =
        `https://api.coingecko.com/api/v3/simple/price?ids=${batch.join(',')}&vs_currencies=usd`;
      const _cgAbort = new AbortController();
      const _cgTimer = setTimeout(() => _cgAbort.abort(), 12_000);
      let res: Response;
      try {
        res = await fetch(url, {
          headers: { Accept: 'application/json' },
          signal: _cgAbort.signal,
        });
      } finally {
        clearTimeout(_cgTimer);
      }
      if (!res.ok) continue;
      const data = (await res.json()) as Record<string, { usd?: number }>;
      for (const [id, v] of Object.entries(data)) {
        if (v.usd) results[id] = v.usd;
      }
    }
    return results;
  } catch {
    return {};
  }
}

// ── 3. Fill outcome prices ────────────────────────────────────────────────────
// Mirrors the backend fillOutcomePrices() logic exactly.
// Returns count of records updated.

export async function fillSignalPrices(): Promise<number> {
  // Bug #9: purge null-coin_id orphans before filling so they don't inflate pendingFill
  purgeOrphanedRecords();

  const records = loadRecords();
  const now = Date.now();

  // Which records need each bucket filled?
  const need1h  = records.filter(r =>
    r.price_1h == null  && now - r.fired_at > HOUR_MS       && now - r.fired_at < 25 * HOUR_MS
  );
  const need4h  = records.filter(r =>
    r.price_4h == null  && now - r.fired_at > 4 * HOUR_MS   && now - r.fired_at < 49 * HOUR_MS
  );
  const need24h = records.filter(r =>
    r.price_24h == null && now - r.fired_at > DAY_MS         && now - r.fired_at < 8 * DAY_MS
  );

  const allNeed = [...need1h, ...need4h, ...need24h];
  if (!allNeed.length) return 0;

  // Unique coin_ids across all buckets
  const coinIds = [
    ...new Set(allNeed.map(r => r.coin_id).filter((id): id is string => Boolean(id))),
  ];
  if (!coinIds.length) return 0;

  const prices = await fetchCgPrices(coinIds);
  if (!Object.keys(prices).length) return 0;

  let filled = 0;

  function applyBucket(
    recs: SignalRecord[],
    pKey: 'price_1h' | 'price_4h' | 'price_24h',
    oKey: 'outcome_1h' | 'outcome_4h' | 'outcome_24h',
    fKey: 'filled_1h_at' | 'filled_4h_at' | 'filled_24h_at'
  ) {
    for (const rec of recs) {
      if (!rec.coin_id) continue;
      const p = prices[rec.coin_id];
      if (!p) continue;
      const pct =
        rec.entry_price > 0
          ? +( ((p - rec.entry_price) / rec.entry_price) * 100 ).toFixed(3)
          : null;
      rec[pKey] = p;
      rec[oKey] = pct;
      rec[fKey] = now;
      filled++;
    }
  }

  applyBucket(need1h,  'price_1h',  'outcome_1h',  'filled_1h_at');
  applyBucket(need4h,  'price_4h',  'outcome_4h',  'filled_4h_at');
  applyBucket(need24h, 'price_24h', 'outcome_24h', 'filled_24h_at');

  if (filled > 0) persistRecords(records);
  return filled;
}

// ── 4. Compute eval table (mirrors backend GROUP BY signal query) ──────────────

export function computeSignalEval(): SignalEvalRow[] {
  const records = loadRecords();
  const cutoff  = Date.now() - 30 * DAY_MS;
  const recent  = records.filter(r => r.fired_at > cutoff && r.signal !== 'HOLD');

  // Group by signal label
  const groups = new Map<string, SignalRecord[]>();
  for (const r of recent) {
    const arr = groups.get(r.signal) ?? [];
    arr.push(r);
    groups.set(r.signal, arr);
  }

  const avg = (vals: (number | null)[]): number | null => {
    const nums = vals.filter((v): v is number => v !== null);
    return nums.length ? +( nums.reduce((a, b) => a + b, 0) / nums.length ).toFixed(2) : null;
  };

  const rows: SignalEvalRow[] = [];

  for (const [signal, recs] of groups.entries()) {
    const withOutcome4h = recs.filter(r => r.outcome_4h !== null);
    const positive4h    = withOutcome4h.filter(r => (r.outcome_4h ?? 0) > 0).length;
    const profitable4h  = withOutcome4h.filter(r => (r.outcome_4h ?? 0) > 2).length;
    const winRate4h     = withOutcome4h.length > 0
      ? +( (positive4h / withOutcome4h.length) * 100 ).toFixed(1)
      : null;
    const avgScore = recs.length
      ? +( recs.reduce((s, r) => s + r.score, 0) / recs.length ).toFixed(0)
      : null;
    const lastFire = recs.reduce((mx, r) => (r.fired_at > mx ? r.fired_at : mx), 0);

    rows.push({
      signal,
      fires: recs.length,
      with_outcome: withOutcome4h.length,
      avg_1h_pct:   avg(recs.map(r => r.outcome_1h)),
      avg_4h_pct:   avg(recs.map(r => r.outcome_4h)),
      avg_24h_pct:  avg(recs.map(r => r.outcome_24h)),
      positive_4h:  positive4h,
      profitable_4h: profitable4h,
      win_rate_4h:  winRate4h,
      avg_score:    avgScore !== null ? Number(avgScore) : null,
      last_fire:    lastFire > 0 ? new Date(lastFire).toISOString() : null,
    });
  }

  // Sort: avg_4h_pct descending, nulls last
  return rows.sort((a, b) => {
    if (a.avg_4h_pct == null && b.avg_4h_pct == null) return 0;
    if (a.avg_4h_pct == null) return 1;
    if (b.avg_4h_pct == null) return -1;
    return b.avg_4h_pct - a.avg_4h_pct;
  });
}

// ── 5. Stats helper for UI ────────────────────────────────────────────────────

export interface SignalStoreStats {
  total: number;
  pendingFill: number;     // records that still need at least one price bucket
  oldestFiredAt: number | null;
}

export function getSignalStoreStats(): SignalStoreStats {
  const records = loadRecords();
  const now = Date.now();
  const pending = records.filter(
    r =>
      (r.price_1h == null  && now - r.fired_at > HOUR_MS) ||
      (r.price_4h == null  && now - r.fired_at > 4 * HOUR_MS) ||
      (r.price_24h == null && now - r.fired_at > DAY_MS)
  );
  const oldest = records.length
    ? records.reduce((mn, r) => (r.fired_at < mn ? r.fired_at : mn), records[0].fired_at)
    : null;
  return { total: records.length, pendingFill: pending.length, oldestFiredAt: oldest };
}

// ── 6. Purge orphaned records ─────────────────────────────────────────────────
// Bug #9 fix: records with coin_id === null can never have their outcome prices
// filled and will sit in pendingFill forever. Purge them once they're past the
// 24h fill window — keeping them only wastes quota and inflates pendingFill.
export function purgeOrphanedRecords(): number {
  const records = loadRecords();
  const now = Date.now();
  const before = records.length;
  const cleaned = records.filter(r => {
    // Keep records that still have a chance of being filled
    if (r.coin_id) return true;
    // Orphan (no coin_id) — keep if still within the 1h fill eligibility window
    return now - r.fired_at < HOUR_MS;
  });
  if (cleaned.length < before) {
    persistRecords(cleaned);
    console.info(`[SignalStore] Purged ${before - cleaned.length} orphaned records (no coin_id)`);
  }
  return before - cleaned.length;
}

export function clearSignalStore(): void {
  localStorage.removeItem(STORE_KEY);
}
