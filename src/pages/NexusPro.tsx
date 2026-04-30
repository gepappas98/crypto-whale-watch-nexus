import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, PieChart, Pie, Cell
} from "recharts";
import {
  Activity, AlertTriangle, BarChart2, Grid3X3, TrendingUp, Wallet,
  Bell, Zap, Play, Square, Plus, X, ArrowUpDown, Shield,
  Volume2, Target, Cpu, Link, Radio, Settings
} from "lucide-react";

/* ═══════════════════════════════════════════════════════
   TYPES
═══════════════════════════════════════════════════════ */
interface HLMarket {
  symbol: string;
  markPx: number;
  midPx: number;
  funding: number;
  openInterest: number;
  volume24h: number;
  premium: number;
}

interface BinanceTicker {
  price: number;
  change24h: number;
  volume24h: number;
  high: number;
  low: number;
}

interface WhaleTrade {
  id: number | string;
  sym: string;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  usd: number;
  ex: string;
  ts: number;
}

interface ArbOpportunity {
  id: string;
  pair: string;
  symbol: string;
  hlPrice: number;
  binPrice: number;
  spreadPercent: number;
  fundingRate: number;
  fundingAnnualized: number;
  confidence: "high" | "medium" | "low";
  direction: string;
  estimatedProfit: number;
  volume24h: number;
  openInterest: number;
  status: string;
  ts: number;
}

interface AlertItem {
  type: "whale_large_tx" | "arbitrage_opportunity" | "whale_bot_correlation" | "risk_threshold_breach";
  message: string;
  symbol?: string;
  ts: number;
}

interface GridConfig {
  exchange: string;
  symbol: string;
  marketType: string;
  mode: string;
  upperPrice: string;
  lowerPrice: string;
  gridCount: number;
  totalInvestment: number;
  feeRate: number;
  takeProfit: string;
  stopLoss: string;
}

interface ActiveGrid extends GridConfig {
  id: number;
  status: string;
  createdAt: number;
  currentPrice: number;
  pnl: number;
  filledGrids: number;
  totalGrids: number;
}

interface Holding {
  symbol: string;
  amount: number;
  entry: number;
}

interface EnrichedHolding extends Holding {
  price: number;
  value: number;
  cost: number;
  pnl: number;
  pnlPct: number;
}

interface BotConfig {
  symbol: string;
  exchange: string;
  mode: string;
  signalSource: string;
  targetVolume: number;
  autoPauseOnWhale: boolean;
  whaleThreshold: number;
  running: boolean;
}

type WsStatus = "connecting" | "live" | "reconnecting" | "error";
type HlStatus = "connecting" | "live" | "error";
type BinStatus = "connecting" | "live" | "error";

/* ═══════════════════════════════════════════════════════
   DESIGN TOKENS
═══════════════════════════════════════════════════════ */
const T = {
  bg:       "#0a0a0f",
  surface:  "#14141f",
  surface2: "#1c1c2e",
  border:   "#1e1e3a",
  cyan:     "#00d4ff",
  green:    "#00ff88",
  red:      "#ff3366",
  orange:   "#ffaa00",
  purple:   "#c084fc",
  text:     "#ffffff",
  muted:    "#8b8b9e",
  dim:      "#3a3a5c",
} as const;

const PAIRS = ["BTC", "ETH", "SOL", "AVAX", "LINK", "ARB", "OP", "MATIC", "DOGE", "XRP"];
const BINANCE_PAIRS = PAIRS.map(p => `${p}USDT`);
const WHALE_THRESHOLD_USD = 200_000;

/* ═══════════════════════════════════════════════════════
   UTILITY FUNCTIONS
═══════════════════════════════════════════════════════ */
const fmt  = (n: number | null | undefined, d = 2): string =>
  n == null ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtK = (n: number): string =>
  n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B`
  : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M`
  : n >= 1e3 ? `$${(n / 1e3).toFixed(1)}K`
  : `$${fmt(n)}`;

const fmtPct = (n: number): string => `${n >= 0 ? "+" : ""}${fmt(n)}%`;
const timeAgo = (ts: number): string => {
  const s = Math.floor((Date.now() - ts) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m`;
};

/* ═══════════════════════════════════════════════════════
   REAL DATA HOOKS
═══════════════════════════════════════════════════════ */
function useHyperliquid() {
  const [markets, setMarkets]         = useState<HLMarket[]>([]);
  const [fundingRates, setFundingRates] = useState<Record<string, number>>({});
  const [hlStatus, setHlStatus]       = useState<HlStatus>("connecting");

  const fetchHL = useCallback(async () => {
    try {
      const res = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "metaAndAssetCtxs" }),
      });
      const [meta, ctxs]: [{ universe: { name: string }[] }, Record<string, string>[]] = await res.json();
      const universe = meta.universe || [];
      const parsed: HLMarket[] = universe.map((u, i) => {
        const ctx = ctxs[i] || {};
        return {
          symbol:       u.name,
          markPx:       parseFloat(ctx.markPx)       || 0,
          midPx:        parseFloat(ctx.midPx)        || 0,
          funding:      parseFloat(ctx.funding)      || 0,
          openInterest: parseFloat(ctx.openInterest) || 0,
          volume24h:    parseFloat(ctx.dayNtlVlm)    || 0,
          premium:      parseFloat(ctx.premium)      || 0,
        };
      });
      setMarkets(parsed);
      const fr: Record<string, number> = {};
      parsed.forEach(m => { fr[m.symbol] = m.funding; });
      setFundingRates(fr);
      setHlStatus("live");
    } catch {
      setHlStatus("error");
    }
  }, []);

  useEffect(() => {
    fetchHL();
    const iv = setInterval(fetchHL, 5000);
    return () => clearInterval(iv);
  }, [fetchHL]);

  return { markets, fundingRates, hlStatus, refetch: fetchHL };
}

function useBinancePrices() {
  const [prices, setPrices]     = useState<Record<string, BinanceTicker>>({});
  const [binStatus, setBinStatus] = useState<BinStatus>("connecting");

  const fetchBin = useCallback(async () => {
    try {
      const syms = JSON.stringify(BINANCE_PAIRS);
      const res  = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${encodeURIComponent(syms)}`);
      const data: Record<string, string>[] = await res.json();
      const parsed: Record<string, BinanceTicker> = {};
      data.forEach(d => {
        const sym = d.symbol.replace("USDT", "");
        parsed[sym] = {
          price:     parseFloat(d.lastPrice),
          change24h: parseFloat(d.priceChangePercent),
          volume24h: parseFloat(d.quoteVolume),
          high:      parseFloat(d.highPrice),
          low:       parseFloat(d.lowPrice),
        };
      });
      setPrices(parsed);
      setBinStatus("live");
    } catch {
      setBinStatus("error");
    }
  }, []);

  useEffect(() => {
    fetchBin();
    const iv = setInterval(fetchBin, 3000);
    return () => clearInterval(iv);
  }, [fetchBin]);

  return { prices, binStatus };
}

function useWhaleWebSocket(threshold = WHALE_THRESHOLD_USD) {
  const [whaleFeed, setWhaleFeed] = useState<WhaleTrade[]>([]);
  const [wsStatus, setWsStatus]   = useState<WsStatus>("connecting");
  const wsRef      = useRef<WebSocket | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retries    = useRef(0);

  const connect = useCallback(() => {
    try {
      const streams = ["btcusdt","ethusdt","solusdt","bnbusdt","avaxusdt","linkusdt"]
        .map(s => `${s}@aggTrade`).join("/");
      const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
      wsRef.current = ws;

      ws.onopen  = () => { setWsStatus("live"); retries.current = 0; };
      ws.onclose = () => {
        setWsStatus("reconnecting");
        const delay = Math.min(1000 * 2 ** retries.current, 30_000);
        retries.current++;
        retryTimer.current = setTimeout(connect, delay);
      };
      ws.onerror = () => setWsStatus("error");
      ws.onmessage = (e: MessageEvent) => {
        try {
          const msg  = JSON.parse(e.data as string);
          const d    = msg.data;
          if (!d || d.e !== "aggTrade") return;
          const sym   = (d.s as string).replace("USDT", "");
          const price = parseFloat(d.p);
          const qty   = parseFloat(d.q);
          const usd   = price * qty;
          if (usd < threshold) return;
          setWhaleFeed(prev => [{
            id:   d.a as number,
            sym,
            side: d.m ? "SELL" : "BUY",
            price, qty, usd,
            ex:   "BINANCE",
            ts:   d.T as number,
          }, ...prev].slice(0, 200));
        } catch { /* ignore malformed frames */ }
      };
    } catch { setWsStatus("error"); }
  }, [threshold]);

  useEffect(() => {
    connect();
    return () => {
      if (retryTimer.current) clearTimeout(retryTimer.current);
      if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); }
    };
  }, [connect]);

  return { whaleFeed, wsStatus };
}

