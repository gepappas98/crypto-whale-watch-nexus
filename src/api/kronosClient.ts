/* ══ KRONOS CLIENT — Crystal Ball PRO API ════════════════════════════════════
 * Calls the Kronos Inference Service deployed on Railway.
 * Set VITE_KRONOS_URL in .env (Vercel env vars for production).
 */

const KRONOS_BASE =
  (import.meta.env.VITE_KRONOS_URL as string | undefined) ??
  'https://your-kronos-service.up.railway.app';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OHLCVCandle {
  t: number;   // unix ms
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface KronosCandle {
  timestamp: string;  // ISO 8601
  open:      number;
  high:      number;
  low:       number;
  close:     number;
  volume:    number;
  ci_high:   number;
  ci_low:    number;
}

export type Signal =
  | 'STRONG_BULL'
  | 'BULLISH'
  | 'NEUTRAL'
  | 'BEARISH'
  | 'STRONG_BEAR';

export interface ForecastResponse {
  symbol:           string;
  timeframe:        string;
  generated_at:     string;
  model:            string;
  context_candles:  OHLCVCandle[];
  forecast:         KronosCandle[];
  signal:           Signal;
  confidence_score: number;
  price_change_pct: number;
}

export interface ForecastRequest {
  symbol?:       string;
  timeframe?:    '5m' | '15m' | '1h' | '4h' | '1d';
  lookback?:     number;
  pred_len?:     number;
  sample_count?: number;
  temperature?:  number;
  top_p?:        number;
  model?:        'mini' | 'small' | 'base';
}

// ─── API calls ────────────────────────────────────────────────────────────────

export async function fetchForecast(req: ForecastRequest): Promise<ForecastResponse> {
  const res = await fetch(`${KRONOS_BASE}/forecast`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      symbol:       req.symbol       ?? 'BTCUSDT',
      timeframe:    req.timeframe    ?? '1h',
      lookback:     req.lookback     ?? 400,
      pred_len:     req.pred_len     ?? 24,
      sample_count: req.sample_count ?? 5,
      temperature:  req.temperature  ?? 1.0,
      top_p:        req.top_p        ?? 0.9,
      model:        req.model        ?? 'mini',
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail ?? 'Kronos request failed');
  }

  return res.json() as Promise<ForecastResponse>;
}

export async function checkHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${KRONOS_BASE}/health`, {
      signal: AbortSignal.timeout(5000),
    });
    const data = (await res.json()) as { model_loaded?: boolean };
    return data.model_loaded === true;
  } catch {
    return false;
  }
}
