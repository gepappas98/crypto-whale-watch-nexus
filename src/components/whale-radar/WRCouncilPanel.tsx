/* ══ AGENT COUNCIL — DEBATE PANEL ═════════════════════════════════════════════
 *  Live multi-agent trading desk. Streams the debate, then locks in a
 *  structured CouncilDecision and persists it with memory + reflection.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AGENT_META, DEPTH_AGENTS, type AgentId, type CouncilDecision, type CouncilDepth, type CouncilMemoryEntry } from '@/types/council';
import type { CoinData, WhaleTrade } from '@/lib/whaleRadarState';
import { buildCouncilContext } from '@/lib/council/context';
import type { RegimeReading } from '@/lib/regime/types';
import {
  buildReflection,
  computeDeskTrackRecord,
  loadCouncilMemory,
  refreshMemoryPerformance,
  runCouncil,
  saveCouncilDecision,
  type CouncilLlmSettings,
} from '@/lib/council/api';

interface Props {
  coin: CoinData;
  whaleTrades: WhaleTrade[];
  /** Current market-wide regime reading (from useRegimeEngine, lifted in
   *  Index.tsx). Optional/nullable — the council still runs without it,
   *  the REGIME DESK agent just says so. */
  regime?: RegimeReading | null;
  llm: CouncilLlmSettings;
  onClose: () => void;
  autoRun?: boolean;
}

const VERDICT_CLS: Record<string, string> = {
  STRONG_LONG: 'text-wr-green border-wr-green/60 bg-wr-green/10',
  LONG: 'text-wr-green-dim border-wr-green/40 bg-wr-green/5',
  NEUTRAL: 'text-wr-muted border-wr-border',
  SHORT: 'text-wr-orange border-wr-orange/40 bg-wr-orange/5',
  STRONG_SHORT: 'text-wr-red border-wr-red/60 bg-wr-red/10',
  AVOID: 'text-wr-red border-wr-red/60 bg-wr-red/10',
};

