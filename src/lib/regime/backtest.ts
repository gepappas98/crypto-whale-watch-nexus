/* ══ REGIME ENGINE — backtesting its own historical calls ═══════════════════
 *  Closes the "backtesting the regime engine's own historical calls" P1 item
 *  from the README's Strategic Direction section.
 *
 *  Real limitation, stated plainly rather than hidden: this app's regime
 *  history lives in localStorage (MAX_HISTORY = 400 snapshots, one write per
 *  5-minute poll tick — see engine.ts), and only accumulates while a browser
 *  tab is actually open. A true 24/7 server-side regime engine is a
 *  separate, still-open item (the README notes it needs Supabase deploy
 *  access this sandbox doesn't have). So this backtests whatever confirmed
 *  regime calls actually accumulated locally — at most ~33 hours of
 *  continuous browser uptime at 400 snapshots × 5 minutes — not a
 *  multi-year historical replay. That's a real, honestly-bounded dataset,
 *  not a placeholder pretending to be more than it is.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { proxied } from '@/lib/binanceProxy';
import type { RegimeName, RegimeSnapshot } from './types';

const HORIZONS_H = [1, 4, 24] as const;
export type HorizonHours = (typeof HORIZONS_H)[number];

export interface BacktestCall {
  ts: number;
  regime: RegimeName;
  score: number;
  priceAtCall: number | null;
  /** Forward BTC % return at each horizon. Null if that horizon hasn't
   *  happened yet (call too recent) or the price fetch failed — never
   *  faked as 0, same "missing means null, not neutral" rule the live
   *  signals follow (see signals.ts). */
  returnPctByHorizon: Record<HorizonHours, number | null>;
}

export interface RegimeBacktestStats {
  count: number;
  /** Mean forward return, %, per horizon — null if no call in this regime
   *  has a resolvable forward price at that horizon yet. */
  avgReturnPctByHorizon: Record<HorizonHours, number | null>;
  /** % of resolvable calls where the forward return's sign matched the
   *  regime's own directional claim (bullish regimes: positive return;
   *  bearish: negative). NEUTRAL/RECOVERY make no directional claim, so
   *  they're excluded from hit-rate scoring entirely — not scored 0, which
   *  would misrepresent "no claim made" as "claim was wrong". */
  hitRatePctByHorizon: Record<HorizonHours, number | null>;
}

export interface BacktestResult {
  horizonsHours: HorizonHours[];
  calls: BacktestCall[];
  byRegime: Partial<Record<RegimeName, RegimeBacktestStats>>;
  /** How many calls the engine has ever confirmed in the given history vs
   *  how many of those this backtest could resolve at least one horizon
   *  for (very recent calls haven't reached even the 1h mark yet). */
  totalConfirmedCalls: number;
  resolvedCalls: number;
}

const BULLISH: RegimeName[] = ['EARLY BULL', 'BULL', 'LATE BULL'];
const BEARISH: RegimeName[] = ['BEAR', 'DISTRIBUTION'];

async function getJson<T>(url: string, timeoutMs = 12_000): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(proxied(url), { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** BTC close price of the 1h candle starting at-or-after `ts`. Null if
 *  Binance has no candle there yet (ts is in the future / too recent) or
 *  the fetch fails — callers treat null as "not resolvable yet", not 0. */
async function btcPriceAt(ts: number): Promise<number | null> {
  const raw = await getJson<unknown[][]>(
    `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&startTime=${ts}&limit=1`,
  );
  if (!raw || raw.length === 0) return null;
  const close = Number(raw[0][4]);
  return Number.isFinite(close) ? close : null;
}

/** Every point in `history` where confirmedRegime actually changed to a new
 *  non-null value — i.e. a genuine new "call" the engine made. Most 5-minute
 *  ticks just reconfirm the same regime; those aren't new calls and would
 *  massively over-count (and self-correlate) the backtest if included.
 *  Since the 3-tier persistence ladder (v9.38, see regime/types.ts),
 *  confirmedRegime only populates once a regime reaches the CONFIRMED tier
 *  (~8h held, up from the old ~15min) — so a "call" here now represents a
 *  genuinely durable regime read. Fewer calls than before, each worth more. */
function extractCalls(history: RegimeSnapshot[]): { ts: number; regime: RegimeName; score: number }[] {
  const calls: { ts: number; regime: RegimeName; score: number }[] = [];
  let last: RegimeName | null = null;
  for (const s of history) {
    const confirmed = s.confirmedRegime ?? null;
    if (confirmed && confirmed !== last) {
      calls.push({ ts: s.ts, regime: confirmed, score: s.score });
    }
    if (confirmed) last = confirmed;
  }
  return calls;
}

/** Backtest every confirmed regime call in persisted history against actual
 *  forward BTC price action at 1h/4h/24h. Never throws — a call whose
 *  forward price can't be resolved (too recent, or a fetch failure) just
 *  gets a null return for that horizon rather than aborting the whole
 *  backtest for every other call. */
export async function backtestHistory(history: RegimeSnapshot[]): Promise<BacktestResult> {
  const rawCalls = extractCalls(history);
  const now = Date.now();

  const calls: BacktestCall[] = await Promise.all(
    rawCalls.map(async (c) => {
      const priceAtCall = await btcPriceAt(c.ts);
      const returnPctByHorizon = {} as Record<HorizonHours, number | null>;
      for (const h of HORIZONS_H) {
        const targetTs = c.ts + h * 3_600_000;
        if (targetTs > now || priceAtCall == null) {
          returnPctByHorizon[h] = null;
          continue;
        }
        const forwardPrice = await btcPriceAt(targetTs);
        returnPctByHorizon[h] = forwardPrice == null ? null : ((forwardPrice - priceAtCall) / priceAtCall) * 100;
      }
      return { ts: c.ts, regime: c.regime, score: c.score, priceAtCall, returnPctByHorizon };
    }),
  );

  const byRegime: Partial<Record<RegimeName, RegimeBacktestStats>> = {};
  const regimesPresent = Array.from(new Set(calls.map((c) => c.regime)));
  for (const regime of regimesPresent) {
    const inRegime = calls.filter((c) => c.regime === regime);
    const avgReturnPctByHorizon = {} as Record<HorizonHours, number | null>;
    const hitRatePctByHorizon = {} as Record<HorizonHours, number | null>;
    const directional = BULLISH.includes(regime) ? 1 : BEARISH.includes(regime) ? -1 : 0;
    for (const h of HORIZONS_H) {
      const resolved = inRegime.map((c) => c.returnPctByHorizon[h]).filter((r): r is number => r != null);
      avgReturnPctByHorizon[h] = resolved.length ? resolved.reduce((a, b) => a + b, 0) / resolved.length : null;
      if (directional === 0 || resolved.length === 0) {
        hitRatePctByHorizon[h] = null;
      } else {
        const hits = resolved.filter((r) => r * directional > 0).length;
        hitRatePctByHorizon[h] = (hits / resolved.length) * 100;
      }
    }
    byRegime[regime] = { count: inRegime.length, avgReturnPctByHorizon, hitRatePctByHorizon };
  }

  const resolvedCalls = calls.filter((c) => HORIZONS_H.some((h) => c.returnPctByHorizon[h] != null)).length;

  return {
    horizonsHours: [...HORIZONS_H],
    calls,
    byRegime,
    totalConfirmedCalls: calls.length,
    resolvedCalls,
  };
}
