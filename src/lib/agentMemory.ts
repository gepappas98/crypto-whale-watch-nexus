/* ══ Agent Memory (lightweight persistence) ════════════════════════════════
 *  Stores outcomes of council / strategy decisions so future runs can bias
 *  toward historically better setups. Default backend: localStorage.
 *  Optional Supabase table `agent_memory` when a client is available —
 *  no pgvector required for v1 (keyword + symbol tags). Upgrade path:
 *  add embedding column later without changing callers.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { getSupabase } from "@/lib/supabase";

const LS_KEY = "wr_agent_memory_v1";
const MAX_LOCAL = 400;

export interface AgentMemoryEntry {
  id: string;
  ts: number;
  agent: string;
  symbol: string;
  side?: "long" | "short" | "flat";
  thesis: string;
  outcome?: "win" | "loss" | "scratch" | "unknown";
  pnlPct?: number;
  tags?: string[];
}

function loadLocal(): AgentMemoryEntry[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentMemoryEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocal(entries: AgentMemoryEntry[]): void {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(entries.slice(0, MAX_LOCAL)));
  } catch {
    /* quota */
  }
}

export function rememberDecision(
  entry: Omit<AgentMemoryEntry, "id" | "ts"> & { id?: string; ts?: number },
): AgentMemoryEntry {
  const full: AgentMemoryEntry = {
    id: entry.id || `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    ts: entry.ts || Date.now(),
    agent: entry.agent,
    symbol: entry.symbol,
    side: entry.side,
    thesis: entry.thesis,
    outcome: entry.outcome ?? "unknown",
    pnlPct: entry.pnlPct,
    tags: entry.tags,
  };

  const list = loadLocal();
  list.unshift(full);
  saveLocal(list);

  // Best-effort remote mirror
  void mirrorToSupabase(full);
  return full;
}

export function updateMemoryOutcome(
  id: string,
  outcome: AgentMemoryEntry["outcome"],
  pnlPct?: number,
): void {
  const list = loadLocal();
  const idx = list.findIndex((e) => e.id === id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], outcome, pnlPct };
    saveLocal(list);
  }
}

export function recallForSymbol(symbol: string, limit = 12): AgentMemoryEntry[] {
  const sym = symbol.toUpperCase();
  return loadLocal()
    .filter((e) => e.symbol.toUpperCase() === sym)
    .slice(0, limit);
}

export function recallWins(agent?: string, limit = 20): AgentMemoryEntry[] {
  return loadLocal()
    .filter((e) => e.outcome === "win" && (!agent || e.agent === agent))
    .slice(0, limit);
}

export function memorySummary(symbol: string): {
  wins: number;
  losses: number;
  avgWinPct: number;
  avgLossPct: number;
  lastThesis?: string;
} {
  const rows = recallForSymbol(symbol, 50);
  const wins = rows.filter((r) => r.outcome === "win");
  const losses = rows.filter((r) => r.outcome === "loss");
  const avg = (xs: AgentMemoryEntry[]) =>
    xs.length
      ? xs.reduce((s, x) => s + (x.pnlPct ?? 0), 0) / xs.length
      : 0;
  return {
    wins: wins.length,
    losses: losses.length,
    avgWinPct: avg(wins),
    avgLossPct: avg(losses),
    lastThesis: rows[0]?.thesis,
  };
}

async function mirrorToSupabase(entry: AgentMemoryEntry): Promise<void> {
  try {
    const sb = getSupabase();
    if (!sb) return;
    await sb.from("agent_memory").upsert({
      id: entry.id,
      ts: new Date(entry.ts).toISOString(),
      agent: entry.agent,
      symbol: entry.symbol,
      side: entry.side ?? null,
      thesis: entry.thesis,
      outcome: entry.outcome ?? "unknown",
      pnl_pct: entry.pnlPct ?? null,
      tags: entry.tags ?? [],
    });
  } catch {
    /* table may not exist yet — local remains source of truth */
  }
}
