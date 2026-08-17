/* ══ STRATEGY TRADER — browser client ═════════════════════════════════════════
 *  Same safety posture as restBridgeBot.ts: never holds a token, routes
 *  through the same nexus-bot-proxy Edge Function, which attaches the real
 *  server secret. This is a plain client module (not a TradingBot
 *  implementation) since forwarding a whale-radar signal to freqtrade is a
 *  different shape of action than Nexus's grid/arbitrage/volume-maker set.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { safeInvoke } from '@/lib/safeInvoke';

async function call<T>(method: 'GET' | 'POST' | 'DELETE', path: string, payload?: unknown): Promise<T> {
  const { data, error } = await safeInvoke<T>('nexus-bot-proxy', { body: { method, path: `/strategy-trader${path}`, payload } });
  if (error) throw error;
  return data as T;
}

export interface StrategyTraderStatus {
  configured: boolean;
  reachable: boolean;
  freqtradeDryRun?: boolean;
  maxOpenTrades?: number;
  stakeCurrency?: string;
  openTrades?: Array<{ trade_id: number; pair: string; is_open: boolean; profit_ratio: number }>;
  profit?: { profit_closed_coin: number; profit_closed_percent: number; winrate: number };
  error?: string;
}

/** Never throws: an unconfigured bridge (503 from nexus-bot-proxy) is a normal
 *  state, not an error — it just means no Express server is wired up yet. */
export async function getStrategyTraderStatus(): Promise<StrategyTraderStatus> {
  try {
    return await call<StrategyTraderStatus>('GET', '/status');
  } catch (err) {
    return { configured: false, reachable: false, error: (err as Error).message };
  }
}

export function getStrategyTraderLocks() {
  return call<{ locks: Array<{ id: number; pair: string; lock_end_time: string; reason: string }> }>('GET', '/locks');
}

export function clearStrategyTraderLock(lockId: number) {
  return call<{ ok: boolean }>('DELETE', `/locks/${lockId}`);
}

export interface ForwardSignalInput {
  pair: string;              // freqtrade pair format, e.g. "BTC/USDT"
  side?: 'long' | 'short';
  stakeAmount?: number;
  entryTag?: string;
  signalScore?: number;      // whale-radar's own score, carried along for the trade record
  mlConfidence?: number;     // from mlScoring.ts's predictConfidence() — server enforces a 50% floor
}

/** Forwards a whale-radar signal to freqtrade's forceentry, subject to the
 *  server's own cooldown lock, dry-run default, and 50%-ML-confidence floor
 *  — see server/routes/strategyTrader.ts. Not wired to fire automatically;
 *  call this from an explicit user action or an opt-in setting, never as a
 *  silent side effect of a signal simply appearing. */
export function forwardSignalToStrategyTrader(input: ForwardSignalInput) {
  return call<{ ok: boolean; dryRun: boolean; trade?: unknown; simulated?: unknown }>('POST', '/enter', input);
}

export function exitStrategyTraderPosition(tradeId: number, amount?: number) {
  return call<{ ok: boolean; result: { result: string } }>('POST', '/exit', { tradeId, amount });
}
