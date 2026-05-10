/* ══ CoinGecko data status badge ════════════════════════════════════════════
 * Shows live/cached/degraded/error state of the CoinGecko market scan
 * pipeline. Pure presentational — derives its state from props.
 * ═════════════════════════════════════════════════════════════════════════ */
import { useEffect, useState } from 'react';

type DataSource = 'live' | 'cached' | 'fallback';

interface Props {
  dataSource: DataSource;
  scanBadge: string;     // 'LIVE' | 'CACHED' | 'DEGRADED' | 'ERROR' | 'SCANNING' | 'IDLE' | 'WAIT 60s'
  lastScanTs: number;    // ms epoch, 0 if never
  scanning: boolean;
}

function fmtAgo(ms: number) {
  if (!ms) return 'never';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function WRCoinGeckoStatus({ dataSource, scanBadge, lastScanTs, scanning }: Props) {
  // Tick once a second so the "ago" label stays fresh.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const stale = lastScanTs > 0 && Date.now() - lastScanTs > 120_000;

  let state: 'live' | 'cached' | 'degraded' | 'error' | 'scanning' | 'idle' | 'waiting';
  let label: string;

  if (scanning || scanBadge === 'SCANNING') {
    state = 'scanning'; label = 'SCANNING…';
  } else if (scanBadge === 'ERROR' || dataSource === 'fallback') {
    state = 'error'; label = 'ERROR';
  } else if (scanBadge.startsWith('WAIT')) {
    state = 'waiting'; label = scanBadge;
  } else if (lastScanTs === 0) {
    state = 'idle'; label = 'IDLE';
  } else if (dataSource === 'cached' || stale) {
    state = stale ? 'degraded' : 'cached';
    label = stale ? 'STALE' : 'CACHED';
  } else {
    state = 'live'; label = 'LIVE';
  }

  const palette: Record<typeof state, { dot: string; text: string; anim: string }> = {
    live:     { dot: 'bg-wr-green',  text: 'text-wr-green',  anim: 'animate-blink' },
    cached:   { dot: 'bg-wr-amber',  text: 'text-wr-amber',  anim: '' },
    degraded: { dot: 'bg-wr-amber',  text: 'text-wr-amber',  anim: 'animate-pulse' },
    error:    { dot: 'bg-wr-red',    text: 'text-wr-red',    anim: 'animate-pulse' },
    scanning: { dot: 'bg-wr-green',  text: 'text-wr-green',  anim: 'animate-pulse' },
    waiting:  { dot: 'bg-wr-amber',  text: 'text-wr-amber',  anim: '' },
    idle:     { dot: 'bg-wr-muted',  text: 'text-wr-muted',  anim: '' },
  };
  const p = palette[state];

  return (
    <span
      className="flex items-center gap-1"
      title={`CoinGecko market data — ${label} · last scan ${fmtAgo(lastScanTs)}`}
    >
      <span className="text-wr-muted">CG:</span>
      <span className={`w-1.5 h-1.5 rounded-full ${p.dot} ${p.anim}`} />
      <span className={p.text}>{label}</span>
      {lastScanTs > 0 && (
        <span className="text-wr-muted">· {fmtAgo(lastScanTs)}</span>
      )}
    </span>
  );
}
