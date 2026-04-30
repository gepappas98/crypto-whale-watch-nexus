import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import type { WhaleSignal } from "@/hooks/useBotBridge";

interface WhaleWatchTabProps {
  signals: WhaleSignal[];
  isConnected: boolean;
}

export function WhaleWatchTab({ signals, isConnected }: WhaleWatchTabProps) {
  if (!isConnected) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-400">
        <div className="w-12 h-12 rounded-full border-2 border-slate-600 border-t-cyan-400 animate-spin mb-4" />
        <p>Awaiting connection to whale bridge...</p>
      </div>
    );
  }

  if (signals.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-400">
        <p>No whale signals yet. Monitoring for large transactions...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-slate-100">Live Whale Feed</h3>
        <span className="text-sm text-slate-400">{signals.length} signals</span>
      </div>

      <div className="space-y-2 max-h-[600px] overflow-y-auto">
        {signals.map((signal) => (
          <div
            key={signal.id}
            className={`flex items-center justify-between p-4 rounded-lg border ${
              signal.type === "buy"
                ? "bg-emerald-950/30 border-emerald-800/50"
                : "bg-red-950/30 border-red-800/50"
            }`}
          >
            <div className="flex items-center gap-4">
              <div
                className={`p-2 rounded-full ${
                  signal.type === "buy" ? "bg-emerald-900/50" : "bg-red-900/50"
                }`}
              >
                {signal.type === "buy" ? (
                  <ArrowUpIcon className="w-5 h-5 text-emerald-400" />
                ) : (
                  <ArrowDownIcon className="w-5 h-5 text-red-400" />
                )}
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-slate-100">{signal.symbol}</span>
                  <span className="text-xs px-2 py-0.5 rounded bg-slate-700 text-slate-300">
                    {signal.exchange}
                  </span>
                </div>
                <p className="text-sm text-slate-400">
                  {signal.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} {signal.symbol}
                </p>
              </div>
            </div>

            <div className="text-right">
              <p
                className={`font-semibold ${
                  signal.type === "buy" ? "text-emerald-400" : "text-red-400"
                }`}
              >
                ${signal.usdValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
              <p className="text-xs text-slate-500">
                {new Date(signal.timestamp).toLocaleTimeString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
