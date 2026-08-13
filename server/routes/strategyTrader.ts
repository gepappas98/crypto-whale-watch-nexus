/* ══ STRATEGY TRADER — /api/nexus-bot/strategy-trader routes ═════════════════
 *  Mounted under nexusBotRouter, so it inherits the same bearer-token auth
 *  as the rest of /api/nexus-bot/*. Client counterpart:
 *  src/lib/nexus/strategyTraderBridge.ts, called from WRSettingsPanel (status/
 *  locks) and the 🎯 button on a CRITICAL alert in WRRightPanel (enter).
 *
 *  Same "server never just trusts the client" posture as nexusBot.ts:
 *  /enter re-checks the cooldown lock and the 50%-ML-confidence floor
 *  server-side, independent of whatever the browser already checked.
 *  freqtrade's own dry-run setting (from show_config) governs whether an
 *  order is real — this route doesn't add a second one.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { Router, Request, Response } from 'express';
import { checkAndLockCooldown, recordTrade } from '../services/nexusBotGates';
import {
  isFreqtradeConfigured, getFreqtradeStatus, getFreqtradeLocks, deleteFreqtradeLock,
  forceEnter, forceExit,
} from '../services/freqtradeClient';

export const strategyTraderRouter = Router();

const ML_CONFIDENCE_FLOOR = 50;

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
  if (!pair) return res.status(400).json({ error: 'pair is required' });

  // Hard floor: only enforced when the caller actually supplied a confidence
  // number — this endpoint is reached by a deliberate, explicit human click
  // (the 🎯 button), not an automated loop, so there isn't always one yet.
  // When a score IS provided, it must clear the floor — no silent bypass.
  if (typeof mlConfidence === 'number' && mlConfidence < ML_CONFIDENCE_FLOOR) {
    return res.status(422).json({ error: `ML confidence ${mlConfidence}% is below the ${ML_CONFIDENCE_FLOOR}% floor for auto-forwarded signals` });
  }

  const gate = await checkAndLockCooldown(pair);
  if (!gate.allowed) return res.status(429).json({ error: gate.reason });

  try {
    const result = await forceEnter({ pair, side, stakeAmount, entryTag });
    const status = await getFreqtradeStatus().catch(() => undefined);
    const dryRun = status?.dryRun ?? true; // fail toward "assume simulated" if we can't confirm

    await recordTrade({
      kind: 'strategy_trade', pair, side, dryRun,
      status: 'open',
      meta: { direction: 'enter', signalScore, mlConfidence, entryTag, freqtradeResult: result },
    });

    if (result && typeof result === 'object' && 'detail' in result) {
      return res.status(502).json({ error: (result as { detail: string }).detail, dryRun });
    }
    res.json({ ok: true, dryRun, trade: result });
  } catch (err) {
    await recordTrade({ kind: 'strategy_trade', pair, side, dryRun: true, status: 'error', errorMessage: (err as Error).message, meta: { direction: 'enter' } });
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

  try {
    const result = await forceExit(tradeId, amount);
    const status = await getFreqtradeStatus().catch(() => undefined);
    await recordTrade({
      kind: 'strategy_trade', pair: `trade#${tradeId}`, dryRun: status?.dryRun ?? true,
      status: 'closed', meta: { direction: 'exit', tradeId, amount, freqtradeResult: result },
    });
    res.json({ ok: true, result });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message });
  }
});
