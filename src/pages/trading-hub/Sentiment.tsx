import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { tradingApi, REFRESH, errText } from "@/lib/trading-api";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, ExternalLink } from "lucide-react";
import { SymbolQuickSelect } from "@/components/trading/SymbolQuickSelect";

function pctColor(s: string) {
  return s === "Bullish" || s === "Positive" ? "text-emerald-500" :
    s === "Bearish" || s === "Negative" ? "text-destructive" : "text-amber-500";
}

function verdictColor(v: string) {
  if (v.includes("STRONG BUY")) return "bg-emerald-600";
  if (v.includes("BUY")) return "bg-emerald-500/70";
  if (v.includes("STRONG SELL")) return "bg-red-600";
  if (v.includes("SELL")) return "bg-red-500/70";
  return "bg-amber-500/70";
}

export default function Sentiment() {
  const [symbol, setSymbol] = useState("BTC-USD");
  const [input, setInput] = useState("BTC-USD");

  const sent = useQuery({
    queryKey: ["sent", symbol], queryFn: () => tradingApi.sentiment(symbol),
    staleTime: REFRESH.sentiment, refetchInterval: REFRESH.sentiment,
  });
  const news = useQuery({
    queryKey: ["news", symbol], queryFn: () => tradingApi.news(symbol),
    staleTime: REFRESH.news, refetchInterval: REFRESH.news,
  });
  const combined = useQuery({
    queryKey: ["combined", symbol], queryFn: () => tradingApi.combined(symbol),
    staleTime: REFRESH.sentiment, refetchInterval: REFRESH.sentiment,
  });

  const selectSymbol = (s: string) => { setSymbol(s); setInput(s); };

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <Card className="p-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
        <Input className="w-48" value={input} onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => e.key === "Enter" && setSymbol(input.trim())} />
        <Button onClick={() => setSymbol(input.trim())}>Analyze</Button>
        <span className="text-xs text-muted-foreground ml-auto">Symbol: {symbol}</span>
        </div>
        <SymbolQuickSelect value={symbol} onSelect={selectSymbol} />
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Reddit */}
        <Card className="p-4">
          <div className="text-sm font-semibold mb-2">Reddit Sentiment</div>
          {sent.isLoading && <Skeleton className="h-40" />}
          {sent.isError && <div className="text-xs text-destructive"><AlertCircle className="w-3 h-3 inline mr-1" />{errText(sent.error)}</div>}
          {sent.data && (
            <>
              <div className="text-3xl font-bold">{sent.data.score.toFixed(2)}</div>
              <div className={`text-sm font-semibold ${pctColor(sent.data.label)}`}>{sent.data.label}</div>
              <div className="text-xs text-muted-foreground">{sent.data.postsAnalyzed} posts · {sent.data.bullishHits} bull / {sent.data.bearishHits} bear</div>
              <div className="mt-3 space-y-2">
                {sent.data.topPosts.map((p) => (
                  <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="block text-xs hover:bg-secondary/50 p-1 rounded">
                    <div className="font-medium line-clamp-2">{p.title}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={pctColor(p.sentiment)}>{p.sentiment}</span>
                      <span className="text-muted-foreground">↑{p.score}</span>
                    </div>
                  </a>
                ))}
              </div>
            </>
          )}
        </Card>

        {/* News */}
        <Card className="p-4">
          <div className="text-sm font-semibold mb-2">Live News Feed</div>
          {news.isLoading && <Skeleton className="h-40" />}
          {news.isError && <div className="text-xs text-destructive"><AlertCircle className="w-3 h-3 inline mr-1" />{errText(news.error)}</div>}
          {news.data && news.data.items.length === 0 && (
            <div className="text-xs text-muted-foreground">No recent news for {symbol}</div>
          )}
          {news.data && (
            <div className="space-y-2 max-h-[500px] overflow-auto">
              {news.data.items.map((n, i) => (
                <a key={i} href={n.url} target="_blank" rel="noreferrer" className="block text-xs hover:bg-secondary/50 p-2 rounded border border-border">
                  <div className="font-medium line-clamp-2 flex items-start gap-1">
                    {n.title} <ExternalLink className="w-3 h-3 shrink-0 mt-0.5" />
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground">
                    <span>{n.source}</span>
                    <span>·</span>
                    <span>{new Date(n.published).toLocaleString()}</span>
                    <span className={`ml-auto ${pctColor(n.sentiment)}`}>{n.sentiment}</span>
                  </div>
                </a>
              ))}
            </div>
          )}
        </Card>

        {/* Combined */}
        <Card className="p-4">
          <div className="text-sm font-semibold mb-2">Combined Analysis</div>
          {combined.isLoading && <Skeleton className="h-40" />}
          {combined.isError && <div className="text-xs text-destructive"><AlertCircle className="w-3 h-3 inline mr-1" />{errText(combined.error)}</div>}
          {combined.data && (
            <>
              <div className={`px-3 py-2 rounded text-center font-bold text-lg text-white ${verdictColor(combined.data.verdict)}`}>
                {combined.data.verdict}
              </div>
              <div className="mt-3 text-sm">Confidence: <span className="font-bold">{combined.data.confidence}%</span></div>
              <div className="mt-3 space-y-1 text-xs">
                <div>Technical: <span className="font-semibold">{combined.data.breakdown.technical}</span></div>
                <div>Sentiment: <span className={`font-semibold ${pctColor(combined.data.breakdown.sentiment)}`}>{combined.data.breakdown.sentiment}</span></div>
                <div>News: <span className={`font-semibold ${pctColor(combined.data.breakdown.news)}`}>{combined.data.breakdown.news}</span></div>
              </div>
              {combined.data.mixed && (
                <div className="mt-3 text-xs text-amber-500">⚠ Mixed signals — exercise caution</div>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
