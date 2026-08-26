/* ══ WHALE RADAR v9 — STATE MANAGEMENT ═══════════════════════════════════════
 *
 *  FIXES v1.2 (see bug report):
 *  - calcThreat(): added MCAP_MIN_RELIABLE guard at top — tokens with mcap <
 *    $10K return score=0/LOW/null immediately instead of scoring as WASH.
 *  - calcThreat(): REMOVED the duplicate WASH bonus block (+20/+14 pts).
 *    The vmcap ≥ 400 branch already awards +40. Adding a second WASH bonus
 *    on top caused scores 20 pts higher than detection.ts whaleScore() for
 *    the same token, diverging results depending on which code path ran.
 *  - calcThreat() category: kept as-is (vmcap > 800 → WASH) but now only
 *    fires after the mcap guard passes.
 *  - Recommended: replace all calcThreat() call sites in Index.tsx with
 *    detect() from detection.ts so both engines stay in sync.
 *
 * ════════════════════════════════════════════════════════════════════════════ */

// ── Minimum mcap to trust — mirrors detection.ts constant ────────────────────
const MCAP_MIN_RELIABLE = 10_000;

export interface CoinData {
  rank: number;
  id: string;
  symbol: string;
  name: string;
  price: number;
  change: number;
  volume: number;
  mcap: number;
  vmcap: number;
  volSpike: number;
  supplyPct: number | null;
  score: number;
  threat: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  category: string | null;
  confidence: number;
  reasons: string[];
  dexHot: boolean;
  dsLiq: { liq: number; pairs: number } | null;
  isSol: boolean;
  birdData: BirdeyeData | null;
  /** Keyless RugCheck on-chain risk report — undefined until enrichment runs. */
  rugCheck?: RugCheckData | null;
  /** Chain slug -> contract address, from CoinGecko's include_platform=true.
   *  Empty/undefined for native L1 coins that aren't a token on another
   *  chain (BTC, ETH itself, SOL itself, etc.) — that's correct, not a gap.
   *  This is what the Insider Risk Scanner's real-data path (insiderRiskApi.ts)
   *  needs a contract address from; see its InsiderRiskCoin comment. */
  platforms?: Record<string, string> | null;
}

export interface RugCheckData {
  ts: number;
  sym: string;
  addr: string;
  /** 0-100, higher = riskier (RugCheck score_normalised). */
  score: number | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  isMintable: boolean;
  isFreezable: boolean;
  /** Best (highest) LP locked/burned percentage across markets, 0-100. */
  lpLockedPct: number | null;
  lpProviders: number | null;
  liquidityUsd: number | null;
  rugged: boolean;
  risks: string[];
}

export interface BirdeyeData {
  ts: number;
  sym: string;
  addr: string;
  top10pct: number | null;
  creatorPct: number | null;
  lpBurned: number | null;
  isMintable: boolean;
  isFreezable: boolean;
  ageDays: number | null;
  rugScore: number;
  devActivity: string;
}


export interface AlertItem {
  ts: number;
  level: 'critical' | 'high' | 'medium' | 'info';
  tag: string;
  text: string;
  tc: string;
  sizing?: string | null;
  pinned: boolean;
  /** Backend row id — set once saveAlert()'s response resolves (new alerts)
   *  or by loadAlerts() (persisted ones). Undefined for an alert that
   *  hasn't round-tripped to the server yet (e.g. offline mode, or the
   *  save is still in flight) — pin-toggling stays local-only until then. */
  dbId?: number;
  /** CoinGecko id, when this alert originated from a specific coin (the
   *  scanner's CRITICAL/HIGH fires) — undefined for market-wide alerts
   *  (REGIME-tagged) or ones with no natural coin (API errors). Needed so
   *  the decision-outcome loop (v9.37) can look up a forward price if the
   *  user marks the alert "I Bought". */
  coinId?: string | null;
  /** Coin price at the moment the alert fired — the entry price a "bought"
   *  decision's forward return is measured against. Same availability
   *  caveat as coinId. */
  entryPrice?: number | null;
  /** The user's own logged decision on this alert, once they've made one —
   *  see the 🔍/💰 buttons in WRRightPanel and POST /api/alerts/:id/outcome.
   *  Undefined until they act, or if this alert predates v9.37. */
  decision?: 'reviewed' | 'bought' | null;
  /** Forward 24h % return, once resolved — only ever set for decision
   *  === 'bought' with a coinId; null/undefined otherwise, including while
   *  still waiting on the 24h window to elapse. */
  outcomePct?: number | null;
}

