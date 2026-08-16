/* ══ STRATEGY TRADER — /api/nexus-bot/strategy-trader routes ═════════════════
 *  Mounted under nexusBotRouter, so it inherits the same bearer-token auth
 *  as the rest of /api/nexus-bot/*. Client counterpart:
 *  src/lib/nexus/strategyTraderBridge.ts, called from WRSettingsPanel (status/
 *  locks) and the 🎯 button on a CRITICAL alert in WRRightPanel (enter).
 *
 *  Same "server never just trusts the client" posture as nexusBot.ts:
 *  /enter re-checks the cooldown lock server-side, independent of whatever
 *  the browser already checked. freqtrade's own dry-run setting (from
 *  show_config) governs whether an order is real — this route doesn't add
 *  a second one.
 *
 *  mlConfidence provenance (v9.16 revision of the v9.13/v9.14 note here):
 *  the client's mlConfidence (src/lib/mlScoring.ts) trains and runs entirely
 *  in the browser on localStorage data — the server has no way to verify a
 *  number the client reports, so it was never a real gate on its own. The
 *  real fix isn't a signature over the client's number (a signature can't
 *  make an unverifiable number verifiable, it can only prove it wasn't
 *  altered in transit — a different problem). Instead: server/services/
 *  signalConfidence.ts computes a win-rate from signal_outcomes, the
 *  server's OWN Postgres history — nothing the client sends. When there's
 *  enough history for the pair (MIN_SAMPLES in that file), THAT number is
 *  the real floor below, and mlConfidence is downgraded to audit-only
 *  metadata (still recorded in the trade ledger, never used to gate). When
 *  there isn't enough server history yet (a pair with no track record),
 *  this falls back to the old client-reported-number check — weaker, but
 *  honestly labelled as such in the response.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { Router, Request, Response } from 'express';
import { checkAndLockCooldown, recordTrade } from '../services/nexusBotGates';
import { getServerSideConfidence } from '../services/signalConfidence';
import {
  isFreqtradeConfigured, getFreqtradeStatus, getFreqtradeLocks, deleteFreqtradeLock,
  forceEnter, forceExit,
} from '../services/freqtradeClient';

export const strategyTraderRouter = Router();

const ML_CONFIDENCE_FLOOR = 50;
// Hard ceiling on a single forceenter's stake — independent of whatever
// freqtrade's own config.json allows — so a malformed or hostile request
// body can't ask for an arbitrarily large position. Override via env if
// your real position sizes are bigger than this.
const MAX_STAKE_USD = Number(process.env.NEXUS_STRATEGY_MAX_STAKE_USD || 500);
const PAIR_RE = /^[A-Z0-9]{2,20}\/[A-Z0-9]{2,10}$/;

// GET /status
strategyTraderRouter.get('/status', async (_req: Request, res: Response) => {
  if (!isFreqtradeConfigured()) {
    return res.json({ configured: false, reachable: false });
  }
  const status = await getFreqtradeStatus();
  res.json({
    configured: true,
    reachable: status.reachable,
    freqtradeDryRun: status.dryRun,
    maxOpenTrades: status.maxOpenTrades,
    stakeCurrency: status.stakeCurrency,
    openTrades: status.openTrades,
    profit: status.profit,
    error: status.error,
  });
});

// GET /locks
strategyTraderRouter.get('/locks', async (_req: Request, res: Response) => {
  if (!isFreqtradeConfigured()) return res.status(503).json({ error: 'freqtrade bridge not configured' });
  try {
    res.json(await getFreqtradeLocks());
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// DELETE /locks/:id
strategyTraderRouter.delete('/locks/:id', async (req: Request, res: Response) => {
  if (!isFreqtradeConfigured()) return res.status(503).json({ error: 'freqtrade bridge not configured' });
  const lockId = Number(req.params.id);
  if (!Number.isFinite(lockId)) return res.status(400).json({ error: 'invalid lock id' });
  try {
    await deleteFreqtradeLock(lockId);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});

// POST /enter — forward a whale-radar signal to freqtrade's forceentry.
strategyTraderRouter.post('/enter', async (req: Request, res: Response) => {
  if (!isFreqtradeConfigured()) return res.status(503).json({ error: 'freqtrade bridge not configured' });
  const { pair, side, stakeAmount, entryTag, signalScore, mlConfidence } = req.body as {
    pair?: string; side?: 'long' | 'short'; stakeAmount?: number; entryTag?: string;
    signalScore?: number; mlConfidence?: number;
  };
  if (!pair || !PAIR_RE.test(pair)) {
    return res.status(400).json({ error: 'pair is required and must look like BASE/QUOTE, e.g. BTC/USDT' });
  }
  if (stakeAmount !== undefined) {
    if (typeof stakeAmount !== 'number' || !Number.isFinite(stakeAmount) || stakeAmount <= 0) {
      return res.status(400).json({ error: 'stakeAmount must be a positive finite number' });
    }
    if (stakeAmount > MAX_STAKE_USD) {
      return res.status(422).json({ error: `stakeAmount ${stakeAmount} exceeds the server-side cap of ${MAX_STAKE_USD} (NEXUS_STRATEGY_MAX_STAKE_USD)` });
    }
  }

  // See the file header: prefer the server's OWN win-rate history for this
  // pair when there's enough of it — nothing the client can lie about.
  // Only fall back to the client-reported mlConfidence (weaker — see header)
  // when the server has no track record for this pair yet.
  const serverConf = await getServerSideConfidence(pair);
  let confidenceSource: 'server' | 'client' | 'none';
  if (serverConf) {
    confidenceSource = 'server';
    if (serverConf.winRatePct < ML_CONFIDENCE_FLOOR) {
      return res.status(422).json({
        error: `Server-tracked win rate for ${pair.split('/')[0]} is ${serverConf.winRatePct}% (${serverConf.sampleSize} samples) — below the ${ML_CONFIDENCE_FLOOR}% floor`,
        confidenceSource,
      });
    }
  } else if (typeof mlConfidence === 'number') {
    confidenceSource = 'client';
    if (mlConfidence < ML_CONFIDENCE_FLOOR) {
      return res.status(422).json({
        error: `ML confidence ${mlConfidence}% is below the ${ML_CONFIDENCE_FLOOR}% floor (no server-side track record yet for this pair, so this is the weaker client-reported check — see server/routes/strategyTrader.ts header)`,
        confidenceSource,
      });
    }
  } else {
    confidenceSource = 'none';
    // Neither a server track record nor a client-supplied number — allowed
    // through (this route is only ever reached by a deliberate human click,
    // not automation), but confidenceSource: 'none' is recorded in the
    // ledger so this is visible in hindsight, not silently indistinguishable
    // from a real pass.
  }

  const gate = await checkAndLockCooldown(pair);
  if (!gate.allowed) return res.status(gate.reason?.includes('unavailable') ? 503 : 429).json({ error: gate.reason });

  // Resolve dry-run status ONCE, up front, and reuse it for both the
  // success and error ledger writes below — rather than assuming "true"
  // in the catch block, which would misreport a live-mode failure as
  // simulated. If it can't be resolved at all, record it honestly as
  // unknown instead of guessing.
  const preStatus = await getFreqtradeStatus().catch(() => undefined);
  const dryRun: boolean | 'unknown' = preStatus?.reachable ? Boolean(preStatus.dryRun) : 'unknown';

  try {
    const result = await forceEnter({ pair, side, stakeAmount, entryTag });
    const failed = Boolean(result && typeof result === 'object' && 'detail' in result);

    // Only recorded as 'open' once the response confirms freqtrade actually
    // accepted the order — a `detail` (error) response is recorded as
    // 'error', not 'open', so the ledger can't show a phantom open position.
    await recordTrade({
      kind: 'strategy_trade', pair, side,
      dryRun: dryRun === 'unknown' ? true : dryRun, // DB column is boolean NOT NULL; see meta.executionMode for the honest 'unknown' case
      status: failed ? 'error' : 'open',
      errorMessage: failed ? (result as { detail: string }).detail : undefined,
      meta: {
        direction: 'enter', signalScore, entryTag, freqtradeResult: result, executionMode: dryRun,
        confidence: { source: confidenceSource, clientReported: mlConfidence, serverWinRate: serverConf?.winRatePct, serverSampleSize: serverConf?.sampleSize },
      },
    });

    if (failed) return res.status(502).json({ error: (result as { detail: string }).detail, dryRun });
    res.json({ ok: true, dryRun, trade: result, confidenceSource });
  } catch (err) {
    await recordTrade({
      kind: 'strategy_trade', pair, side,
      dryRun: dryRun === 'unknown' ? true : dryRun,
      status: 'error', errorMessage: (err as Error).message,
      meta: { direction: 'enter', executionMode: dryRun },
    });
    res.status(502).json({ error: (err as Error).message });
  }
});

// POST /exit — close an open freqtrade position. Deliberately NOT gated by
// the cooldown lock: cooldown exists to stop the bot piling into *new*
// positions too fast, not to block a user closing one they already hold.
strategyTraderRouter.post('/exit', async (req: Request, res: Response) => {
  if (!isFreqtradeConfigured()) return res.status(503).json({ error: 'freqtrade bridge not configured' });
  const { tradeId, amount } = req.body as { tradeId?: number; amount?: number };
  if (!tradeId) return res.status(400).json({ error: 'tradeId is required' });

  const preStatus = await getFreqtradeStatus().catch(() => undefined);
  const dryRun: boolean | 'unknown' = preStatus?.reachable ? Boolean(preStatus.dryRun) : 'unknown';

  try {
    const result = await forceExit(tradeId, amount);
    // freqtrade's forceexit can return HTTP 200 with a failure message in
    // `result` rather than a non-2xx status (e.g. an unknown trade id) — a
    // plain try/catch around the HTTP call alone would miss that and record
    // a failed exit as 'closed'. Treat anything mentioning error/invalid as
    // a failure for ledger purposes; still returned to the caller either way.
    const failed = typeof result?.result === 'string' && /error|invalid|not found/i.test(result.result);
    await recordTrade({
      kind: 'strategy_trade', pair: `trade#${tradeId}`,
      dryRun: dryRun === 'unknown' ? true : dryRun,
      status: failed ? 'error' : 'closed',
      errorMessage: failed ? result.result : undefined,
      meta: { direction: 'exit', tradeId, amount, freqtradeResult: result, executionMode: dryRun },
    });
    if (failed) return res.status(502).json({ error: result.result, dryRun });
    res.json({ ok: true, dryRun, result });
  } catch (err) {
    await recordTrade({
      kind: 'strategy_trade', pair: `trade#${tradeId}`,
      dryRun: dryRun === 'unknown' ? true : dryRun,
      status: 'error', errorMessage: (err as Error).message,
      meta: { direction: 'exit', tradeId, amount, executionMode: dryRun },
    });
    res.status(502).json({ error: (err as Error).message });
  }
});
