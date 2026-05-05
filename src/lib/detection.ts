/* ══ WHALE RADAR — DETECTION ENGINE v1.1 ══════════════════════════════════════
 *  FIX: Recalculated vmcap is now realistic (0-500% range), so thresholds
 *       lowered from 800/1500 to 400/800 to match real-world manipulation.
 * ═══════════════════════════════════════════════════════════════════════════ */

import type { BirdeyeData } from './whaleRadarState';

export interface WhaleScoreInput {
  vmcap: number;
  chg24: number;
  volSpike: number;
  vol: number;
  mcap: number;
  supplyPct: number | null;
  dexHot: boolean;
  dsLiq: { liq: number; pairs: number } | null;
  isSol: boolean;
  birdData: BirdeyeData | null;
}

export interface WhaleScoreResult {
  score: number;
  reasons: string[];
  flagCount: number;
}

export interface ManipulationResult {
  level: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NORMAL';
  pattern: ManipulationPattern;
  confidence: number;
}

export type ManipulationPattern =
  | 'WASH_TRADE'
  | 'PUMP_AND_DUMP'
  | 'SHORT_SQUEEZE'
  | 'ACCUMULATION'
  | 'DUMP'
  | 'RUG_PULL_RISK'
  | 'NONE';

export type ThreatLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';

export interface DetectionResult {
  score: number;
  threat: ThreatLevel;
  category: string | null;
  confidence: number;
  reasons: string[];
  manipulation: ManipulationResult;
  whale: WhaleScoreResult;
  signals: DetectionSignals;
}

export interface DetectionSignals {
  isWashSuspect: boolean;
  isPumpActive: boolean;
  isDumpActive: boolean;
  isSqueezeActive: boolean;
  isAccumulating: boolean;
  isRugRisk: boolean;
  isNanoCap: boolean;
  hasLowLiquidity: boolean;
  hasMintableRisk: boolean;
}

// ── 1. Whale Score ────────────────────────────────────────────────────────────

