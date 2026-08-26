import type { RegimeWeights, SignalId } from './types';

/** Starting weights from the README's grounded proposal. These are explicitly
 *  tunable judgment calls, not truths — the Settings panel writes overrides
 *  here so they can be adjusted without a code change. */
export const DEFAULT_WEIGHTS: RegimeWeights = {
  btc_trend: 20,
  btc_momentum: 10,
  breadth: 15,
  whale_flow: 12,
  aggressive_flow: 8,
  oi_roc: 10,
  funding: 8,
  fng_level: 7,
  fng_roc: 5,
  btc_dominance: 5,
  eth_btc_strength: 8,
  stablecoin_flow: 9,
};

export const SIGNAL_ORDER: SignalId[] = Object.keys(DEFAULT_WEIGHTS) as SignalId[];

const KEY = 'wr_regime_weights';

export function loadWeights(): RegimeWeights {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_WEIGHTS };
    const parsed = JSON.parse(raw) as Partial<RegimeWeights>;
    const out = { ...DEFAULT_WEIGHTS };
    for (const id of SIGNAL_ORDER) {
      const v = parsed[id];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) out[id] = v;
    }
    return out;
  } catch {
    return { ...DEFAULT_WEIGHTS };
  }
}

export function saveWeights(w: RegimeWeights) {
  try {
    localStorage.setItem(KEY, JSON.stringify(w));
  } catch {
    /* storage full / disabled — weights just don't persist */
  }
}

export function resetWeights(): RegimeWeights {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_WEIGHTS };
}