function useArbitrage(
  hlMarkets: HLMarket[],
  binPrices: Record<string, BinanceTicker>,
  hlFunding: Record<string, number>,
): ArbOpportunity[] {
  return useMemo(() => {
    const opps: ArbOpportunity[] = [];
    PAIRS.forEach(sym => {
      const hl  = hlMarkets.find(m => m.symbol === sym);
      const bin = binPrices[sym];
      if (!hl || !bin || !hl.markPx || !bin.price) return;
      const hlPrice  = hl.markPx;
      const binPrice = bin.price;
      const spread   = ((hlPrice - binPrice) / binPrice) * 100;
      const absSpread = Math.abs(spread);
      const confidence: ArbOpportunity["confidence"] =
        absSpread > 0.3 ? "high" : absSpread > 0.1 ? "medium" : "low";
      opps.push({
        id:               `${sym}-${Date.now()}`,
        pair:             `${sym}/USDT`,
        symbol:           sym,
        hlPrice,
        binPrice,
        spreadPercent:    spread,
        fundingRate:      hlFunding[sym] || 0,
        fundingAnnualized:(hlFunding[sym] || 0) * 100 * 3 * 365,
        confidence,
        direction:        spread > 0 ? "short_hl_long_bin" : "long_hl_short_bin",
        estimatedProfit:  absSpread - 0.1,
        volume24h:        Math.min(hl.volume24h, bin.volume24h),
        openInterest:     hl.openInterest,
        status:           "detected",
        ts:               Date.now(),
      });
    });
    return opps.sort((a, b) => Math.abs(b.spreadPercent) - Math.abs(a.spreadPercent));
  }, [hlMarkets, binPrices, hlFunding]);
}

/* ═══════════════════════════════════════════════════════
   SHARED COMPONENTS
═══════════════════════════════════════════════════════ */
const StatusDot = ({ status }: { status: string }) => {
  const colors: Record<string, string> = {
    live: T.green, error: T.red, reconnecting: T.orange, connecting: T.muted,
  };
  return (
    <span style={{
      display: "inline-block", width: 6, height: 6, borderRadius: "50%",
      background: colors[status] ?? T.muted,
      boxShadow: status === "live" ? `0 0 6px ${T.green}` : "none",
    }} />
  );
};

const Badge = ({ children, color = T.cyan }: { children: React.ReactNode; color?: string }) => (
  <span style={{
    background: `${color}18`, color, border: `1px solid ${color}40`,
    borderRadius: 3, padding: "1px 6px", fontSize: 9,
    fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.08em",
  }}>{children}</span>
);

const Card = ({ children, style, className }: {
  children: React.ReactNode;
  style?: React.CSSProperties;
  className?: string;
}) => (
  <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 6, ...style }} className={className}>
    {children}
  </div>
);

const SectionHeader = ({ icon: Icon, title, subtitle, right }: {
  icon?: React.ElementType;
  title: string;
  subtitle?: string;
  right?: React.ReactNode;
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 14px",
    borderBottom: `1px solid ${T.border}` }}>
    {Icon && <Icon size={14} color={T.cyan} />}
    <div style={{ flex: 1 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.12em", color: T.text, fontFamily: "monospace" }}>{title}</div>
      {subtitle && <div style={{ fontSize: 9, color: T.muted, marginTop: 1 }}>{subtitle}</div>}
    </div>
    {right}
  </div>
);

const inputStyle: React.CSSProperties = {
  width: "100%", background: "#1c1c2e", border: `1px solid ${T.border}`, color: T.text,
  padding: "6px 8px", borderRadius: 3, fontSize: 10, fontFamily: "monospace",
  outline: "none", boxSizing: "border-box",
};

const GridField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div style={{ fontSize: 8, color: T.muted, marginBottom: 4, letterSpacing: "0.1em", fontFamily: "monospace" }}>{label}</div>
    {children}
  </div>
);

/* ═══════════════════════════════════════════════════════
   WHALE WATCH
═══════════════════════════════════════════════════════ */
function WhaleFeed({ feed }: { feed: WhaleTrade[] }) {
  const [filter, setFilter] = useState<"ALL" | "BUY" | "SELL">("ALL");
  const [minUsd, setMinUsd] = useState(200_000);

  const filtered = feed.filter(t =>
    (filter === "ALL" || t.side === filter) && t.usd >= minUsd
  );

  return (
    <Card style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <SectionHeader icon={Activity} title="LIVE WHALE FEED" subtitle="Binance aggregate trades › threshold"
        right={
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {(["ALL","BUY","SELL"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)} style={{
                padding: "2px 8px", fontSize: 9, borderRadius: 3, cursor: "pointer",
                background: filter === f ? `${f === "BUY" ? T.green : f === "SELL" ? T.red : T.cyan}22` : "transparent",
                color: filter === f ? (f === "BUY" ? T.green : f === "SELL" ? T.red : T.cyan) : T.muted,
                border: `1px solid ${filter === f ? (f === "BUY" ? T.green : f === "SELL" ? T.red : T.cyan) + "50" : T.border}`,
                fontFamily: "monospace",
              }}>{f}</button>
            ))}
            <select value={minUsd} onChange={e => setMinUsd(Number(e.target.value))}
              style={{ background: T.surface2, border: `1px solid ${T.border}`, color: T.muted,
                fontSize: 9, padding: "2px 4px", borderRadius: 3, fontFamily: "monospace" }}>
              <option value={100000}>$100K+</option>
              <option value={200000}>$200K+</option>
              <option value={500000}>$500K+</option>
              <option value={1000000}>$1M+</option>
            </select>
          </div>
        }
      />
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", color: T.muted, fontSize: 11, padding: 40 }}>
            <Radio size={20} style={{ margin: "0 auto 8px", display: "block", opacity: 0.4 }} />
            Scanning for whale trades...
          </div>
        ) : filtered.slice(0, 60).map((t, i) => <WhaleTxRow key={t.id ?? i} trade={t} />)}
      </div>
    </Card>
  );
}

function WhaleTxRow({ trade }: { trade: WhaleTrade }) {
  const isBuy     = trade.side === "BUY";
  const sizeLevel = trade.usd > 2_000_000 ? "MEGA" : trade.usd > 1_000_000 ? "LARGE" : "WHALE";
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "52px 50px 1fr 100px 80px 50px",
      gap: 6, padding: "5px 14px", borderBottom: `1px solid ${T.border}30`,
      background: isBuy ? `${T.green}06` : `${T.red}06`, alignItems: "center",
    }}>
      <Badge color={isBuy ? T.green : T.red}>{trade.side}</Badge>
      <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: T.cyan }}>{trade.sym}</span>
      <Badge color={sizeLevel === "MEGA" ? T.red : sizeLevel === "LARGE" ? T.orange : T.cyan}>{sizeLevel}</Badge>
      <span style={{ fontFamily: "monospace", fontSize: 11, color: isBuy ? T.green : T.red, fontWeight: 700 }}>{fmtK(trade.usd)}</span>
      <span style={{ fontFamily: "monospace", fontSize: 10, color: T.muted }}>${fmt(trade.price)}</span>
      <span style={{ fontFamily: "monospace", fontSize: 9, color: T.dim }}>{timeAgo(trade.ts)}</span>
    </div>
  );
}

