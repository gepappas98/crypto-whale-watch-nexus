import { useState } from 'react';
import { REGIME_COLORS, EARLY_SNAPSHOTS, DEVELOPING_SNAPSHOTS, CONFIRMED_SNAPSHOTS, MAX_HISTORY as MAX_HISTORY_SNAPSHOTS } from '@/lib/regime/engine';
import { SIGNAL_ORDER } from '@/lib/regime/weights';
import { FAMILY_ORDER, FAMILY_LABELS, SIGNAL_FAMILIES } from '@/lib/regime/families';
import { useRegimeAlerts } from '@/hooks/useRegimeAlerts';
import { useRegimeBacktest } from '@/hooks/useRegimeBacktest';
import type { RegimeName, RegimeReading, RegimeSignal, RegimeSnapshot, RegimeWeights } from '@/lib/regime/types';

const NOOP_ADD_ALERT = () => {};

interface RegimePanelProps {
  /** Lifted to the page so the same reading can also feed the AI Council's
   *  REGIME DESK agent without a second, duplicate useRegimeEngine poll
   *  loop — see useRegimeEngine(local) in Index.tsx. */
  reading: RegimeReading | null;
  history: RegimeSnapshot[];
  weights: RegimeWeights;
  setWeights: (w: RegimeWeights) => void;
  restoreDefaults: () => void;
  loading: boolean;
  refresh: () => void;
  /** Wired into useRegimeAlerts below — fires a Telegram/Discord/in-app
   *  alert only when confirmedRegime actually changes. Optional so the
   *  panel still renders (alert-free) if a caller doesn't have addAlert
   *  in scope. */
  addAlert?: (level: 'high' | 'medium' | 'critical' | 'info', tag: string, text: string, sizing?: string) => void;
}

function signalTone(s: RegimeSignal) {
  if (s.score == null) return 'text-wr-muted';
  if (s.score > 0.2) return 'text-wr-green';
  if (s.score < -0.2) return 'text-wr-red';
  return 'text-wr-amber';
}

function barColor(score: number) {
  if (score >= 57) return 'hsl(var(--wr-green))';
  if (score >= 43) return 'hsl(var(--wr-amber))';
  return 'hsl(var(--wr-red))';
}

