/* ══ REGIME ENGINE — signal families ════════════════════════════════════════
 *  Closes the "signal-family grouping" P1 item from the README's Strategic
 *  Direction section. The problem it solves: `scoreOf()`'s `agreeing/active`
 *  count in engine.ts treats all signals as independent votes, but they
 *  aren't — fng_level and fng_roc are both readings of the same underlying
 *  Fear & Greed index, oi_roc and funding both come off the same BTC perp
 *  market, etc. "8 of 10 signals agree" can overstate how broad the evidence
 *  actually is when several of those 8 are really one opinion counted twice.
 *  Family-level agreement (how many of 5 *independent* families lean the
 *  same way) is the more honest breadth read, alongside — not instead of —
 *  the existing raw signal count.
 * ═══════════════════════════════════════════════════════════════════════════ */
import type { SignalId } from './types';

export type FamilyId = 'trend' | 'derivatives' | 'flow' | 'sentiment' | 'rotation';

export const FAMILY_LABELS: Record<FamilyId, string> = {
  trend: 'Trend',
  derivatives: 'Derivatives',
  flow: 'Flow',
  sentiment: 'Sentiment',
  rotation: 'Rotation',
};

/** Which family each raw signal (see types.ts SignalId) belongs to. Every
 *  signal must appear exactly once — engine.ts's familyReadings() iterates
 *  FAMILY_ORDER and filters signals by this map, so a signal left out here
 *  would silently never count toward any family's agreement.
 *
 *  "Rotation" (formerly "Dominance") holds both btc_dominance and
 *  eth_btc_strength — added when the latter shipped, since they're both
 *  answers to "which asset is capital moving into," just measured against
 *  a different denominator (whole market vs specifically ETH). This is the
 *  original 6-family name from the audit's proposal, applied once there
 *  were two rotation signals to actually group under it.
 *
 *  stablecoin_flow joins "Flow" alongside whale_flow/aggressive_flow/
 *  breadth: those three track capital already inside crypto moving around;
 *  stablecoin_flow tracks capital entering or leaving the ecosystem
 *  altogether. Different scope, same underlying question (where is money
 *  moving), so it belongs with the other flow-type reads rather than
 *  forming a 6th, single-signal family of its own. */
export const SIGNAL_FAMILIES: Record<SignalId, FamilyId> = {
  btc_trend: 'trend',
  btc_momentum: 'trend',
  oi_roc: 'derivatives',
  funding: 'derivatives',
  whale_flow: 'flow',
  aggressive_flow: 'flow',
  breadth: 'flow',
  stablecoin_flow: 'flow',
  fng_level: 'sentiment',
  fng_roc: 'sentiment',
  btc_dominance: 'rotation',
  eth_btc_strength: 'rotation',
};

export const FAMILY_ORDER: FamilyId[] = ['trend', 'derivatives', 'flow', 'sentiment', 'rotation'];
