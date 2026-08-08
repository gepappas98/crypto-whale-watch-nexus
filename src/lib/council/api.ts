/* ══ AGENT COUNCIL — CLIENT SERVICE ═══════════════════════════════════════════
 *  Streaming debate + Supabase persistence + memory/reflection layer.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { supabase } from '@/integrations/supabase/client';
import type {
  AgentId,
  CouncilContext,
  CouncilDecision,
  CouncilDepth,
  CouncilMemoryEntry,
  CouncilStreamEvent,
} from '@/types/council';

const FN_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/agent-council`;
const ANON = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export interface CouncilLlmSettings {
  provider: 'lovable' | 'anthropic' | 'openai' | 'openrouter' | 'groq' | 'custom';
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export const DEFAULT_LLM: CouncilLlmSettings = { provider: 'lovable' };

// ── Streaming run ────────────────────────────────────────────────────────────

export async function runCouncil(
  ctx: CouncilContext,
  depth: CouncilDepth,
  memory: CouncilMemoryEntry[],
  llm: CouncilLlmSettings,
  handlers: {
    onAgentStart: (a: AgentId) => void;
    onDelta: (a: AgentId, text: string) => void;
    onAgentEnd: (a: AgentId) => void;
    onDecision: (d: CouncilDecision) => void;
    onError: (msg: string) => void;
  },
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(FN_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        apikey: ANON,
        authorization: `Bearer ${ANON}`,
      },
      body: JSON.stringify({
        context: ctx,
        depth,
        memory,
        llm: llm.provider === 'lovable' ? { provider: 'lovable', model: llm.model } : llm,
      }),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return;
    handlers.onError('Council unreachable — check connectivity.');
    return;
  }

  if (!res.ok || !res.body) {
    handlers.onError(`Council failed (${res.status}).`);
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch {
      return;
    }
    if (chunk.done) break;
    buf += dec.decode(chunk.value, { stream: true });
    const parts = buf.split('\n\n');
    buf = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith('data:')) continue;
      let ev: CouncilStreamEvent;
      try {
        ev = JSON.parse(line.slice(5).trim());
      } catch {
        continue;
      }
      switch (ev.type) {
        case 'agent_start': handlers.onAgentStart(ev.agent); break;
        case 'delta': handlers.onDelta(ev.agent, ev.text); break;
        case 'agent_end': handlers.onAgentEnd(ev.agent); break;
        case 'decision': handlers.onDecision(ev.decision); break;
        case 'error': handlers.onError(ev.message); break;
      }
    }
  }
}

// ── Persistence ──────────────────────────────────────────────────────────────

export async function saveCouncilDecision(
  decision: CouncilDecision,
  ctx: CouncilContext,
  transcript: { agent: AgentId; text: string }[],
  depth: CouncilDepth,
  reflection: string | null,
): Promise<string | null> {
  try {
    // Writes go through the council-persist edge function (service role).
    // Direct client INSERTs are blocked by RLS so decisions can't be forged.
    const { data, error } = await supabase.functions.invoke('council-persist', {
      body: {
        action: 'save',
        payload: {
          symbol: decision.symbol,
          token_id: ctx.tokenId ?? null,
          depth,
          final_verdict: decision.finalVerdict,
          conviction: decision.conviction,
          decision: JSON.parse(JSON.stringify(decision)),
          context: JSON.parse(JSON.stringify(ctx)),
          transcript: JSON.parse(JSON.stringify(transcript)),
          price_at: ctx.price,
          reflection,
        },
      },
    });
    if (error) {
      console.warn('[council] save failed:', error.message);
      return null;
    }
    return (data as { id?: string } | null)?.id ?? null;
  } catch (e) {
    console.warn('[council] save threw:', e);
    return null;
  }
}

export async function loadCouncilMemory(symbol: string, limit = 6): Promise<CouncilMemoryEntry[]> {
  try {
    const { data, error } = await supabase
      .from('council_decisions')
      .select('id, created_at, final_verdict, conviction, decision, price_at, performance, reflection')
      .eq('symbol', symbol.toUpperCase())
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error || !data) return [];
    return data.map((r) => ({
      id: r.id as string,
      createdAt: r.created_at as string,
      finalVerdict: r.final_verdict as CouncilMemoryEntry['finalVerdict'],
      conviction: (r.conviction as number) ?? 0,
      summary: ((r.decision as Record<string, unknown>)?.summary as string) ?? '',
      priceAt: (r.price_at as number) ?? null,
      performance: (r.performance as Record<string, number | null>) ?? {},
      reflection: (r.reflection as string) ?? null,
    }));
  } catch {
    return [];
  }
}

/** Compute realized performance buckets for past decisions against the live price. */
export async function refreshMemoryPerformance(
  entries: CouncilMemoryEntry[],
  livePrice: number,
): Promise<CouncilMemoryEntry[]> {
  if (!livePrice || !entries.length) return entries;
  const now = Date.now();
  const updated: CouncilMemoryEntry[] = [];
  for (const e of entries) {
    if (!e.priceAt) { updated.push(e); continue; }
    const ageMs = now - new Date(e.createdAt).getTime();
    const bucket =
      ageMs >= 7 * 864e5 ? '7d' :
      ageMs >= 864e5 ? '24h' :
      ageMs >= 4 * 36e5 ? '4h' :
      ageMs >= 36e5 ? '1h' : null;
    if (!bucket) { updated.push(e); continue; }
    const ret = Number((((livePrice - e.priceAt) / e.priceAt) * 100).toFixed(2));
    const perf = { ...e.performance, [bucket]: ret };
    updated.push({ ...e, performance: perf });
    if (e.performance?.[bucket] !== ret) {
      // Persisted value is recomputed server-side from a server-fetched price;
      // the local figure above is only used for immediate display.
      supabase.functions
        .invoke('council-persist', { body: { action: 'update_performance', id: e.id } })
        .then(({ error }) => { if (error) console.warn('[council] perf update:', error.message); });
    }
  }
  return updated;
}

/** Deterministic local reflection over past councils — injected into the PM prompt. */
export function buildReflection(entries: CouncilMemoryEntry[]): string | null {
  const scored = entries.filter(e => Object.keys(e.performance ?? {}).length > 0);
  if (!scored.length) return null;
  const lines = scored.slice(0, 4).map((e) => {
    const best = Object.entries(e.performance).sort(
      (a, b) => Math.abs((b[1] ?? 0)) - Math.abs((a[1] ?? 0)),
    )[0];
    const ret = best?.[1] ?? 0;
    const bullish = e.finalVerdict === 'LONG' || e.finalVerdict === 'STRONG_LONG';
    const bearish = e.finalVerdict === 'SHORT' || e.finalVerdict === 'STRONG_SHORT';
    const right = (bullish && (ret ?? 0) > 0) || (bearish && (ret ?? 0) < 0) ||
      (e.finalVerdict === 'AVOID' && (ret ?? 0) <= 0);
    return `${new Date(e.createdAt).toLocaleDateString()} · ${e.finalVerdict} (conv ${e.conviction}) → ${best?.[0]} ${ret}% · ${right ? 'CORRECT' : 'WRONG'}`;
  });
  const hits = scored.filter((e) => {
    const ret = Object.values(e.performance)[0] ?? 0;
    const bullish = e.finalVerdict === 'LONG' || e.finalVerdict === 'STRONG_LONG';
    return bullish ? (ret ?? 0) > 0 : (ret ?? 0) <= 0;
  }).length;
  return `Desk track record on this token: ${hits}/${scored.length} directionally correct.\n${lines.join('\n')}`;
}
