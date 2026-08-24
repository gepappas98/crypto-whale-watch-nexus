// src/components/ArbitrageCommandCenter.tsx
import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';

interface Opportunity {
  pair: string;
  route: string;
  spread: number;
  baseline: string;
  direction: 'LONG' | 'SHORT';
  estPL: number;
  confidence: number;
  hlPrice: number | null;
  bpPrice: number | null;
  binPrice: number | null;
}

const symbols = ['BTC', 'ETH', 'SOL'];

const fetchHyperliquidMids = async () => {
  const res = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'allMids' }),
  });
  if (!res.ok) throw new Error('HL fetch failed');
  return await res.json();
};

const fetchBinancePrice = async (symbol: string) => {
  const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}USDT`);
  if (!res.ok) throw new Error('Binance fetch failed');
  const data = await res.json();
  return parseFloat(data.price);
};

const fetchBackpackPrice = async (symbol: string) => {
  // Public Backpack ticker (adjust symbol mapping if needed)
  const res = await fetch(`https://api.backpack.exchange/api/v1/ticker?symbol=${symbol}_USDC`);
  if (!res.ok) throw new Error('Backpack fetch failed');
  const data = await res.json();
  return parseFloat(data.lastPrice || data.markPrice);
};

export default function ArbitrageCommandCenter() {
  const [lastScan, setLastScan] = useState<Date>(new Date());

  const { data: opportunities = [], isLoading, error, refetch } = useQuery({
    queryKey: ['arbitrage'],
    queryFn: async (): Promise<Opportunity[]> => {
      const results: Opportunity[] = [];
      const hlMids = await fetchHyperliquidMids();

      for (const sym of symbols) {
        let hlPrice: number | null = null;
        let bpPrice: number | null = null;
        let binPrice: number | null = null;

        try {
          hlPrice = parseFloat(hlMids[sym] || '0') || null;
        } catch (_) { /* price unavailable, stays null */ }

        try {
          binPrice = await fetchBinancePrice(sym);
        } catch (_) { /* price unavailable, stays null */ }

        try {
          bpPrice = await fetchBackpackPrice(sym);
        } catch (_) { /* price unavailable, stays null */ }

        const prices = [hlPrice, bpPrice, binPrice].filter((p): p is number => p !== null);
        if (prices.length < 2) continue;

        const maxPrice = Math.max(...prices);
        const minPrice = Math.min(...prices);
        const avgPrice = (maxPrice + minPrice) / 2;
        const spread = ((maxPrice - minPrice) / avgPrice) * 100;

        if (spread > 0.05) {
          const route = hlPrice && binPrice 
            ? (hlPrice > binPrice ? 'HL → Binance' : 'Binance → HL') 
            : 'Multi-venue';

          results.push({
            pair: `${sym}-PERP`,
            route,
            spread: parseFloat(spread.toFixed(3)),
            baseline: `${avgPrice.toFixed(2)}`,
            direction: hlPrice && hlPrice > avgPrice ? 'SHORT' : 'LONG',
            estPL: Math.round(spread * 8), // rough $1k est after fees
            confidence: spread > 0.3 ? 85 : spread > 0.15 ? 70 : 55,
            hlPrice,
            bpPrice,
            binPrice,
          });
        }
      }
      setLastScan(new Date());
      return results.sort((a, b) => b.spread - a.spread);
    },
    refetchInterval: 5000,
    retry: 2,
    staleTime: 4000,
  });

  return (
    <div className="space-y-6 p-4">
      <Card className="border border-green-500/30 bg-black/90">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-2xl font-mono text-green-400 flex items-center gap-3">
              ⚡ ARBITRAGE COMMAND CENTER
            </CardTitle>
            <div className="flex items-center gap-4">
              <Badge variant="outline" className="font-mono">
                SCAN EVERY 5s
              </Badge>
              <Button onClick={() => refetch()} size="sm" variant="outline">
                <RefreshCw className="w-4 h-4 mr-2" />
                Refresh Now
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="flex justify-between text-sm mb-4 text-gray-400">
            <div>Live spreads: HL ↔ Backpack ↔ Binance</div>
            <div>Last scan: {lastScan.toLocaleTimeString()}</div>
          </div>

          {error && (
            <div className="p-4 bg-red-950 border border-red-500 rounded mb-4 flex items-center gap-3">
              <AlertCircle className="text-red-400" />
              <div>{(error as Error).message}. Retrying automatically...</div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="border-b border-gray-800">
                  <th className="py-3 text-left">Pair</th>
                  <th className="py-3 text-left">Route</th>
                  <th className="py-3 text-right">Spread %</th>
                  <th className="py-3 text-right">Baseline</th>
                  <th className="py-3 text-center">Direction</th>
                  <th className="py-3 text-right">Est. P/L $1k</th>
                  <th className="py-3 text-right">Conf.</th>
                  <th className="py-3 text-center">Action</th>
                </tr>
              </thead>
              <tbody>
                {opportunities.length > 0 ? (
                  opportunities.map((opp, i) => (
                    <tr key={i} className="border-b border-gray-800 hover:bg-green-950/30">
                      <td className="py-4 font-bold">{opp.pair}</td>
                      <td className="py-4 text-gray-400">{opp.route}</td>
                      <td className="py-4 text-right text-green-400 font-bold">
                        +{opp.spread}%
                      </td>
                      <td className="py-4 text-right">${opp.baseline}</td>
                      <td className="py-4 text-center">
                        <Badge className={opp.direction === 'LONG' ? 'bg-green-600' : 'bg-red-600'}>
                          {opp.direction}
                        </Badge>
                      </td>
                      <td className="py-4 text-right font-bold text-emerald-400">
                        +${opp.estPL}
                      </td>
                      <td className="py-4 text-right">{opp.confidence}%</td>
                      <td className="py-4 text-center">
                        <Button size="sm" variant="secondary">Execute</Button>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={8} className="py-12 text-center text-gray-500">
                      No opportunities above 0.05% spread right now.<br />
                      <span className="text-xs">Real prices updating live • Check during volatility</span>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-6 text-xs text-gray-500 border-t border-gray-800 pt-4">
            ⚠️ For informational purposes only. Includes estimated fees (\~0.05-0.1%). 
            Always verify live order books before trading.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