export function whaleScore(input: WhaleScoreInput): WhaleScoreResult {
  const { vmcap, chg24, volSpike, vol, mcap, supplyPct, dexHot, dsLiq, isSol, birdData } = input;
  let score = 0;
  const reasons: string[] = [];
  let flagCount = 0;
  const absChg = Math.abs(chg24);

  // VOL/MCAP ratio — primary whale activity signal
  // FIX: Lowered thresholds for realistic recalculated vmcap (0-500% range)
  if (vmcap >= 400)      { score += 40; reasons.push(`VOL/MCAP=${vmcap.toFixed(0)}% 🔴`); flagCount++; }
  else if (vmcap >= 200) { score += 28; reasons.push(`VOL/MCAP=${vmcap.toFixed(0)}%`);     flagCount++; }
  else if (vmcap >= 100) { score += 16; reasons.push(`VOL/MCAP=${vmcap.toFixed(0)}%`);     flagCount++; }
  else if (vmcap >= 40)  { score += 8;  reasons.push(`VOL/MCAP=${vmcap.toFixed(0)}%`);      flagCount++; }
  else if (vmcap >= 15)  { score += 4; }

  // Price change magnitude
  if (absChg >= 50)      { score += 25; reasons.push(`ΔP=${chg24.toFixed(1)}% 🔴`); flagCount++; }
  else if (absChg >= 30) { score += 18; reasons.push(`ΔP=${chg24.toFixed(1)}%`);    flagCount++; }
  else if (absChg >= 15) { score += 10; reasons.push(`ΔP=${chg24.toFixed(1)}%`);    flagCount++; }
  else if (absChg >= 8)  { score += 4;                                                flagCount++; }

  // Volume spike vs historical baseline
  if (volSpike >= 5)      { score += 20; reasons.push(`VOL×${volSpike.toFixed(1)} 🔴`); flagCount++; }
  else if (volSpike >= 3) { score += 12; reasons.push(`VOL×${volSpike.toFixed(1)}`);    flagCount++; }
  else if (volSpike >= 2) { score += 6;                                                   flagCount++; }
  else if (volSpike >= 1.5) { score += 3; }

  // Circulating supply — low float = easier to manipulate
  if (supplyPct !== null) {
    if (supplyPct <= 15)      { score += 22; reasons.push(`CIRC=${supplyPct.toFixed(0)}% 🔴`); flagCount++; }
    else if (supplyPct <= 25) { score += 16; reasons.push(`CIRC=${supplyPct.toFixed(0)}%`);    flagCount++; }
    else if (supplyPct <= 40) { score += 8;  reasons.push(`CIRC=${supplyPct.toFixed(0)}%`);    flagCount++; }
    else if (supplyPct <= 60) { score += 4; }
  }

  // Market cap tier — smaller = more manipulable
  if (mcap < 5e6)        { score += 15; reasons.push('NANO CAP');   flagCount++; }
  else if (mcap < 20e6)  { score += 12; reasons.push('MICRO CAP');  flagCount++; }
  else if (mcap < 100e6) { score += 7;  reasons.push('SMALL CAP');  flagCount++; }
  else if (mcap < 500e6) { score += 3; }

  // DEX trending
  if (dexHot) { score += 10; reasons.push('DEX TRENDING 🔵'); flagCount++; }

  // PUMP + low-float unlock — coordinated exit setup
  if (chg24 >= 30 && supplyPct !== null && supplyPct <= 30) {
    score += 15; reasons.push('PUMP+UNLOCK'); flagCount++;
  }

  // Liquidity ratio: vol vs pool depth
  if (dsLiq) {
    const lr = vol / (dsLiq.liq || 1);
    if (lr >= 20)      { score += 15; reasons.push(`LOW DEX LIQ(×${lr.toFixed(0)}) 🔴`); flagCount++; }
    else if (lr >= 8)  { score += 8;  reasons.push(`DEX LIQ THIN(×${lr.toFixed(0)})`);   flagCount++; }
    else if (lr >= 3)  { score += 4; }
  } else if (vol > mcap * 5 && mcap < 50e6) {
    score += 10; reasons.push('VOL>5×MCAP'); flagCount++;
  }

  // On-chain Solana signals (Birdeye)
  if (isSol && birdData) {
    if (birdData.rugScore >= 70)  { score += 25; reasons.push(`RUG=${birdData.rugScore}/100 🔴`); flagCount++; }
    else if (birdData.rugScore >= 40) { score += 12; reasons.push(`RUG=${birdData.rugScore}/100`); flagCount++; }
    if (birdData.top10pct != null && birdData.top10pct > 60) {
      score += 18; reasons.push(`TOP10=${birdData.top10pct.toFixed(0)}%`); flagCount++;
    }
    if (birdData.isMintable)  { score += 12; reasons.push('MINTABLE⚠'); flagCount++; }
    if (birdData.isFreezable) { score += 8;  reasons.push('FREEZABLE'); flagCount++; }
    if (birdData.lpBurned != null && birdData.lpBurned < 50) {
      score += 10; reasons.push(`LP=${birdData.lpBurned.toFixed(0)}%`); flagCount++;
    }
    if (birdData.ageDays != null && birdData.ageDays < 3) {
      score += 15; reasons.push(`AGE=${birdData.ageDays}d 🔴`); flagCount++;
    }
  } else if (isSol && !birdData) {
    reasons.push('◎ on-chain pending');
  }

  return { score: Math.min(score, 100), reasons, flagCount };
}

// ── 2. Manipulation Detector ──────────────────────────────────────────────────

export interface ManipulationInput {
  vmcap: number;
  chg24: number;
  volSpike: number;
  vol: number;
  mcap: number;
  supplyPct: number | null;
  score: number;
  birdData: BirdeyeData | null;
  flagCount: number;
}

