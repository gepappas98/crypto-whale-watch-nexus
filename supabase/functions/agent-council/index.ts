// ══ AGENT COUNCIL — MULTI-AGENT TRADING DESK (Deno edge function) ════════════
// Streams a live agent debate over SSE and emits a structured CouncilDecision.
import { corsHeaders } from '../_shared/cors.ts';

const LOVABLE_URL = 'https://ai.gateway.lovable.dev/v1/responses';
const DEFAULT_MODEL = 'openai/gpt-5.6-sol';

type AgentId = 'bull' | 'bear' | 'quant' | 'regime' | 'risk' | 'trader' | 'pm';

interface LlmConfig {
  provider?: 'lovable' | 'anthropic' | 'openai' | 'openrouter' | 'groq' | 'custom';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

const BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  openrouter: 'https://openrouter.ai/api/v1',
  groq: 'https://api.groq.com/openai/v1',
};

// SSRF guard: only these hosts may ever be contacted for OpenAI-compatible calls.
// A client-supplied baseUrl is accepted only if it is https and its host is listed.
const ALLOWED_LLM_HOSTS = new Set([
  'api.openai.com',
  'openrouter.ai',
  'api.groq.com',
  'api.anthropic.com',
  'api.mistral.ai',
  'api.deepseek.com',
  'api.together.xyz',
  'api.x.ai',
]);

