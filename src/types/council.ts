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
  risk: { id: 'risk', label: 'RISK DESK', role: 'Aggressive · Neutral · Conservative', color: 'text-wr-amber', glyph: '⚖' },
  trader: { id: 'trader', label: 'TRADER AGENT', role: 'Execution synthesis', color: 'text-wr-cyan', glyph: '⌁' },
  pm: { id: 'pm', label: 'PORTFOLIO MANAGER', role: 'Final verdict · memory', color: 'text-wr-purple', glyph: '★' },
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

/** SSE event shapes emitted by the agent-council edge function. */
export type CouncilStreamEvent =
  | { type: 'agent_start'; agent: AgentId }
  | { type: 'delta'; agent: AgentId; text: string }
  | { type: 'agent_end'; agent: AgentId }
  | { type: 'decision'; decision: CouncilDecision }
  | { type: 'error'; message: string };