export interface WhaleTrade {
  ts: number;
  sym: string;
  side: string;
  price: number;
  qty: number;
  usdt: number;
  cls: string;
  ex: string;
}

export interface TrackedToken {
  id: string;
  price: number;
  basePrice: number;
  lastPrice: number;
}

export interface PortfolioEntry {
  amount: number;
  entryPrice: number;
}

export interface WalletEntry {
  address: string;
  label: string;
  /** ISO timestamp of the most recent on-chain transaction — populated by
   *  useWalletActivity (lib/solanaWallet.ts), not set at add-time. */
  lastActivity?: string;
  balanceSol?: number;
  recentTxCount24h?: number;
  /** Smart-money trading-skill fields — populated by useWalletSkillScoring
   *  (lib/walletSkillScoring.ts), not set at add-time. skillScore/winRate
   *  stay undefined until at least one closed (fully cost-basis-matched)
   *  swap round-trip has been parsed for this wallet. */
  skillScore?: number;
  winRate?: number;
  avgProfitSol?: number;
  closedTrades?: number;
}

export interface ScanSnapshot {
  ts: number;
  coins: Partial<CoinData>[];
  critCount: number;
  highCount: number;
}

export interface WhaleRadarConfig {
  SCAN_MS_NORMAL: number;
  SCAN_MS_AGG: number;
  CACHE_TTL: number;
  STALE_WARN: number;
  DEX_THROTTLE: number;
  WHALE_MIN: number;
  WFEED_MAX: number;
  AFEED_MAX: number;
  HISTORY_MAX: number;
  AI_CACHE_MS: number;
  BIRD_CACHE_MS: number;
  DAILY_BUDGET_FREE: number;
  DAILY_BUDGET_PRO: number;
  STORE_KEY: string;
  SOL_SYMS: Set<string>;
  SOL_ADDRS: Record<string, string>;
}

export const CFG: WhaleRadarConfig = {
  SCAN_MS_NORMAL: 5 * 60 * 1000,
  SCAN_MS_AGG: 3 * 60 * 1000,
  CACHE_TTL: 4 * 60 * 1000,
  STALE_WARN: 3 * 60 * 1000,
  DEX_THROTTLE: 3 * 60 * 1000,
  WHALE_MIN: 150_000,
  WFEED_MAX: 150,
  AFEED_MAX: 80,
  HISTORY_MAX: 30,
  AI_CACHE_MS: 10 * 60 * 1000,
  BIRD_CACHE_MS: 15 * 60 * 1000,
  DAILY_BUDGET_FREE: 333,
  DAILY_BUDGET_PRO: 10_000,
  STORE_KEY: 'wr_v9',
  SOL_SYMS: new Set(['SOL', 'RAY', 'BONK', 'WIF', 'JTO', 'JUP', 'PYTH', 'RNDR', 'RENDER',
    'SAMO', 'ORCA', 'MNGO', 'STEP', 'FIDA', 'KIN', 'ATLAS', 'POLIS', 'GMT', 'GST',
    'GENE', 'SLIM', 'HXRO', 'FORGE', 'DUST', 'DFL', 'REAL', 'WOOF', 'NINJA', 'AURY']),
  SOL_ADDRS: {
    SOL: 'So11111111111111111111111111111111111111112',
    RAY: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    WIF: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    JUP: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
    PYTH: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  },
};

/* ══ FORMATTING HELPERS ═══════════════════════════════════════════════════════ */
export function fmtN(n: number): string {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toFixed(0);
}

