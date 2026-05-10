// Shared inline badge: pulls live RSI + overall signal for a symbol from the
// trading-bridge edge function. Designed to drop into rows/tables without
// causing a fetch storm — TanStack Query dedupes by [symbol, timeframe].

import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { tradingApi, REFRESH } from "@/lib/trading-api";

interface Props {
  /** Trading symbol in Yahoo format (e.g. BTC-USD, AAPL). */
  symbol: string;
  /** Optional timeframe override. Defaults to 1H — short-horizon context. */
  timeframe?: string;
  /** Hide the deep-link arrow. */
  noLink?: boolean;
  /** Disable the underlying network call (for hidden rows / virtualized lists). */
  enabled?: boolean;
}

function sigClass(s?: string) {
  if (!s) return "bg-muted text-muted-foreground";
  if (s.includes("STRONG BUY")) return "bg-emerald-600 text-white";
  if (s.includes("BUY")) return "bg-emerald-500/30 text-emerald-400";
  if (s.includes("STRONG SELL")) return "bg-red-600 text-white";
  if (s.includes("SELL")) return "bg-red-500/30 text-red-400";
  return "bg-amber-500/30 text-amber-400";
}

export function TechnicalContextBadge({
  symbol, timeframe = "1H", noLink = false, enabled = true,
}: Props) {
  const q = useQuery({
    queryKey: ["ta-badge", symbol, timeframe],
    queryFn: () => tradingApi.technical(symbol, timeframe),
    staleTime: REFRESH.technical,
    refetchInterval: REFRESH.technical,
    enabled: enabled && !!symbol,
    retry: 1,
  });

  if (q.isLoading) {
    return <span className="inline-block w-20 h-4 bg-muted/40 rounded animate-pulse" />;
  }

  if (q.isError || !q.data) {
    return (
      <span className="text-[10px] text-muted-foreground" title={String((q.error as Error)?.message ?? "TA unavailable")}>
        TA n/a
      </span>
    );
  }

  const d = q.data;
  const rsi = d.rsi.value;
  const inner = (
    <span className="inline-flex items-center gap-1 text-[10px] font-mono">
      <span
        className={`px-1.5 py-0.5 rounded ${
          rsi < 30 ? "bg-emerald-500/20 text-emerald-400" :
          rsi > 70 ? "bg-red-500/20 text-red-400" :
          "bg-muted text-muted-foreground"
        }`}
        title={`RSI ${d.rsi.signal}`}
      >
        RSI {rsi.toFixed(0)}
      </span>
      <span className={`px-1.5 py-0.5 rounded ${sigClass(d.overall.signal)}`} title={`${d.overall.confidence}% confidence`}>
        {d.overall.signal}
      </span>
    </span>
  );

  if (noLink) return inner;
  return (
    <Link to={`/trading-hub/technical?s=${encodeURIComponent(symbol)}`} className="hover:opacity-80">
      {inner}
    </Link>
  );
}

/** Whale-trade conviction tag: combines whale side + live RSI signal. */
export function WhaleConvictionTag({ symbol, side }: { symbol: string; side: "BUY" | "SELL" }) {
  const q = useQuery({
    queryKey: ["ta-badge", symbol, "1H"],
    queryFn: () => tradingApi.technical(symbol, "1H"),
    staleTime: REFRESH.technical,
    enabled: !!symbol,
    retry: 1,
  });
  if (!q.data) return null;
  const rsi = q.data.rsi.value;
  let label = "";
  let cls = "";
  if (side === "BUY" && rsi < 30) { label = "HIGH CONVICTION"; cls = "bg-emerald-600 text-white"; }
  else if (side === "BUY" && rsi > 70) { label = "CONTRARIAN WARNING"; cls = "bg-amber-600 text-white"; }
  else if (side === "SELL" && rsi > 70) { label = "HIGH CONVICTION"; cls = "bg-red-600 text-white"; }
  else if (side === "SELL" && rsi < 30) { label = "CONTRARIAN WARNING"; cls = "bg-amber-600 text-white"; }
  if (!label) return null;
  return <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${cls}`}>{label}</span>;
}
