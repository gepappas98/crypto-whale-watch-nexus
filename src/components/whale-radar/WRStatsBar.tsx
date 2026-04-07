/* ══ WHALE RADAR v9 — STATS BAR ══════════════════════════════════════════════ */
import { fmtN, CFG } from '@/lib/whaleRadarState';

interface WRStatsBarProps {
  alertsToday: number;
  apiCallCount: number;
  apiKey: string;
  lastScanTs: number;
  historyCount: number;
  portfolioValue: number;
}

export function WRStatsBar({ alertsToday, apiCallCount, apiKey, lastScanTs, historyCount, portfolioValue }: WRStatsBarProps) {
  const budget = apiKey ? CFG.DAILY_BUDGET_PRO : CFG.DAILY_BUDGET_FREE;
  const pct = Math.min((apiCallCount / budget) * 100, 100);
  const cacheAge = lastScanTs > 0 ? Math.floor((Date.now() - lastScanTs) / 1000) : 0;

  return (
    <div className="bg-wr-bg3 border-t border-wr-border px-4 py-1 flex gap-4 items-center flex-wrap">
      <Stat label="ALERTS" value={String(alertsToday)} />
      <div className="flex gap-1.5 items-center text-[8px] tracking-widest">
        <span className="text-wr-muted">API:</span>
        <span className="text-wr-white">{apiCallCount}</span>
        <div className="w-16 h-0.5 bg-wr-border overflow-hidden">
          <div
            className="h-full transition-all duration-500"
            style={{
              width: pct + '%',
              background: pct > 80 ? 'hsl(var(--wr-red))' : pct > 50 ? 'hsl(var(--wr-amber))' : 'hsl(var(--wr-green))',
            }}
          />
        </div>
        <span className="text-wr-muted">/{budget}</span>
      </div>
      <Stat label="CACHE" value={lastScanTs > 0 ? (cacheAge < 60 ? cacheAge + 's' : Math.floor(cacheAge / 60) + 'm') : '—'} />
      <Stat label="HIST" value={String(historyCount)} />
      <Stat label="PTF" value={portfolioValue > 0 ? '$' + fmtN(portfolioValue) : '—'} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5 items-center text-[8px] tracking-widest">
      <span className="text-wr-muted">{label}:</span>
      <span className="text-wr-white">{value}</span>
    </div>
  );
}
