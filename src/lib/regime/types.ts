/* ══ REGIME ENGINE — types ═════════════════════════════════════════════════
 *  P0 of the "personal 24/7 early-warning system" direction (see README →
 *  Strategic Direction). Everything here is market-WIDE, not per-asset: the
 *  per-asset machinery (scanner, council, ML confidence) already exists.
 * ═══════════════════════════════════════════════════════════════════════════ */
import type { FamilyId } from './families';

export type RegimeName =
  | 'BEAR'
  | 'RECOVERY'
  | 'NEUTRAL'
  | 'EARLY BULL'
  | 'BULL'
  | 'LATE BULL'
  | 'DISTRIBUTION';

export type SignalId =
  | 'btc_trend'
  | 'btc_momentum'
  | 'breadth'
  | 'whale_flow'
  | 'aggressive_flow'
  | 'oi_roc'
  | 'funding'
  | 'fng_level'
  | 'fng_roc'
  | 'btc_dominance'
  | 'eth_btc_strength'
  | 'stablecoin_flow';

/** One regime input. `score` is normalized to -1 (max bearish) … +1 (max
 *  bullish); `null` means the data genuinely wasn't available this tick —
 *  a missing signal is dropped from the weighted average rather than being
 *  silently counted as neutral, which would drag the score toward 50. */
export interface RegimeSignal {
  id: SignalId;
  label: string;
  score: number | null;
  /** Human-readable measured value, e.g. "+2.4% vs EMA50". */
  value: string;
  /** Why this reads bullish/bearish — powers "why am I getting this alert". */
  detail: string;
}

/** 3-tier persistence ladder (replaces the old flat confirmedRegime-at-15min
 *  design) — closes the "Early/Developing/Confirmed" open item from the
 *  README's Strategic Direction section. A regime holding for 15 minutes
 *  was never really "confirmed" in the way a human would use that word;
 *  this makes the engine's own confidence language honest about how long a
 *  read has actually held, instead of collapsing "just formed" and "held
 *  all day" into the same flag. See engine.ts's EARLY_SNAPSHOTS/
 *  DEVELOPING_SNAPSHOTS/CONFIRMED_SNAPSHOTS for the actual thresholds. */
export type PersistenceTier = 'early' | 'developing' | 'confirmed';

export interface RegimeSnapshot {
  ts: number;
  /** 0-100. 50 = no information / perfectly mixed signals. */
  score: number;
  regime: RegimeName;
  /** How many signals independently agree with the dominant direction. */
  agreeing: number;
  /** How many signals had usable data this tick. */
  active: number;
  signals: RegimeSignal[];
  /** Optional because the RegimeSnapshot type predates confirmedRegime, but
   *  it's genuinely present on every entry engine.ts's evaluate() persists —
   *  writeHistory() is handed the full RegimeReading (which has this field),
   *  not a stripped-down snapshot, so it's really in localStorage today.
   *  Declared here, not just on RegimeReading, so backtest.ts (which reads
   *  persisted history as RegimeSnapshot[]) can access it type-safely
   *  instead of casting. Absent/undefined on any snapshot written before
   *  this field existed. */
  confirmedRegime?: RegimeName | null;
}

/** One signal family's aggregated read — see families.ts for why families
 *  exist and which signals belong to which. */
export interface FamilyReading {
  id: FamilyId;
  label: string;
  /** Weighted-average score of this family's active, weighted signals,
   *  -1..1. Null if no member signal had usable data this tick. */
  score: number | null;
  /** How many member signals had usable (non-null) data this tick and a
   *  nonzero weight. */
  active: number;
  /** Of those active signals, how many agree with THIS family's own
   *  dominant direction — not the overall reading's direction. */
  agreeing: number;
}

export interface RegimeReading extends RegimeSnapshot {
  /** Score change over each horizon (null until history is deep enough). */
  delta5m: number | null;
  delta30m: number | null;
  delta2h: number | null;
  /** Points per hour, from the 30m window — the "acceleration" read. */
  acceleration: number | null;
  /** Regime that has held across every snapshot in the persistence window.
   *  Null while the regime is still flickering — this is the false-positive
   *  suppressor: a single spike never promotes an alert on its own.
   *  Since the 3-tier ladder (see PersistenceTier above), this only
   *  populates once `tier` reaches 'confirmed' — i.e. much later than the
   *  old ~15min mark (now ~8h, see engine.ts's CONFIRMED_SNAPSHOTS). Use
   *  `tier`/`regime` together for anything that wants an earlier read. */
  confirmedRegime: RegimeName | null;
  /** Where the CURRENT regime streak sits on the 3-tier ladder. Null until
   *  it's held even the EARLY threshold — i.e. a regime can be freshly
   *  classified (`regime` already reflects it) well before `tier` is
   *  anything but null. Monotonic within one streak (early → developing →
   *  confirmed) since `heldSnapshots` only ever increases while `regime`
   *  stays the same and resets to 1 the moment it changes. */
  tier: PersistenceTier | null;
  /** Consecutive snapshots the current regime has held for. */
  heldSnapshots: number;
  /** Plain-language trigger list for the current reading. */
  reasons: string[];
  /** Signals grouped into 5 (mostly-)independent families — see
   *  families.ts. A more honest breadth read than raw agreeing/active,
   *  since several raw signals are correlated readings of the same
   *  underlying thing (e.g. fng_level/fng_roc both come off one index). */
  families: FamilyReading[];
}

export type RegimeWeights = Record<SignalId, number>;
