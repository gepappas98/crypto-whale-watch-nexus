/* ══ REGIME ENGINE — alert text + severity + last-alerted persistence ═══════
 *  Supports useRegimeAlerts.ts. Kept separate from that hook (and from
 *  engine.ts) since none of this is regime-computation logic — it's the
 *  "should this reading actually interrupt someone, and what does it say"
 *  layer on top of a reading that's already been computed.
 *
 *  v9.38: reworked for the 3-tier persistence ladder (engine.ts's EARLY/
 *  DEVELOPING/CONFIRMED_SNAPSHOTS). Alerts now fire once per tier reached
 *  within a regime streak (early → developing → confirmed), not once at
 *  the old single ~15min mark — a deliberate choice, not a default: up to
 *  3 alerts per regime transition instead of 1, each carrying real new
 *  information (this has now held for 15min / 1.5h / 8h).
 * ═══════════════════════════════════════════════════════════════════════════ */
import type { AlertLevel } from '@/lib/alertCooldown';
import type { PersistenceTier, RegimeName, RegimeReading } from './types';

const LAST_ALERTED_KEY = 'wr_regime_last_alerted';

interface LastAlertedTier {
  regime: string;
  tier: PersistenceTier;
}

/** Last {regime, tier} we actually alerted on, persisted across reloads so
 *  a page refresh doesn't re-fire an alert for a tier that was already
 *  announced in a prior session. Format changed in v9.38 (was a bare
 *  regime-name string) — a value written by the pre-ladder version fails
 *  the shape check below and is treated as "no prior alert", which costs
 *  at most one duplicate alert right after upgrading, never a stuck or
 *  crashed state. */
export function getLastAlertedTier(): LastAlertedTier | null {
  try {
    const raw = localStorage.getItem(LAST_ALERTED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastAlertedTier>;
    if (typeof parsed?.regime === 'string' && typeof parsed?.tier === 'string') {
      return { regime: parsed.regime, tier: parsed.tier as PersistenceTier };
    }
    return null;
  } catch {
    return null;
  }
}

export function setLastAlertedTier(regime: string, tier: PersistenceTier): void {
  try {
    localStorage.setItem(LAST_ALERTED_KEY, JSON.stringify({ regime, tier }));
  } catch {
    /* storage full / disabled — alert just isn't deduped across a reload */
  }
}

const TIER_ORDER: Record<PersistenceTier, number> = { early: 0, developing: 1, confirmed: 2 };

/** True if `tier` is a real forward step past `prev` for the SAME regime
 *  streak — i.e. something genuinely new to say. A brand-new regime streak
 *  (prev is null, or prev.regime differs) always counts, since even its
 *  first tier is new information. */
export function tierAdvanced(prev: LastAlertedTier | null, regime: RegimeName, tier: PersistenceTier): boolean {
  if (!prev || prev.regime !== regime) return true;
  return TIER_ORDER[tier] > TIER_ORDER[prev.tier];
}

/** BEAR/DISTRIBUTION and EARLY BULL/BULL/LATE BULL are both "something is
 *  actually shifting, look at this" — downside and upside surfaced with
 *  equal urgency, not just bullish moves. RECOVERY/NEUTRAL are "nothing to
 *  act on yet" and stay info-only at every tier, since more time holding a
 *  no-action regime isn't more actionable, just more of the same.
 *
 *  Severity now escalates with tier for actionable regimes: EARLY is a
 *  lower-confidence first heads-up (didn't exist before this ladder),
 *  DEVELOPING sits roughly where the old single-tier system alerted, and
 *  CONFIRMED is a genuine escalation past that old ceiling — reaching it
 *  now means many hours of consistency, not 15 minutes. */
export function regimeAlertLevel(regime: RegimeName, tier: PersistenceTier): AlertLevel {
  const actionable =
    regime === 'BEAR' || regime === 'DISTRIBUTION' ||
    regime === 'EARLY BULL' || regime === 'BULL' || regime === 'LATE BULL';
  if (!actionable) return 'info';
  switch (tier) {
    case 'confirmed': return 'critical';
    case 'developing': return 'high';
    case 'early': return 'medium';
  }
}

/** Regime + tier + score + how long it's held + the top contributing
 *  reasons, plus an explicit no-auto-execution line kept in every alert on
 *  purpose — this system hands the decision to a human, it never acts on
 *  its own read. */
export function buildRegimeAlertText(reading: RegimeReading): string {
  const tierLabel =
    reading.tier === 'confirmed' ? 'CONFIRMED (≈8h+)'
      : reading.tier === 'developing' ? 'developing (≈1.5h+)'
      : 'early read (≈15min+)';
  const topReasons = reading.reasons.slice(0, 3).join(' · ');
  const lines = [
    `${reading.regime} — ${tierLabel} (score ${reading.score}/100, held ${reading.heldSnapshots} snapshots, ${reading.agreeing}/${reading.active} signals agreeing).`,
    topReasons ? `Why: ${topReasons}` : '',
    'No automatic trade executed — review manually.',
  ].filter(Boolean);
  return lines.join(' ');
}