/** Returns a safe base URL for the provider, ignoring any disallowed custom baseUrl. */
function resolveBaseUrl(provider: string, baseUrl?: string): string {
  const fallback = BASE_URLS[provider] || BASE_URLS.openai;
  if (!baseUrl) return fallback;
  let u: URL;
  try {
    u = new URL(baseUrl);
  } catch {
    return fallback;
  }
  if (u.protocol !== 'https:') return fallback;
  if (!ALLOWED_LLM_HOSTS.has(u.hostname.toLowerCase())) return fallback;
  return `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
}


const DEPTH_AGENTS: Record<string, AgentId[]> = {
  quick: ['bull', 'bear', 'pm'],
  standard: ['bull', 'bear', 'regime', 'risk', 'trader', 'pm'],
  // 'deep' previously ran the exact same five agents as 'standard' — only
  // the per-agent word limit differed. QUANT gives deep a genuinely
  // distinct roster: a dedicated orderflow/derivatives-positioning read
  // that bull/bear only touch in passing today.
  deep: ['bull', 'bear', 'quant', 'regime', 'risk', 'trader', 'pm'],
};

const LENGTH: Record<string, string> = {
  quick: 'Be terse: max 90 words.',
  standard: 'Max 160 words. Dense, no filler.',
  deep: 'Max 320 words. Go deep on mechanics, flows and second-order effects.',
};

function agentPrompt(agent: AgentId, depth: string): string {
  const len = LENGTH[depth] ?? LENGTH.standard;
  const base =
    'You are an agent on a professional crypto trading desk reading a live on-chain/CEX whale-radar feed. ' +
    'Speak like a desk analyst on a terminal: concrete, numeric, no hedging boilerplate, no disclaimers. ' +
    'Cite the actual numbers from the DESK DATA. ' + len;
  switch (agent) {
    case 'bull':
      return base + ' ROLE: BULL RESEARCHER. Build the strongest honest long case: whale accumulation, volume expansion, funding/OI positioning, liquidity, narrative. Flag if the long case is weak.';
    case 'bear':
      return base + ' ROLE: BEAR RESEARCHER. Build the short / do-not-touch case: wash trading, rug vectors, holder concentration, mint/freeze authority, manipulation patterns, thin liquidity, distribution.';
    case 'quant':
      return base + ' ROLE: QUANT DESK. Ignore narrative — read pure orderflow and derivatives positioning: perp funding rate (positive = longs paying shorts, crowded-long tell), open interest trend, and the buy/sell $ imbalance in RECENT WHALE TRADES. State the imbalance ratio and funding number explicitly, then one line on what the positioning implies (squeeze risk, crowded trade, neutral). Say "NO EDGE — insufficient orderflow data" if funding/OI/whale-trade data is too thin to read.';
    case 'regime':
      return base + ' ROLE: REGIME DESK. Ignore this token\'s own chart — read the market-WIDE regime block in DESK DATA (score, confirmed regime, held snapshots, agreeing/active signals, reasons). State plainly what regime we are in right now, how long it has held, and — critically — what would INVALIDATE that read (which signal(s) flipping, or the score crossing which threshold, would flip the regime). Then one line on how that regime context should color this specific token\'s setup (e.g. late-bull distribution regime makes an aggressive long riskier even if the token-level signal is strong). Say "REGIME UNAVAILABLE — no market-wide read this tick" if the regime block is missing.';
    case 'risk':
      return base + ' ROLE: RISK DESK. Output three labelled voices that actually disagree: "AGGRESSIVE:", "NEUTRAL:", "CONSERVATIVE:" — each 1-3 sentences on position size and risk, then "RISK DESK CONSENSUS:" with one line.';
    case 'trader':
      return base + ' ROLE: TRADER. Synthesize bull, bear and risk desk into an executable plan: direction, entry zone, invalidation, stop, targets, time horizon. Say AVOID plainly if the setup is untradeable.';
    case 'pm':
      return base + ' ROLE: PORTFOLIO MANAGER. Final authority. You may override the trader on risk grounds. Use MEMORY of past councils on this token and their realized performance.';
  }
}

function buildBrief(ctx: Record<string, any>, memory: any[]): string {
  const b = ctx.birdeye ?? {};
  const lines = [
    `TOKEN: ${ctx.symbol} ${ctx.name ? `(${ctx.name})` : ''}`,
    `PRICE: $${ctx.price} | 24H CHANGE: ${ctx.change24h}%`,
    `VOLUME 24H: $${ctx.volume} | MCAP: $${ctx.mcap} | VOL/MCAP: ${ctx.vmcapPct}%`,
    ctx.volSpike ? `VOLUME SPIKE vs last scan: ${ctx.volSpike}x` : '',
    `WHALE SCORE: ${ctx.whaleScore}/100 | THREAT: ${ctx.threat} | PATTERN: ${ctx.manipulationPattern ?? 'none'}`,
    `WHALE REASONS: ${(ctx.whaleReasons ?? []).join(' | ') || 'none'}`,
    `CEO SIGNAL: ${ctx.ceoSignal}`,
    ctx.dex ? `DEX LIQUIDITY: $${ctx.dex.liq} across ${ctx.dex.pairs} pairs` : 'DEX LIQUIDITY: unavailable',
    Object.keys(b).length
      ? `BIRDEYE: rugScore=${b.rugScore ?? '?'} top10=${b.top10pct ?? '?'}% creator=${b.creatorPct ?? '?'}% mintable=${b.isMintable} freezable=${b.isFreezable} lpBurned=${b.lpBurned ?? '?'} ageDays=${b.ageDays ?? '?'}`
      : 'BIRDEYE: unavailable',
    ctx.hyperliquid
      ? `HYPERLIQUID: funding=${ctx.hyperliquid.fundingRate} OI=${ctx.hyperliquid.openInterest} mark=${ctx.hyperliquid.markPrice}`
      : 'HYPERLIQUID: no perp data',
    `RECENT WHALE TRADES: ${
      (ctx.recentWhaleTrades ?? [])
        .slice(0, 12)
        .map((t: any) => `${t.side} $${Math.round(t.usdt)} @${t.ex}`)
        .join(', ') || 'none in feed'
    }`,
    ctx.regime
      ? `MARKET REGIME: ${ctx.regime.confirmedRegime ?? ctx.regime.regime} (score ${ctx.regime.score}/100, held ${ctx.regime.heldSnapshots} snapshots, ${ctx.regime.agreeing}/${ctx.regime.active} signals agreeing)${ctx.regime.confirmedRegime && ctx.regime.confirmedRegime !== ctx.regime.regime ? ` [live read currently flickering to ${ctx.regime.regime}]` : ''} | REASONS: ${(ctx.regime.reasons ?? []).join(' | ') || 'none'}`
      : 'MARKET REGIME: unavailable this tick',
  ].filter(Boolean);

  if (memory?.length) {
    lines.push('--- MEMORY: PAST COUNCILS ON THIS TOKEN ---');
    for (const m of memory.slice(0, 5)) {
      const perf = m.performance && Object.keys(m.performance).length
        ? Object.entries(m.performance).map(([k, v]) => `${k}:${v}%`).join(' ')
        : 'no realized perf yet';
      lines.push(
        `[${m.createdAt}] ${m.finalVerdict} conv=${m.conviction} @ $${m.priceAt ?? '?'} → ${perf}${m.reflection ? ` | reflection: ${m.reflection}` : ''}`,
      );
    }
  }
  return lines.join('\n');
}

const DECISION_INSTRUCTIONS = `
After your analysis, output a final line break and then ONLY a JSON object (no code fences, no prose after it) matching exactly:
{"symbol":string,"finalVerdict":"STRONG_LONG"|"LONG"|"NEUTRAL"|"SHORT"|"STRONG_SHORT"|"AVOID","conviction":number,"summary":string,"bullCase":string,"bearCase":string,"riskAssessment":string,"keyCatalysts":string[],"keyRisks":string[],"suggestedSize":"small"|"medium"|"large"|"none","entryZone":string,"stopLoss":string,"targets":string[],"invalidation":string,"timeHorizon":"scalp"|"intraday"|"swing"|"position","relatedWhaleSignals":string[],"manipulationFlags":string[]}
conviction is 0-100. Keep each string under 400 chars.`;

// ── Streaming callers ────────────────────────────────────────────────────────

async function* sseLines(res: Response): AsyncGenerator<string> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const parts = buf.split('\n');
    buf = parts.pop() ?? '';
    for (const line of parts) {
      const t = line.trim();
      if (t.startsWith('data:')) yield t.slice(5).trim();
    }
  }
}

async function streamAgent(
  system: string,
  user: string,
  llm: LlmConfig,
  lovableKey: string | undefined,
  onDelta: (t: string) => void,
): Promise<string> {
  const provider = llm.provider && llm.apiKey ? llm.provider : 'lovable';
  let full = '';

  if (provider === 'anthropic') {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': llm.apiKey!,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: llm.model || 'claude-sonnet-4-20250514',
        max_tokens: 1600,
        stream: true,
        system,
        messages: [{ role: 'user', content: user }],
      }),
    });
    if (!res.ok || !res.body) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    for await (const data of sseLines(res)) {
      if (data === '[DONE]') break;
      try {
        const e = JSON.parse(data);
        const t = e?.delta?.text;
        if (typeof t === 'string' && t) { full += t; onDelta(t); }
      } catch { /* ignore */ }
    }
    return full;
  }

  if (provider !== 'lovable') {
    const base = resolveBaseUrl(provider, llm.baseUrl);
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${llm.apiKey}` },
      body: JSON.stringify({
        model: llm.model || 'gpt-4o-mini',
        stream: true,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!res.ok || !res.body) throw new Error(`LLM ${res.status}: ${await res.text()}`);
    for await (const data of sseLines(res)) {
      if (data === '[DONE]') break;
      try {
        const e = JSON.parse(data);
        const t = e?.choices?.[0]?.delta?.content;
        if (typeof t === 'string' && t) { full += t; onDelta(t); }
      } catch { /* ignore */ }
    }
    return full;
  }

  // Default: Lovable AI Gateway Responses API (always streaming).
  const res = await fetch(LOVABLE_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'Lovable-API-Key': lovableKey ?? '',
      'X-Lovable-AIG-SDK': 'fetch',
    },
    body: JSON.stringify({
      model: llm.model || DEFAULT_MODEL,
      stream: true,
      instructions: system,
      input: user,
      reasoning: { effort: 'low', summary: 'auto' },
    }),
  });
  if (res.status === 429) throw new Error('RATE_LIMIT: AI gateway rate limit — wait a moment and re-run the council.');
  if (res.status === 402) throw new Error('NO_CREDITS: AI credits exhausted — top up in workspace settings.');
  if (!res.ok || !res.body) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  for await (const data of sseLines(res)) {
    if (data === '[DONE]') break;
    try {
      const e = JSON.parse(data);
      if (e?.type === 'response.output_text.delta' && typeof e.delta === 'string') {
        full += e.delta;
        onDelta(e.delta);
      }
    } catch { /* ignore */ }
  }
  return full;
}

