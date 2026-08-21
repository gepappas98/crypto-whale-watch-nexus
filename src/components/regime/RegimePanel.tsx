import { useState } from 'react';
import { REGIME_COLORS, PERSISTENCE_SNAPSHOTS } from '@/lib/regime/engine';
import { SIGNAL_ORDER } from '@/lib/regime/weights';
import type { RegimeReading, RegimeSignal, RegimeSnapshot, RegimeWeights } from '@/lib/regime/types';

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
  /** Unused today — kept for the (not-yet-built) regime-change alert
   *  wiring; useRegimeAlerts.ts currently imports a missing
   *  '@/lib/regime/regimeAlerts' module, a separate pre-existing gap. */
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

export function RegimePanel({ reading, history, weights, setWeights, restoreDefaults, loading, refresh }: RegimePanelProps) {
  const [open, setOpen] = useState(false);
  const [tuning, setTuning] = useState(false);

  const spark = history.slice(-40);
  const regimeColor = reading ? REGIME_COLORS[reading.regime] : 'text-wr-muted';

  return (
    <section aria-label="Market regime" className="border-b border-wr-border bg-wr-bg2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
        <span className="text-[9px] tracking-widest text-wr-muted">🧠 REGIME</span>
        <span className={`text-sm font-bold tracking-widest ${regimeColor}`}>
          {reading ? reading.regime : loading ? 'READING…' : '—'}
        </span>
        <span className="text-[10px] text-wr-muted">{reading ? `${reading.score}/100` : ''}</span>

        {reading && (
          <span
            className={`text-[9px] tracking-widest px-1.5 py-0.5 border border-wr-border ${reading.confirmedRegime ? 'text-wr-green' : 'text-wr-amber'}`}
            title={`A regime must hold ${PERSISTENCE_SNAPSHOTS} consecutive checks before it counts as confirmed`}
          >
            {reading.confirmedRegime
              ? `CONFIRMED ×${reading.heldSnapshots}`
              : `UNCONFIRMED ${reading.heldSnapshots}/${PERSISTENCE_SNAPSHOTS}`}
          </span>
        )}

        {reading && (
          <span className="text-[9px] tracking-widest text-wr-cyan" title="Independent signals agreeing with the dominant direction">
            ⛓ {reading.agreeing}/{reading.active} AGREE
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
            <ul className="space-y-0.5">
              {reading.signals.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-2 text-[10px]" title={s.detail}>
                  <span className="text-wr-muted truncate">{s.label}</span>
                  <span className={`${signalTone(s)} whitespace-nowrap`}>
                    {s.value}
                    <span className="text-wr-muted"> · w{weights[s.id]}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {tuning && (
        <div className="px-4 pb-3 border-t border-wr-border pt-2">
          <div className="flex items-center gap-2 mb-2">
            <h2 className="text-[9px] tracking-widest text-wr-muted">SIGNAL WEIGHTS (rescores instantly)</h2>
            <button onClick={restoreDefaults} className={BTN}>RESET</button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1">
            {SIGNAL_ORDER.map((id) => (
              <label key={id} className="flex items-center gap-2 text-[10px]">
                <span className="text-wr-muted w-40 truncate">
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
      )}
    </section>
  );
}
