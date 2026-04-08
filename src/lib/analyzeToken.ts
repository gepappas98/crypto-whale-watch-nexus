/* ══ WHALE RADAR v9 — Claude AI Analysis ═════════════════════════════════════ */
import { CoinData, fmtN, fmtP } from './whaleRadarState';

interface AiCacheEntry {
  ts: number;
  text: string;
}

const aiCache: Record<string, AiCacheEntry> = {};
const AI_CACHE_MS = 10 * 60 * 1000;

export async function analyzeToken(coin: CoinData, aiKey: string): Promise<string | null> {
  if (!aiKey) return null;

  // Check cache
  const cached = aiCache[coin.symbol];
  if (cached && Date.now() - cached.ts < AI_CACHE_MS) return cached.text;

  const prompt = `Analyze ${coin.symbol} (${coin.name}):
Price: $${fmtP(coin.price)} | 24h: ${coin.change.toFixed(1)}% | Vol: $${fmtN(coin.volume)} | MCap: $${fmtN(coin.mcap)}
VOL/MCAP: ${coin.vmcap.toFixed(0)}% | Score: ${coin.score}/100 | Threat: ${coin.threat}
${coin.category ? 'Category: ' + coin.category : ''}
Flags: ${coin.reasons.join(', ')}
${coin.isSol ? 'Chain: Solana' : ''}
${coin.birdData ? `On-chain: RugScore=${coin.birdData.rugScore} Top10=${coin.birdData.top10pct}% Mintable=${coin.birdData.isMintable} Age=${coin.birdData.ageDays}d` : ''}`;

  try {
    // Issue #1: Add required x-api-key and anthropic-version headers
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
        system: 'You are a crypto market manipulation analyst and Solana ecosystem specialist. Be concise, direct, data-driven. 3-5 sentences max. Include on-chain assessment if available. No disclaimers.',
        messages: [{ role: 'user', content: prompt }],
      }),
    });
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
  const top = coins.filter(c => c.score >= 50).slice(0, 5).map(c => `${c.symbol}(${c.score})`).join(', ');

  try {
    // Issue #1: Add required x-api-key and anthropic-version headers
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
        messages: [{ role: 'user', content: `Market manipulation sentiment:\nCRITICAL: ${critCount} | HIGH: ${highCount} | WASH suspects: ${washCount}\nTop threats: ${top}\nTotal scanned: ${coins.length}` }],
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    return data.content?.[0]?.text || 'No response';
  } catch (e: unknown) {
    return 'AI error: ' + (e instanceof Error ? e.message : 'Unknown').slice(0, 60);
  }
}
