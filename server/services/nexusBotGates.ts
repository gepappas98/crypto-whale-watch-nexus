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

/** Checks + (on pass) sets a short cooldown lock for `pair`. Call this once
 *  per mutating action, right before executing. Fails OPEN (allows) only if
 *  the DB itself is unreachable — logged loudly, since that's a config
 *  problem, not something that should silently block trading forever, but
 *  also not something that should silently disable this gate either. */
export async function checkAndLockCooldown(pair: string): Promise<GateResult> {
  try {
    const rows = await query<{ locked_until: string }>(
      `SELECT locked_until FROM nexus_bot_locks WHERE pair = $1 AND source = 'cooldown' AND locked_until > now()`,
      [pair]
    );
    if (rows.length > 0) {
      return { allowed: false, reason: `cooldown active until ${rows[0].locked_until}` };
    }
    await query(
      `INSERT INTO nexus_bot_locks (pair, source, reason, locked_until)
       VALUES ($1, 'cooldown', 'post-trade cooldown', now() + ($2 || ' minutes')::interval)
       ON CONFLICT (pair, source) DO UPDATE SET locked_until = EXCLUDED.locked_until, reason = EXCLUDED.reason`,
      [pair, String(COOLDOWN_MINUTES)]
    );
    return { allowed: true };
  } catch (err) {
    console.error('[nexusBotGates] cooldown check failed, failing OPEN — check DATABASE_URL', (err as Error).message);
    return { allowed: true };
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
