/* ══ WHALE RADAR v9 — Claude AI Analysis ═════════════════════════════════════ */
import { CoinData, fmtN, fmtP } from './whaleRadarState';
import { detect, ManipulationPattern } from './detection';
import { handleRateLimit, isRateLimited, RL_KEYS } from './rateLimit';

const PATTERN_LABEL: Record<ManipulationPattern, string> = {
  WASH_TRADE:    'Wash Trading',
  PUMP_AND_DUMP: 'Pump & Dump',
  SHORT_SQUEEZE: 'Short Squeeze',
  ACCUMULATION:  'Stealth Accumulation',
  DUMP:          'Distribution / Dump',
  RUG_PULL_RISK: 'Rug Pull Risk',
  NONE:          'No dominant pattern',
};

interface AiCacheEntry {
  ts: number;
  text: string;
}

const aiCache: Record<string, AiCacheEntry> = {};
const AI_CACHE_MS = 10 * 60 * 1000;

export async function analyzeToken(coin: CoinData, aiKey: string): Promise<string | null> {
  if (!aiKey) return null;

  const cached = aiCache[coin.symbol];
  if (cached && Date.now() - cached.ts < AI_CACHE_MS) return cached.text;

  // Run structured detection engine for enriched AI context
  const det = detect({
    vmcap:     coin.vmcap,
    chg24:     coin.change,
    volSpike:  coin.volSpike,
    vol:       coin.volume,
    mcap:      coin.mcap,
    supplyPct: null,
    dexHot:    coin.dexHot,
    dsLiq:     null,
    isSol:     coin.isSol,
    birdData:  coin.birdData,
  });

  const sig = det.signals;
  const activeSignals = [
    sig.isWashSuspect   && 'WASH TRADE PATTERN',
    sig.isPumpActive    && 'ACTIVE PUMP',
    sig.isDumpActive    && 'ACTIVE DUMP',
    sig.isSqueezeActive && 'SHORT SQUEEZE',
    sig.isAccumulating  && 'STEALTH ACCUMULATION',
    sig.isRugRisk       && 'RUG PULL RISK',
    sig.isNanoCap       && 'NANO/MICRO CAP',
    sig.hasLowLiquidity && 'LOW LIQUIDITY',
    sig.hasMintableRisk && 'MINTABLE TOKEN',
  ].filter(Boolean).join(' | ') || 'None';

  const prompt = `Analyze ${coin.symbol} (${coin.name}):

MARKET DATA
Price: $${fmtP(coin.price)} | 24h: ${coin.change.toFixed(1)}% | Vol: $${fmtN(coin.volume)} | MCap: $${fmtN(coin.mcap)}
VOL/MCAP: ${coin.vmcap.toFixed(0)}% | Vol Spike: x${coin.volSpike.toFixed(1)}

DETECTION ENGINE OUTPUT
Score: ${det.score}/100 | Threat: ${det.threat} | Confidence: ${det.confidence}%
Category: ${det.category || 'Unclassified'}
Pattern: ${PATTERN_LABEL[det.manipulation.pattern]} [${det.manipulation.level}]
Active Signals: ${activeSignals}
Flags: ${det.reasons.join(', ')}
${coin.isSol ? 'Chain: Solana' : ''}
${coin.birdData ? `On-chain: RugScore=${coin.birdData.rugScore} Top10=${coin.birdData.top10pct?.toFixed(0)}% Mintable=${coin.birdData.isMintable} Age=${coin.birdData.ageDays}d` : ''}`;

  if (isRateLimited(RL_KEYS.CLAUDE)) return 'AI rate limited — cooling down';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': aiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 350,
        system: 'You are a crypto market manipulation analyst and Solana ecosystem specialist. You receive structured detection engine output — treat it as ground truth. Be concise, direct, data-driven. 3-5 sentences max. Lead with the dominant pattern and its risk implication. Include on-chain assessment if available. No disclaimers.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (res.status === 429) {
      handleRateLimit('Claude AI', RL_KEYS.CLAUDE, res.headers.get('Retry-After'));
      return 'AI rate limited — cooling down';
    }
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const text = data.content?.[0]?.text || 'No response';
    aiCache[coin.symbol] = { ts: Date.now(), text };
    return text;
  } catch (e: unknown) {
    return 'AI error: ' + (e instanceof Error ? e.message : 'Unknown').slice(0, 60);
  }
}

export async function analyzeSentiment(
  coins: CoinData[],
  aiKey: string
): Promise<string | null> {
  if (!aiKey) return null;

  const critCount = coins.filter(c => c.threat === 'CRITICAL').length;
  const highCount = coins.filter(c => c.threat === 'HIGH').length;
  const washCount = coins.filter(c => c.category === 'WASH').length;
  const pumpCount = coins.filter(c => c.category === 'PUMP').length;
  const rugCount  = coins.filter(c => c.birdData && c.birdData.rugScore >= 70).length;
  const top = coins
    .filter(c => c.score >= 50)
    .slice(0, 5)
    .map(c => `${c.symbol}(${c.score})`)
    .join(', ');

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': aiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: 'You are a senior crypto market analyst. Provide a concise market-wide manipulation sentiment assessment. Format: 1) Overall Manipulation Index (Low/Medium/High/Extreme) 2) Dominant Pattern (2 sentences) 3) Key Risk Tokens (top 3) 4) Trader Advice (2 sentences). Direct and data-driven.',
        messages: [{
          role: 'user',
          content: `Market manipulation sentiment:\nCRITICAL: ${critCount} | HIGH: ${highCount} | WASH suspects: ${washCount} | PUMP active: ${pumpCount} | Rug risks: ${rugCount}\nTop threats: ${top}\nTotal scanned: ${coins.length}`,
        }],
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data.content?.[0]?.text || 'No response';
  } catch (e: unknown) {
    return 'AI error: ' + (e instanceof Error ? e.message : 'Unknown').slice(0, 60);
  }
}