function extractJson(text: string): any | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '');
  const start = cleaned.lastIndexOf('{');
  if (start === -1) return null;
  // Walk back through candidate objects until one parses.
  let idx = start;
  while (idx !== -1) {
    const candidate = cleaned.slice(idx);
    try { return JSON.parse(candidate); } catch { /* keep searching */ }
    // try trimming to matching brace
    let depth = 0;
    for (let i = 0; i < candidate.length; i++) {
      if (candidate[i] === '{') depth++;
      else if (candidate[i] === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(candidate.slice(0, i + 1)); } catch { /* ignore */ }
          break;
        }
      }
    }
    idx = cleaned.lastIndexOf('{', idx - 1);
  }
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

  let body: any;
  try { body = await req.json(); } catch { body = null; }
  if (!body?.context?.symbol) {
    return new Response(JSON.stringify({ error: 'context.symbol required' }), {
      status: 400,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    });
  }

  const ctx = body.context;
  const depth: string = DEPTH_AGENTS[body.depth] ? body.depth : 'standard';
  const memory = Array.isArray(body.memory) ? body.memory : [];
  const llm: LlmConfig = body.llm ?? {};
  const lovableKey = Deno.env.get('LOVABLE_API_KEY');

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

      try {
        const brief = buildBrief(ctx, memory);
        const transcript: { agent: AgentId; text: string }[] = [];

        for (const agent of DEPTH_AGENTS[depth]) {
          send({ type: 'agent_start', agent });
          const prior = transcript.length
            ? '\n\n--- DESK TRANSCRIPT SO FAR ---\n' +
              transcript.map((t) => `[${t.agent.toUpperCase()}]\n${t.text}`).join('\n\n')
            : '';
          const user =
            `--- DESK DATA ---\n${brief}${prior}\n\n` +
            (agent === 'pm'
              ? `Deliver the final verdict.${DECISION_INSTRUCTIONS}`
              : 'Deliver your section now.');

          const text = await streamAgent(
            agentPrompt(agent, depth),
            user,
            llm,
            lovableKey,
            (t) => send({ type: 'delta', agent, text: t }),
          );
          transcript.push({ agent, text });
          send({ type: 'agent_end', agent });
        }

        const pmText = transcript[transcript.length - 1]?.text ?? '';
        const parsed = extractJson(pmText);
        if (!parsed) {
          send({ type: 'error', message: 'Portfolio Manager did not return a structured decision.' });
        } else {
          const decision = {
            symbol: ctx.symbol,
            timestamp: new Date().toISOString(),
            finalVerdict: parsed.finalVerdict ?? 'NEUTRAL',
            conviction: Math.max(0, Math.min(100, Number(parsed.conviction) || 0)),
            summary: String(parsed.summary ?? ''),
            bullCase: String(parsed.bullCase ?? transcript.find((t) => t.agent === 'bull')?.text ?? ''),
            bearCase: String(parsed.bearCase ?? transcript.find((t) => t.agent === 'bear')?.text ?? ''),
            riskAssessment: String(parsed.riskAssessment ?? ''),
            keyCatalysts: Array.isArray(parsed.keyCatalysts) ? parsed.keyCatalysts.map(String) : [],
            keyRisks: Array.isArray(parsed.keyRisks) ? parsed.keyRisks.map(String) : [],
            suggestedSize: parsed.suggestedSize ?? 'none',
            entryZone: parsed.entryZone ? String(parsed.entryZone) : undefined,
            stopLoss: parsed.stopLoss ? String(parsed.stopLoss) : undefined,
            targets: Array.isArray(parsed.targets) ? parsed.targets.map(String) : [],
            invalidation: String(parsed.invalidation ?? ''),
            timeHorizon: parsed.timeHorizon ?? 'swing',
            relatedWhaleSignals: Array.isArray(parsed.relatedWhaleSignals)
              ? parsed.relatedWhaleSignals.map(String)
              : (ctx.whaleReasons ?? []),
            manipulationFlags: Array.isArray(parsed.manipulationFlags)
              ? parsed.manipulationFlags.map(String)
              : (ctx.manipulationPattern ? [ctx.manipulationPattern] : []),
          };
          send({ type: 'decision', decision });
        }
      } catch (err) {
        send({ type: 'error', message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      ...corsHeaders,
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    },
  });
});
