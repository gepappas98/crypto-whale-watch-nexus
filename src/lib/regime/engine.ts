/* ══ REGIME ENGINE — scoring, classification, persistence ══════════════════ */
import type { RegimeName, RegimeReading, RegimeSignal, RegimeSnapshot, RegimeWeights, FamilyReading } from './types';
import { FAMILY_ORDER, FAMILY_LABELS, SIGNAL_FAMILIES } from './families';

const HISTORY_KEY = 'wr_regime_history';
const MAX_HISTORY = 400;
/** A regime must hold across this many consecutive snapshots before it is
 *  "confirmed" — the single-spike false-positive suppressor. */
export const PERSISTENCE_SNAPSHOTS = 3;

export function scoreOf(signals: RegimeSignal[], weights: RegimeWeights): { score: number; active: number; agreeing: number } {
  let wSum = 0;
  let acc = 0;
  let active = 0;
  for (const s of signals) {
    if (s.score == null) continue;
    const w = weights[s.id] ?? 0;
    if (w <= 0) continue;
    wSum += w;
    acc += w * s.score;
    active++;
  }
  const norm = wSum > 0 ? acc / wSum : 0;
  const score = Math.round(Math.max(0, Math.min(100, 50 + norm * 50)));
  const dir = norm >= 0 ? 1 : -1;
  const agreeing = signals.filter((s) => s.score != null && (weights[s.id] ?? 0) > 0 && s.score * dir > 0.2).length;
  return { score, active, agreeing };
}

export function classify(score: number, acceleration: number | null): RegimeName {
  if (score >= 68 && acceleration != null && acceleration <= -4) return 'DISTRIBUTION';
  if (score >= 82) return 'LATE BULL';
  if (score >= 68) return 'BULL';
  if (score >= 57) return 'EARLY BULL';
  if (score >= 43) return 'NEUTRAL';
  if (score >= 28) return 'RECOVERY';
  return 'BEAR';
}

/** Aggregate signals into their 5 families (see families.ts). Mirrors
 *  scoreOf()'s own rules for what counts as "active" (usable score AND a
 *  nonzero weight) so a family's active/agreeing counts stay comparable to
 *  the overall reading's — just scoped to that family's members instead of
 *  all raw signals. Each family judges "agreeing" against ITS OWN dominant
 *  direction, not the overall reading's, so a family can legitimately show
 *  e.g. 1/2 agreeing while still being the family dragging the overall
 *  score the other way. */
function familyReadings(signals: RegimeSignal[], weights: RegimeWeights): FamilyReading[] {
  return FAMILY_ORDER.map((id) => {
    const members = signals.filter(
      (s) => SIGNAL_FAMILIES[s.id] === id && s.score != null && (weights[s.id] ?? 0) > 0,
    );
    if (members.length === 0) {
      return { id, label: FAMILY_LABELS[id], score: null, active: 0, agreeing: 0 };
    }
    let wSum = 0;
    let acc = 0;
    for (const s of members) {
      const w = weights[s.id] ?? 0;
      wSum += w;
      acc += w * (s.score as number);
    }
    const score = wSum > 0 ? acc / wSum : 0;
    const dir = score >= 0 ? 1 : -1;
    const agreeing = members.filter((s) => (s.score as number) * dir > 0.2).length;
    return { id, label: FAMILY_LABELS[id], score, active: members.length, agreeing };
  });
}

export const REGIME_COLORS: Record<RegimeName, string> = {
  BEAR: 'text-wr-red',
  RECOVERY: 'text-wr-amber',
  NEUTRAL: 'text-wr-muted',
  'EARLY BULL': 'text-wr-cyan',
  BULL: 'text-wr-green',
  'LATE BULL': 'text-wr-amber',
  DISTRIBUTION: 'text-wr-red',
};

function readHistory(): RegimeSnapshot[] {
  try {
    const raw = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') as RegimeSnapshot[];
    return Array.isArray(raw) ? raw.filter((s) => typeof s?.score === 'number') : [];
  } catch {
    return [];
  }
}

function writeHistory(history: RegimeSnapshot[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
  } catch {
    /* ignore */
  }
}

export function getHistory(): RegimeSnapshot[] {
  return readHistory();
}

