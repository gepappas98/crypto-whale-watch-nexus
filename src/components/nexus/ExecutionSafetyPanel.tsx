import { useEffect, useState } from "react";
import { AlertTriangle, Shield, Zap, RotateCcw, ChevronDown, ChevronUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getCircuitBreakerConfig,
  setCircuitBreakerConfig,
  getCircuitBreakerState,
  resetCircuitBreaker,
  DEFAULT_CIRCUIT_CONFIG,
  type CircuitBreakerConfig,
} from "@/lib/nexus/circuitBreaker";
import {
  getDailyRiskConfig,
  setDailyRiskConfig,
  getDayPnlFraction,
  DEFAULT_DAILY_RISK_CONFIG,
  type DailyRiskConfig,
} from "@/lib/nexus/dailyRiskGate";

/** Settings UI for Circuit Breaker + Daily Risk Gate (WR-10 safety layer). */
export function ExecutionSafetyPanel() {
  const [open, setOpen] = useState(true);
  const [circuit, setCircuit] = useState<CircuitBreakerConfig>(getCircuitBreakerConfig);
  const [daily, setDaily] = useState<DailyRiskConfig>(getDailyRiskConfig);
  const [cbState, setCbState] = useState(getCircuitBreakerState);
  const [dayPnl, setDayPnl] = useState(() => getDayPnlFraction());

  const refresh = () => {
    setCircuit(getCircuitBreakerConfig());
    setDaily(getDailyRiskConfig());
    setCbState(getCircuitBreakerState());
    setDayPnl(getDayPnlFraction());
  };

  useEffect(() => {
    const onTrip = () => refresh();
    const onReset = () => refresh();
    window.addEventListener("nexus:circuit:trip", onTrip);
    window.addEventListener("nexus:circuit:reset", onReset);
    const t = window.setInterval(refresh, 15_000);
    return () => {
      window.removeEventListener("nexus:circuit:trip", onTrip);
      window.removeEventListener("nexus:circuit:reset", onReset);
      window.clearInterval(t);
    };
  }, []);

  const saveCircuit = (next: CircuitBreakerConfig) => {
    setCircuitBreakerConfig(next);
    setCircuit(next);
  };

  const saveDaily = (next: DailyRiskConfig) => {
    setDailyRiskConfig(next);
    setDaily(next);
  };

  const circuitOpen = cbState.openUntil > Date.now();
  const dayLimitHit = daily.enabled && dayPnl.pnl <= -daily.maxDailyDrawdownPct;

  return (
    <Card className="p-3 space-y-2 text-xs border-amber-500/20">
      <button
        type="button"
        className="flex items-center justify-between w-full text-left"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2 font-semibold">
          <Zap className="w-4 h-4 text-amber-400" />
          Execution safety gates
          {circuitOpen && (
            <span className="text-[9px] font-normal text-red-400 bg-red-500/10 rounded px-1.5 py-0.5">
              circuit open
            </span>
          )}
          {dayLimitHit && (
            <span className="text-[9px] font-normal text-red-400 bg-red-500/10 rounded px-1.5 py-0.5">
              daily limit
            </span>
          )}
        </div>
        {open ? <ChevronUp className="w-3.5 h-3.5 opacity-60" /> : <ChevronDown className="w-3.5 h-3.5 opacity-60" />}
      </button>

      {open && (
        <div className="space-y-4 pt-1">
          {/* Live status */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            <Stat
              label="Circuit"
              value={circuitOpen ? "OPEN" : "closed"}
              bad={circuitOpen}
            />
            <Stat
              label="Latency samples"
              value={String(cbState.latencySamples.length)}
            />
            <Stat
              label="Day PnL"
              value={`${(dayPnl.pnl * 100).toFixed(2)}%`}
              bad={dayPnl.pnl < 0}
            />
            <Stat label="Day trades" value={String(dayPnl.count)} />
          </div>

          {circuitOpen && (
            <div className="flex items-start gap-2 rounded border border-red-500/30 bg-red-500/10 p-2 text-[10px] text-red-300">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <div className="flex-1">
                <div className="font-medium">Breaker tripped</div>
                <div className="opacity-80">{cbState.reason}</div>
                <div className="opacity-60 mt-0.5">
                  Until {new Date(cbState.openUntil).toLocaleTimeString()}
                </div>
              </div>
              <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={() => { resetCircuitBreaker(); refresh(); }}>
                Reset
              </Button>
            </div>
          )}

          {/* Circuit breaker config */}
          <section className="space-y-2 border-t border-border/50 pt-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5 font-medium">
                <Shield className="w-3.5 h-3.5 text-muted-foreground" />
                Circuit breaker
              </div>
              <Toggle
                on={circuit.enabled}
                onChange={(v) => saveCircuit({ ...circuit, enabled: v })}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field
                label="Max slippage %"
                value={(circuit.maxSlippagePct * 100).toFixed(2)}
                onChange={(v) =>
                  saveCircuit({
                    ...circuit,
                    maxSlippagePct: Math.max(0.05, Math.min(10, Number(v) || 0)) / 100,
                  })
                }
              />
              <Field
                label="Max latency ms"
                value={String(circuit.maxLatencyMs)}
                onChange={(v) =>
                  saveCircuit({
                    ...circuit,
                    maxLatencyMs: Math.max(200, Math.min(30_000, Number(v) || 0)),
                  })
                }
              />
              <Field
                label="Cooldown min"
                value={String(circuit.cooldownMinutes)}
                onChange={(v) =>
                  saveCircuit({
                    ...circuit,
                    cooldownMinutes: Math.max(1, Math.min(120, Number(v) || 0)),
                  })
                }
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Default max slippage 1%. Trips cancel new guarded entries until cooldown ends.
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2"
              onClick={() => {
                setCircuitBreakerConfig(DEFAULT_CIRCUIT_CONFIG);
                refresh();
              }}
            >
              <RotateCcw className="w-3 h-3 mr-1" /> Reset circuit defaults
            </Button>
          </section>

          {/* Daily risk */}
          <section className="space-y-2 border-t border-border/50 pt-2">
            <div className="flex items-center justify-between">
              <div className="font-medium">Daily risk auditor</div>
              <Toggle
                on={daily.enabled}
                onChange={(v) => saveDaily({ ...daily, enabled: v })}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Field
                label="Max day DD %"
                value={(daily.maxDailyDrawdownPct * 100).toFixed(1)}
                onChange={(v) =>
                  saveDaily({
                    ...daily,
                    maxDailyDrawdownPct: Math.max(0.5, Math.min(50, Number(v) || 0)) / 100,
                  })
                }
              />
              <Field
                label="Min R:R (0=off)"
                value={String(daily.minRiskReward)}
                onChange={(v) =>
                  saveDaily({
                    ...daily,
                    minRiskReward: Math.max(0, Math.min(10, Number(v) || 0)),
                  })
                }
              />
              <Field
                label="Equity baseline $"
                value={String(daily.equityBaselineUsd)}
                onChange={(v) =>
                  saveDaily({
                    ...daily,
                    equityBaselineUsd: Math.max(100, Number(v) || 0),
                  })
                }
              />
            </div>
            <p className="text-[10px] text-muted-foreground">
              Blocks new exposure when UTC-day realized PnL ≤ −max day DD. Resets at UTC midnight.
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-2"
              onClick={() => {
                setDailyRiskConfig(DEFAULT_DAILY_RISK_CONFIG);
                refresh();
              }}
            >
              <RotateCcw className="w-3 h-3 mr-1" /> Reset daily defaults
            </Button>
          </section>
        </div>
      )}
    </Card>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`text-[10px] px-2 py-0.5 rounded border ${
        on
          ? "border-emerald-500/40 text-emerald-400 bg-emerald-500/10"
          : "border-border text-muted-foreground"
      }`}
    >
      {on ? "ON" : "OFF"}
    </button>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-[9px] text-muted-foreground">{label}</label>
      <Input
        className="h-7 text-xs"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function Stat({ label, value, bad }: { label: string; value: string; bad?: boolean }) {
  return (
    <div className="rounded border border-border/60 bg-muted/20 px-2 py-1.5">
      <div className="text-[9px] text-muted-foreground tracking-wider">{label}</div>
      <div className={`font-mono text-sm ${bad ? "text-red-400" : "text-foreground"}`}>{value}</div>
    </div>
  );
}
