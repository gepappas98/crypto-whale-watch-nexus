/* ══ AGENT COUNCIL — TYPES ════════════════════════════════════════════════════
 *  Multi-agent AI trading desk living inside Whale Radar.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type CouncilVerdict =
  | 'STRONG_LONG'
  | 'LONG'
  | 'NEUTRAL'
  | 'SHORT'
  | 'STRONG_SHORT'
  | 'AVOID';

export interface CouncilDecision {
  symbol: string;
  timestamp: string;
  finalVerdict: CouncilVerdict;
  conviction: number; // 0-100
  summary: string;
  bullCase: string;
  bearCase: string;
  riskAssessment: string;
  keyCatalysts: string[];
  keyRisks: string[];
  suggestedSize: 'small' | 'medium' | 'large' | 'none';
  entryZone?: string;
  stopLoss?: string;
  targets?: string[];
  invalidation: string;
  timeHorizon: 'scalp' | 'intraday' | 'swing' | 'position';
  relatedWhaleSignals: string[];
  manipulationFlags: string[];
}

export type CouncilDepth = 'quick' | 'standard' | 'deep';

export type AgentId =
  | 'bull'
  | 'bear'
  | 'quant'
  | 'regime'
  | 'risk'
  | 'trader'
  | 'pm';

export interface AgentMeta {
  id: AgentId;
  label: string;
  role: string;
  color: string; // tailwind text class
  glyph: string;
}

export const AGENT_META: Record<AgentId, AgentMeta> = {
  bull: { id: 'bull', label: 'BULL RESEARCHER', role: 'Long thesis', color: 'text-wr-green', glyph: '▲' },
  bear: { id: 'bear', label: 'BEAR RESEARCHER', role: 'Short / risk thesis', color: 'text-wr-red', glyph: '▼' },
  quant: { id: 'quant', label: 'QUANT DESK', role: 'Orderflow · derivatives positioning', color: 'text-wr-blue', glyph: '∑' },
  regime: { id: 'regime', label: 'REGIME DESK', role: 'What regime are we in · what invalidates it', color: 'text-wr-purple', glyph: '◈' },
  risk: { id: 'risk', label: 'RISK DESK', role: 'Aggressive · Neutral · Conservative', color: 'text-wr-amber', glyph: '⚖' },
  trader: { id: 'trader', label: 'TRADER AGENT', role: 'Execution synthesis', color: 'text-wr-cyan', glyph: '⌁' },
  pm: { id: 'pm', label: 'PORTFOLIO MANAGER', role: 'Final verdict · memory', color: 'text-wr-purple', glyph: '★' },
};

/** Mirrors the server's DEPTH_AGENTS gating (supabase/functions/agent-council)
 *  — kept here too so the client can describe the roster (intro copy, depth
 *  picker hints) without a round-trip. The server is still the actual
 *  authority on which agents run; this is display-only. */
export const DEPTH_AGENTS: Record<CouncilDepth, AgentId[]> = {
  quick: ['bull', 'bear', 'pm'],
  standard: ['bull', 'bear', 'regime', 'risk', 'trader', 'pm'],
  deep: ['bull', 'bear', 'quant', 'regime', 'risk', 'trader', 'pm'],
};

export interface AgentMessage {
  agent: AgentId;
  text: string;
  done: boolean;
  startedAt: number;
}

/** Everything injected into every agent prompt. */
export interface CouncilContext {
  symbol: string;
  tokenId?: string;
  name?: string;
  price: number;
  change24h: number;
  volume: number;
  mcap: number;
  vmcapPct: number;
  volSpike?: number;
  whaleScore: number;
  whaleReasons: string[];
  threat: string;
  manipulationPattern: string | null;
  ceoSignal: string;
  birdeye?: {
    rugScore?: number | null;
    top10pct?: number | null;
    creatorPct?: number | null;
    isMintable?: boolean;
    isFreezable?: boolean;
    lpBurned?: number | null;
    ageDays?: number | null;
  } | null;
  dex?: { liq: number; pairs: number } | null;
  hyperliquid?: { fundingRate?: number; openInterest?: number; markPrice?: number } | null;
  recentWhaleTrades: { sym: string; side: string; usdt: number; ex: string; ts: number }[];
  isSol?: boolean;
  /** Market-wide regime read from the Regime Engine (P0), if available.
   *  Distinct from per-token whale/manipulation signals above — this is
   *  what the REGIME DESK agent reads to answer "what regime are we in /
   *  what would invalidate this" rather than "is this coin bullish". */
  regime?: {
    score: number;
    regime: string;
    confirmedRegime: string | null;
    /** New in the 3-tier persistence ladder — see regime/types.ts. Since
     *  confirmedRegime now only populates once a regime has held for
     *  CONFIRMED_SNAPSHOTS (~8h, up from the old ~15min), the Council would
     *  otherwise be blind to an early/developing read for most of a
     *  regime's life. null means the current regime hasn't held even the
     *  EARLY threshold yet. */
    tier: 'early' | 'developing' | 'confirmed' | null;
    heldSnapshots: number;
    agreeing: number;
    active: number;
    reasons: string[];
  } | null;
}

export interface CouncilMemoryEntry {
  id: string;
  createdAt: string;
  finalVerdict: CouncilVerdict;
  conviction: number;
  summary: string;
  priceAt: number | null;
  performance: Record<string, number | null>;
  reflection: string | null;
}

export interface CouncilRunResult {
  decision: CouncilDecision;
  transcript: AgentMessage[];
}

/** Numeric summary of how this token's past graded calls actually played
 *  out, scored at each call's LONGEST available realized-return horizon
 *  (now out to 30d — see council-persist's bucketFor). Distinct from
 *  buildReflection()'s narrative text: this is the structured version meant
 *  for a UI badge, not just text baked into the PM's prompt. */
export interface DeskTrackRecord {
  gradedCalls: number; // directional calls (excludes NEUTRAL) with at least one realized bucket
  hits: number;
  hitRate: number | null;
  avgReturnPct: number | null; // mean realized return at each call's longest horizon
  /** Confidence-discounted 0-100 read on the desk's track record for this
   *  token, pulled toward 50 (no-information baseline for a binary
   *  direction call) when gradedCalls is thin — same reasoning
   *  pairPerformance.ts / walletSkillScoring.ts already use for small
   *  samples, just anchored at 50 instead of 0 since a coin flip's
   *  expected hit rate is 50%, not 0%. */
  score: number | null;
}

/** SSE event shapes emitted by the agent-council edge function. */
export type CouncilStreamEvent =
  | { type: 'agent_start'; agent: AgentId }
  | { type: 'delta'; agent: AgentId; text: string }
  | { type: 'agent_end'; agent: AgentId }
  | { type: 'decision'; decision: CouncilDecision }
  | { type: 'error'; message: string };
