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
  DeskTrackRecord,
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
    // Writes go through council-persist, but the server must prove that this
    // decision was actually emitted by agent-council. The publishable key is
    // intentionally not trusted as an authorization credential for writes.
    const persistProof = decision.persistProof;
    if (!persistProof?.issuedAt || !persistProof.signature) {
      console.warn('[council] save rejected: missing server persistence proof');
      return null;
    }
    const { persistProof: _proof, ...decisionForStorage } = decision;
    const { data, error } = await supabase.functions.invoke('council-persist', {
      body: {
        action: 'save',
        payload: {
          symbol: decision.symbol,
          token_id: ctx.tokenId ?? null,
          depth,
          final_verdict: decision.finalVerdict,
          conviction: decision.conviction,
          decision: JSON.parse(JSON.stringify(decisionForStorage)),
          context: JSON.parse(JSON.stringify(ctx)),
          transcript: JSON.parse(JSON.stringify(transcript)),
          price_at: ctx.price,
          reflection,
          persist_proof: persistProof,
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

/**
 * Run one autonomous Council cycle without rendering the Council panel.
 * Persistence remains the same signed server->persist path as manual Council.
 *
 * Freshness is enforced here as the final guard: a symbol is not re-run
 * while its newest persisted decision is still inside the 30-minute feed SLA.
 */
export async function runAutonomousCouncil(
  ctx: CouncilContext,
  llm: CouncilLlmSettings,
  depth: CouncilDepth = 'quick',
): Promise<string | null> {
  const existing = await loadCouncilMemory(ctx.symbol, 1);
  const latest = existing[0];
  if (latest) {
    const ageMs = Date.now() - new Date(latest.createdAt).getTime();
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < 30 * 60 * 1000) {
      return null;
    }
  }

  const memory = await refreshMemoryPerformance(
    await loadCouncilMemory(ctx.symbol),
    ctx.price,
  );
  const reflection = buildReflection(memory);
  const transcriptByAgent = new Map<AgentId, string>();
  let decision: CouncilDecision | null = null;

  await runCouncil(
    ctx,
    depth,
    memory,
    llm,
    {
      onAgentStart: (agent) => {
        transcriptByAgent.set(agent, '');
      },
      onDelta: (agent, text) => {
        transcriptByAgent.set(agent, (transcriptByAgent.get(agent) ?? '') + text);
      },
      onAgentEnd: () => {},
      onDecision: (d) => {
        decision = d;
      },
      onError: (message) => {
        console.warn('[council-auto] run failed:', message);
      },
    },
  );

  if (!decision) return null;

  const transcript = Array.from(transcriptByAgent.entries())
    .map(([agent, text]) => ({ agent, text }));
  const id = await saveCouncilDecision(decision, ctx, transcript, depth, reflection);

  if (id) {
    console.info('[council-auto] persisted', ctx.symbol, id);
  } else {
    console.warn('[council-auto] decision produced but persistence failed', ctx.symbol);
  }
  return id;
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
      ageMs >= 30 * 864e5 ? '30d' :
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
/** Longest-elapsed-time bucket available — the most conclusive read on
 *  whether a thesis played out, not the first one computed (which is
 *  usually just the noisy 1h figure). */
const BUCKET_HORIZON_ORDER = ['30d', '7d', '24h', '4h', '1h'] as const;
function longestAvailableBucket(performance: Record<string, number | null>): [string, number] | null {
  for (const key of BUCKET_HORIZON_ORDER) {
    const v = performance[key];
    if (v != null) return [key, v];
  }
  return null;
}

function wasDirectionallyCorrect(verdict: CouncilMemoryEntry['finalVerdict'], ret: number): boolean | null {
  const bullish = verdict === 'LONG' || verdict === 'STRONG_LONG';
  const bearish = verdict === 'SHORT' || verdict === 'STRONG_SHORT';
  if (bullish) return ret > 0;
  if (bearish) return ret < 0;
  if (verdict === 'AVOID') return ret <= 0;
  return null; // NEUTRAL made no directional claim — nothing to grade
}

const MIN_CONFIDENT_CALLS = 5; // graded calls needed before the score isn't pulled toward the 50 baseline

/** Shared by buildReflection() (narrative) and computeDeskTrackRecord()
 *  (structured badge) so both grade calls the exact same way — longest
 *  available horizon, NEUTRAL excluded — rather than drifting apart. */
function gradeCalls(entries: CouncilMemoryEntry[]): { verdict: CouncilMemoryEntry['finalVerdict']; ret: number; correct: boolean }[] {
  const scored = entries.filter(e => Object.keys(e.performance ?? {}).length > 0 && e.finalVerdict !== 'NEUTRAL');
  const graded: { verdict: CouncilMemoryEntry['finalVerdict']; ret: number; correct: boolean }[] = [];
  for (const e of scored) {
    const longest = longestAvailableBucket(e.performance);
    if (!longest) continue;
    const correct = wasDirectionallyCorrect(e.finalVerdict, longest[1] ?? 0);
    if (correct === null) continue;
    graded.push({ verdict: e.finalVerdict, ret: longest[1] ?? 0, correct });
  }
  return graded;
}

export function buildReflection(entries: CouncilMemoryEntry[]): string | null {
  const scored = entries.filter(e => Object.keys(e.performance ?? {}).length > 0);
  if (!scored.length) return null;
  const lines = scored.slice(0, 4).map((e) => {
    // "Most notable" (largest-magnitude) move for the narrative line — a
    // big swing either way is the most tellable data point about this call.
    const best = Object.entries(e.performance).sort(
      (a, b) => Math.abs((b[1] ?? 0)) - Math.abs((a[1] ?? 0)),
    )[0];
    const ret = best?.[1] ?? 0;
    const right = wasDirectionallyCorrect(e.finalVerdict, ret);
    const tag = right === null ? 'N/A' : right ? 'CORRECT' : 'WRONG';
    return `${new Date(e.createdAt).toLocaleDateString()} · ${e.finalVerdict} (conv ${e.conviction}) → ${best?.[0]} ${ret}% · ${tag}`;
  });
  // "Hits" (the headline track-record stat) grades against the LONGEST
  // available horizon instead of an arbitrary bucket, and excludes NEUTRAL
  // calls entirely (previously graded as if they were bearish, which
  // artificially dragged the hit rate around for calls with no direction
  // to actually get right or wrong).
  const graded = gradeCalls(entries);
  const hits = graded.filter(g => g.correct).length;
  const headline = graded.length > 0
    ? `Desk track record on this token: ${hits}/${graded.length} directionally correct.`
    : `Desk track record on this token: no directional calls to grade yet (NEUTRAL only).`;
  return `${headline}\n${lines.join('\n')}`;
}

/** Structured counterpart to buildReflection() — same grading, meant for a
 *  UI badge rather than text folded into the PM's prompt. See
 *  DeskTrackRecord's docstring for the scoring rationale. */
export function computeDeskTrackRecord(entries: CouncilMemoryEntry[]): DeskTrackRecord {
  const graded = gradeCalls(entries);
  if (graded.length === 0) {
    return { gradedCalls: 0, hits: 0, hitRate: null, avgReturnPct: null, score: null };
  }
  const hits = graded.filter(g => g.correct).length;
  const hitRate = hits / graded.length;
  const avgReturnPct = +(graded.reduce((s, g) => s + g.ret, 0) / graded.length).toFixed(2);
  const confidence = Math.min(1, graded.length / MIN_CONFIDENT_CALLS);
  const score = Math.round(hitRate * 100 * confidence + 50 * (1 - confidence));
  return { gradedCalls: graded.length, hits, hitRate, avgReturnPct, score };
}