function Delta({ label, value }: { label: string; value: number | null }) {
  return (
    <span className="text-[9px] tracking-widest">
      <span className="text-wr-muted">{label} </span>
      <span className={value == null ? 'text-wr-muted' : value >= 0 ? 'text-wr-green' : 'text-wr-red'}>
        {value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(0)}`}
      </span>
    </span>
  );
}

const BTN = 'text-[9px] tracking-widest border border-wr-border px-2 py-0.5 text-wr-muted hover:text-wr-cyan';

export function RegimePanel({ reading, history, weights, setWeights, restoreDefaults, loading, refresh, addAlert }: RegimePanelProps) {
  useRegimeAlerts(reading, addAlert ?? NOOP_ADD_ALERT);
  const [open, setOpen] = useState(false);
  const [tuning, setTuning] = useState(false);
  const [backtestOpen, setBacktestOpen] = useState(false);
  const backtest = useRegimeBacktest();

  const spark = history.slice(-40);
  const regimeColor = reading ? REGIME_COLORS[reading.regime] : 'text-wr-muted';

  return (
    <section aria-label="Market regime" className="border-b border-wr-border bg-wr-bg2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <span className="text-[9px] tracking-widest text-wr-muted">🧠 REGIME</span>
        <span className={`text-sm font-bold tracking-widest ${regimeColor}`}>
          {reading ? reading.regime : loading ? 'READING…' : '—'}
        </span>
        <span className="text-[10px] text-wr-muted" title="Composite weighted-signal score, 0-100 — not a probability">
          {reading ? `${reading.score}/100` : ''}
        </span>

        {reading && (
          <span
            className={`text-[9px] tracking-widest px-1.5 py-0.5 border border-wr-border ${
              reading.tier === 'confirmed' ? 'text-wr-green'
                : reading.tier === 'developing' ? 'text-wr-cyan'
                : reading.tier === 'early' ? 'text-wr-amber'
                : 'text-wr-muted'
            }`}
            title={`3-tier persistence ladder: EARLY ≥${EARLY_SNAPSHOTS} checks (≈15min), DEVELOPING ≥${DEVELOPING_SNAPSHOTS} (≈1.5h), CONFIRMED ≥${CONFIRMED_SNAPSHOTS} (≈8h) — replaces the old single "confirmed at 15min" flag`}
          >
            {reading.tier === 'confirmed' ? `CONFIRMED ×${reading.heldSnapshots}`
              : reading.tier === 'developing' ? `DEVELOPING ×${reading.heldSnapshots}`
              : reading.tier === 'early' ? `EARLY ×${reading.heldSnapshots}`
              : `FORMING ${reading.heldSnapshots}/${EARLY_SNAPSHOTS}`}
          </span>
        )}

        {reading && (
          <span className="text-[9px] tracking-widest text-wr-cyan" title="Independent signals agreeing with the dominant direction">
            ⛓ {reading.agreeing}/{reading.active} AGREE
          </span>
        )}

        {reading && (
          <span
            className="text-[9px] tracking-widest text-wr-cyan"
            title="How many of the 5 independent signal families (Trend, Derivatives, Flow, Sentiment, Dominance) lean the same way — a more honest breadth read than raw signal count, since several signals within one family are correlated readings of the same underlying thing"
          >
            🔗 {reading.families.filter((f) => f.score != null && f.score * (reading.score >= 50 ? 1 : -1) > 0.2).length}
            /{reading.families.filter((f) => f.score != null).length} FAMILIES
          </span>
        )}

        {reading && (
          <span className="flex items-center gap-2">
            <Delta label="5m" value={reading.delta5m} />
            <Delta label="30m" value={reading.delta30m} />
            <Delta label="2h" value={reading.delta2h} />
          </span>
        )}

        {spark.length > 1 && (
          <span className="flex items-end gap-[1px] h-4" aria-hidden>
            {spark.map((s) => (
              <span
                key={s.ts}
                className="w-[3px]"
                style={{ height: `${Math.max(2, (s.score / 100) * 16)}px`, background: barColor(s.score) }}
              />
            ))}
          </span>
        )}

        <div className="flex-1" />
        <button onClick={() => refresh()} aria-label="Re-read market regime now" className={BTN}>
          {loading ? '…' : '↻'}
        </button>
        <button onClick={() => setTuning((p) => !p)} aria-label="Tune regime signal weights" className={BTN}>
          ⚖ WEIGHTS
        </button>
        <button onClick={() => setBacktestOpen((p) => !p)} aria-label="Backtest the regime engine's own historical calls" className={BTN}>
          📊 BACKTEST
        </button>
        <button
          onClick={() => setOpen((p) => !p)}
          aria-expanded={open}
          aria-label="Show why the regime reads this way"
          className="text-[9px] tracking-widest border border-wr-border px-2 py-0.5 text-wr-cyan hover:text-wr-green"
        >
          {open ? 'HIDE WHY' : 'WHY?'}
        </button>
      </div>

      {open && reading && (
        <div className="px-4 pb-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <h2 className="text-[9px] tracking-widest text-wr-muted mb-1">WHY THIS READING</h2>
            <ul className="space-y-1">
              {reading.reasons.map((r, i) => (
                <li key={i} className="text-[10px] text-wr-white leading-snug">• {r}</li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="text-[9px] tracking-widest text-wr-muted mb-1">SIGNALS</h2>
            {reading.families.map((f) => {
              const members = reading.signals.filter((s) => SIGNAL_FAMILIES[s.id] === f.id);
              if (members.length === 0) return null;
              return (
                <div key={f.id} className="mb-1.5">
                  <div
                    className="text-[9px] tracking-widest text-wr-muted/70 flex items-center justify-between"
                    title={`${f.label} family — ${f.score == null ? 'no usable data this tick' : `${f.agreeing}/${f.active} members agree with each other`}`}
                  >
                    <span>{f.label.toUpperCase()}</span>
                    <span>{f.score == null ? '—' : `${f.agreeing}/${f.active}`}</span>
                  </div>
                  <ul className="space-y-0.5">
                    {members.map((s) => (
                      <li key={s.id} className="flex items-center justify-between gap-2 text-[10px]" title={s.detail}>
                        <span className="text-wr-muted truncate pl-2">{s.label}</span>
                        <span className={`${signalTone(s)} whitespace-nowrap`}>
                          {s.value}
                          <span className="text-wr-muted"> · w{weights[s.id]}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tuning && (
        <div className="px-4 pb-3 border-t border-wr-border pt-2">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-[9px] tracking-widest text-wr-muted">SIGNAL WEIGHTS (rescores instantly)</h2>
            <button onClick={restoreDefaults} className={BTN}>RESET</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2">
            {FAMILY_ORDER.map((fid) => (
              <div key={fid} className="col-span-1 md:col-span-2">
                <div className="text-[9px] tracking-widest text-wr-muted/70 mb-0.5">{FAMILY_LABELS[fid]}</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
                  {SIGNAL_ORDER.filter((id) => SIGNAL_FAMILIES[id] === fid).map((id) => (
                    <label key={id} className="flex items-center gap-2 text-[10px]">
                      <span className="text-wr-muted w-40 truncate pl-2">
                        {reading?.signals.find((s) => s.id === id)?.label ?? id}
                      </span>
                      <input
                        type="range"
                        min={0}
                        max={30}
                        step={1}
                        value={weights[id]}
                        onChange={(e) => setWeights({ ...weights, [id]: Number(e.target.value) })}
                        className="flex-1"
                        aria-label={`Weight for ${id}`}
                      />
                      <span className="text-wr-cyan w-6 text-right">{weights[id]}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {backtestOpen && (
        <div className="px-4 pb-3 border-t border-wr-border pt-2">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-[9px] tracking-widest text-wr-muted">
              BACKTEST — confirmed regime calls vs actual forward BTC price
            </h2>
            <button onClick={() => backtest.run(history)} className={BTN} disabled={backtest.loading}>
              {backtest.loading ? 'RUNNING…' : backtest.result ? 'RE-RUN' : 'RUN'}
            </button>
          </div>

          {backtest.error && <p className="text-[10px] text-wr-red">{backtest.error}</p>}

          {!backtest.result && !backtest.loading && !backtest.error && (
            <p className="text-[10px] text-wr-muted leading-snug">
              Tests every confirmed regime call still in your local history against actual forward
              BTC price action at 1h/4h/24h. Only as deep as this browser's own accumulated
              session (history caps at {MAX_HISTORY_SNAPSHOTS} snapshots, ~5 min apart) — not a multi-year replay.
            </p>
          )}

          {backtest.result && (
            <div className="space-y-2">
              <p className="text-[10px] text-wr-muted">
                {backtest.result.resolvedCalls} of {backtest.result.totalConfirmedCalls} confirmed
                calls have a resolvable forward price so far — recent ones need time to reach
                their horizon.
              </p>
              {backtest.result.totalConfirmedCalls === 0 ? (
                <p className="text-[10px] text-wr-muted">
                  No confirmed regime transitions in local history yet — a regime has to hold for
                  {` ${CONFIRMED_SNAPSHOTS} `}consecutive checks (≈8h) to reach the CONFIRMED tier
                  and count as a call. With history capped at {MAX_HISTORY_SNAPSHOTS} snapshots
                  (~{Math.round((MAX_HISTORY_SNAPSHOTS * 5) / 60)}h), that's reachable but takes a
                  while — check back after the browser's been open a few hours.
                </p>
              ) : (
                <table className="text-[10px] w-full">
                  <thead>
                    <tr className="text-wr-muted text-left">
                      <th className="pr-3 font-normal">Regime</th>
                      <th className="pr-3 font-normal">Calls</th>
                      {backtest.result.horizonsHours.map((h) => (
                        <th key={h} className="pr-3 font-normal">{h}h avg / hit%</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(backtest.result.byRegime).map(([regime, stats]) => (
                      <tr key={regime}>
                        <td className={REGIME_COLORS[regime as RegimeName]}>{regime}</td>
                        <td className="text-wr-white">{stats!.count}</td>
                        {backtest.result!.horizonsHours.map((h) => (
                          <td key={h} className="text-wr-white whitespace-nowrap">
                            {stats!.avgReturnPctByHorizon[h] == null ? '—' : `${stats!.avgReturnPctByHorizon[h]!.toFixed(1)}%`}
                            {' / '}
                            {stats!.hitRatePctByHorizon[h] == null ? '—' : `${stats!.hitRatePctByHorizon[h]!.toFixed(0)}%`}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