export function WRCouncilPanel({ coin, whaleTrades, regime, llm, onClose, autoRun }: Props) {
  const [depth, setDepth] = useState<CouncilDepth>('standard');
  const [running, setRunning] = useState(false);
  const [active, setActive] = useState<AgentId | null>(null);
  const [messages, setMessages] = useState<{ agent: AgentId; text: string; done: boolean }[]>([]);
  const [decision, setDecision] = useState<CouncilDecision | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memory, setMemory] = useState<CouncilMemoryEntry[]>([]);
  const [showMemory, setShowMemory] = useState(false);
  const trackRecord = useMemo(() => computeDeskTrackRecord(memory), [memory]);
  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const startedRef = useRef(false);

  // ── Memory load + realized performance ────────────────────────────────────
  useEffect(() => {
    let alive = true;
    loadCouncilMemory(coin.symbol).then(async (m) => {
      const withPerf = await refreshMemoryPerformance(m, coin.price);
      if (alive) setMemory(withPerf);
    });
    return () => { alive = false; };
  }, [coin.symbol, coin.price]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages, decision]);

  const start = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setDecision(null);
    setMessages([]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const ctx = buildCouncilContext(coin, { whaleTrades, regime });
    const mem = await loadCouncilMemory(coin.symbol);
    const memWithPerf = await refreshMemoryPerformance(mem, coin.price);
    const reflection = buildReflection(memWithPerf);
    setMemory(memWithPerf);

    const transcript: { agent: AgentId; text: string }[] = [];

    await runCouncil(
      ctx,
      depth,
      memWithPerf,
      llm,
      {
        onAgentStart: (a) => {
          setActive(a);
          setMessages(prev => [...prev, { agent: a, text: '', done: false }]);
        },
        onDelta: (a, t) => {
          setMessages(prev => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].agent === a && !next[i].done) { next[i] = { ...next[i], text: next[i].text + t }; break; }
            }
            return next;
          });
        },
        onAgentEnd: (a) => {
          setActive(null);
          setMessages(prev => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i--) {
              if (next[i].agent === a && !next[i].done) {
                next[i] = { ...next[i], done: true };
                transcript.push({ agent: a, text: next[i].text });
                break;
              }
            }
            return next;
          });
        },
        onDecision: (d) => {
          setDecision(d);
          saveCouncilDecision(d, ctx, transcript, depth, reflection).then((id) => {
            if (id) loadCouncilMemory(coin.symbol).then(setMemory);
          });
        },
        onError: (m) => setError(m),
      },
      ctrl.signal,
    );

    setRunning(false);
    setActive(null);
  }, [coin, whaleTrades, regime, depth, llm, running]);

  useEffect(() => {
    if (autoRun && !startedRef.current) {
      startedRef.current = true;
      void start();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRun]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const verdictCls = decision ? VERDICT_CLS[decision.finalVerdict] ?? VERDICT_CLS.NEUTRAL : '';

  return (
    <div
      className="fixed inset-0 bg-black/90 z-[600] flex items-center justify-center animate-modal-fade"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-wr-bg2 border border-wr-border border-t-2 border-t-wr-purple w-[96%] max-w-[900px] max-h-[88vh] flex flex-col animate-modal-up">
        {/* Header */}
        <div className="px-4 py-3 border-b border-wr-border bg-wr-bg3 flex items-center justify-between gap-2 flex-shrink-0">
          <div className="font-head text-[10px] tracking-[3px] text-wr-purple">
            ★ AGENT COUNCIL — {coin.symbol}
            <span className="text-wr-muted ml-2 tracking-normal">
              score {Math.round(coin.score ?? 0)} · {coin.threat} · vol/mcap {Math.round(coin.vmcap ?? 0)}%
            </span>
          </div>
          <button className="text-wr-muted hover:text-wr-red text-lg bg-transparent border-none font-mono" onClick={onClose}>✕</button>
        </div>

        {/* Controls */}
        <div className="px-4 py-2 border-b border-wr-border bg-wr-bg flex flex-wrap items-center gap-2">
          <span className="text-[8px] text-wr-green-dim tracking-[2px]">DEPTH</span>
          {(['quick', 'standard', 'deep'] as CouncilDepth[]).map(d => (
            <button
              key={d}
              disabled={running}
              className={`wr-btn text-[8px] ${depth === d ? 'active' : ''}`}
              onClick={() => setDepth(d)}
            >
              {d.toUpperCase()}
            </button>
          ))}
          <button className="wr-btn ai text-[8px]" disabled={running} onClick={() => void start()}>
            {running ? '⟳ DEBATING…' : messages.length ? '↻ RE-RUN COUNCIL' : '▶ CONVENE COUNCIL'}
          </button>
          {running && (
            <button className="wr-btn text-[8px]" onClick={() => { abortRef.current?.abort(); setRunning(false); }}>
              ■ ABORT
            </button>
          )}
          <button className="wr-btn text-[8px] ml-auto" onClick={() => setShowMemory(s => !s)}>
            🗂 MEMORY ({memory.length})
          </button>
          {trackRecord.gradedCalls > 0 && (
            <span
              className={`text-[8px] px-1.5 py-0.5 border font-mono tracking-widest cursor-help
                ${(trackRecord.score ?? 50) >= 60 ? 'border-wr-green text-wr-green' : (trackRecord.score ?? 50) <= 40 ? 'border-wr-red text-wr-red' : 'border-wr-border text-wr-muted'}`}
              title={`Graded at each call's longest available realized-return horizon (up to 30d), NEUTRAL calls excluded. ${trackRecord.gradedCalls} < ${5} graded calls means this is still confidence-discounted toward 50.`}
            >
              🎯 {trackRecord.score} · {trackRecord.hits}/{trackRecord.gradedCalls} hit{trackRecord.avgReturnPct != null ? ` · avg ${trackRecord.avgReturnPct >= 0 ? '+' : ''}${trackRecord.avgReturnPct}%` : ''}
            </span>
          )}
        </div>

        {/* Body */}
        <div ref={logRef} className="p-4 overflow-y-auto flex-1 scrollbar-thin space-y-3">
          {showMemory && (
            <div className="border border-wr-border bg-wr-bg3 p-3">
              <div className="text-[8px] text-wr-amber tracking-[2px] mb-2">PAST COUNCILS · {coin.symbol}</div>
              {trackRecord.gradedCalls > 0 && (
                <div className="text-[9px] text-wr-white mb-2 pb-2 border-b border-wr-border/50">
                  Longest-horizon track record: <span className="text-wr-cyan">{trackRecord.hits}/{trackRecord.gradedCalls} directionally correct</span>
                  {trackRecord.avgReturnPct != null && <span className="text-wr-muted"> · avg realized {trackRecord.avgReturnPct >= 0 ? '+' : ''}{trackRecord.avgReturnPct}%</span>}
                </div>
              )}
              {memory.length === 0 ? (
                <div className="text-[9px] text-wr-muted">No prior councils recorded for this token.</div>
              ) : memory.map(m => (
                <div key={m.id} className="text-[9px] text-wr-white border-b border-wr-border/50 py-1.5">
                  <span className="text-wr-muted">{new Date(m.createdAt).toLocaleString()}</span>{' '}
                  <span className={VERDICT_CLS[m.finalVerdict]?.split(' ')[0]}>{m.finalVerdict}</span>{' '}
                  <span className="text-wr-muted">conv {m.conviction} @ ${m.priceAt ?? '—'}</span>
                  {Object.keys(m.performance ?? {}).length > 0 && (
                    <span className="ml-2 text-wr-cyan">
                      {Object.entries(m.performance).map(([k, v]) => `${k} ${v}%`).join(' · ')}
                    </span>
                  )}
                  <div className="text-wr-muted mt-0.5">{m.summary}</div>
                </div>
              ))}
            </div>
          )}

          {messages.length === 0 && !running && (
            <div className="text-[10px] text-wr-muted leading-relaxed">
              The {depth.toUpperCase()} council convenes {DEPTH_AGENTS[depth].length} agents —{' '}
              {DEPTH_AGENTS[depth].map((a, i) => (
                <span key={a}>
                  {i > 0 && (i === DEPTH_AGENTS[depth].length - 1 ? ' and ' : ', ')}
                  <span className={AGENT_META[a].color}>{AGENT_META[a].label}</span>
                </span>
              ))}{' '}
              over live whale, manipulation, liquidity and perp data for{' '}
              <span className="text-wr-green">{coin.symbol}</span>. Pick a depth and convene.
            </div>
          )}

          {messages.map((m, i) => {
            const meta = AGENT_META[m.agent];
            return (
              <div key={`${m.agent}-${i}`} className="border border-wr-border bg-wr-bg3">
                <div className="px-3 py-1.5 border-b border-wr-border flex items-center gap-2 bg-wr-bg">
                  <span className={`text-[10px] ${meta.color}`}>{meta.glyph}</span>
                  <span className={`text-[9px] tracking-[2px] ${meta.color}`}>{meta.label}</span>
                  <span className="text-[8px] text-wr-muted">{meta.role}</span>
                  {!m.done && <span className="text-[8px] text-wr-amber animate-pulse ml-auto">streaming…</span>}
                </div>
                <div className="px-3 py-2 text-[10px] text-wr-white whitespace-pre-wrap leading-relaxed">
                  {m.text.replace(/\{[\s\S]*$/, '').trim() || (active === m.agent ? '▍' : '')}
                </div>
              </div>
            );
          })}

          {error && (
            <div className="border border-wr-red/60 bg-wr-red/10 text-wr-red text-[10px] p-3">⚠ {error}</div>
          )}

          {decision && (
            <div className={`border-2 p-3 ${verdictCls}`}>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="font-head text-[13px] tracking-[3px]">{decision.finalVerdict.replace('_', ' ')}</div>
                <div className="text-[9px]">
                  SIZE <span className="font-bold">{decision.suggestedSize.toUpperCase()}</span> ·{' '}
                  HORIZON <span className="font-bold">{decision.timeHorizon.toUpperCase()}</span>
                </div>
              </div>

              {/* Conviction meter */}
              <div className="mt-2">
                <div className="flex justify-between text-[8px] text-wr-muted tracking-[2px]">
                  <span>CONVICTION</span><span>{decision.conviction}/100</span>
                </div>
                <div className="h-1.5 bg-wr-bg border border-wr-border mt-1">
                  <div
                    className="h-full bg-current transition-all duration-500"
                    style={{ width: `${decision.conviction}%` }}
                  />
                </div>
              </div>

              <div className="text-[10px] text-wr-white mt-3 leading-relaxed">{decision.summary}</div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <Field label="BULL CASE" cls="text-wr-green">{decision.bullCase}</Field>
                <Field label="BEAR CASE" cls="text-wr-red">{decision.bearCase}</Field>
                <Field label="RISK ASSESSMENT" cls="text-wr-amber">{decision.riskAssessment}</Field>
                <Field label="INVALIDATION" cls="text-wr-orange">{decision.invalidation}</Field>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[9px]">
                <Stat label="ENTRY" value={decision.entryZone || '—'} />
                <Stat label="STOP" value={decision.stopLoss || '—'} />
                <Stat label="TARGETS" value={decision.targets?.join(' / ') || '—'} />
                <Stat label="SIZE" value={decision.suggestedSize} />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
                <List label="KEY CATALYSTS" items={decision.keyCatalysts} cls="text-wr-green-dim" />
                <List label="KEY RISKS" items={decision.keyRisks} cls="text-wr-red" />
                <List label="WHALE SIGNALS" items={decision.relatedWhaleSignals} cls="text-wr-cyan" />
                <List label="MANIPULATION FLAGS" items={decision.manipulationFlags} cls="text-wr-orange" />
              </div>

              <div className="text-[8px] text-wr-muted mt-3 tracking-widest">
                {new Date(decision.timestamp).toLocaleString()} · persisted to council memory
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, cls, children }: { label: string; cls: string; children: React.ReactNode }) {
  return (
    <div className="border border-wr-border bg-wr-bg p-2">
      <div className={`text-[8px] tracking-[2px] mb-1 ${cls}`}>{label}</div>
      <div className="text-[9px] text-wr-white leading-relaxed">{children || '—'}</div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-wr-border bg-wr-bg p-2">
      <div className="text-[8px] text-wr-muted tracking-[2px]">{label}</div>
      <div className="text-wr-white truncate">{value}</div>
    </div>
  );
}

function List({ label, items, cls }: { label: string; items: string[]; cls: string }) {
  return (
    <div className="border border-wr-border bg-wr-bg p-2">
      <div className={`text-[8px] tracking-[2px] mb-1 ${cls}`}>{label}</div>
      {items?.length ? (
        <ul className="text-[9px] text-wr-white space-y-0.5">
          {items.map((it, i) => <li key={i}>› {it}</li>)}
        </ul>
      ) : <div className="text-[9px] text-wr-muted">—</div>}
    </div>
  );
}