function MarketOverview({ hlMarkets, binPrices }: { hlMarkets: HLMarket[]; binPrices: Record<string, BinanceTicker> }) {
  return (
    <Card style={{ overflow: "hidden" }}>
      <SectionHeader icon={BarChart2} title="MARKET OVERVIEW" subtitle="Hyperliquid Perps + Binance Spot" />
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
          <thead>
            <tr style={{ borderBottom: `1px solid ${T.border}` }}>
              {["PAIR","HL PRICE","BIN PRICE","SPREAD","FUNDING/8H","OI","24H VOL"].map(h => (
                <th key={h} style={{ padding: "6px 12px", textAlign: "left", color: T.muted,
                  fontSize: 8, letterSpacing: "0.1em", fontFamily: "monospace", whiteSpace: "nowrap" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PAIRS.slice(0, 10).map(sym => {
              const hl     = hlMarkets.find(m => m.symbol === sym);
              const bin    = binPrices[sym];
              const spread = hl && bin ? ((hl.markPx - bin.price) / bin.price) * 100 : 0;
              const spreadColor = Math.abs(spread) > 0.2 ? T.orange : Math.abs(spread) > 0.05 ? T.cyan : T.muted;
              return (
                <tr key={sym} style={{ borderBottom: `1px solid ${T.border}30` }}>
                  <td style={{ padding: "7px 12px", fontFamily: "monospace", fontWeight: 700, color: T.text, fontSize: 11 }}>{sym}</td>
                  <td style={{ padding: "7px 12px", fontFamily: "monospace", color: T.cyan }}>${fmt(hl?.markPx)}</td>
                  <td style={{ padding: "7px 12px", fontFamily: "monospace", color: T.text }}>${fmt(bin?.price)}</td>
                  <td style={{ padding: "7px 12px", fontFamily: "monospace", color: spreadColor, fontWeight: 700 }}>{fmtPct(spread)}</td>
                  <td style={{ padding: "7px 12px", fontFamily: "monospace",
                    color: (hl?.funding ?? 0) > 0 ? T.green : (hl?.funding ?? 0) < 0 ? T.red : T.muted }}>
                    {((hl?.funding ?? 0) * 100).toFixed(4)}%
                  </td>
                  <td style={{ padding: "7px 12px", fontFamily: "monospace", color: T.muted }}>{fmtK((hl?.openInterest ?? 0) * (hl?.markPx ?? 0))}</td>
                  <td style={{ padding: "7px 12px", fontFamily: "monospace", color: T.muted }}>{fmtK(hl?.volume24h ?? 0)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════
   ARBITRAGE PANEL
═══════════════════════════════════════════════════════ */
function ArbitragePanel({ opportunities, onExecute }: {
  opportunities: ArbOpportunity[];
  onExecute: (opp: ArbOpportunity) => Promise<void>;
}) {
  const [selected, setSelected]         = useState<ArbOpportunity | null>(null);
  const [spreadHistory, setSpreadHistory] = useState<Record<string, { t: number; v: number }[]>>({});
  const [executing, setExecuting]       = useState<string | null>(null);

  useEffect(() => {
    if (!opportunities.length) return;
    const now = Date.now();
    setSpreadHistory(prev => {
      const next = { ...prev };
      opportunities.forEach(opp => {
        const hist = prev[opp.symbol] ?? [];
        next[opp.symbol] = [...hist.slice(-29), { t: now, v: opp.spreadPercent }];
      });
      return next;
    });
  }, [opportunities]);

  const handleExecute = async (opp: ArbOpportunity) => {
    setExecuting(opp.symbol);
    await onExecute(opp);
    setTimeout(() => setExecuting(null), 3000);
  };

  const confColor: Record<string, string> = { high: T.green, medium: T.orange, low: T.muted };

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: 12, height: "100%" }}>
      <Card style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <SectionHeader icon={ArrowUpDown} title="ARBITRAGE OPPORTUNITIES"
          subtitle={`${opportunities.filter(o => Math.abs(o.spreadPercent) > 0.05).length} active signals | HL Perp ↔ Binance Spot`}
          right={<Badge color={T.cyan}>LIVE</Badge>}
        />
        <div style={{ flex: 1, overflowY: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead style={{ position: "sticky", top: 0, background: T.surface, zIndex: 1 }}>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                {["PAIR","HL PRICE","BIN PRICE","SPREAD","FUNDING DAILY","CONFIDENCE","ACTION"].map(h => (
                  <th key={h} style={{ padding: "7px 12px", textAlign: "left", color: T.muted,
                    fontSize: 8, letterSpacing: "0.1em", fontFamily: "monospace" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {opportunities.map(opp => {
                const abs   = Math.abs(opp.spreadPercent);
                const color = abs > 0.3 ? T.green : abs > 0.1 ? T.cyan : T.muted;
                const isSel = selected?.symbol === opp.symbol;
                return (
                  <tr key={opp.symbol} onClick={() => setSelected(isSel ? null : opp)}
                    style={{ borderBottom: `1px solid ${T.border}30`, cursor: "pointer",
                      background: isSel ? `${T.cyan}08` : "transparent", transition: "background 0.2s" }}>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 700, color: T.text }}>{opp.pair}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: T.cyan }}>${fmt(opp.hlPrice)}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: T.text }}>${fmt(opp.binPrice)}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 700, color }}>{fmtPct(opp.spreadPercent)}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace",
                      color: opp.fundingRate > 0 ? T.green : opp.fundingRate < 0 ? T.red : T.muted }}>
                      {fmtPct(opp.fundingRate * 24 * 3 * 100)}
                    </td>
                    <td style={{ padding: "8px 12px" }}><Badge color={confColor[opp.confidence]}>{opp.confidence.toUpperCase()}</Badge></td>
                    <td style={{ padding: "8px 12px" }}>
                      {abs > 0.05 ? (
                        <button onClick={e => { e.stopPropagation(); void handleExecute(opp); }}
                          disabled={executing === opp.symbol}
                          style={{
                            padding: "3px 10px", fontSize: 9, borderRadius: 3, cursor: "pointer",
                            background: executing === opp.symbol ? T.dim : `${T.cyan}22`,
                            color: executing === opp.symbol ? T.muted : T.cyan,
                            border: `1px solid ${executing === opp.symbol ? T.dim : T.cyan + "50"}`,
                            fontFamily: "monospace", fontWeight: 700,
                          }}>
                          {executing === opp.symbol ? "EXECUTING…" : "EXECUTE"}
                        </button>
                      ) : <span style={{ color: T.dim, fontSize: 9, fontFamily: "monospace" }}>LOW SPREAD</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Card style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <SectionHeader icon={TrendingUp} title={selected ? `${selected.symbol} SPREAD` : "SELECT A PAIR"} />
          <div style={{ flex: 1, padding: 12 }}>
            {selected ? (
              <>
                <div style={{ height: 140 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={spreadHistory[selected.symbol] ?? []}>
                      <defs>
                        <linearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={T.cyan} stopOpacity={0.3} />
                          <stop offset="95%" stopColor={T.cyan} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis hide />
                      <YAxis tick={{ fontSize: 8, fill: T.muted }} tickFormatter={v => `${(v as number).toFixed(2)}%`} width={45} />
                      <Tooltip
                        formatter={(v: number) => [`${v.toFixed(4)}%`, "Spread"]}
                        contentStyle={{ background: T.surface2, border: `1px solid ${T.border}`, fontSize: 10 }}
                      />
                      <ReferenceLine y={0} stroke={T.border} strokeDasharray="3 3" />
                      <Area type="monotone" dataKey="v" stroke={T.cyan} fill="url(#sg)" strokeWidth={1.5} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 12 }}>
                  {([
                    ["SPREAD",    fmtPct(selected.spreadPercent),          Math.abs(selected.spreadPercent) > 0.1 ? T.green : T.muted],
                    ["DIRECTION", selected.direction.replace(/_/g," ").toUpperCase(), T.cyan],
                    ["FUNDING 8H",`${(selected.fundingRate*100).toFixed(4)}%`, selected.fundingRate > 0 ? T.green : T.red],
                    ["OI",        fmtK(selected.openInterest * selected.hlPrice), T.muted],
                  ] as [string, string, string][]).map(([label, value, color]) => (
                    <div key={label} style={{ background: T.surface2, borderRadius: 4, padding: "8px 10px", border: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 8, color: T.muted, marginBottom: 3, letterSpacing: "0.1em", fontFamily: "monospace" }}>{label}</div>
                      <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color }}>{value}</div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{ textAlign: "center", color: T.muted, fontSize: 11, paddingTop: 40 }}>
                <ArrowUpDown size={24} style={{ margin: "0 auto 10px", display: "block", opacity: 0.3 }} />
                Click a pair to view<br />spread chart & details
              </div>
            )}
          </div>
        </Card>

        <Card>
          <SectionHeader icon={Shield} title="EXECUTION BRIDGE" />
          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 9, color: T.muted, marginBottom: 10, lineHeight: 1.6, fontFamily: "monospace" }}>
              Connect FastAPI bot bridge to enable live execution.
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px",
              background: `${T.orange}12`, border: `1px solid ${T.orange}30`, borderRadius: 4, marginBottom: 8 }}>
              <Link size={10} color={T.orange} />
              <span style={{ fontSize: 9, color: T.orange, fontFamily: "monospace" }}>BOT BRIDGE: NOT CONNECTED</span>
            </div>
            <input placeholder="http://localhost:8000" style={inputStyle} />
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   GRID STUDIO
═══════════════════════════════════════════════════════ */
const DEFAULT_GRID: GridConfig = {
  exchange: "hyperliquid", symbol: "BTC/USDC", marketType: "perpetual",
  mode: "normal", upperPrice: "", lowerPrice: "", gridCount: 10,
  totalInvestment: 1000, feeRate: 0.02, takeProfit: "", stopLoss: "",
};

function GridStudio({ binPrices, hlMarkets }: { binPrices: Record<string, BinanceTicker>; hlMarkets: HLMarket[] }) {
  const [config, setConfig]         = useState<GridConfig>(DEFAULT_GRID);
  const [grids, setGrids]           = useState<ActiveGrid[]>([]);
  const [showBuilder, setShowBuilder] = useState(false);
  const [deploying, setDeploying]   = useState(false);

  const sym          = config.symbol.split("/")[0];
  const currentPrice = binPrices[sym]?.price ?? hlMarkets.find(m => m.symbol === sym)?.markPx ?? 0;
  const set          = <K extends keyof GridConfig>(k: K, v: GridConfig[K]) =>
    setConfig(prev => ({ ...prev, [k]: v }));

  const deployGrid = async () => {
    if (!config.upperPrice || !config.lowerPrice) return;
    setDeploying(true);
    await new Promise(r => setTimeout(r, 1200));
    setGrids(prev => [{
      id: Date.now(), ...config, status: "active",
      createdAt: Date.now(), currentPrice, pnl: 0, filledGrids: 0, totalGrids: config.gridCount,
    }, ...prev]);
    setDeploying(false);
    setShowBuilder(false);
  };

  const gridLevels = useMemo(() => {
    const upper = parseFloat(config.upperPrice);
    const lower = parseFloat(config.lowerPrice);
    if (isNaN(upper) || isNaN(lower) || upper <= lower || !config.gridCount) return [];
    const step = (upper - lower) / config.gridCount;
    return Array.from({ length: config.gridCount + 1 }, (_, i) => lower + i * step);
  }, [config.upperPrice, config.lowerPrice, config.gridCount]);

  return (
    <div style={{ display: "grid", gridTemplateColumns: showBuilder ? "1fr 380px" : "1fr", gap: 12, height: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Card style={{ overflow: "hidden" }}>
          <SectionHeader icon={Grid3X3} title="GRID TRADING STUDIO"
            subtitle="Deploy and manage grid strategies across exchanges"
            right={
              <button onClick={() => setShowBuilder(p => !p)} style={{
                padding: "4px 12px", fontSize: 9, borderRadius: 3, cursor: "pointer",
                background: `${T.cyan}22`, color: T.cyan, border: `1px solid ${T.cyan}50`,
                fontFamily: "monospace", fontWeight: 700, display: "flex", alignItems: "center", gap: 4,
              }}>
                <Plus size={10} /> NEW GRID
              </button>
            }
          />
          {grids.length === 0 ? (
            <div style={{ textAlign: "center", color: T.muted, fontSize: 11, padding: "40px 20px" }}>
              <Grid3X3 size={28} style={{ margin: "0 auto 10px", display: "block", opacity: 0.25 }} />
              No active grids. Click NEW GRID to deploy a strategy.
            </div>
          ) : (
            <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px,1fr))", gap: 10 }}>
              {grids.map(g => (
                <GridCard key={g.id} grid={g} currentPrice={currentPrice}
                  onStop={() => setGrids(prev => prev.filter(x => x.id !== g.id))} />
              ))}
            </div>
          )}
        </Card>

        <Card>
          <SectionHeader icon={BarChart2} title="GRID ANALYTICS" />
          <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10 }}>
            {([
              ["ACTIVE GRIDS",   grids.length,                                                   T.cyan],
              ["TOTAL INVESTED", `$${fmtK(grids.reduce((s,g) => s + Number(g.totalInvestment),0))}`, T.text],
              ["TOTAL P&L",      `$${fmt(grids.reduce((s,g) => s + (g.pnl||0), 0))}`,            T.green],
              ["FILLED GRIDS",   grids.reduce((s,g) => s + (g.filledGrids||0), 0),               T.orange],
            ] as [string, string | number, string][]).map(([label, value, color]) => (
              <div key={label} style={{ background: T.surface2, borderRadius: 4, padding: 10,
                border: `1px solid ${T.border}`, textAlign: "center" }}>
                <div style={{ fontSize: 16, fontFamily: "monospace", fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 8, color: T.muted, marginTop: 3, letterSpacing: "0.1em" }}>{label}</div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {showBuilder && (
        <Card style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <SectionHeader icon={Target} title="GRID BUILDER"
            right={
              <button onClick={() => setShowBuilder(false)}
                style={{ background: "none", border: "none", color: T.muted, cursor: "pointer" }}>
                <X size={14} />
              </button>
            }
          />
          <div style={{ flex: 1, overflowY: "auto", padding: 14 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <GridField label="EXCHANGE">
                  <select value={config.exchange} onChange={e => set("exchange", e.target.value)} style={inputStyle}>
                    {["hyperliquid","backpack","binance","okx","lighter"].map(ex => (
                      <option key={ex} value={ex}>{ex.toUpperCase()}</option>
                    ))}
                  </select>
                </GridField>
                <GridField label="SYMBOL">
                  <input value={config.symbol} onChange={e => set("symbol", e.target.value.toUpperCase())}
                    placeholder="BTC/USDC" style={inputStyle} />
                </GridField>
              </div>

              {currentPrice > 0 && (
                <div style={{ background: `${T.cyan}10`, border: `1px solid ${T.cyan}30`, borderRadius: 4,
                  padding: "6px 10px", fontSize: 10, fontFamily: "monospace",
                  display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: T.muted }}>CURRENT PRICE</span>
                  <span style={{ color: T.cyan, fontWeight: 700 }}>${fmt(currentPrice)}</span>
                </div>
              )}

              <GridField label="GRID MODE">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 4 }}>
                  {["normal","martingale","moving","scalping","capital_protection"].map(m => (
                    <button key={m} onClick={() => set("mode", m)} style={{
                      padding: "4px 6px", fontSize: 8, borderRadius: 3, cursor: "pointer",
                      background: config.mode === m ? `${T.cyan}22` : "transparent",
                      color: config.mode === m ? T.cyan : T.muted,
                      border: `1px solid ${config.mode === m ? T.cyan+"50" : T.border}`,
                      fontFamily: "monospace",
                    }}>{m.replace(/_/g," ").toUpperCase()}</button>
                  ))}
                </div>
              </GridField>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <GridField label="UPPER PRICE ($)">
                  <input type="number" value={config.upperPrice}
                    onChange={e => set("upperPrice", e.target.value)}
                    placeholder={currentPrice ? `${(currentPrice*1.1).toFixed(0)}` : "e.g. 110000"}
                    style={inputStyle} />
                </GridField>
                <GridField label="LOWER PRICE ($)">
                  <input type="number" value={config.lowerPrice}
                    onChange={e => set("lowerPrice", e.target.value)}
                    placeholder={currentPrice ? `${(currentPrice*0.9).toFixed(0)}` : "e.g. 90000"}
                    style={inputStyle} />
                </GridField>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <GridField label="GRID LEVELS">
                  <input type="number" value={config.gridCount}
                    onChange={e => set("gridCount", Number(e.target.value))}
                    min={2} max={200} style={inputStyle} />
                </GridField>
                <GridField label="TOTAL INVESTMENT ($)">
                  <input type="number" value={config.totalInvestment}
                    onChange={e => set("totalInvestment", Number(e.target.value))} style={inputStyle} />
                </GridField>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <GridField label="TAKE PROFIT ($)">
                  <input type="number" value={config.takeProfit}
                    onChange={e => set("takeProfit", e.target.value)} placeholder="Optional" style={inputStyle} />
                </GridField>
                <GridField label="STOP LOSS ($)">
                  <input type="number" value={config.stopLoss}
                    onChange={e => set("stopLoss", e.target.value)} placeholder="Optional" style={inputStyle} />
                </GridField>
              </div>

              {gridLevels.length > 0 && (
                <div style={{ background: T.surface2, borderRadius: 4, padding: 10, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 8, color: T.muted, marginBottom: 8, letterSpacing: "0.1em" }}>GRID LEVELS PREVIEW</div>
                  <div style={{ position: "relative", height: 100 }}>
                    {gridLevels.map((level, i) => {
                      const min = gridLevels[0];
                      const max = gridLevels[gridLevels.length - 1];
                      const pct = ((level - min) / (max - min)) * 100;
                      return (
                        <div key={i} style={{
                          position: "absolute", left: 0, right: 0, bottom: `${pct}%`,
                          height: 1, background: T.border,
                        }}>
                          {i % Math.ceil(gridLevels.length / 5) === 0 && (
                            <span style={{ position: "absolute", right: 0, fontSize: 7, color: T.muted,
                              fontFamily: "monospace", transform: "translateY(-50%)" }}>
                              ${level.toFixed(0)}
                            </span>
                          )}
                        </div>
                      );
                    })}
                    {currentPrice > 0 && gridLevels.length >= 2 && (
                      <div style={{
                        position: "absolute", left: 0, right: 0,
                        bottom: `${((currentPrice - gridLevels[0]) / (gridLevels[gridLevels.length-1] - gridLevels[0])) * 100}%`,
                        height: 2, background: T.orange, boxShadow: `0 0 6px ${T.orange}`,
                      }}>
                        <span style={{ position: "absolute", left: 0, fontSize: 7, color: T.orange,
                          fontFamily: "monospace", transform: "translateY(-50%)" }}>▶ ${fmt(currentPrice)}</span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, fontSize: 9, fontFamily: "monospace" }}>
                    <span style={{ color: T.muted }}>
                      GRID SIZE: ${((parseFloat(config.upperPrice) - parseFloat(config.lowerPrice)) / config.gridCount).toFixed(2)}
                    </span>
                    <span style={{ color: T.muted }}>
                      PER GRID: ${(config.totalInvestment / config.gridCount).toFixed(2)}
                    </span>
                  </div>
                </div>
              )}

              <button onClick={() => void deployGrid()}
                disabled={deploying || !config.upperPrice || !config.lowerPrice}
                style={{
                  padding: 10, fontSize: 11, borderRadius: 4, cursor: "pointer",
                  background: deploying ? T.dim : `${T.cyan}22`,
                  color: deploying ? T.muted : T.cyan,
                  border: `2px solid ${deploying ? T.dim : T.cyan+"60"}`,
                  fontFamily: "monospace", fontWeight: 700, letterSpacing: "0.1em",
                }}>
                {deploying ? "⚡ DEPLOYING…" : "🚀 DEPLOY GRID"}
              </button>

              <div style={{ fontSize: 9, color: T.muted, textAlign: "center", lineHeight: 1.5 }}>
                Requires FastAPI bot bridge connected to execute real trades
              </div>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function GridCard({ grid, currentPrice, onStop }: {
  grid: ActiveGrid;
  currentPrice: number;
  onStop: () => void;
}) {
  const upper = parseFloat(grid.upperPrice);
  const lower = parseFloat(grid.lowerPrice);
  const range = upper - lower;
  const pct   = currentPrice && range > 0
    ? Math.max(0, Math.min(100, ((currentPrice - lower) / range) * 100))
    : 50;

  return (
    <div style={{ background: T.surface2, border: `1px solid ${T.border}`, borderRadius: 6,
      padding: 12, borderLeft: `3px solid ${T.cyan}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
        <div>
          <span style={{ fontFamily: "monospace", fontWeight: 700, color: T.text, fontSize: 12 }}>{grid.symbol}</span>
          <span style={{ marginLeft: 6 }}><Badge color={T.cyan}>{grid.exchange.toUpperCase()}</Badge></span>
        </div>
        <button onClick={onStop} style={{ background: `${T.red}18`, border: `1px solid ${T.red}40`,
          color: T.red, fontSize: 9, padding: "2px 6px", borderRadius: 3, cursor: "pointer", fontFamily: "monospace" }}>
          STOP
        </button>
      </div>
      <div style={{ marginBottom: 8 }}>
        <div style={{ background: T.border, borderRadius: 2, height: 4, position: "relative" }}>
          <div style={{ width: `${pct}%`, height: "100%", background: T.cyan, borderRadius: 2 }} />
          <div style={{ position: "absolute", top: -3, left: `${pct}%`, transform: "translateX(-50%)",
            width: 10, height: 10, borderRadius: "50%", background: T.orange, border: `2px solid ${T.bg}` }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 8, color: T.muted,
          marginTop: 3, fontFamily: "monospace" }}>
          <span>${lower.toFixed(0)}</span>
          <span>${upper.toFixed(0)}</span>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
        {([
          ["GRIDS",    `${grid.filledGrids}/${grid.totalGrids}`],
          ["INVESTED", `$${fmtK(grid.totalInvestment)}`],
          ["P&L",      `$${fmt(grid.pnl)}`],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} style={{ textAlign: "center" }}>
            <div style={{ fontSize: 11, fontFamily: "monospace",
              color: label === "P&L" ? T.green : T.text }}>{value}</div>
            <div style={{ fontSize: 7, color: T.muted, marginTop: 1 }}>{label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   VOLUME CONTROLLER
═══════════════════════════════════════════════════════ */
function VolumeController({ hlMarkets, whaleFeed }: { hlMarkets: HLMarket[]; whaleFeed: WhaleTrade[] }) {
  const [botConfig, setBotConfig] = useState<BotConfig>({
    symbol: "BTC/USDC", exchange: "backpack", mode: "limit",
    signalSource: "backpack_rest", targetVolume: 100_000,
    autoPauseOnWhale: true, whaleThreshold: 500_000, running: false,
  });

  const set = <K extends keyof BotConfig>(k: K, v: BotConfig[K]) =>
    setBotConfig(prev => ({ ...prev, [k]: v }));

  const topMarkets = [...hlMarkets].sort((a, b) => b.volume24h - a.volume24h).slice(0, 8);

  const recentWhale = whaleFeed.some(t =>
    t.sym === botConfig.symbol.split("/")[0] && t.usd > botConfig.whaleThreshold && Date.now() - t.ts < 60_000
  );
  const autoPaused = botConfig.autoPauseOnWhale && recentWhale;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 300px", gap: 12, height: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Card style={{ overflow: "hidden" }}>
          <SectionHeader icon={Volume2} title="VOLUME MAKING CONTROLLER"
            subtitle="Backpack limit mode / Lighter market mode"
            right={
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {autoPaused && <Badge color={T.red}>WHALE PAUSE</Badge>}
                <button onClick={() => set("running", !botConfig.running)} style={{
                  padding: "4px 12px", fontSize: 9, borderRadius: 3, cursor: "pointer",
                  background: botConfig.running && !autoPaused ? `${T.red}22` : `${T.green}22`,
                  color: botConfig.running && !autoPaused ? T.red : T.green,
                  border: `1px solid ${botConfig.running && !autoPaused ? T.red+"50" : T.green+"50"}`,
                  fontFamily: "monospace", fontWeight: 700, display: "flex", alignItems: "center", gap: 4,
                }}>
                  {botConfig.running && !autoPaused ? <><Square size={10} /> STOP</> : <><Play size={10} /> START</>}
                </button>
              </div>
            }
          />

          <div style={{ padding: 12, display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10,
            borderBottom: `1px solid ${T.border}` }}>
            {([
              ["STATUS",        autoPaused ? "PAUSED" : botConfig.running ? "RUNNING" : "STOPPED",
                autoPaused ? T.orange : botConfig.running ? T.green : T.muted],
              ["TARGET VOL",    fmtK(botConfig.targetVolume),  T.cyan],
              ["SYMBOL",        botConfig.symbol,              T.text],
              ["SIGNAL SOURCE", botConfig.signalSource.replace(/_/g," ").toUpperCase(), T.muted],
            ] as [string, string, string][]).map(([label, value, color]) => (
              <div key={label} style={{ background: T.surface2, borderRadius: 4, padding: 10,
                border: `1px solid ${T.border}`, textAlign: "center" }}>
                <div style={{ fontSize: 13, fontFamily: "monospace", fontWeight: 700, color }}>{value}</div>
                <div style={{ fontSize: 8, color: T.muted, marginTop: 3, letterSpacing: "0.1em" }}>{label}</div>
              </div>
            ))}
          </div>

          <div style={{ padding: 12 }}>
            <div style={{ fontSize: 9, color: T.muted, marginBottom: 8, letterSpacing: "0.1em", fontFamily: "monospace" }}>
              24H VOLUME — HYPERLIQUID TOP PAIRS
            </div>
            <div style={{ height: 160 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topMarkets.map(m => ({ name: m.symbol, v: m.volume24h / 1e6 }))}>
                  <XAxis dataKey="name" tick={{ fontSize: 8, fill: T.muted }} />
                  <YAxis tick={{ fontSize: 8, fill: T.muted }} tickFormatter={(v: number) => `$${v.toFixed(0)}M`} width={48} />
                  <Tooltip
                    formatter={(v: number) => [fmtK(v * 1e6), "Volume"]}
                    contentStyle={{ background: T.surface2, border: `1px solid ${T.border}`, fontSize: 10 }}
                  />
                  <Bar dataKey="v" fill={T.cyan} fillOpacity={0.7} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </Card>

        <Card style={{ overflow: "hidden" }}>
          <SectionHeader icon={BarChart2} title="TOP MARKETS BY VOLUME" subtitle="Hyperliquid 24h" />
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                {["PAIR","24H VOLUME","OPEN INTEREST","FUNDING/8H","MARK PRICE"].map(h => (
                  <th key={h} style={{ padding: "7px 12px", textAlign: "left", color: T.muted,
                    fontSize: 8, fontFamily: "monospace" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {topMarkets.map(m => (
                <tr key={m.symbol} style={{ borderBottom: `1px solid ${T.border}30` }}>
                  <td style={{ padding: "7px 12px", fontFamily: "monospace", fontWeight: 700, color: T.text }}>{m.symbol}</td>
                  <td style={{ padding: "7px 12px", fontFamily: "monospace", color: T.cyan }}>{fmtK(m.volume24h)}</td>
                  <td style={{ padding: "7px 12px", fontFamily: "monospace", color: T.muted }}>{fmtK(m.openInterest * m.markPx)}</td>
                  <td style={{ padding: "7px 12px", fontFamily: "monospace",
                    color: m.funding > 0 ? T.green : m.funding < 0 ? T.red : T.muted }}>
                    {(m.funding * 100).toFixed(4)}%
                  </td>
                  <td style={{ padding: "7px 12px", fontFamily: "monospace", color: T.text }}>${fmt(m.markPx)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Card style={{ overflow: "hidden" }}>
          <SectionHeader icon={Settings} title="BOT CONFIGURATION" />
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
            <GridField label="EXCHANGE">
              <select value={botConfig.exchange} onChange={e => set("exchange", e.target.value)} style={inputStyle}>
                <option value="backpack">Backpack</option>
                <option value="lighter">Lighter</option>
                <option value="hyperliquid">Hyperliquid</option>
              </select>
            </GridField>
            <GridField label="SYMBOL">
              <input value={botConfig.symbol} onChange={e => set("symbol", e.target.value.toUpperCase())} style={inputStyle} />
            </GridField>
            <GridField label="SIGNAL SOURCE">
              <select value={botConfig.signalSource} onChange={e => set("signalSource", e.target.value)} style={inputStyle}>
                <option value="backpack_rest">Backpack REST</option>
                <option value="hyperliquid_ws">Hyperliquid WebSocket</option>
              </select>
            </GridField>
            <GridField label="TARGET DAILY VOLUME ($)">
              <input type="number" value={botConfig.targetVolume}
                onChange={e => set("targetVolume", Number(e.target.value))} style={inputStyle} />
            </GridField>

            <div style={{ background: `${T.orange}10`, border: `1px solid ${T.orange}30`, borderRadius: 6, padding: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: T.orange, fontFamily: "monospace", fontWeight: 700 }}>
                  🛡 AUTO-PAUSE ON WHALE
                </div>
                <button onClick={() => set("autoPauseOnWhale", !botConfig.autoPauseOnWhale)} style={{
                  width: 36, height: 18, borderRadius: 9, cursor: "pointer",
                  background: botConfig.autoPauseOnWhale ? T.orange : T.dim,
                  border: "none", position: "relative", transition: "background 0.2s",
                }}>
                  <span style={{
                    position: "absolute", top: 2, width: 14, height: 14, borderRadius: "50%",
                    background: "#fff", transition: "left 0.2s",
                    left: botConfig.autoPauseOnWhale ? 20 : 2,
                  }} />
                </button>
              </div>
              <input type="number" value={botConfig.whaleThreshold}
                onChange={e => set("whaleThreshold", Number(e.target.value))}
                placeholder="Whale USD threshold" style={{ ...inputStyle, marginTop: 4 }} />
              {recentWhale && (
                <div style={{ marginTop: 6, fontSize: 9, color: T.red, fontFamily: "monospace" }}>
                  ⚠ Whale detected on {botConfig.symbol.split("/")[0]}!
                </div>
              )}
            </div>
          </div>
        </Card>

        <Card>
          <SectionHeader icon={Cpu} title="EXECUTION LOG" />
          <div style={{ padding: 12, fontFamily: "monospace", fontSize: 9, color: T.muted, lineHeight: 1.8 }}>
            {botConfig.running ? (
              <>
                <span style={{ color: T.green }}>▶</span> Bot initialised on {botConfig.exchange}<br />
                <span style={{ color: T.cyan }}>→</span> Signal: {botConfig.signalSource}<br />
                <span style={{ color: T.cyan }}>→</span> Monitoring {botConfig.symbol}<br />
                {autoPaused && <><span style={{ color: T.red }}>⚠</span> PAUSED: whale detected<br /></>}
              </>
            ) : (
              <span style={{ color: T.dim }}>Bot stopped. Click START to begin.</span>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   PORTFOLIO
═══════════════════════════════════════════════════════ */
function PortfolioPanel({ binPrices, hlMarkets }: { binPrices: Record<string, BinanceTicker>; hlMarkets: HLMarket[] }) {
  const [holdings, setHoldings] = useState<Holding[]>([]);
  const [form, setForm]         = useState({ symbol: "", amount: "", entry: "" });

  const getPrice = (sym: string) =>
    binPrices[sym]?.price ?? hlMarkets.find(m => m.symbol === sym)?.markPx ?? 0;

  const addHolding = () => {
    const sym    = form.symbol.trim().toUpperCase();
    const amount = parseFloat(form.amount);
    const entry  = parseFloat(form.entry);
    if (!sym || isNaN(amount) || isNaN(entry) || amount <= 0 || entry <= 0) return;
    setHoldings(prev => [...prev.filter(h => h.symbol !== sym), { symbol: sym, amount, entry }]);
    setForm({ symbol: "", amount: "", entry: "" });
  };

  const enriched: EnrichedHolding[] = holdings.map(h => {
    const price = getPrice(h.symbol);
    const value = price * h.amount;
    const cost  = h.entry * h.amount;
    const pnl   = value - cost;
    const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
    return { ...h, price, value, cost, pnl, pnlPct };
  });

  const totalValue  = enriched.reduce((s, h) => s + h.value, 0);
  const totalCost   = enriched.reduce((s, h) => s + h.cost, 0);
  const totalPnl    = totalValue - totalCost;
  const totalPnlPct = totalCost > 0 ? (totalPnl / totalCost) * 100 : 0;

  const COLORS = [T.cyan, T.green, T.orange, T.purple, T.red, "#60a5fa", "#f472b6", "#a3e635"];

  const exportCSV = () => {
    const rows = ["Symbol,Amount,Entry,Current,P&L,P&L%",
      ...enriched.map(h => `${h.symbol},${h.amount},${h.entry},${h.price},${h.pnl.toFixed(2)},${h.pnlPct.toFixed(2)}`)
    ].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([rows], { type: "text/csv" }));
    a.download = "portfolio.csv";
    a.click();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
        {([
          ["TOTAL VALUE", fmtK(totalValue),                                   T.text],
          ["TOTAL COST",  fmtK(totalCost),                                    T.muted],
          ["TOTAL P&L",   `${totalPnl >= 0?"+":""}${fmtK(totalPnl)}`,        totalPnl >= 0 ? T.green : T.red],
          ["RETURN",      fmtPct(totalPnlPct),                                totalPnlPct >= 0 ? T.green : T.red],
        ] as [string, string, string][]).map(([label, value, color]) => (
          <Card key={label} style={{ padding: "14px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 20, fontFamily: "monospace", fontWeight: 700, color }}>{value}</div>
            <div style={{ fontSize: 8, color: T.muted, marginTop: 4, letterSpacing: "0.12em" }}>{label}</div>
          </Card>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 260px", gap: 12 }}>
        <Card style={{ overflow: "hidden" }}>
          <SectionHeader icon={Wallet} title="HOLDINGS"
            right={
              <button onClick={exportCSV} style={{ padding: "3px 10px", fontSize: 9, borderRadius: 3,
                cursor: "pointer", background: `${T.green}18`, color: T.green,
                border: `1px solid ${T.green}40`, fontFamily: "monospace" }}>
                EXPORT CSV
              </button>
            }
          />
          <div style={{ padding: "10px 14px", borderBottom: `1px solid ${T.border}`, display: "flex", gap: 8 }}>
            {(["Symbol","Amount","Entry $"] as const).map((placeholder, i) => {
              const keys = ["symbol","amount","entry"] as const;
              return (
                <input key={placeholder} placeholder={placeholder} value={form[keys[i]]}
                  onChange={e => setForm(p => ({ ...p, [keys[i]]: e.target.value }))}
                  style={{ ...inputStyle, flex: i === 0 ? "0 0 80px" : 1 }} />
              );
            })}
            <button onClick={addHolding} style={{ padding: "5px 12px", fontSize: 9, borderRadius: 3,
              cursor: "pointer", background: `${T.cyan}22`, color: T.cyan,
              border: `1px solid ${T.cyan}50`, fontFamily: "monospace", whiteSpace: "nowrap" }}>
              + ADD
            </button>
          </div>

          {enriched.length === 0 ? (
            <div style={{ textAlign: "center", color: T.muted, fontSize: 11, padding: "40px 20px" }}>
              <Wallet size={24} style={{ margin: "0 auto 10px", display: "block", opacity: 0.25 }} />
              Add holdings to track your portfolio
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${T.border}` }}>
                  {["SYMBOL","AMOUNT","ENTRY","PRICE","VALUE","P&L","P&L %",""].map(h => (
                    <th key={h} style={{ padding: "7px 12px", textAlign: "left", color: T.muted,
                      fontSize: 8, fontFamily: "monospace" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {enriched.map(h => (
                  <tr key={h.symbol} style={{ borderBottom: `1px solid ${T.border}30` }}>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 700, color: T.cyan }}>{h.symbol}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: T.text }}>{h.amount}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: T.muted }}>${fmt(h.entry)}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: T.text }}>${fmt(h.price)}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", color: T.text }}>{fmtK(h.value)}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace", fontWeight: 700,
                      color: h.pnl >= 0 ? T.green : T.red }}>{h.pnl >= 0?"+":""}{fmtK(h.pnl)}</td>
                    <td style={{ padding: "8px 12px", fontFamily: "monospace",
                      color: h.pnlPct >= 0 ? T.green : T.red }}>{fmtPct(h.pnlPct)}</td>
                    <td style={{ padding: "8px 12px" }}>
                      <button onClick={() => setHoldings(prev => prev.filter(x => x.symbol !== h.symbol))}
                        style={{ background: "none", border: "none", color: T.muted, cursor: "pointer", fontSize: 12 }}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card style={{ padding: 14 }}>
          <div style={{ fontSize: 9, color: T.muted, marginBottom: 12, letterSpacing: "0.1em", fontFamily: "monospace" }}>CAPITAL ALLOCATION</div>
          {enriched.length > 0 ? (
            <>
              <div style={{ height: 160 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={enriched} dataKey="value" nameKey="symbol"
                      cx="50%" cy="50%" innerRadius={45} outerRadius={70} strokeWidth={0}>
                      {enriched.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} fillOpacity={0.85} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmtK(v)}
                      contentStyle={{ background: T.surface2, border: `1px solid ${T.border}`, fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                {enriched.map((h, i) => (
                  <div key={h.symbol} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 9, fontFamily: "monospace" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[i % COLORS.length], flexShrink: 0 }} />
                    <span style={{ color: T.text, flex: 1 }}>{h.symbol}</span>
                    <span style={{ color: T.muted }}>{totalValue > 0 ? ((h.value / totalValue) * 100).toFixed(1) : 0}%</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", color: T.dim, fontSize: 11, paddingTop: 30 }}>No holdings</div>
          )}
        </Card>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   ALERT CENTER
═══════════════════════════════════════════════════════ */
const ALERT_TYPES: AlertItem["type"][] = [
  "whale_large_tx", "arbitrage_opportunity", "whale_bot_correlation", "risk_threshold_breach",
];

function AlertCenter({ alerts, onClear }: { alerts: AlertItem[]; onClear: () => void }) {
  const [filter, setFilter] = useState<"ALL" | AlertItem["type"]>("ALL");

  const filtered = filter === "ALL" ? alerts : alerts.filter(a => a.type === filter);
  const alertColor = (type: string): string => ({
    whale_large_tx:       T.orange,
    arbitrage_opportunity:T.cyan,
    whale_bot_correlation:T.red,
    risk_threshold_breach:T.red,
  }[type] ?? T.muted);

  return (
    <Card style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <SectionHeader icon={Bell} title="ALERT CENTER"
        subtitle={`${alerts.length} alerts received`}
        right={
          <button onClick={onClear} style={{ padding: "3px 10px", fontSize: 9, borderRadius: 3,
            cursor: "pointer", background: `${T.red}15`, color: T.red,
            border: `1px solid ${T.red}30`, fontFamily: "monospace" }}>
            CLEAR ALL
          </button>
        }
      />
      <div style={{ display: "flex", gap: 4, padding: "6px 12px", borderBottom: `1px solid ${T.border}`, flexWrap: "wrap" }}>
        {(["ALL", ...ALERT_TYPES] as const).map(t => (
          <button key={t} onClick={() => setFilter(t)} style={{
            padding: "2px 8px", fontSize: 8, borderRadius: 3, cursor: "pointer",
            background: filter === t ? `${T.cyan}18` : "transparent",
            color: filter === t ? T.cyan : T.muted,
            border: `1px solid ${filter === t ? T.cyan+"40" : T.border}`,
            fontFamily: "monospace",
          }}>{t === "ALL" ? "ALL" : t.replace(/_/g," ").toUpperCase()}</button>
        ))}
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {filtered.length === 0 ? (
          <div style={{ textAlign: "center", color: T.muted, fontSize: 11, padding: "40px 20px" }}>
            <Bell size={20} style={{ margin: "0 auto 8px", display: "block", opacity: 0.3 }} />
            No alerts yet
          </div>
        ) : filtered.map((alert, i) => (
          <div key={i} style={{
            padding: "10px 14px", borderBottom: `1px solid ${T.border}30`,
            borderLeft: `3px solid ${alertColor(alert.type)}`,
            background: `${alertColor(alert.type)}06`,
          }}>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
              <AlertTriangle size={12} color={alertColor(alert.type)} style={{ marginTop: 2, flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
                  <span style={{ fontSize: 9, fontFamily: "monospace", color: alertColor(alert.type), fontWeight: 700 }}>
                    {alert.type.replace(/_/g," ").toUpperCase()}
                  </span>
                  <span style={{ fontSize: 8, color: T.muted, fontFamily: "monospace" }}>{timeAgo(alert.ts)}</span>
                </div>
                <div style={{ fontSize: 11, color: T.text, lineHeight: 1.4 }}>{alert.message}</div>
                {alert.symbol && <span style={{ fontSize: 9, color: T.cyan, fontFamily: "monospace", marginTop: 3, display: "block" }}>{alert.symbol}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ═══════════════════════════════════════════════════════
   ALERT SIDEBAR
═══════════════════════════════════════════════════════ */
function AlertSidebar({ alerts }: { alerts: AlertItem[] }) {
  const alertColor = (type: string): string => ({
    whale_large_tx:       T.orange,
    arbitrage_opportunity:T.cyan,
    whale_bot_correlation:T.red,
    risk_threshold_breach:T.red,
  }[type] ?? T.muted);

  return (
    <div style={{ width: 220, background: T.surface, borderRight: `1px solid ${T.border}`,
      display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", flexShrink: 0 }}>
      <div style={{ padding: "10px 12px", borderBottom: `1px solid ${T.border}` }}>
        <div style={{ fontSize: 9, color: T.muted, letterSpacing: "0.15em", fontFamily: "monospace" }}>ALERT FEED</div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {alerts.length === 0 ? (
          <div style={{ padding: "20px 12px", textAlign: "center", color: T.dim, fontSize: 10 }}>
            Monitoring...
          </div>
        ) : alerts.slice(0, 20).map((a, i) => (
          <div key={i} style={{ padding: "8px 12px", borderBottom: `1px solid ${T.border}20`,
            borderLeft: `2px solid ${alertColor(a.type)}` }}>
            <div style={{ fontSize: 8, color: alertColor(a.type), fontFamily: "monospace", letterSpacing: "0.08em" }}>
              {a.type.split("_").slice(0, 2).join(" ").toUpperCase()}
            </div>
            <div style={{ fontSize: 9, color: T.text, marginTop: 2, lineHeight: 1.3 }}>{a.message.slice(0, 60)}</div>
            <div style={{ fontSize: 7, color: T.dim, marginTop: 2, fontFamily: "monospace" }}>{timeAgo(a.ts)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════
   NAV TABS
═══════════════════════════════════════════════════════ */
const TABS = [
  { id: "whale",     label: "WHALE WATCH", icon: Activity   },
  { id: "arbitrage", label: "ARBITRAGE",   icon: ArrowUpDown },
  { id: "grid",      label: "GRID STUDIO", icon: Grid3X3    },
  { id: "volume",    label: "VOLUME",      icon: Volume2    },
  { id: "portfolio", label: "PORTFOLIO",   icon: Wallet     },
  { id: "alerts",    label: "ALERTS",      icon: Bell       },
] as const;

type TabId = typeof TABS[number]["id"];

/* ═══════════════════════════════════════════════════════
   ROOT COMPONENT
═══════════════════════════════════════════════════════ */
export default function NexusPro() {
  const [activeTab, setActiveTab]       = useState<TabId>("whale");
  const [alerts, setAlerts]             = useState<AlertItem[]>([]);
  const [botBridgeUrl, setBotBridgeUrl] = useState("http://localhost:8000");

  const { markets: hlMarkets, fundingRates, hlStatus } = useHyperliquid();
  const { prices: binPrices, binStatus }               = useBinancePrices();
  const { whaleFeed, wsStatus }                        = useWhaleWebSocket(200_000);
  const arbOpps                                        = useArbitrage(hlMarkets, binPrices, fundingRates);

  const prevWhaleLen = useRef(0);
  const prevArbHigh  = useRef(0);

  // Whale alerts
  useEffect(() => {
    if (whaleFeed.length <= prevWhaleLen.current) return;
    const fresh = whaleFeed.slice(0, whaleFeed.length - prevWhaleLen.current);
    fresh.filter(t => t.usd > 1_000_000).forEach(t => {
      setAlerts(prev => [{
        type: "whale_large_tx",
        message: `${t.side} ${fmtK(t.usd)} ${t.sym} @ $${fmt(t.price)}`,
        symbol: t.sym, ts: t.ts,
      }, ...prev].slice(0, 200));
    });
    prevWhaleLen.current = whaleFeed.length;
  }, [whaleFeed]);

  // Arb alerts
  useEffect(() => {
    const high = arbOpps.filter(o => o.confidence === "high" && Math.abs(o.spreadPercent) > 0.2);
    if (high.length > prevArbHigh.current) {
      high.slice(0, high.length - prevArbHigh.current).forEach(o => {
        setAlerts(prev => [{
          type: "arbitrage_opportunity",
          message: `${o.pair} spread: ${fmtPct(o.spreadPercent)} (HL vs Binance)`,
          symbol: o.symbol, ts: Date.now(),
        }, ...prev].slice(0, 200));
      });
    }
    prevArbHigh.current = high.length;
  }, [arbOpps]);

  // Whale-arb correlation
  useEffect(() => {
    if (!whaleFeed.length || !arbOpps.length) return;
    const latest = whaleFeed[0];
    if (!latest || Date.now() - latest.ts > 10_000) return;
    const matchArb = arbOpps.find(o => o.symbol === latest.sym && Math.abs(o.spreadPercent) > 0.1);
    if (matchArb) {
      setAlerts(prev => [{
        type: "whale_bot_correlation",
        message: `WHALE + ARB: ${latest.sym} ${fmtK(latest.usd)} ${latest.side} | Spread ${fmtPct(matchArb.spreadPercent)}`,
        symbol: latest.sym, ts: Date.now(),
      }, ...prev].slice(0, 200));
    }
  }, [whaleFeed, arbOpps]);

  const handleExecuteArb = useCallback(async (opp: ArbOpportunity) => {
    try {
      await fetch(`${botBridgeUrl}/arbitrage/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol: opp.symbol, direction: opp.direction, spreadPercent: opp.spreadPercent }),
      });
    } catch {
      setAlerts(prev => [{
        type: "risk_threshold_breach",
        message: `Bot bridge unavailable at ${botBridgeUrl}`,
        ts: Date.now(),
      }, ...prev].slice(0, 200));
    }
  }, [botBridgeUrl]);

  return (
    <div style={{ minHeight: "100vh", background: T.bg, color: T.text, fontFamily: "monospace",
      display: "flex", flexDirection: "column" }}>

      {/* TOP NAV */}
      <div style={{ background: T.surface, borderBottom: `1px solid ${T.border}`,
        padding: "0 16px", display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 0",
          marginRight: 16, borderRight: `1px solid ${T.border}`, paddingRight: 16 }}>
          <Zap size={16} color={T.cyan} />
          <span style={{ fontFamily: "monospace", fontWeight: 900, fontSize: 13, letterSpacing: "0.15em",
            background: `linear-gradient(135deg, ${T.cyan}, ${T.green})`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
            NEXUS PRO
          </span>
        </div>

        {TABS.map(({ id, label, icon: Icon }) => {
          const count = id === "alerts" ? alerts.length : 0;
          return (
            <button key={id} onClick={() => setActiveTab(id)} style={{
              padding: "14px 16px", fontSize: 10, fontFamily: "monospace", fontWeight: 700,
              letterSpacing: "0.1em", cursor: "pointer", background: "none", border: "none",
              color: activeTab === id ? T.cyan : T.muted,
              borderBottom: activeTab === id ? `2px solid ${T.cyan}` : "2px solid transparent",
              display: "flex", alignItems: "center", gap: 5, transition: "color 0.2s",
              position: "relative",
            }}>
              <Icon size={11} />
              {label}
              {count > 0 && (
                <span style={{ background: T.red, color: "#fff", borderRadius: "50%", width: 14, height: 14,
                  display: "flex", alignItems: "center", justifyContent: "center", fontSize: 7, fontWeight: 900 }}>
                  {count > 99 ? "99" : count}
                </span>
              )}
            </button>
          );
        })}

        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 12, fontSize: 9, color: T.muted }}>
          {([["WS", wsStatus], ["HL", hlStatus], ["BIN", binStatus]] as [string, string][]).map(([label, status]) => (
            <span key={label} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <StatusDot status={status} /> {label}
            </span>
          ))}
        </div>
      </div>

      {/* BODY */}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        <AlertSidebar alerts={alerts} />

        <div style={{ flex: 1, padding: 14, overflowY: "auto", minWidth: 0 }}>
          {activeTab === "whale" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <MarketOverview hlMarkets={hlMarkets} binPrices={binPrices} />
              <WhaleFeed feed={whaleFeed} />
            </div>
          )}
          {activeTab === "arbitrage" && (
            <div style={{ height: "calc(100vh - 160px)" }}>
              <ArbitragePanel opportunities={arbOpps} onExecute={handleExecuteArb} />
            </div>
          )}
          {activeTab === "grid" && (
            <div style={{ height: "calc(100vh - 160px)" }}>
              <GridStudio binPrices={binPrices} hlMarkets={hlMarkets} />
            </div>
          )}
          {activeTab === "volume" && (
            <div style={{ height: "calc(100vh - 160px)" }}>
              <VolumeController hlMarkets={hlMarkets} whaleFeed={whaleFeed} />
            </div>
          )}
          {activeTab === "portfolio" && (
            <PortfolioPanel binPrices={binPrices} hlMarkets={hlMarkets} />
          )}
          {activeTab === "alerts" && (
            <div style={{ height: "calc(100vh - 160px)" }}>
              <AlertCenter alerts={alerts} onClear={() => setAlerts([])} />
            </div>
          )}
        </div>
      </div>

      {/* STATUS BAR */}
      <div style={{ background: T.surface, borderTop: `1px solid ${T.border}`,
        padding: "5px 16px", display: "flex", alignItems: "center", gap: 20,
        fontSize: 9, color: T.muted, fontFamily: "monospace", flexShrink: 0 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <StatusDot status={wsStatus} /> WHALE WS: {wsStatus.toUpperCase()}
        </span>
        <span>HL MARKETS: {hlMarkets.length}</span>
        <span>ARB SIGNALS: {arbOpps.filter(o => Math.abs(o.spreadPercent) > 0.05).length}</span>
        <span>ALERTS: {alerts.length}</span>
        <div style={{ flex: 1 }} />
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ color: T.dim }}>BOT BRIDGE:</span>
          <input value={botBridgeUrl} onChange={e => setBotBridgeUrl(e.target.value)}
            style={{ background: "transparent", border: "none", color: T.orange,
              fontFamily: "monospace", fontSize: 9, outline: "none", width: 200 }} />
        </span>
        <span>NEXUS PRO v1.0</span>
      </div>
    </div>
  );
}
