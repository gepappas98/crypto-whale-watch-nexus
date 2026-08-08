/* ══ WHALE RADAR — EXPECTANCY-BASED SIZING HINT ═══════════════════════════════
 *
 *  Ported concept from freqtrade's (now-removed, but still influential)
 *  Edge Positioning module: instead of sizing every signal the same,
 *  compute real expectancy (win_rate × avg_win − loss_rate × avg_loss)
 *  from actual trade history and let that inform position size — a signal
 *  category with a proven positive edge earns a bigger size than one with
 *  no track record or a negative one.
 *
 *  This app already computes exactly that per signal-category
 *  (lib/backtestMetrics.ts's expectancy/profitFactor/winRate, built on the
 *  forward-tested outcomes in lib/signalStore.ts) but nothing consumed it
 *  outside the eval panel — live alerts had a `sizing` field
 *  (whaleRadarState.ts's AlertItem, threaded through every alert function
 *  signature) that was never populated or rendered. This closes that loop.
 *
 *  Re-implemented from scratch against this app's own backtestMetrics.ts —
 *  no freqtrade source copied, only the "let real expectancy inform size"
 *  idea. Same honesty posture as protectionOptimizer.ts: this describes
 *  what happened to past signals in this category, not a promise about
 *  the current one — it's a hint, not a guarantee.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { computeRiskMetrics, type Horizon } from './backtestMetrics';

const MIN_SAMPLE_FOR_CONFIDENCE = 8; // below this, even a good-looking edge is too thin to trust

export type SizingConfidence = 'no-data' | 'thin' | 'negative' | 'solid';

export interface SizingHint {
  confidence: SizingConfidence;
  label: string; // short, ready-to-render string for the alert feed
}

/**
 * Looks up the given signal label's real historical performance (default
 * 4h horizon, matching the eval panel's default) and turns it into a short
 * sizing suggestion. Falls back to "no track record" when the category
 * hasn't accumulated enough resolved outcomes yet — same
 * MIN_SAMPLE_FOR_CONFIDENCE posture as mlScoring.ts's training floor.
 */
export function getSizingHint(signalLabel: string, horizon: Horizon = '4h'): SizingHint {
  if (!signalLabel || signalLabel === 'HOLD') {
    return { confidence: 'no-data', label: '' };
  }

  const rows = computeRiskMetrics(horizon);
  const row = rows.find((r) => r.group === signalLabel);

  if (!row || row.trades === 0) {
    return { confidence: 'no-data', label: 'no track record yet — size cautiously' };
  }
  if (row.trades < MIN_SAMPLE_FOR_CONFIDENCE) {
    const sign = row.expectancy != null && row.expectancy >= 0 ? '+' : '';
    return {
      confidence: 'thin',
      label: `${sign}${row.expectancy ?? 0}% expectancy but only ${row.trades} samples — low confidence, size small`,
    };
  }
  if (row.expectancy != null && row.expectancy < 0) {
    return {
      confidence: 'negative',
      label: `${row.expectancy}% expectancy over ${row.trades} trades — historically a net loser, consider skipping`,
    };
  }

  const pf = row.profitFactor;
  const pfNote = pf == null ? '' : pf === Infinity ? ', no recorded losses' : `, PF ${pf.toFixed(2)}`;
  return {
    confidence: 'solid',
    label: `+${row.expectancy ?? 0}% expectancy over ${row.trades} trades${pfNote} — standard size reasonable`,
  };
}
