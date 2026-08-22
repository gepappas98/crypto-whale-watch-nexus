/* ══ WHALE NET-FLOW HEATMAP ═══════════════════════════════════════════════════
 *  Real data only — per-asset net taker buy/sell notional from Binance klines,
 *  refreshed every 15s by useWhaleNetFlow. Assets are ranked from the live
 *  whale feed, falling back to the top scanner coins.
 * ═══════════════════════════════════════════════════════════════════════════ */
import React, { useMemo, useState } from 'react';
import { Activity, ArrowDownRight, ArrowUpRight, Filter, Info, Loader2 } from 'lucide-react';
import { WhaleTrade, CoinData } from '@/lib/whaleRadarState';
import { useWhaleNetFlow, TimeFrame } from '@/hooks/useWhaleNetFlow';

const TFS: TimeFrame[] = ['1h', '4h', '24h', '7d'];

const fmtFlow = (val: number) => {
  const a = Math.abs(val);
  const sign = val < 0 ? '-' : '+';
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`;
  return `${sign}$${a.toFixed(0)}`;
};

interface Props {
  whaleFeed: WhaleTrade[];
  coins: CoinData[];
}

export const WhaleHeatmap: React.FC<Props> = ({ whaleFeed, coins }) => {
  const [timeframe, setTimeframe] = useState<TimeFrame>('24h');

  // Rank assets by live whale activity; fall back to top scanner coins.
  const assets = useMemo(() => {
    const counts = new Map<string, number>();
    for (const t of whaleFeed) {
      const s = (t.sym || '').toUpperCase();
      if (s) counts.set(s, (counts.get(s) ?? 0) + t.usdt);
    }
    const names = new Map(coins.map(c => [c.symbol.toUpperCase(), c.name]));
    const ranked = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([symbol]) => ({ symbol, name: names.get(symbol) ?? symbol }));
    if (ranked.length >= 6) return ranked.slice(0, 12);
    const seen = new Set(ranked.map(r => r.symbol));
    for (const c of coins) {
      const s = c.symbol.toUpperCase();
      if (!seen.has(s)) { ranked.push({ symbol: s, name: c.name }); seen.add(s); }
      if (ranked.length >= 12) break;
    }
    return ranked;
  }, [whaleFeed, coins]);

  const { data, loading, error } = useWhaleNetFlow(timeframe, assets);

  const maxFlow = useMemo(
    () => Math.max(1, ...data.map(d => Math.abs(d.netFlow))),
    [data]
  );

  const tileStyle = (netFlow: number): React.CSSProperties => {
    const intensity = Math.min(Math.abs(netFlow) / maxFlow, 1);
    const opacity = Math.max(intensity * 0.5, 0.12);
    const hue = netFlow >= 0 ? 'var(--wr-green)' : 'var(--wr-red)';
    return {
      backgroundColor: `hsl(${hue} / ${opacity})`,
      borderColor: `hsl(${hue} / ${Math.min(opacity + 0.35, 1)})`,
    };
  };

  return (
    <section
      className="mx-2 my-2 rounded-lg border p-4"
      style={{ borderColor: 'hsl(var(--wr-border))', background: 'hsl(var(--wr-bg))' }}
      aria-label="Whale net flow heatmap"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5" style={{ color: 'hsl(var(--wr-cyan))' }} />
            <h2 className="text-base font-bold tracking-tight" style={{ color: 'hsl(var(--wr-white))' }}>
              WHALE NET FLOW HEATMAP
            </h2>
            {loading && <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'hsl(var(--wr-muted))' }} />}
          </div>
          <p className="text-[11px] mt-1" style={{ color: 'hsl(var(--wr-muted))' }}>
            Net taker buy vs sell notional per asset · refreshes every 15s
          </p>
        </div>

        <div
          className="flex items-center p-1 rounded-lg border self-start sm:self-auto"
          style={{ borderColor: 'hsl(var(--wr-border))' }}
        >
          <Filter className="w-3.5 h-3.5 ml-1 mr-1" style={{ color: 'hsl(var(--wr-muted))' }} />
          {TFS.map(tf => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              aria-pressed={timeframe === tf}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-md transition-colors"
              style={
                timeframe === tf
                  ? { background: 'hsl(var(--wr-cyan))', color: 'hsl(var(--wr-bg))' }
                  : { color: 'hsl(var(--wr-muted))' }
              }
            >
              {tf.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div
          className="text-xs py-8 text-center rounded-lg border border-dashed"
          style={{ color: 'hsl(var(--wr-muted))', borderColor: 'hsl(var(--wr-border))' }}
        >
          {loading ? 'Loading net flow…' : error ?? 'No net-flow data available yet.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {data.map(asset => (
            <div
              key={asset.symbol}
              style={tileStyle(asset.netFlow)}
              className="relative p-4 rounded-lg border flex flex-col justify-between min-h-[128px]"
            >
              <div className="flex justify-between items-start gap-2">
                <div>
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'hsl(var(--wr-bg) / 0.6)', color: 'hsl(var(--wr-white))' }}
                  >
                    {asset.symbol}
                  </span>
                  <h3 className="text-sm font-extrabold mt-1" style={{ color: 'hsl(var(--wr-white))' }}>
                    {asset.name}
                  </h3>
                </div>
                <div
                  className="flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                  style={{
                    background: 'hsl(var(--wr-bg) / 0.5)',
                    color: asset.change24h >= 0 ? 'hsl(var(--wr-green))' : 'hsl(var(--wr-red))',
                  }}
                >
                  {asset.change24h >= 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                  {asset.change24h.toFixed(1)}%
                </div>
              </div>

              <div className="mt-3 flex items-end justify-between gap-2">
                <div>
                  <p className="text-[9px] uppercase tracking-wider font-bold" style={{ color: 'hsl(var(--wr-muted))' }}>
                    Net Flow · {timeframe.toUpperCase()}
                  </p>
                  <p className="text-xl font-black" style={{ color: 'hsl(var(--wr-white))' }}>
                    {fmtFlow(asset.netFlow)}
                  </p>
                </div>
                <div className="text-right">
                  <span className="text-[9px] block" style={{ color: 'hsl(var(--wr-muted))' }}>
                    Trades
                  </span>
                  <span
                    className="text-xs font-bold px-1.5 py-0.5 rounded"
                    style={{ background: 'hsl(var(--wr-bg) / 0.4)', color: 'hsl(var(--wr-white))' }}
                  >
                    {asset.whaleCount.toLocaleString()} 🐋
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        className="flex flex-col sm:flex-row items-center justify-between text-[10px] pt-3 mt-4 border-t gap-2"
        style={{ color: 'hsl(var(--wr-muted))', borderColor: 'hsl(var(--wr-border))' }}
      >
        <div className="flex items-center gap-1.5">
          <Info className="w-3.5 h-3.5" />
          <span>Colour intensity scales with net buy (green) / net sell (red) notional.</span>
        </div>
        <div className="flex items-center gap-2">
          <span style={{ color: 'hsl(var(--wr-red))' }} className="font-semibold">Heavy Sell</span>
          <div
            className="h-2 w-24 rounded-full border"
            style={{
              borderColor: 'hsl(var(--wr-border))',
              background: 'linear-gradient(90deg, hsl(var(--wr-red)), hsl(var(--wr-bg)), hsl(var(--wr-green)))',
            }}
          />
          <span style={{ color: 'hsl(var(--wr-green))' }} className="font-semibold">Heavy Buy</span>
        </div>
      </div>
    </section>
  );
};

export default WhaleHeatmap;
