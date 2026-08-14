/* ══ NEXUS BOT — server-side gates ═══════════════════════════════════════════
 *  The browser's lib/nexus/protections.ts already gates every action before
 *  it calls the RestBridgeBot — but the server must not simply trust that.
 *  A malicious or buggy client, a stale build, or someone hitting these
 *  routes directly with a valid token would otherwise bypass every check.
 *  This is the server's own, independent enforcement — deliberately
 *  simpler than the full StoplossGuard/MaxDrawdown/LowProfitPairs set
 *  client-side, but real: a cooldown lock the server itself checks, and a
 *  hard, double-opt-in dry-run default so a misconfigured deploy fails
 *  toward "no real orders" rather than the reverse.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { query } from '../db';

const COOLDOWN_MINUTES = Number(process.env.NEXUS_COOLDOWN_MINUTES || 15);

/**
 * Dry-run is ON unless BOTH of these are explicitly set:
 *   NEXUS_DRY_RUN=false
 *   NEXUS_LIVE_TRADING_CONFIRM=I_UNDERSTAND_THE_RISK
 * Requiring the second, oddly-specific value is deliberate — it can't be
 * flipped on by accident via a stray "false" typo in an env var.
 */
export function isServerDryRun(): boolean {
  const dryRunFlag = (process.env.NEXUS_DRY_RUN || 'true').toLowerCase();
  const confirmed = process.env.NEXUS_LIVE_TRADING_CONFIRM === 'I_UNDERSTAND_THE_RISK';
  return !(dryRunFlag === 'false' && confirmed);
}

export interface GateResult {
  allowed: boolean;
  reason?: string;
}

/** Checks + (on pass) atomically sets a short admission lock for `pair` in a
 *  SINGLE statement. Call this once per mutating action, right before
 *  executing.
 *
 *  v9.13 shipped this as a separate SELECT-then-INSERT, which had a real
 *  race: two concurrent requests for the same pair could both see "no lock"
 *  before either had written one, and both would proceed. Fixed here by
 *  folding the check into the INSERT's own ON CONFLICT ... WHERE clause —
 *  Postgres locks the conflicting row before evaluating that WHERE, so only
 *  one of two concurrent callers can ever win the UPDATE and get a row back.
 *
 *  Also fails CLOSED now, not open: a trade-admission gate that quietly
 *  allows everything through the moment the DB hiccups isn't a gate. If the
 *  DB is unreachable, callers get a 503 instead of a silently-ungated order.
 *  (This previously failed open across every nexus-bot action — arbitrage,
 *  grids, volume-maker, and strategy-trader alike — not just this route.) */
export async function checkAndLockCooldown(pair: string): Promise<GateResult> {
  try {
    const acquired = await query<{ locked_until: string }>(
      `INSERT INTO nexus_bot_locks (pair, source, reason, locked_until)
       VALUES ($1, 'cooldown', 'admission lock', now() + ($2 || ' minutes')::interval)
       ON CONFLICT (pair, source) DO UPDATE
         SET locked_until = EXCLUDED.locked_until, reason = EXCLUDED.reason
         WHERE nexus_bot_locks.locked_until <= now()
       RETURNING locked_until`,
      [pair, String(COOLDOWN_MINUTES)]
    );
    if (acquired.length === 0) {
      // Conflict existed and its WHERE guard blocked the update — an active
      // lock is still held. Look it up only to build a human-readable reason;
      // this second query isn't part of the atomic decision, just messaging.
      const existing = await query<{ locked_until: string }>(
        `SELECT locked_until FROM nexus_bot_locks WHERE pair = $1 AND source = 'cooldown'`,
        [pair]
      );
      return { allowed: false, reason: `cooldown active until ${existing[0]?.locked_until ?? 'unknown'}` };
    }
    return { allowed: true };
  } catch (err) {
    console.error('[nexusBotGates] cooldown check failed, failing CLOSED — check DATABASE_URL', (err as Error).message);
    return { allowed: false, reason: 'trading protection unavailable (cooldown check failed) — refusing to trade until this is fixed' };
  }
}

export async function recordTrade(input: {
  kind: 'arbitrage' | 'grid_open' | 'grid_close' | 'volume_maker' | 'strategy_trade';
  pair: string;
  exchange?: string;
  side?: string;
  amountUsd?: number;
  pnlUsd?: number;
  dryRun: boolean;
  status?: 'open' | 'closed' | 'error';
  errorMessage?: string;
  meta?: unknown;
}): Promise<void> {
  try {
    await query(
      `INSERT INTO nexus_bot_trades (kind, pair, exchange, side, amount_usd, pnl_usd, dry_run, status, error_message, meta)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        input.kind, input.pair, input.exchange ?? null, input.side ?? null,
        input.amountUsd ?? null, input.pnlUsd ?? null, input.dryRun,
        input.status ?? 'open', input.errorMessage ?? null,
        input.meta ? JSON.stringify(input.meta) : null,
      ]
    );
  } catch (err) {
    console.error('[nexusBotGates] failed to record trade (non-fatal)', (err as Error).message);
  }
}