function deltaOver(history: RegimeSnapshot[], current: RegimeSnapshot, ms: number): number | null {
  const target = current.ts - ms;
  // Oldest snapshot at or before the target — null if history isn't deep enough
  // yet, rather than comparing against a window we don't actually have.
  const ref = [...history].reverse().find((s) => s.ts <= target);
  return ref ? current.score - ref.score : null;
}

function buildReasons(reading: Omit<RegimeReading, 'reasons'>): string[] {
  const dir = reading.score >= 50 ? 1 : -1;
  const contributing = reading.signals
    .filter((s) => s.score != null && s.score * dir > 0.2)
    .sort((a, b) => Math.abs(b.score ?? 0) - Math.abs(a.score ?? 0))
    .slice(0, 5)
    .map((s) => s.detail);

  const head = `${reading.agreeing} of ${reading.active} live signals agree on a ${dir > 0 ? 'bullish' : 'bearish'} read (score ${reading.score}/100).`;
  const familiesActive = reading.families.filter((f) => f.score != null);
  const familiesLeaning = familiesActive.filter((f) => (f.score as number) * dir > 0.2).length;
  const breadth =
    familiesActive.length > 0
      ? `That holds across ${familiesLeaning} of ${familiesActive.length} independent signal families (not just a cluster of correlated signals within one).`
      : null;
  const persistence =
    reading.confirmedRegime
      ? `${reading.regime} has held for ${reading.heldSnapshots} consecutive checks — treated as confirmed.`
      : `${reading.regime} has only held for ${reading.heldSnapshots} check${reading.heldSnapshots === 1 ? '' : 's'} — not confirmed yet, so it can't raise alert severity on its own.`;
  const accel =
    reading.acceleration == null
      ? 'Not enough history yet to read acceleration.'
      : `Regime score is moving ${reading.acceleration >= 0 ? '+' : ''}${reading.acceleration.toFixed(1)} pts/hour.`;

  return [head, breadth, persistence, accel, ...contributing].filter((l): l is string => l != null);
}

/** Score signals against history WITHOUT persisting — used when the read is
 *  a rescore of already-collected signals (e.g. dragging a weight slider),
 *  not a genuine new market observation. Persisting every rescore would let
 *  a single slider drag (an onChange per pixel moved) flood the history
 *  with near-duplicate entries sharing stale signal data, which corrupts
 *  both `heldSnapshots`/`confirmedRegime` (the actual false-positive
 *  suppressor) and the 5m/30m/2h delta windows with entries that don't
 *  represent real ticks. Reads `history` (immutably) to compute deltas and
 *  persistence exactly like `evaluate()` does, it just never writes. */
export function rescore(signals: RegimeSignal[], weights: RegimeWeights): RegimeReading {
  const history = readHistory();
  return buildReading(signals, weights, history);
}

/** Score a fresh set of signals, append it to persisted history, and return the
 *  full reading (deltas, acceleration, confirmed regime, trigger reasons). */
export function evaluate(signals: RegimeSignal[], weights: RegimeWeights): RegimeReading {
  const history = readHistory();
  const reading = buildReading(signals, weights, history);
  writeHistory([...history, reading]);
  return reading;
}

function buildReading(signals: RegimeSignal[], weights: RegimeWeights, history: RegimeSnapshot[]): RegimeReading {
  const { score, active, agreeing } = scoreOf(signals, weights);
  const ts = Date.now();

  const provisional: RegimeSnapshot = { ts, score, regime: 'NEUTRAL', agreeing, active, signals };
  const d30 = deltaOver(history, provisional, 30 * 60_000);
  const acceleration = d30 == null ? null : d30 * 2; // pts per hour from the 30m window

  const regime = classify(score, acceleration);
  const snapshot: RegimeSnapshot = { ...provisional, regime };

  let held = 1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].regime === regime) held++;
    else break;
  }

  const base: Omit<RegimeReading, 'reasons'> = {
    ...snapshot,
    delta5m: deltaOver(history, snapshot, 5 * 60_000),
    delta30m: d30,
    delta2h: deltaOver(history, snapshot, 2 * 3_600_000),
    acceleration,
    confirmedRegime: held >= PERSISTENCE_SNAPSHOTS ? regime : null,
    heldSnapshots: held,
    families: familyReadings(signals, weights),
  };

  return { ...base, reasons: buildReasons(base) };
}

export function clearHistory() {
  try {
    localStorage.removeItem(HISTORY_KEY);
  } catch {
    /* ignore */
  }
}
