/* ══ REGIME ENGINE — alert text + severity + last-alerted persistence ═══════
 *  Supports useRegimeAlerts.ts. Kept separate from that hook (and from
 *  engine.ts) since none of this is regime-computation logic — it's the
 *  "should this reading actually interrupt someone, and what does it say"
 *  layer on top of a reading that's already been computed.
 * ═══════════════════════════════════════════════════════════════════════════ */
import type { AlertLevel } from '@/lib/alertCooldown';
import type { RegimeName, RegimeReading } from './types';

const LAST_ALERTED_KEY = 'wr_regime_last_alerted';

/** Last confirmedRegime we actually alerted on, persisted across reloads so
 *  a page refresh doesn't re-fire an alert for a regime that was already
 *  announced in a prior session. */
export function getLastAlertedRegime(): string | null {
  try {
    return localStorage.getItem(LAST_ALERTED_KEY);
  } catch {
    return null;
  }
}

export function setLastAlertedRegime(regime: string): void {
  try {
    localStorage.setItem(LAST_ALERTED_KEY, regime);
  } catch {
    /* storage full / disabled — alert just isn't deduped across a reload */
  }
}

/** BEAR/DISTRIBUTION and EARLY BULL/BULL/LATE BULL are both "something is
 *  actually shifting, look at this" — downside and upside surfaced with
 *  equal urgency, not just bullish moves. RECOVERY/NEUTRAL are "nothing to
 *  act on yet" and stay info-only. */
export function regimeAlertLevel(regime: RegimeName): AlertLevel {
  switch (regime) {
    case 'BEAR':
    case 'DISTRIBUTION':
    case 'EARLY BULL':
    case 'BULL':
    case 'LATE BULL':
      return 'high';
    case 'RECOVERY':
    case 'NEUTRAL':
    default:
      return 'info';
  }
}

/** Regime + score + how long it's held + the top contributing reasons, plus
 *  an explicit no-auto-execution line kept in every alert on purpose — this
 *  system hands the decision to a human, it never acts on its own read. */
export function buildRegimeAlertText(reading: RegimeReading): string {
  const regime = reading.confirmedRegime ?? reading.regime;
  const topReasons = reading.reasons.slice(0, 3).join(' · ');
  const lines = [
    `Regime shifted to ${regime} (score ${reading.score}/100, held ${reading.heldSnapshots} snapshots, ${reading.agreeing}/${reading.active} signals agreeing).`,
    topReasons ? `Why: ${topReasons}` : '',
    'No automatic trade executed — review manually.',
  ].filter(Boolean);
  return lines.join(' ');
}