export function detectManipulation(input: ManipulationInput): ManipulationResult {
  const { vmcap, chg24, volSpike, vol, mcap, supplyPct, score, birdData, flagCount } = input;
  const absChg = Math.abs(chg24);
  const confidence = Math.min(Math.round((flagCount / 10) * 100), 100);

  // WASH TRADE: extreme vol relative to tiny mcap — coordinated circular trading
  // FIX: Lowered thresholds for realistic recalculated vmcap
  if (vmcap > 800 && mcap < 500e6) {
    return { level: 'CRITICAL', pattern: 'WASH_TRADE', confidence };
  }
  if (vmcap > 400 && mcap < 200e6) {
    return { level: 'HIGH', pattern: 'WASH_TRADE', confidence };
  }

  // RUG PULL RISK: on-chain signals dominant
  if (birdData && (birdData.rugScore >= 70 || (birdData.isMintable && birdData.ageDays != null && birdData.ageDays < 3))) {
    return { level: 'CRITICAL', pattern: 'RUG_PULL_RISK', confidence };
  }

  // PUMP & DUMP: big price spike + high vol relative to mcap
  // FIX: Lowered vmcap threshold from 200 to 120
  if (chg24 >= 30 && vmcap >= 120) {
    const level: ManipulationResult['level'] = chg24 >= 50 ? 'CRITICAL' : 'HIGH';
    return { level, pattern: 'PUMP_AND_DUMP', confidence };
  }

  // DUMP: sharp sell-off with massive volume
  if (chg24 <= -25 && vol > 30e6) {
    return { level: 'HIGH', pattern: 'DUMP', confidence };
  }

  // SHORT SQUEEZE: volatile price + locked supply
  if (absChg >= 20 && supplyPct !== null && supplyPct <= 25) {
    return { level: 'HIGH', pattern: 'SHORT_SQUEEZE', confidence };
  }

  // ACCUMULATION: vol spike but price stable — quiet buying
  if (volSpike >= 3 && absChg < 10 && score >= 20) {
    return { level: 'MEDIUM', pattern: 'ACCUMULATION', confidence };
  }

  // No dominant pattern
  const level: ManipulationResult['level'] =
    score >= 70 ? 'HIGH' :
    score >= 45 ? 'MEDIUM' :
    score >= 25 ? 'LOW' : 'NORMAL';

  return { level, pattern: 'NONE', confidence };
}

// ── 3. Category Classifier ────────────────────────────────────────────────────

export function classifyCategory(
  vmcap: number, chg24: number, volSpike: number, mcap: number, supplyPct: number | null
): string | null {
  const absChg = Math.abs(chg24);
  // FIX: Lowered thresholds for realistic recalculated vmcap
  if (vmcap > 800 && mcap < 500e6) return 'WASH';
  if (vmcap > 400 && mcap < 200e6)  return 'WASH';
  if (chg24 >= 30 && vmcap >= 120)   return 'PUMP';
  if (chg24 <= -25 && chg24 < 0 && vmcap >= 100) return 'DUMP';
  if (absChg >= 20 && supplyPct !== null && supplyPct <= 25) return 'SQUEEZE';
  if (volSpike >= 3 && absChg < 10)  return 'ACCUM';
  return null;
}

// ── 4. Threat Level Calculator ────────────────────────────────────────────────

export function calcThreatLevel(score: number): ThreatLevel {
  if (score >= 70) return 'CRITICAL';
  if (score >= 45) return 'HIGH';
  if (score >= 25) return 'MEDIUM';
  return 'LOW';
}

// ── 5. Build Detection Signals ────────────────────────────────────────────────

export function buildSignals(input: WhaleScoreInput & { score: number }): DetectionSignals {
  const { vmcap, chg24, volSpike, mcap, supplyPct, dsLiq, vol, birdData, score } = input;
  const absChg = Math.abs(chg24);
  const liqRatio = dsLiq ? vol / (dsLiq.liq || 1) : 0;

  // FIX: Lowered thresholds for realistic recalculated vmcap
  return {
    isWashSuspect:    (vmcap > 400 && mcap < 500e6) || (vmcap > 800),
    isPumpActive:     chg24 >= 30 && vmcap >= 120,
    isDumpActive:     chg24 <= -25 && vol > 30e6,
    isSqueezeActive:  absChg >= 20 && supplyPct !== null && supplyPct <= 25,
    isAccumulating:   volSpike >= 3 && absChg < 10 && score >= 20,
    isRugRisk:        !!(birdData && (birdData.rugScore >= 70 || (birdData.isMintable && birdData.ageDays != null && birdData.ageDays < 7))),
    isNanoCap:        mcap < 20e6,
    hasLowLiquidity:  liqRatio >= 8 || (!dsLiq && vol > mcap * 5 && mcap < 50e6),
    hasMintableRisk:  !!(birdData?.isMintable),
  };
}

// ── 6. Master detect() — single entry point ───────────────────────────────────

export function detect(input: WhaleScoreInput): DetectionResult {
  const whale = whaleScore(input);
  const { score, reasons, flagCount } = whale;

  const manipulation = detectManipulation({ ...input, score, flagCount });
  const category = classifyCategory(input.vmcap, input.chg24, input.volSpike, input.mcap, input.supplyPct);
  const threat = calcThreatLevel(score);
  const confidence = Math.min(Math.round((flagCount / 10) * 100), 100);
  const signals = buildSignals({ ...input, score });

  return { score, threat, category, confidence, reasons, manipulation, whale, signals };
}
