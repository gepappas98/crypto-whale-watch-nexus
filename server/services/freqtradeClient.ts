/* ══ STRATEGY TRADER — freqtrade REST API client ═════════════════════════════
 *  This file is the missing half of the "Strategy Trader" feature: the client
 *  bridge (src/lib/nexus/strategyTraderBridge.ts) and the UI (WRSettingsPanel,
 *  the 🎯 forward button in WRRightPanel) have called a `/strategy-trader/*`
 *  path since v9.4 — but until now there was no server route to receive it,
 *  no freqtrade client to talk to, and the nexus-bot-proxy Edge Function
 *  rejected the path outright (not on its allowlist). Every one of those
 *  calls has been failing in production. This closes it end-to-end.
 *
 *  freqtrade's REST API accepts plain HTTP Basic Auth on every request
 *  (in addition to its JWT flow) — see freqtrade's `api_server` docs — so
 *  there's no login/refresh dance to manage here, just a Basic header per
 *  call, same credential-from-env pattern as ccxtExecutor.ts.
 * ═══════════════════════════════════════════════════════════════════════════ */

const FREQTRADE_API_URL = (process.env.FREQTRADE_API_URL || '').replace(/\/+$/, '');
const FREQTRADE_API_USERNAME = process.env.FREQTRADE_API_USERNAME || '';
const FREQTRADE_API_PASSWORD = process.env.FREQTRADE_API_PASSWORD || '';

export function isFreqtradeConfigured(): boolean {
  return Boolean(FREQTRADE_API_URL && FREQTRADE_API_USERNAME && FREQTRADE_API_PASSWORD);
}

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  if (!isFreqtradeConfigured()) {
    throw new Error('freqtrade bridge not configured — set FREQTRADE_API_URL/USERNAME/PASSWORD on the Express server');
  }
  const auth = Buffer.from(`${FREQTRADE_API_USERNAME}:${FREQTRADE_API_PASSWORD}`).toString('base64');
  const res = await fetch(`${FREQTRADE_API_URL}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8_000), // freqtrade instance is usually LAN-local; don't hang a browser request on a dead one
  });
  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { /* non-JSON error page, e.g. a bad URL */ }
  if (!res.ok) {
    const msg = (parsed as { detail?: string; error?: string } | null)?.detail
      ?? (parsed as { detail?: string; error?: string } | null)?.error
      ?? `freqtrade returned HTTP ${res.status}`;
    throw new Error(msg);
  }
  return parsed as T;
}

export interface FreqtradeOpenTrade {
  trade_id: number;
  pair: string;
  is_open: boolean;
  profit_ratio: number;
}

export interface FreqtradeStatusSummary {
  reachable: boolean;
  dryRun?: boolean;
  maxOpenTrades?: number;
  stakeCurrency?: string;
  openTrades?: FreqtradeOpenTrade[];
  profit?: { profit_closed_coin: number; profit_closed_percent: number; winrate: number };
  error?: string;
}

/** Combines show_config + status + profit into the one shape the settings
 *  panel wants — three freqtrade calls, but they're cheap and local. Never
 *  throws: an unreachable instance comes back as `{ reachable: false, error }`
 *  so the caller can show that in the UI instead of a 500. */
export async function getFreqtradeStatus(): Promise<FreqtradeStatusSummary> {
  try {
    const [config, openTrades, profit] = await Promise.all([
      call<{ dry_run: boolean; max_open_trades: number; stake_currency: string }>('GET', '/show_config'),
      call<FreqtradeOpenTrade[]>('GET', '/status'),
      call<{ profit_closed_coin: number; profit_closed_percent: number; winrate: number }>('GET', '/profit').catch(() => undefined),
      // profit can legitimately 404/empty on a fresh instance with zero closed trades — don't fail the whole status over it
    ]);
    return {
      reachable: true,
      dryRun: config.dry_run,
      maxOpenTrades: config.max_open_trades,
      stakeCurrency: config.stake_currency,
      openTrades,
      profit,
    };
  } catch (err) {
    return { reachable: false, error: (err as Error).message };
  }
}

export function getFreqtradeLocks() {
  return call<{ locks: Array<{ id: number; pair: string; lock_end_time: string; reason: string }> }>('GET', '/locks');
}

export function deleteFreqtradeLock(lockId: number) {
  return call<{ locks: unknown[] }>('DELETE', `/locks/${lockId}`);
}

export interface ForceEnterInput {
  pair: string;
  side?: 'long' | 'short';
  stakeAmount?: number;
  entryTag?: string;
}

/** freqtrade's own dry-run setting (returned by show_config) governs whether
 *  this places a real order — same as every other freqtrade forceentry call,
 *  UI or CLI. This function does not add a second dry-run layer of its own;
 *  the cooldown lock + ML-confidence floor happen one level up, in the route. */
export function forceEnter(input: ForceEnterInput) {
  return call<{ status?: string; trade_id?: number } | { detail: string }>('POST', '/forceenter', {
    pair: input.pair,
    side: input.side ?? 'long',
    ...(input.stakeAmount ? { stakeamount: input.stakeAmount } : {}),
    ...(input.entryTag ? { entry_tag: input.entryTag } : {}),
  });
}

export function forceExit(tradeId: number, amount?: number) {
  return call<{ result: string }>('POST', '/forceexit', {
    tradeid: tradeId,
    ...(amount ? { amount } : {}),
  });
}
