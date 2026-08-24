/* ══ WHALE RADAR — ADAPTIVE ML CONFIDENCE (FreqAI-inspired) ═══════════════════
 *
 *  Ported concept from freqtrade's freqai/ module: instead of trusting a
 *  fixed set of hand-tuned thresholds forever, take the features that went
 *  into a decision (here: detect()'s inputs) and the label of whether that
 *  decision actually paid off (here: signalStore's outcome_4h), and train a
 *  model that learns which features actually predicted a profitable move —
 *  which may not match the hand-tuned weights in detection.ts.
 *
 *  This is deliberately NOT a port of FreqAI's actual ML stack (LightGBM /
 *  PyTorch / RL agents, walk-forward retraining, feature-importance
 *  pruning). Running that in a browser tab isn't realistic. What's ported
 *  is the *idea*: features → label → train → predict → use the prediction
 *  to inform (not blindly replace) the existing signal.
 *
 *  Implementation: a from-scratch logistic regression (batch gradient
 *  descent, L2-regularized), because it's ~80 lines of plain TS with zero
 *  dependencies, trains in milliseconds on a few hundred rows, and its
 *  learned weights are directly inspectable (freqtrade users ask "why did
 *  FreqAI say that" too — with logistic regression you can just read the
 *  coefficients).
 *
 *  DATA REQUIREMENT: training rows come from lib/signalStore.ts records
 *  that (a) have a filled outcome_4h AND (b) were fired after the feature
 *  snapshot fields (chg24/volSpike/supplyPct/mcap/dexHot/isSol) started
 *  being recorded. Records from before that change simply aren't
 *  ML-eligible — see MIN_TRAINING_SAMPLES below for the floor.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { getAllSignalRecords, type SignalRecord } from './signalStore';

// ── Feature engineering (freqtrade calls this "populate_any_indicators") ─────

export interface FeatureInput {
  score: number;
  vmcap: number;
  chg24: number;
  volSpike: number;
  supplyPct: number | null;
  mcap: number;
  dexHot: boolean;
  isSol: boolean;
}

const FEATURE_NAMES = ['score', 'vmcap', 'chg24', 'volSpike', 'supplyPct', 'mcapLog', 'dexHot', 'isSol'] as const;

/** Normalizes a raw feature snapshot into a bounded numeric vector suitable for gradient descent. */
function toVector(f: FeatureInput): number[] {
  return [
    clamp(f.score / 100, 0, 1),
    clamp(f.vmcap / 200, 0, 3),                       // vmcap can spike well past 100%
    clamp(f.chg24 / 100, -3, 3),
    clamp(Math.log10(Math.max(f.volSpike, 0.01)), -2, 2),
    f.supplyPct == null ? 0.5 : clamp(f.supplyPct / 100, 0, 1),
    clamp(Math.log10(Math.max(f.mcap, 1)) / 12, 0, 1), // log-scale market cap, roughly 0..1 for $1..$1T
    f.dexHot ? 1 : 0,
    f.isSol ? 1 : 0,
  ];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function isFeatureEligible(r: SignalRecord): boolean {
  return (
    r.chg24 !== undefined && r.volSpike !== undefined &&
    r.mcap !== undefined && r.dexHot !== undefined && r.isSol !== undefined
  );
}

// ── Model persistence ─────────────────────────────────────────────────────────

export interface MlModel {
  weights: number[];   // one per FEATURE_NAMES entry
  bias: number;
  trainedAt: number;
  samples: number;
  trainAccuracy: number;
}

const MODEL_KEY = 'wr_ml_confidence_model_v1';
export const MIN_TRAINING_SAMPLES = 30;

export function getModel(): MlModel | null {
  try {
    const raw = localStorage.getItem(MODEL_KEY);
    return raw ? (JSON.parse(raw) as MlModel) : null;
  } catch {
    return null;
  }
}

function saveModel(m: MlModel): void {
  try { localStorage.setItem(MODEL_KEY, JSON.stringify(m)); } catch { /* storage full/unavailable */ }
}

// ── Training data assembly ────────────────────────────────────────────────────

interface TrainingRow { x: number[]; y: number; }

function buildTrainingSet(): TrainingRow[] {
  return getAllSignalRecords()
    .filter(r => isFeatureEligible(r) && r.outcome_4h !== null)
    .map(r => ({
      x: toVector({
        score: r.score, vmcap: r.vmcap, chg24: r.chg24 as number,
        volSpike: r.volSpike as number, supplyPct: r.supplyPct ?? null,
        mcap: r.mcap as number, dexHot: !!r.dexHot, isSol: !!r.isSol,
      }),
      y: (r.outcome_4h as number) > 0 ? 1 : 0,
    }));
}

export interface TrainingEligibility {
  eligible: number;
  needed: number;
  ready: boolean;
}

export function getTrainingEligibility(): TrainingEligibility {
  const eligible = getAllSignalRecords().filter(r => isFeatureEligible(r) && r.outcome_4h !== null).length;
  return { eligible, needed: MIN_TRAINING_SAMPLES, ready: eligible >= MIN_TRAINING_SAMPLES };
}

// ── Logistic regression (batch gradient descent, L2-regularized) ─────────────

function sigmoid(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

function trainLogisticRegression(rows: TrainingRow[], epochs = 300, lr = 0.3, l2 = 0.01): { weights: number[]; bias: number } {
  const nFeatures = rows[0].x.length;
  const weights = new Array(nFeatures).fill(0);
  let bias = 0;
  const n = rows.length;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const gradW = new Array(nFeatures).fill(0);
    let gradB = 0;

    for (const { x, y } of rows) {
      const z = x.reduce((s, xi, i) => s + xi * weights[i], bias);
      const pred = sigmoid(z);
      const err = pred - y;
      for (let i = 0; i < nFeatures; i++) gradW[i] += err * x[i];
      gradB += err;
    }

    for (let i = 0; i < nFeatures; i++) {
      weights[i] -= lr * (gradW[i] / n + l2 * weights[i]);
    }
    bias -= lr * (gradB / n);
  }

  return { weights, bias };
}

/**
 * Trains (or retrains) the model on every currently ML-eligible record.
 * Returns null if there isn't enough labeled data yet (see
 * getTrainingEligibility() to check/display that before offering the button).
 */
export function trainModel(): MlModel | null {
  const rows = buildTrainingSet();
  if (rows.length < MIN_TRAINING_SAMPLES) return null;

  const { weights, bias } = trainLogisticRegression(rows);

  // Training accuracy — not held-out, so it's optimistic, but useful as a sanity signal
  // (freqtrade's own backtest-on-training-data caveat applies here too).
  let correct = 0;
  for (const { x, y } of rows) {
    const z = x.reduce((s, xi, i) => s + xi * weights[i], bias);
    const pred = sigmoid(z) >= 0.5 ? 1 : 0;
    if (pred === y) correct++;
  }

  const model: MlModel = {
    weights, bias,
    trainedAt: Date.now(),
    samples: rows.length,
    trainAccuracy: +((correct / rows.length) * 100).toFixed(1),
  };
  saveModel(model);
  return model;
}

/**
 * Predicted probability (0-100) that a coin with these features would have
 * a profitable 4h outcome, per the currently trained model. Returns null if
 * no model has been trained yet.
 */
export function predictConfidence(f: FeatureInput): number | null {
  const model = getModel();
  if (!model) return null;
  const x = toVector(f);
  const z = x.reduce((s, xi, i) => s + xi * model.weights[i], model.bias);
  return +(sigmoid(z) * 100).toFixed(1);
}

/** Feature name → learned weight, for a simple "what does the model weigh" display. */
export function getFeatureImportance(): { name: string; weight: number }[] | null {
  const model = getModel();
  if (!model) return null;
  return FEATURE_NAMES.map((name, i) => ({ name, weight: +model.weights[i].toFixed(3) }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
}
