/* ══ WHALE RADAR — SIGNAL EVAL PANEL ══════════════════════════════════════════
 *  Shows win-rate table for CEO Signal Engine outputs.
 *  Data source: localStorage (always) + backend DB (when available).
 *  Outcome prices fetched from CoinGecko at 1h / 4h / 24h marks.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { loadSignalEval } from '@/lib/db';
import type { SignalEvalRow } from '@/lib/db';
import { fillSignalPrices, getSignalStoreStats } from '@/lib/signalStore';
import { computeRiskMetrics, computePortfolioMetrics, type Horizon, type RiskMetricsRow } from '@/lib/backtestMetrics';
import {
  trainModel, getModel, getTrainingEligibility, getFeatureImportance,
  MIN_TRAINING_SAMPLES, type MlModel,
} from '@/lib/mlScoring';
import { getAllSignalRecords } from '@/lib/signalStore';

const SIGNAL_ORDER = [
  'AGGRESSIVE LONG',
  'LONG (tight stop)',
  'LONG',
  'WATCH',
  'AVOID / SHORT',
];

const SIGNAL_COLOR: Record<string, string> = {
  'AGGRESSIVE LONG':    'text-wr-amber',
  'LONG (tight stop)':  'text-wr-amber',
  'LONG':               'text-wr-green',
  'WATCH':              'text-wr-muted',
  'AVOID / SHORT':      'text-wr-red',
};

function pct(n: number | null, decimals = 1): string {
  if (n == null) return '—';
  const s = n.toFixed(decimals);
  return n > 0 ? `+${s}%` : `${s}%`;
}

function pctColor(n: number | null): string {
  if (n == null) return 'text-wr-muted';
  if (n > 3)  return 'text-wr-green';
  if (n > 0)  return 'text-green-400/70';
  if (n > -3) return 'text-wr-red/70';
  return 'text-wr-red';
}

function winColor(rate: number | null): string {
  if (rate == null) return 'text-wr-muted';
  if (rate >= 60) return 'text-wr-green';
  if (rate >= 50) return 'text-green-400/70';
  if (rate >= 40) return 'text-wr-amber';
  return 'text-wr-red';
}

function timeAgo(iso: string | null): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return '<1h ago';
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function WRSignalEval() {
  const [rows, setRows]         = useState<SignalEvalRow[]>([]);
  const [loading, setLoading]   = useState(true);
  const [filling, setFilling]   = useState(false);
  const [lastFetch, setLastFetch] = useState<Date | null>(null);
  const [lastFilled, setLastFilled] = useState<number>(0);
  const [storeStats, setStoreStats] = useState({ total: 0, pendingFill: 0, oldestFiredAt: null as number | null });

  // ── Risk metrics (freqtrade-style: profit factor, expectancy, max DD, Sharpe) ──
  const [riskHorizon, setRiskHorizon] = useState<Horizon>('4h');
  const riskRows = useMemo(() => computeRiskMetrics(riskHorizon), [riskHorizon, storeStats.total, lastFilled]);
  const portfolioRow = useMemo(() => computePortfolioMetrics(riskHorizon), [riskHorizon, storeStats.total, lastFilled]);

  // ── ML confidence model (FreqAI-inspired — see lib/mlScoring.ts) ─────────────
  const [model, setModel] = useState<MlModel | null>(() => getModel());
  const [training, setTraining] = useState(false);
  const eligibility = useMemo(() => getTrainingEligibility(), [storeStats.total, lastFilled]);
  const featureImportance = useMemo(() => getFeatureImportance(), [model]);

  // "If we'd only acted on predictions the model was confident about" comparison —
  // recomputed with the current model against every ML-eligible, outcome-filled record.
  const mlComparison = useMemo(() => {
    if (!model) return null;
    const records = getAllSignalRecords().filter(
      r => r.outcome_4h !== null && r.chg24 !== undefined && r.volSpike !== undefined &&
        r.mcap !== undefined && r.dexHot !== undefined && r.isSol !== undefined,
    );
    if (records.length === 0) return null;

    // Recompute confidence inline (same math as predictConfidence) to avoid an import cycle risk.
    const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    const scored = records.map(r => {
      const x = [
        clamp(r.score / 100, 0, 1),
        clamp(r.vmcap / 200, 0, 3),
        clamp((r.chg24 as number) / 100, -3, 3),
        clamp(Math.log10(Math.max(r.volSpike as number, 0.01)), -2, 2),
        r.supplyPct == null ? 0.5 : clamp(r.supplyPct / 100, 0, 1),
        clamp(Math.log10(Math.max(r.mcap as number, 1)) / 12, 0, 1),
        r.dexHot ? 1 : 0,
        r.isSol ? 1 : 0,
      ];
      const z = x.reduce((s, xi, i) => s + xi * model.weights[i], model.bias);
      return { outcome: r.outcome_4h as number, confidence: sigmoid(z) * 100 };
    });

    const baselineWin = +((scored.filter(s => s.outcome > 0).length / scored.length) * 100).toFixed(1);
    const highConf = scored.filter(s => s.confidence >= 60);
    const highConfWin = highConf.length > 0
      ? +((highConf.filter(s => s.outcome > 0).length / highConf.length) * 100).toFixed(1)
      : null;

    return { total: scored.length, baselineWin, highConfCount: highConf.length, highConfWin };
  }, [model]);

  const handleTrain = useCallback(() => {
    setTraining(true);
    // Runs synchronously (a few hundred rows, <300 epochs) but a tick lets the button repaint first.
    setTimeout(() => {
      const m = trainModel();
      setModel(m);
      setTraining(false);
    }, 30);
  }, []);

  const refreshStats = useCallback(() => {
    setStoreStats(getSignalStoreStats());
  }, []);

  const fetchEval = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadSignalEval();
      data.sort((a, b) => {
        const ai = SIGNAL_ORDER.indexOf(a.signal);
        const bi = SIGNAL_ORDER.indexOf(b.signal);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
      setRows(data);
      setLastFetch(new Date());
      refreshStats();
    } finally {
      setLoading(false);
    }
  }, [refreshStats]);

  const handleFillNow = useCallback(async () => {
    setFilling(true);
    try {
      const filled = await fillSignalPrices();
      setLastFilled(filled);
      await fetchEval(); // Refresh table after filling
    } finally {
      setFilling(false);
    }
  }, [fetchEval]);

  useEffect(() => {
    fetchEval();
  }, [fetchEval]);

  const totalFires  = rows.reduce((s, r) => s + Number(r.fires), 0);
  const withOutcome = rows.reduce((s, r) => s + Number(r.with_outcome), 0);
  const coverage    = totalFires > 0 ? Math.round((withOutcome / totalFires) * 100) : 0;

  return (
    <div className="space-y-4 text-[11px] font-mono">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-2">
        <div className="space-y-0.5">
          <div className="text-[8px] text-wr-muted tracking-widest">LAST 30 DAYS · CEO SIGNAL ENGINE v1.0</div>
          <div className="text-[8px] text-wr-muted">
            {storeStats.total} signals stored · {totalFires} in 30d window · {withOutcome} with 4h outcome ({coverage}% filled)
          </div>
          {storeStats.pendingFill > 0 && (
            <div className="text-[8px] text-wr-amber">
              ⏳ {storeStats.pendingFill} pending price fill
            </div>
          )}
        </div>
        <div className="flex gap-1 flex-shrink-0">
          <button
            onClick={handleFillNow}
            disabled={filling || loading}
            className="wr-btn text-[8px] px-2 py-0.5"
            title="Fetch outcome prices now from CoinGecko"
          >
            {filling ? '...' : '⚡ FILL'}
          </button>
          <button
            onClick={fetchEval}
            disabled={loading}
            className="wr-btn text-[8px] px-2 py-0.5"
          >
            {loading ? '...' : '↻'}
          </button>
        </div>
      </div>

      {/* ── Last fill result ─────────────────────────────────────────────────── */}
      {lastFilled > 0 && (
        <div className="text-[8px] text-wr-green">
          ✓ Filled {lastFilled} outcome price{lastFilled !== 1 ? 's' : ''} from CoinGecko
        </div>
      )}

      {/* ── No data yet ─────────────────────────────────────────────────────── */}
      {storeStats.total === 0 && !loading && (
        <div className="border border-wr-amber/30 bg-wr-amber/5 rounded p-3 text-[10px] text-wr-amber leading-relaxed">
          <div className="font-bold mb-1">📡 No signals recorded yet</div>
          Run a scan — the engine records every signal automatically.
          Outcome prices (1h / 4h / 24h) are fetched from CoinGecko after each window elapses.
          Hit <span className="text-wr-white font-bold">⚡ FILL</span> to pull prices for any ready signals.
        </div>
      )}

      {/* ── Has signals but no outcomes yet ─────────────────────────────────── */}
      {storeStats.total > 0 && withOutcome === 0 && !loading && (
        <div className="border border-wr-border rounded p-3 text-[10px] text-wr-muted leading-relaxed space-y-1">
          <div className="text-wr-white font-bold">⏳ {storeStats.total} signals recorded — waiting for 1h mark</div>
          <div>Outcome prices fill automatically after 1h, 4h, 24h have elapsed.</div>
          <div>Hit <span className="text-wr-green font-bold">⚡ FILL</span> to check now.</div>
        </div>
      )}

      {withOutcome > 0 && withOutcome < 20 && (
        <div className="border border-wr-border rounded p-2 text-[9px] text-wr-muted">
          ⚠ {withOutcome} outcomes so far — win rates stabilize after ~20+ samples per signal.
        </div>
      )}

      {/* ── Main table ──────────────────────────────────────────────────────── */}
      {!loading && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-b border-wr-border">
                <th className="text-left py-1.5 pr-3 text-[8px] text-wr-muted tracking-widest font-normal">SIGNAL</th>
                <th className="text-right py-1.5 px-2 text-[8px] text-wr-muted tracking-widest font-normal">FIRES</th>
                <th className="text-right py-1.5 px-2 text-[8px] text-wr-muted tracking-widest font-normal">AVG 1H</th>
                <th className="text-right py-1.5 px-2 text-[8px] text-wr-muted tracking-widest font-normal">AVG 4H</th>
                <th className="text-right py-1.5 px-2 text-[8px] text-wr-muted tracking-widest font-normal">AVG 24H</th>
                <th className="text-right py-1.5 px-2 text-[8px] text-wr-muted tracking-widest font-normal">WIN% 4H</th>
                <th className="text-right py-1.5 px-2 text-[8px] text-wr-muted tracking-widest font-normal">SCORE</th>
                <th className="text-right py-1.5 pl-2 text-[8px] text-wr-muted tracking-widest font-normal">LAST</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.signal} className="border-b border-wr-border/40 hover:bg-wr-bg3/30">
                  <td className={`py-2 pr-3 font-bold ${SIGNAL_COLOR[row.signal] ?? 'text-wr-white'}`}>
                    {row.signal}
                  </td>
                  <td className="text-right px-2 text-wr-white">
                    {row.fires}
                    <span className="text-wr-muted ml-1">({row.with_outcome})</span>
                  </td>
                  <td className={`text-right px-2 ${pctColor(row.avg_1h_pct)}`}>{pct(row.avg_1h_pct)}</td>
                  <td className={`text-right px-2 font-bold ${pctColor(row.avg_4h_pct)}`}>{pct(row.avg_4h_pct)}</td>
                  <td className={`text-right px-2 ${pctColor(row.avg_24h_pct)}`}>{pct(row.avg_24h_pct)}</td>
                  <td className={`text-right px-2 font-bold ${winColor(row.win_rate_4h)}`}>
                    {row.win_rate_4h != null ? `${row.win_rate_4h}%` : '—'}
                  </td>
                  <td className="text-right px-2 text-wr-muted">{row.avg_score ?? '—'}</td>
                  <td className="text-right pl-2 text-wr-muted text-[8px]">{timeAgo(row.last_fire)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Risk Metrics (freqtrade-style backtest report) ─────────────────── */}
      {storeStats.total > 0 && (
        <div className="border-t border-wr-border pt-3 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[8px] text-wr-cyan tracking-widest">🎯 RISK METRICS — SEQUENTIAL, EQUAL-WEIGHTED</div>
            <div className="flex gap-1">
              {(['1h', '4h', '24h'] as Horizon[]).map(h => (
                <button
                  key={h}
                  onClick={() => setRiskHorizon(h)}
                  className={`text-[8px] px-1.5 py-0.5 border font-mono tracking-widest
                    ${riskHorizon === h
                      ? 'bg-wr-cyan/10 border-wr-cyan text-wr-cyan'
                      : 'border-wr-border text-wr-muted hover:border-wr-cyan/40'}`}
                >
                  {h.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {riskRows.length === 0 ? (
            <div className="text-[9px] text-wr-muted py-2">No filled outcomes at this horizon yet.</div>
          ) : (
            <>
              {/* Portfolio-level summary — "if you took every signal" */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
                <RiskStat label="TOT PROFIT" value={pct(portfolioRow.totalProfitPct)} color={pctColor(portfolioRow.totalProfitPct)} />
                <RiskStat label="WIN RATE" value={portfolioRow.winRate != null ? `${portfolioRow.winRate}%` : '—'} color={winColor(portfolioRow.winRate)} />
                <RiskStat
                  label="PROFIT FACTOR"
                  value={portfolioRow.profitFactor == null ? '—' : portfolioRow.profitFactor === Infinity ? '∞' : portfolioRow.profitFactor.toFixed(2)}
                  color={portfolioRow.profitFactor != null && portfolioRow.profitFactor >= 1 ? 'text-wr-green' : 'text-wr-red'}
                />
                <RiskStat label="EXPECTANCY" value={pct(portfolioRow.expectancy)} color={pctColor(portfolioRow.expectancy)} />
                <RiskStat label="MAX DD" value={`-${portfolioRow.maxDrawdownPct}%`} color="text-wr-amber" />
                <RiskStat label="SHARPE" value={portfolioRow.sharpe == null ? '—' : portfolioRow.sharpe.toFixed(2)} color={portfolioRow.sharpe != null && portfolioRow.sharpe > 0 ? 'text-wr-green' : 'text-wr-red'} />
                <RiskStat label="SORTINO" value={portfolioRow.sortino == null ? '—' : portfolioRow.sortino.toFixed(2)} color={portfolioRow.sortino != null && portfolioRow.sortino > 0 ? 'text-wr-green' : 'text-wr-red'} />
                <RiskStat label="CALMAR" value={portfolioRow.calmar == null ? '—' : portfolioRow.calmar.toFixed(2)} color={portfolioRow.calmar != null && portfolioRow.calmar > 0 ? 'text-wr-green' : 'text-wr-red'} />
                <RiskStat label="SQN" value={portfolioRow.sqn == null ? '—' : portfolioRow.sqn.toFixed(2)} color={portfolioRow.sqn != null && portfolioRow.sqn > 0 ? 'text-wr-green' : 'text-wr-red'} />
              </div>

              {/* Per-signal breakdown */}
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-[9px]">
                  <thead>
                    <tr className="border-b border-wr-border">
                      <th className="text-left py-1 pr-2 text-[7px] text-wr-muted tracking-widest font-normal">SIGNAL</th>
                      <th className="text-right py-1 px-1.5 text-[7px] text-wr-muted tracking-widest font-normal">N</th>
                      <th className="text-right py-1 px-1.5 text-[7px] text-wr-muted tracking-widest font-normal">TOT %</th>
                      <th className="text-right py-1 px-1.5 text-[7px] text-wr-muted tracking-widest font-normal">PF</th>
                      <th className="text-right py-1 px-1.5 text-[7px] text-wr-muted tracking-widest font-normal">EXPECT</th>
                      <th className="text-right py-1 px-1.5 text-[7px] text-wr-muted tracking-widest font-normal">MAX DD</th>
                      <th className="text-right py-1 px-1.5 text-[7px] text-wr-muted tracking-widest font-normal">SHARPE</th>
                      <th className="text-right py-1 px-1.5 text-[7px] text-wr-muted tracking-widest font-normal">SORTINO</th>
                      <th className="text-right py-1 pl-1.5 text-[7px] text-wr-muted tracking-widest font-normal">SQN</th>
                    </tr>
                  </thead>
                  <tbody>
                    {riskRows.map(row => (
                      <tr key={row.group} className="border-b border-wr-border/30">
                        <td className={`py-1.5 pr-2 font-bold ${SIGNAL_COLOR[row.group] ?? 'text-wr-white'}`}>{row.group}</td>
                        <td className="text-right px-1.5 text-wr-white">{row.trades}</td>
                        <td className={`text-right px-1.5 font-bold ${pctColor(row.totalProfitPct)}`}>{pct(row.totalProfitPct)}</td>
                        <td className={`text-right px-1.5 ${row.profitFactor != null && row.profitFactor >= 1 ? 'text-wr-green' : 'text-wr-red'}`}>
                          {row.profitFactor == null ? '—' : row.profitFactor === Infinity ? '∞' : row.profitFactor.toFixed(2)}
                        </td>
                        <td className={`text-right px-1.5 ${pctColor(row.expectancy)}`}>{pct(row.expectancy)}</td>
                        <td className="text-right px-1.5 text-wr-amber">-{row.maxDrawdownPct}%</td>
                        <td className={`text-right px-1.5 ${row.sharpe != null && row.sharpe > 0 ? 'text-wr-green' : 'text-wr-red'}`}>
                          {row.sharpe == null ? '—' : row.sharpe.toFixed(2)}
                        </td>
                        <td className={`text-right px-1.5 ${row.sortino != null && row.sortino > 0 ? 'text-wr-green' : 'text-wr-red'}`}>
                          {row.sortino == null ? '—' : row.sortino.toFixed(2)}
                        </td>
                        <td className={`text-right pl-1.5 ${row.sqn != null && row.sqn > 0 ? 'text-wr-green' : 'text-wr-red'}`}>
                          {row.sqn == null ? '—' : row.sqn.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="text-[7px] text-wr-muted leading-relaxed">
                PF = profit factor (sum of wins ÷ |sum of losses|; &gt;1 means net profitable).
                EXPECT = expected % per trade. MAX DD = worst cumulative peak-to-trough decline.
                SHARPE = mean ÷ stddev of per-trade returns (per-trade, not annualized).
                All computed sequentially, equal-weighted, from locally recorded signals — not a substitute for real position sizing/risk management.
              </div>
            </>
          )}
        </div>
      )}

      {/* ── ML Confidence Model (FreqAI-inspired) ───────────────────────────── */}
      <div className="border-t border-wr-border pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <div className="text-[8px] text-wr-purple tracking-widest">🧠 ML CONFIDENCE MODEL</div>
          <button
            className="wr-btn text-[8px] disabled:opacity-40 disabled:cursor-not-allowed"
            disabled={!eligibility.ready || training}
            onClick={handleTrain}
            title={eligibility.ready ? 'Retrain on all currently eligible records' : `Needs ${eligibility.needed} labeled samples (have ${eligibility.eligible})`}
          >
            {training ? '⏳ TRAINING...' : model ? '↻ RETRAIN' : '▶ TRAIN MODEL'}
          </button>
        </div>

        {!eligibility.ready ? (
          <div className="text-[9px] text-wr-muted py-1">
            Not enough labeled data yet — {eligibility.eligible}/{MIN_TRAINING_SAMPLES} signals with a filled 4h outcome and feature snapshot.
            Keep scanning; this fills in automatically as signals resolve.
          </div>
        ) : !model ? (
          <div className="text-[9px] text-wr-muted py-1">
            {eligibility.eligible} labeled samples ready. Train to get a data-driven confidence score alongside the rule-based detector.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              <RiskStat label="TRAINED ON" value={`${model.samples}`} color="text-wr-white" />
              <RiskStat label="TRAIN FIT" value={`${model.trainAccuracy}%`} color={model.trainAccuracy >= 55 ? 'text-wr-green' : 'text-wr-amber'} />
              <RiskStat label="LAST TRAINED" value={new Date(model.trainedAt).toLocaleDateString()} color="text-wr-white" />
            </div>

            {mlComparison && mlComparison.highConfWin !== null && (
              <div className="text-[9px] leading-relaxed bg-wr-bg3 border border-wr-border rounded px-2 py-1.5">
                Baseline win rate across {mlComparison.total} labeled signals: <span className="text-wr-white font-bold">{mlComparison.baselineWin}%</span>.
                Restricting to the {mlComparison.highConfCount} signals the model scored ≥60% confidence:{' '}
                <span className={`font-bold ${mlComparison.highConfWin >= mlComparison.baselineWin ? 'text-wr-green' : 'text-wr-red'}`}>
                  {mlComparison.highConfWin}%
                </span>.
                {mlComparison.highConfWin < mlComparison.baselineWin && ' (Model isn\'t adding value yet — needs more training data.)'}
              </div>
            )}

            {featureImportance && (
              <div className="flex flex-wrap gap-1.5">
                {featureImportance.map(f => (
                  <span
                    key={f.name}
                    className={`text-[7px] px-1.5 py-0.5 border rounded font-mono
                      ${f.weight > 0 ? 'border-wr-green/40 text-wr-green' : 'border-wr-red/40 text-wr-red'}`}
                    title="Learned logistic-regression weight — positive pushes confidence up, negative pushes it down"
                  >
                    {f.name} {f.weight > 0 ? '+' : ''}{f.weight}
                  </span>
                ))}
              </div>
            )}
          </>
        )}
        <div className="text-[7px] text-wr-muted leading-relaxed">
          Trains a small logistic-regression model on your own recorded signals (score, vol/mcap, 24h change,
          volume spike, supply %, market cap, DEX-hot flag, Solana flag → did it profit at 4h). This is a
          supplementary confidence score, not a replacement for detection.ts — training accuracy is on the
          training set itself (not held-out), so treat it as a sanity check, not a guarantee.
        </div>
      </div>

      {/* ── Legend ──────────────────────────────────────────────────────────── */}
      <div className="border-t border-wr-border pt-3 space-y-1 text-[8px] text-wr-muted leading-relaxed">
        <div><span className="text-wr-white">Fires</span> = total fires · <span className="text-wr-white">(n)</span> = with 4h outcome filled</div>
        <div><span className="text-wr-white">WIN% 4H</span> = % of signals where price rose after 4h</div>
        <div><span className="text-wr-white">AVG 4H</span> = mean % change from entry at 4h mark</div>
        <div>Outcomes filled from CoinGecko. Stored in browser localStorage. Needs 2+ weeks for statistical significance.</div>
        {lastFetch && (
          <div className="text-wr-muted/50">Updated: {lastFetch.toLocaleTimeString()}</div>
        )}
      </div>

      {/* ── Quick read ──────────────────────────────────────────────────────── */}
      {withOutcome >= 20 && rows.length > 0 && (() => {
        const ranked = rows.filter(r => r.avg_4h_pct != null);
        if (ranked.length < 2) return null;
        const best  = [...ranked].sort((a, b) => (b.avg_4h_pct ?? -999) - (a.avg_4h_pct ?? -999))[0];
        const worst = [...ranked].sort((a, b) => (a.avg_4h_pct ?? 999)  - (b.avg_4h_pct ?? 999))[0];
        return (
          <div className="border border-wr-cyan/20 bg-wr-cyan/5 rounded p-3 space-y-1">
            <div className="text-[8px] text-wr-cyan tracking-widest mb-2">✦ QUICK READ</div>
            <div className="text-[10px] text-wr-white">
              Best 4h: <span className={`font-bold ${SIGNAL_COLOR[best.signal] ?? ''}`}>{best.signal}</span>
              {' '}({pct(best.avg_4h_pct)} avg · {best.win_rate_4h}% win)
            </div>
            <div className="text-[10px] text-wr-white">
              Worst 4h: <span className={`font-bold ${SIGNAL_COLOR[worst.signal] ?? ''}`}>{worst.signal}</span>
              {' '}({pct(worst.avg_4h_pct)} avg · {worst.win_rate_4h}% win)
            </div>
          </div>
        );
      })()}

    </div>
  );
}

function RiskStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="bg-wr-bg3 border border-wr-border rounded px-2 py-1.5 text-center">
      <div className={`font-bold text-[11px] ${color}`}>{value}</div>
      <div className="text-[6px] text-wr-muted tracking-widest mt-0.5">{label}</div>
    </div>
  );
}

