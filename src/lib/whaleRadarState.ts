/* ══ WHALE RADAR v9 — STATE MANAGEMENT ═══════════════════════════════════════ */

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
  lastActivity?: string;
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
  if (p >= 1) return p.toFixed(2);
  if (p >= 0.01) return p.toFixed(4);
  return p.toFixed(6);
}

export function isSolToken(sym: string): boolean {
  return CFG.SOL_SYMS.has(sym) || sym.endsWith('SOL');
}

/* ══ THREAT ENGINE v9.1 ═══════════════════════════════════════════════════════
 *  FIX: Lowered vmcap thresholds to match realistic recalculated values (0-500%).
 * ═════════════════════════════════════════════════════════════════════════════ */

export function calcThreat(params: {
  vmcap: number; chg24: number; volSpike: number; supplyPct: number | null;
  vol: number; mcap: number; dexHot: boolean; dsLiq: { liq: number; pairs: number } | null;
  isSol: boolean; birdData: BirdeyeData | null;
}) {
  const { vmcap, chg24, volSpike, supplyPct, vol, mcap, dexHot, dsLiq, isSol, birdData } = params;
  let score = 0;
  const reasons: string[] = [];
  let ff = 0;
  const absChg = Math.abs(chg24);

  // FIX: Lowered thresholds for realistic recalculated vmcap
  if (vmcap >= 400) { score += 40; reasons.push('VOL/MCAP=' + vmcap.toFixed(0) + '% 🔴'); ff++; }
  else if (vmcap >= 200) { score += 28; reasons.push('VOL/MCAP=' + vmcap.toFixed(0) + '%'); ff++; }
  else if (vmcap >= 100) { score += 16; reasons.push('VOL/MCAP=' + vmcap.toFixed(0) + '%'); ff++; }
  else if (vmcap >= 40) { score += 8; reasons.push('VOL/MCAP=' + vmcap.toFixed(0) + '%'); ff++; }
  else if (vmcap >= 15) { score += 4; }

  if (absChg >= 50) { score += 25; reasons.push('ΔP=' + chg24.toFixed(1) + '% 🔴'); ff++; }
  else if (absChg >= 30) { score += 18; reasons.push('ΔP=' + chg24.toFixed(1) + '%'); ff++; }
  else if (absChg >= 15) { score += 10; reasons.push('ΔP=' + chg24.toFixed(1) + '%'); ff++; }
  else if (absChg >= 8) { score += 4; ff++; }

  if (volSpike >= 5) { score += 20; reasons.push('VOL×' + volSpike.toFixed(1) + ' 🔴'); ff++; }
  else if (volSpike >= 3) { score += 12; reasons.push('VOL×' + volSpike.toFixed(1)); ff++; }
  else if (volSpike >= 2) { score += 6; ff++; }
  else if (volSpike >= 1.5) { score += 3; }

  if (supplyPct !== null) {
    if (supplyPct <= 15) { score += 22; reasons.push('CIRC=' + supplyPct.toFixed(0) + '% 🔴'); ff++; }
    else if (supplyPct <= 25) { score += 16; reasons.push('CIRC=' + supplyPct.toFixed(0) + '%'); ff++; }
    else if (supplyPct <= 40) { score += 8; reasons.push('CIRC=' + supplyPct.toFixed(0) + '%'); ff++; }
    else if (supplyPct <= 60) { score += 4; }
  }

  if (mcap < 5e6) { score += 15; reasons.push('NANO CAP'); ff++; }
  else if (mcap < 20e6) { score += 12; reasons.push('MICRO CAP'); ff++; }
  else if (mcap < 100e6) { score += 7; reasons.push('SMALL CAP'); ff++; }
  else if (mcap < 500e6) { score += 3; }

  // FIX: Lowered WASH thresholds for realistic recalculated vmcap
  if (vmcap > 800 && mcap < 500e6) { score += 20; reasons.push('WASH SUSPECT 🟣'); ff++; }
  else if (vmcap > 400 && mcap < 200e6) { score += 14; reasons.push('WASH PATTERN'); ff++; }

  if (chg24 >= 30 && supplyPct !== null && supplyPct <= 30) { score += 15; reasons.push('PUMP+UNLOCK'); ff++; }
  if (dexHot) { score += 10; reasons.push('DEX TRENDING 🔵'); ff++; }

  if (dsLiq) {
    const lr = vol / (dsLiq.liq || 1);
    if (lr >= 20) { score += 15; reasons.push('LOW DEX LIQ(×' + lr.toFixed(0) + ') 🔴'); ff++; }
    else if (lr >= 8) { score += 8; reasons.push('DEX LIQ THIN(×' + lr.toFixed(0) + ')'); ff++; }
    else if (lr >= 3) { score += 4; }
  } else if (vol > mcap * 5 && mcap < 50e6) { score += 10; reasons.push('VOL>5×MCAP'); ff++; }

  if (isSol && birdData) {
    if (birdData.rugScore >= 70) { score += 25; reasons.push('RUG=' + birdData.rugScore + '/100 🔴'); ff++; }
    else if (birdData.rugScore >= 40) { score += 12; reasons.push('RUG=' + birdData.rugScore + '/100'); ff++; }
    if (birdData.top10pct != null && birdData.top10pct > 60) { score += 18; reasons.push('TOP10=' + birdData.top10pct.toFixed(0) + '%'); ff++; }
    if (birdData.isMintable) { score += 12; reasons.push('MINTABLE⚠'); ff++; }
    if (birdData.isFreezable) { score += 8; reasons.push('FREEZABLE'); ff++; }
    if (birdData.lpBurned != null && birdData.lpBurned < 50) { score += 10; reasons.push('LP=' + birdData.lpBurned.toFixed(0) + '%'); ff++; }
    if (birdData.ageDays != null && birdData.ageDays < 3) { score += 15; reasons.push('AGE=' + birdData.ageDays + 'd 🔴'); ff++; }
  } else if (isSol && !birdData) { reasons.push('◎ on-chain pending'); }

  score = Math.min(score, 100);
  let threat: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  if (score >= 70) threat = 'CRITICAL';
  else if (score >= 45) threat = 'HIGH';
  else if (score >= 25) threat = 'MEDIUM';
  else threat = 'LOW';

  let category: string | null = null;
  // FIX: Lowered thresholds for realistic recalculated vmcap
  if (vmcap > 800 && mcap < 500e6) category = 'WASH';
  else if (vmcap > 400 && mcap < 200e6) category = 'WASH';
  else if (chg24 >= 30 && vmcap >= 120) category = 'PUMP';
  else if (chg24 <= -25 && vol > 30e6) category = 'DUMP';
  else if (absChg >= 20 && supplyPct !== null && supplyPct <= 25) category = 'SQUEEZE';
  else if (volSpike >= 3 && absChg < 10 && score >= 20) category = 'ACCUM';

  const confidence = Math.min(Math.round((ff / 10) * 100), 100);
  return { score, threat, category, confidence, reasons };
}

/* ══ SIZING CALCULATOR ════════════════════════════════════════════════════════ */
export function calcSizing(coin: CoinData) {
  if (coin.threat === 'CRITICAL') return { label: 'AVOID', cls: 'siz-none', slip: null };
  if (coin.threat === 'HIGH') return { label: '$50-200', cls: 'siz-micro', slip: '~2-5% slippage' };
  if (coin.threat === 'MEDIUM') return { label: '$200-1K', cls: 'siz-small', slip: '~1-2% slippage' };
  return { label: '$1K-5K', cls: 'siz-normal', slip: '<1% slippage' };
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