export function fmtP(p: number): string {
  if (p >= 1000) return p.toFixed(0);
  if (p >= 1)    return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

export function isSolToken(sym: string): boolean {
  return CFG.SOL_SYMS.has(sym) || sym.endsWith('SOL');
}

/* ══ THREAT ENGINE v9.2 ═══════════════════════════════════════════════════════
 *
 *  FIX BUG-001: mcap < MCAP_MIN_RELIABLE → return score=0, threat='LOW',
 *               category=null immediately. Prevents API garbage (mcap=1) from
 *               producing billions-percent vmcap and cascading to CRITICAL/WASH.
 *
 *  FIX BUG-003: Removed the duplicate WASH bonus block:
 *               BEFORE: vmcap>800 → +20 pts on top of vmcap≥400 → +40 pts = +60
 *               AFTER:  vmcap≥400 → +40 pts only (matches detection.ts)
 *               The old bonus caused calcThreat() scores to be ~20 pts higher
 *               than detect() for the same token — two engines disagreed.
 *
 * ════════════════════════════════════════════════════════════════════════════ */

export function calcThreat(params: {
  vmcap: number; chg24: number; volSpike: number; supplyPct: number | null;
  vol: number; mcap: number; dexHot: boolean; dsLiq: { liq: number; pairs: number } | null;
  isSol: boolean; birdData: BirdeyeData | null;
}) {
  const { vmcap, chg24, volSpike, supplyPct, vol, mcap, dexHot, dsLiq, isSol, birdData } = params;

  // FIX BUG-001: Reject tokens with unreliable mcap immediately.
  // API returns market_cap=0/null for unlisted tokens; a || 1 fallback in the
  // normalizer makes mcap=1 and vmcap climb to billions, falsely triggering WASH.
  if (mcap < MCAP_MIN_RELIABLE) {
    return {
      score: 0,
      threat: 'LOW' as const,
      category: null,
      confidence: 0,
      reasons: ['UNVERIFIED MCAP — excluded from scoring'],
    };
  }

  let score = 0;
  const reasons: string[] = [];
  let ff = 0;
  const absChg = Math.abs(chg24);

  // VOL/MCAP ratio (thresholds match detection.ts whaleScore)
  if (vmcap >= 400)      { score += 40; reasons.push('VOL/MCAP=' + vmcap.toFixed(0) + '% 🔴'); ff++; }
  else if (vmcap >= 200) { score += 28; reasons.push('VOL/MCAP=' + vmcap.toFixed(0) + '%');     ff++; }
  else if (vmcap >= 100) { score += 16; reasons.push('VOL/MCAP=' + vmcap.toFixed(0) + '%');     ff++; }
  else if (vmcap >= 40)  { score += 8;  reasons.push('VOL/MCAP=' + vmcap.toFixed(0) + '%');     ff++; }
  else if (vmcap >= 15)  { score += 4; }

  // Price change magnitude
  if (absChg >= 50)      { score += 25; reasons.push('ΔP=' + chg24.toFixed(1) + '% 🔴'); ff++; }
  else if (absChg >= 30) { score += 18; reasons.push('ΔP=' + chg24.toFixed(1) + '%');    ff++; }
  else if (absChg >= 15) { score += 10; reasons.push('ΔP=' + chg24.toFixed(1) + '%');    ff++; }
  else if (absChg >= 8)  { score += 4;                                                    ff++; }

  // Volume spike
  if (volSpike >= 5)        { score += 20; reasons.push('VOL×' + volSpike.toFixed(1) + ' 🔴'); ff++; }
  else if (volSpike >= 3)   { score += 12; reasons.push('VOL×' + volSpike.toFixed(1));          ff++; }
  else if (volSpike >= 2)   { score += 6;                                                         ff++; }
  else if (volSpike >= 1.5) { score += 3; }

  // Circulating supply
  if (supplyPct !== null) {
    if (supplyPct <= 15)      { score += 22; reasons.push('CIRC=' + supplyPct.toFixed(0) + '% 🔴'); ff++; }
    else if (supplyPct <= 25) { score += 16; reasons.push('CIRC=' + supplyPct.toFixed(0) + '%');    ff++; }
    else if (supplyPct <= 40) { score += 8;  reasons.push('CIRC=' + supplyPct.toFixed(0) + '%');    ff++; }
    else if (supplyPct <= 60) { score += 4; }
  }

  // Market cap tier
  if (mcap < 5e6)        { score += 15; reasons.push('NANO CAP');   ff++; }
  else if (mcap < 20e6)  { score += 12; reasons.push('MICRO CAP');  ff++; }
  else if (mcap < 100e6) { score += 7;  reasons.push('SMALL CAP');  ff++; }
  else if (mcap < 500e6) { score += 3; }

  // NOTE: The WASH bonus block that used to be here (+20/+14 pts) has been
  // REMOVED. It was double-counting vmcap — the +40 above already captures it.
  // Category 'WASH' is still set in the classification section below.

  // PUMP + low-float unlock
  if (chg24 >= 30 && supplyPct !== null && supplyPct <= 30) {
    score += 15; reasons.push('PUMP+UNLOCK'); ff++;
  }

  // DEX trending
  if (dexHot) { score += 10; reasons.push('DEX TRENDING 🔵'); ff++; }

  // Liquidity ratio
  if (dsLiq) {
    const lr = vol / (dsLiq.liq || 1);
    if (lr >= 20)     { score += 15; reasons.push('LOW DEX LIQ(×' + lr.toFixed(0) + ') 🔴'); ff++; }
    else if (lr >= 8) { score += 8;  reasons.push('DEX LIQ THIN(×' + lr.toFixed(0) + ')');   ff++; }
    else if (lr >= 3) { score += 4; }
  } else if (vol > mcap * 5 && mcap < 50e6) {
    score += 10; reasons.push('VOL>5×MCAP'); ff++;
  }

  // On-chain Solana signals
  if (isSol && birdData) {
    if (birdData.rugScore >= 70)      { score += 25; reasons.push('RUG=' + birdData.rugScore + '/100 🔴'); ff++; }
    else if (birdData.rugScore >= 40) { score += 12; reasons.push('RUG=' + birdData.rugScore + '/100');    ff++; }
    if (birdData.top10pct != null && birdData.top10pct > 60) {
      score += 18; reasons.push('TOP10=' + birdData.top10pct.toFixed(0) + '%'); ff++;
    }
    if (birdData.isMintable)  { score += 12; reasons.push('MINTABLE⚠'); ff++; }
    if (birdData.isFreezable) { score += 8;  reasons.push('FREEZABLE');  ff++; }
    if (birdData.lpBurned != null && birdData.lpBurned < 50) {
      score += 10; reasons.push('LP=' + birdData.lpBurned.toFixed(0) + '%'); ff++;
    }
    if (birdData.ageDays != null && birdData.ageDays < 3) {
      score += 15; reasons.push('AGE=' + birdData.ageDays + 'd 🔴'); ff++;
    }
  } else if (isSol && !birdData) {
    reasons.push('◎ on-chain pending');
  }

  score = Math.min(score, 100);

  let threat: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  if (score >= 70)      threat = 'CRITICAL';
  else if (score >= 45) threat = 'HIGH';
  else if (score >= 25) threat = 'MEDIUM';
  else                  threat = 'LOW';

  // Category classification (mcap guard already passed above)
  let category: string | null = null;
  if (vmcap > 800 && mcap < 500e6)        category = 'WASH';
  else if (vmcap > 400 && mcap < 200e6)   category = 'WASH';
  else if (chg24 >= 30 && vmcap >= 120)   category = 'PUMP';
  else if (chg24 <= -25 && vol > 30e6)    category = 'DUMP';
  else if (absChg >= 20 && supplyPct !== null && supplyPct <= 25) category = 'SQUEEZE';
  else if (volSpike >= 3 && absChg < 10 && score >= 20)          category = 'ACCUM';

  const confidence = Math.min(Math.round((ff / 10) * 100), 100);
  return { score, threat, category, confidence, reasons };
}

/* ══ SIZING CALCULATOR ════════════════════════════════════════════════════════ */
export function calcSizing(coin: CoinData) {
  if (coin.threat === 'CRITICAL') return { label: 'AVOID', cls: 'siz-none', slip: null };
  if (coin.threat === 'HIGH')     return { label: '$50-200',  cls: 'siz-micro',  slip: '~2-5% slippage' };
  if (coin.threat === 'MEDIUM')   return { label: '$200-1K',  cls: 'siz-small',  slip: '~1-2% slippage' };
  return                                 { label: '$1K-5K',   cls: 'siz-normal', slip: '<1% slippage' };
}

/* ══ PERSISTENCE ══════════════════════════════════════════════════════════════ */
export function saveState(state: Record<string, unknown>) {
  try {
    localStorage.setItem(CFG.STORE_KEY, JSON.stringify(state));
  } catch (_) { /* quota exceeded */ }
}

export function loadState(): Record<string, unknown> {
  try {
    return JSON.parse(localStorage.getItem(CFG.STORE_KEY) || '{}');
  } catch (_) {
    return {};
  }
}
