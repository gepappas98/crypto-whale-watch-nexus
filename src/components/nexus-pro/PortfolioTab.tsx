import { WalletIcon, TrendingUpIcon, TrendingDownIcon } from "lucide-react";
import type { PortfolioAsset, TradeHistory } from "@/lib/botApi";

interface PortfolioTabProps {
  portfolio: PortfolioAsset[];
  recentTrades: TradeHistory[];
  totalPnl: number;
  dailyPnl: number;
  isConnected: boolean;
}

export function PortfolioTab({
  portfolio,
  recentTrades,
  totalPnl,
  dailyPnl,
  isConnected,
}: PortfolioTabProps) {
  const totalValue = portfolio.reduce((sum, asset) => sum + asset.valueUsd, 0);

  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-400">
        <div className="w-12 h-12 rounded-full border-2 border-slate-600 border-t-cyan-400 animate-spin mb-4" />
        <p>Awaiting connection to portfolio tracker...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <div className="p-4 rounded-lg border border-slate-700 bg-slate-800/50">
          <p className="text-slate-400 text-sm mb-1">Total Value</p>
          <p className="text-2xl font-semibold text-slate-100">
            ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="p-4 rounded-lg border border-slate-700 bg-slate-800/50">
          <p className="text-slate-400 text-sm mb-1">Total P&L</p>
          <p
            className={`text-2xl font-semibold ${
              totalPnl >= 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {totalPnl >= 0 ? "+" : ""}${totalPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="p-4 rounded-lg border border-slate-700 bg-slate-800/50">
          <p className="text-slate-400 text-sm mb-1">24h P&L</p>
          <p
            className={`text-2xl font-semibold ${
              dailyPnl >= 0 ? "text-emerald-400" : "text-red-400"
            }`}
          >
            {dailyPnl >= 0 ? "+" : ""}${dailyPnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        </div>
        <div className="p-4 rounded-lg border border-slate-700 bg-slate-800/50">
          <p className="text-slate-400 text-sm mb-1">Assets</p>
          <p className="text-2xl font-semibold text-slate-100">{portfolio.length}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Holdings */}
        <div>
          <h3 className="text-lg font-semibold text-slate-100 mb-4">Holdings</h3>
          {portfolio.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400 border border-dashed border-slate-700 rounded-lg">
              <WalletIcon className="w-10 h-10 mb-3 opacity-50" />
              <p>No assets in portfolio</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {portfolio.map((asset, idx) => (
                <div
                  key={`${asset.symbol}-${asset.exchange}-${idx}`}
                  className="flex items-center justify-between p-3 rounded-lg border border-slate-700 bg-slate-800/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center">
                      <span className="text-sm font-semibold text-slate-300">
                        {asset.symbol.slice(0, 2)}
                      </span>
                    </div>
                    <div>
                      <p className="font-medium text-slate-100">{asset.symbol}</p>
                      <p className="text-xs text-slate-400">
                        {asset.amount.toLocaleString(undefined, { maximumFractionDigits: 6 })} on {asset.exchange}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="font-medium text-slate-100">
                      ${asset.valueUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </p>
                    <div
                      className={`flex items-center justify-end gap-1 text-xs ${
                        asset.change24h >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {asset.change24h >= 0 ? (
                        <TrendingUpIcon className="w-3 h-3" />
                      ) : (
                        <TrendingDownIcon className="w-3 h-3" />
                      )}
                      {asset.change24h >= 0 ? "+" : ""}
                      {asset.change24h.toFixed(2)}%
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Trades */}
        <div>
          <h3 className="text-lg font-semibold text-slate-100 mb-4">Recent Trades</h3>
          {recentTrades.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-slate-400 border border-dashed border-slate-700 rounded-lg">
              <p>No recent trades</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[400px] overflow-y-auto">
              {recentTrades.map((trade) => (
                <div
                  key={trade.id}
                  className={`flex items-center justify-between p-3 rounded-lg border ${
                    trade.side === "buy"
                      ? "border-emerald-800/50 bg-emerald-950/20"
                      : "border-red-800/50 bg-red-950/20"
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                          trade.side === "buy"
                            ? "bg-emerald-900/50 text-emerald-400"
                            : "bg-red-900/50 text-red-400"
                        }`}
                      >
                        {trade.side.toUpperCase()}
                      </span>
                      <span className="font-medium text-slate-100">{trade.pair}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">
                      {trade.amount.toLocaleString()} @ ${trade.price.toLocaleString()}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="font-medium text-slate-100">
                      ${trade.total.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-slate-500">
                      {new Date(trade.timestamp).toLocaleTimeString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
