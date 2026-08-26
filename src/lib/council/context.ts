/* ══ AGENT COUNCIL — CONTEXT BUILDER ══════════════════════════════════════════
 *  Turns existing Whale Radar state (detection, birdeye, dex, HL, whale feed)
 *  into the single context object injected into every agent prompt.
 * ═══════════════════════════════════════════════════════════════════════════ */
import type { CoinData, WhaleTrade } from '@/lib/whaleRadarState';
import type { CouncilContext } from '@/types/council';
import type { RegimeReading } from '@/lib/regime/types';
import { getCeoSignalLabel } from '@/services/signals';

// getCeoSignalLabel used to be duplicated here with its own, different
// thresholds/label set ('STRONG ACCUMULATION SIGNAL' / 'NO EDGE' / etc.)
// instead of reusing the canonical version in services/signals.ts (the one
// WRScanner's live table actually shows the user, 'AGGRESSIVE LONG' /
// 'AVOID / SHORT' / etc.). That meant the AI Council was being told a
// completely different "CEO signal" for the same coin than what the user
// was looking at on screen — re-exported here (not re-implemented) so both
// surfaces can never drift apart again.
export { getCeoSignalLabel };

export function isHighSignal(c: Partial<CoinData>): boolean {
  const score = c.score ?? 0;
  return score >= 70 || c.threat === 'CRITICAL' || c.threat === 'HIGH';
}

export function buildCouncilContext(
  coin: CoinData,
  opts: {
    whaleTrades?: WhaleTrade[];
    hyperliquid?: { fundingRate?: number; openInterest?: number; markPrice?: number } | null;
    regime?: RegimeReading | null;
  } = {},
): CouncilContext {
  const sym = (coin.symbol || '').toUpperCase();
  const trades = (opts.whaleTrades ?? [])
    .filter(t => (t.sym || '').toUpperCase().startsWith(sym))
    .slice(0, 15)
    .map(t => ({ sym: t.sym, side: t.side, usdt: t.usdt, ex: t.ex, ts: t.ts }));

  return {
    symbol: sym,
    tokenId: coin.id,
    name: coin.name,
    price: coin.price ?? 0,
    change24h: Number((coin.change ?? 0).toFixed(2)),
    volume: Math.round(coin.volume ?? 0),
    mcap: Math.round(coin.mcap ?? 0),
    vmcapPct: Math.round(coin.vmcap ?? 0),
    volSpike: coin.volSpike ? Number(coin.volSpike.toFixed(2)) : undefined,
    whaleScore: Math.round(coin.score ?? 0),
    whaleReasons: coin.reasons ?? [],
    threat: coin.threat ?? 'LOW',
    manipulationPattern: coin.category ?? null,
    ceoSignal: getCeoSignalLabel(coin.score ?? 0, coin.threat ?? '', coin.category ?? '', coin.vmcap ?? 0),
    birdeye: coin.birdData
      ? {
          rugScore: coin.birdData.rugScore,
          top10pct: coin.birdData.top10pct,
          creatorPct: coin.birdData.creatorPct,
          isMintable: coin.birdData.isMintable,
          isFreezable: coin.birdData.isFreezable,
          lpBurned: coin.birdData.lpBurned,
          ageDays: coin.birdData.ageDays,
        }
      : null,
    dex: coin.dsLiq ?? null,
    hyperliquid: opts.hyperliquid ?? null,
    recentWhaleTrades: trades,
    isSol: coin.isSol,
    regime: opts.regime
      ? {
          score: opts.regime.score,
          regime: opts.regime.regime,
          confirmedRegime: opts.regime.confirmedRegime,
          tier: opts.regime.tier,
          heldSnapshots: opts.regime.heldSnapshots,
          agreeing: opts.regime.agreeing,
          active: opts.regime.active,
          reasons: opts.regime.reasons,
        }
      : null,
  };
}
