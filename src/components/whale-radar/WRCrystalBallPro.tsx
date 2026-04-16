/* ══ CRYSTAL BALL PRO — Kronos AI Forecast Tab ═══════════════════════════════
 * Whale RADAR v9 · powered by NeoQuasar/Kronos-mini (4.1M params)
 */

import { useState, useEffect, useRef } from 'react';
import { useKronos } from '@/hooks/useKronos';
import { Signal, OHLCVCandle as OHLCVCandleT, KronosCandle } from '@/api/kronosClient';

// ─── Constants ────────────────────────────────────────────────────────────────

const COINS   = ['BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','DOGEUSDT','AVAXUSDT','LINKUSDT'] as const;
const FRAMES  = ['5m','15m','1h','4h','1d'] as const;
const LENGTHS = [12, 24, 48, 96] as const;

const SIGNAL_META: Record<Signal, { label: string; color: string; bg: string; border: string; icon: string }> = {
  STRONG_BULL: { label: 'STRONG BULL', color: '#00ff88', bg: 'rgba(0,255,136,0.08)',   border: 'rgba(0,255,136,0.25)',   icon: '🚀' },
  BULLISH:     { label: 'BULLISH',     color: '#4ade80', bg: 'rgba(74,222,128,0.08)',  border: 'rgba(74,222,128,0.25)',  icon: '📈' },
  NEUTRAL:     { label: 'NEUTRAL',     color: '#94a3b8', bg: 'rgba(148,163,184,0.06)', border: 'rgba(148,163,184,0.2)',  icon: '➡️' },
  BEARISH:     { label: 'BEARISH',     color: '#f87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.25)', icon: '📉' },
  STRONG_BEAR: { label: 'STRONG BEAR', color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',   icon: '🐻' },
};

// ─── Forecast Chart (pure canvas) ────────────────────────────────────────────

interface ForecastChartProps {
  contextCandles: Pick<OHLCVCandleT, 't' | 'c'>[];
  forecast:       KronosCandle[];
}

function ForecastChart({ contextCandles, forecast }: ForecastChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width  = canvas.offsetWidth  * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;

    ctx.clearRect(0, 0, w, h);

    const ctxPrices   = contextCandles.map(c => c.c);
    const fcastPrices = forecast.map(f => f.close);
    const ciHighs     = forecast.map(f => f.ci_high);
    const ciLows      = forecast.map(f => f.ci_low);
    const allPrices   = [...ctxPrices, ...fcastPrices, ...ciHighs, ...ciLows];
    const minP  = Math.min(...allPrices);
    const maxP  = Math.max(...allPrices);
    const range = maxP - minP || 1;

    const total = ctxPrices.length + fcastPrices.length;
    const PAD   = { t: 14, b: 14, l: 10, r: 10 };
    const pw    = w - PAD.l - PAD.r;
    const ph    = h - PAD.t - PAD.b;

    const xS = (i: number) => PAD.l + (i / (total - 1)) * pw;
    const yS = (p: number) => PAD.t + (1 - (p - minP) / range) * ph;

    const splitX = xS(ctxPrices.length - 1);

    // Grid
    ctx.strokeStyle = 'rgba(148,163,184,0.06)';
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const y = PAD.t + (g / 4) * ph;
      ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(w - PAD.r, y); ctx.stroke();
    }

    // CI band
    ctx.beginPath();
    forecast.forEach((_, i) => {
      const x = xS(ctxPrices.length + i);
      const y = yS(ciHighs[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    for (let i = forecast.length - 1; i >= 0; i--) {
      ctx.lineTo(xS(ctxPrices.length + i), yS(ciLows[i]));
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(139,92,246,0.13)';
    ctx.fill();

    // Divider
    ctx.strokeStyle = 'rgba(139,92,246,0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(splitX, PAD.t); ctx.lineTo(splitX, h - PAD.b); ctx.stroke();
    ctx.setLineDash([]);

    // Context line
    ctx.beginPath();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.5;
    ctxPrices.forEach((p, i) => {
      const x = xS(i), y = yS(p);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Forecast line
    ctx.beginPath();
    ctx.strokeStyle = '#a78bfa';
    ctx.lineWidth = 2;
    fcastPrices.forEach((p, i) => {
      const x = xS(ctxPrices.length + i), y = yS(p);
      if (i === 0) {
        ctx.moveTo(xS(ctxPrices.length - 1), yS(ctxPrices[ctxPrices.length - 1]));
      }
      ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Endpoint dot
    const lastX = xS(total - 1);
    const lastY = yS(fcastPrices[fcastPrices.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#a78bfa';
    ctx.fill();

    // "NOW" label at divider
    ctx.fillStyle = 'rgba(139,92,246,0.5)';
    ctx.font = `9px monospace`;
    ctx.fillText('NOW', splitX + 3, PAD.t + 10);

  }, [contextCandles, forecast]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '180px', display: 'block' }}
    />
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function CrystalBallPro() {
  const [symbol,    setSymbol]   = useState<typeof COINS[number]>('BTCUSDT');
  const [timeframe, setTf]       = useState<typeof FRAMES[number]>('1h');
  const [predLen,   setPredLen]  = useState<typeof LENGTHS[number]>(24);
  const [samples,   setSamples]  = useState(5);
  const [modelKey,  setModelKey] = useState<'mini' | 'small'>('mini');

  const { data, loading, error, lastFetch, run } = useKronos();

  const handleRun = () => run({
    symbol,
    timeframe,
    pred_len:     predLen,
    sample_count: samples,
    model:        modelKey,
  });

  // Auto-run on first mount
  useEffect(() => { handleRun(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const sig = data ? SIGNAL_META[data.signal] : null;

  return (
    <div className="p-3 min-h-[500px]" style={{ fontFamily: "'JetBrains Mono', 'Fira Code', monospace" }}>

      {/* ── Panel Header ── */}
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🔮</span>
        <span className="text-xs font-bold tracking-widest" style={{ color: '#a78bfa' }}>
          CRYSTAL BALL PRO
        </span>
        <span
          className="text-[9px] px-1.5 py-0.5 rounded ml-1"
          style={{ color: '#475569', background: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.2)' }}
        >
          POWERED BY KRONOS
        </span>
        {data && (
          <span className="ml-auto text-[9px] text-wr-muted">
            {data.symbol.replace('USDT', '/USDT')} · {data.model}
          </span>
        )}
      </div>

      {/* ── Controls ── */}
      <div className="flex gap-2 flex-wrap mb-3">
        <select value={symbol}   onChange={e => setSymbol(e.target.value as typeof COINS[number])}   style={sel}>
          {COINS.map(c => <option key={c} value={c}>{c.replace('USDT', '/USDT')}</option>)}
        </select>
        <select value={timeframe} onChange={e => setTf(e.target.value as typeof FRAMES[number])}    style={sel}>
          {FRAMES.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <select value={predLen}  onChange={e => setPredLen(Number(e.target.value) as typeof LENGTHS[number])} style={sel}>
          {LENGTHS.map(l => <option key={l} value={l}>{l} candles</option>)}
        </select>
        <select value={modelKey} onChange={e => setModelKey(e.target.value as 'mini' | 'small')}    style={sel}>
          <option value="mini">kronos-mini (fast)</option>
          <option value="small">kronos-small (precise)</option>
        </select>
        <button
          onClick={handleRun}
          disabled={loading}
          style={{
            marginLeft: 'auto',
            padding: '5px 14px',
            fontSize: '11px',
            fontWeight: 700,
            letterSpacing: '0.08em',
            background: loading ? 'rgba(139,92,246,0.15)' : 'rgba(139,92,246,0.8)',
            color:      loading ? '#7c3aed' : '#fff',
            border:     '1px solid rgba(139,92,246,0.55)',
            borderRadius: '5px',
            cursor:     loading ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit',
            transition: 'all 0.15s',
          }}
        >
          {loading ? '⏳ RUNNING…' : '▶ FORECAST'}
        </button>
      </div>

      {/* ── Error ── */}
      {error && (
        <div className="mb-3 p-2 text-[11px] rounded"
          style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Signal Badge ── */}
      {data && sig && (
        <div
          className="flex items-center gap-3 p-2.5 rounded-lg mb-3"
          style={{ background: sig.bg, border: `1px solid ${sig.border}` }}
        >
          <span className="text-xl">{sig.icon}</span>
          <div className="flex-1">
            <div className="text-[13px] font-bold tracking-wider" style={{ color: sig.color }}>
              {sig.label}
            </div>
            <div className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
              {data.price_change_pct > 0 ? '+' : ''}{data.price_change_pct.toFixed(2)}% over&nbsp;
              {data.forecast.length} {data.timeframe} candles
              &nbsp;·&nbsp;confidence {(data.confidence_score * 100).toFixed(0)}%
            </div>
          </div>
          <div className="text-right text-[10px]" style={{ color: '#64748b' }}>
            <div>model</div>
            <div style={{ color: '#a78bfa' }}>{data.model}</div>
          </div>
        </div>
      )}

      {/* ── Chart ── */}
      <div
        className="rounded-lg mb-3 flex items-center justify-center"
        style={{
          background: 'rgba(10,15,30,0.6)',
          border: '1px solid rgba(51,65,85,0.4)',
          minHeight: '208px',
          padding: '8px',
        }}
      >
        {loading && (
          <div className="text-center" style={{ color: '#475569', fontSize: '11px' }}>
            <div className="text-2xl mb-2">⏳</div>
            Kronos inference running…
            <div className="text-[9px] mt-1" style={{ color: '#334155' }}>
              CPU: ~4–9s · GPU: ~0.7s
            </div>
          </div>
        )}
        {!loading && data && (
          <ForecastChart
            contextCandles={data.context_candles.map(c => ({ t: c.t, c: c.c }))}
            forecast={data.forecast}
          />
        )}
        {!loading && !data && !error && (
          <div style={{ color: '#334155', fontSize: '11px' }}>Press ▶ FORECAST to generate</div>
        )}
      </div>

      {/* ── Candle Table ── */}
      {data && (
        <div className="overflow-x-auto">
          <table style={{ width: '100%', fontSize: '10px', borderCollapse: 'collapse', color: '#94a3b8' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(51,65,85,0.4)' }}>
                {['TIME','OPEN','HIGH','LOW','CLOSE','CI LOW','CI HIGH'].map(h => (
                  <th key={h} style={{ padding: '3px 5px', textAlign: 'right', color: '#475569', fontWeight: 600, letterSpacing: '0.05em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.forecast.slice(0, 6).map((c, i) => {
                const bull = c.close >= c.open;
                return (
                  <tr key={i} style={{ borderBottom: '1px solid rgba(30,41,59,0.4)' }}>
                    <td style={{ padding: '2.5px 5px', color: '#64748b' }}>
                      {new Date(c.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    {[c.open, c.high, c.low].map((v, j) => (
                      <td key={j} style={{ padding: '2.5px 5px', textAlign: 'right' }}>
                        {v.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                    ))}
                    <td style={{ padding: '2.5px 5px', textAlign: 'right', color: bull ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                      {c.close.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '2.5px 5px', textAlign: 'right', color: '#475569' }}>
                      {c.ci_low.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                    <td style={{ padding: '2.5px 5px', textAlign: 'right', color: '#475569' }}>
                      {c.ci_high.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.forecast.length > 6 && (
            <div style={{ fontSize: '10px', color: '#334155', textAlign: 'center', padding: '3px' }}>
              + {data.forecast.length - 6} more candles
            </div>
          )}
        </div>
      )}

      {/* ── Footer ── */}
      {lastFetch && (
        <div className="text-right mt-2" style={{ fontSize: '9px', color: '#334155' }}>
          updated {lastFetch.toLocaleTimeString()} · cache 5 min
        </div>
      )}
    </div>
  );
}

// Shared select style
const sel: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: '11px',
  background: 'rgba(15,23,42,0.9)',
  color: '#94a3b8',
  border: '1px solid rgba(51,65,85,0.5)',
  borderRadius: '5px',
  fontFamily: 'inherit',
  cursor: 'pointer',
};
