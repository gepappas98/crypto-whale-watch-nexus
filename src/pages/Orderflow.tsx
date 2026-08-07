/* ══ ORDERFLOW PRO — Real-time Binance order flow command center ═══════════ */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useOrderflowEngine, type OFSignal } from "@/hooks/useOrderflowEngine";

const PRESETS = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT", "DOGEUSDT"];

const sigColor = (t: OFSignal["type"]) => {
  switch (t) {
    case "BUY_PRESSURE":
    case "SQUEEZE_UP":
    case "HIDDEN_BUYER":
      return "text-[hsl(var(--wr-green))] border-[hsl(var(--wr-green)/0.4)] bg-[hsl(var(--wr-green)/0.08)]";
    case "SELL_PRESSURE":
    case "SQUEEZE_DOWN":
    case "HIDDEN_SELLER":
      return "text-[hsl(var(--wr-red))] border-[hsl(var(--wr-red)/0.4)] bg-[hsl(var(--wr-red)/0.08)]";
    case "FAKE_LIQUIDITY":
      return "text-[hsl(var(--wr-amber))] border-[hsl(var(--wr-amber)/0.4)] bg-[hsl(var(--wr-amber)/0.08)]";
  }
};

const fmtPx = (n: number) =>
  n >= 1000 ? n.toLocaleString(undefined, { maximumFractionDigits: 2 }) : n.toFixed(n < 1 ? 6 : 4);

const fmtUsd = (n: number) => {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
};

export default function Orderflow() {
  const [symbol, setSymbol] = useState("BTCUSDT");
  const [custom, setCustom] = useState("");
  const s = useOrderflowEngine(symbol);

  const maxBidQty = Math.max(1, ...s.bids.map(([, q]) => q));
  const maxAskQty = Math.max(1, ...s.asks.map(([, q]) => q));
  const maxLevel = Math.max(maxBidQty, maxAskQty);

  // Imbalance gauge: 0..2 normalized
  const imbNorm = Math.min(2, Math.max(0, s.imbalance));
  const imbPct = (imbNorm / 2) * 100;

  const cvdMin = useMemo(() => Math.min(0, ...s.cvdHistory.map((c) => c.cvd)), [s.cvdHistory]);
  const cvdMax = useMemo(() => Math.max(0, ...s.cvdHistory.map((c) => c.cvd)), [s.cvdHistory]);
  const cvdRange = Math.max(1e-9, cvdMax - cvdMin);

  const liqTotal = s.liqLongUsd + s.liqShortUsd;
  const longPct = liqTotal ? (s.liqLongUsd / liqTotal) * 100 : 50;

  const submitCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const v = custom.trim().toUpperCase();
    if (v.length >= 5) {
      setSymbol(v);
      setCustom("");
    }
  };

  return (
    <div className="min-h-screen bg-[hsl(var(--wr-bg))] text-[hsl(var(--wr-green))] font-mono">
      {/* Header */}
      <header className="border-b border-[hsl(var(--wr-border))] bg-[hsl(var(--wr-bg2))]">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 py-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="text-xs text-[hsl(var(--wr-green-dim))] hover:text-[hsl(var(--wr-green))]"
            >
              ← RADAR
            </Link>
            <h1 className="font-[family-name:var(--font-head)] text-lg sm:text-xl tracking-wider">
              ORDERFLOW · PRO
            </h1>
            <span
              className={`text-[10px] px-2 py-0.5 rounded border ${
                s.connected
                  ? "border-[hsl(var(--wr-green)/0.5)] text-[hsl(var(--wr-green))]"
                  : "border-[hsl(var(--wr-amber)/0.5)] text-[hsl(var(--wr-amber))]"
              }`}
            >
              {s.connected ? "LIVE" : "CONNECTING…"}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setSymbol(p)}
                className={`text-[11px] px-2 py-1 rounded border transition ${
                  symbol === p
                    ? "border-[hsl(var(--wr-green))] bg-[hsl(var(--wr-green)/0.12)] text-[hsl(var(--wr-green))]"
                    : "border-[hsl(var(--wr-border))] text-[hsl(var(--wr-green-dim))] hover:border-[hsl(var(--wr-green)/0.4)]"
                }`}
              >
                {p.replace("USDT", "")}
              </button>
            ))}
            <form onSubmit={submitCustom} className="flex">
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="SYMBOL"
                className="bg-[hsl(var(--wr-bg3))] border border-[hsl(var(--wr-border))] text-[11px] px-2 py-1 rounded-l w-24 focus:outline-none focus:border-[hsl(var(--wr-green)/0.5)]"
              />
              <button
                type="submit"
                className="text-[11px] px-2 py-1 border border-l-0 border-[hsl(var(--wr-border))] rounded-r hover:border-[hsl(var(--wr-green)/0.5)]"
              >
                GO
              </button>
            </form>
          </div>
        </div>

        {/* Stats strip */}
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 pb-3 grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 text-[11px]">
          <Stat label="MID" value={s.midPrice ? fmtPx(s.midPrice) : "—"} />
          <Stat label="SPREAD" value={s.spread ? fmtPx(s.spread) : "—"} />
          <Stat
            label="IMBALANCE"
            value={s.imbalance.toFixed(2)}
            tone={s.imbalance > 1.3 ? "good" : s.imbalance < 0.8 ? "bad" : "neutral"}
          />
          <Stat
            label="CVD 60s"
            value={s.cvd.toFixed(3)}
            tone={s.cvd > 0 ? "good" : s.cvd < 0 ? "bad" : "neutral"}
          />
          <Stat label="BUY VOL" value={s.buyVol.toFixed(2)} tone="good" />
          <Stat label="SELL VOL" value={s.sellVol.toFixed(2)} tone="bad" />
          <Stat
            label="LIQ 60s"
            value={fmtUsd(liqTotal)}
            tone={s.liqShortUsd > s.liqLongUsd ? "good" : "bad"}
          />
        </div>
      </header>

      {/* Main grid */}
      <main className="max-w-[1600px] mx-auto px-3 sm:px-6 py-4 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Orderbook ladder */}
        <section className="lg:col-span-5 border border-[hsl(var(--wr-border))] bg-[hsl(var(--wr-bg2))] rounded">
          <div className="px-3 py-2 border-b border-[hsl(var(--wr-border))] flex justify-between text-[11px] text-[hsl(var(--wr-green-dim))]">
            <h2 className="text-[11px] text-[hsl(var(--wr-green-dim))] m-0">ORDERBOOK · top 20</h2>
            <span>{symbol}</span>
          </div>
          <div className="grid grid-cols-2">
            {/* Bids */}
            <div>
              <div className="px-2 py-1 text-[10px] text-[hsl(var(--wr-green-dim))] flex justify-between border-b border-[hsl(var(--wr-border))]">
                <span>SIZE</span>
                <span>BID</span>
              </div>
              {s.bids.length === 0 ? (
                <div className="p-3 text-[11px] text-[hsl(var(--wr-muted))]">Waiting…</div>
              ) : (
                s.bids.map(([p, q], i) => (
                  <LadderRow
                    key={`b${i}`}
                    price={p}
                    qty={q}
                    pct={(q / maxLevel) * 100}
                    side="bid"
                  />
                ))
              )}
            </div>
            {/* Asks */}
            <div className="border-l border-[hsl(var(--wr-border))]">
              <div className="px-2 py-1 text-[10px] text-[hsl(var(--wr-green-dim))] flex justify-between border-b border-[hsl(var(--wr-border))]">
                <span>ASK</span>
                <span>SIZE</span>
              </div>
              {s.asks.length === 0 ? (
                <div className="p-3 text-[11px] text-[hsl(var(--wr-muted))]">Waiting…</div>
              ) : (
                s.asks.map(([p, q], i) => (
                  <LadderRow
                    key={`a${i}`}
                    price={p}
                    qty={q}
                    pct={(q / maxLevel) * 100}
                    side="ask"
                  />
                ))
              )}
            </div>
          </div>
        </section>

        {/* Gauges + CVD + Liquidations */}
        <section className="lg:col-span-4 flex flex-col gap-4">
          <h2 className="sr-only">Gauges & Order Flow</h2>
          {/* Imbalance gauge */}
          <div className="border border-[hsl(var(--wr-border))] bg-[hsl(var(--wr-bg2))] rounded p-3">
            <div className="flex justify-between text-[11px] text-[hsl(var(--wr-green-dim))] mb-2">
              <span>IMBALANCE</span>
              <span>{s.imbalance.toFixed(2)}</span>
            </div>
            <div className="relative h-3 rounded bg-[hsl(var(--wr-bg3))] overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-[hsl(var(--wr-red))] via-[hsl(var(--wr-amber))] to-[hsl(var(--wr-green))]"
                style={{ width: `${imbPct}%` }}
              />
              <div className="absolute inset-y-0 left-1/2 w-px bg-[hsl(var(--wr-white)/0.3)]" />
            </div>
            <div className="flex justify-between text-[9px] text-[hsl(var(--wr-muted))] mt-1">
              <span>BEAR 0.0</span>
              <span>1.0</span>
              <span>BULL 2.0+</span>
            </div>
          </div>

          {/* CVD sparkline */}
          <div className="border border-[hsl(var(--wr-border))] bg-[hsl(var(--wr-bg2))] rounded p-3">
            <div className="flex justify-between text-[11px] text-[hsl(var(--wr-green-dim))] mb-2">
              <span>CVD · 60s</span>
              <span
                className={
                  s.cvd > 0
                    ? "text-[hsl(var(--wr-green))]"
                    : s.cvd < 0
                      ? "text-[hsl(var(--wr-red))]"
                      : ""
                }
              >
                {s.cvd > 0 ? "+" : ""}
                {s.cvd.toFixed(3)}
              </span>
            </div>
            <svg viewBox="0 0 200 60" className="w-full h-16" preserveAspectRatio="none">
              <line
                x1="0"
                y1={60 - ((0 - cvdMin) / cvdRange) * 60}
                x2="200"
                y2={60 - ((0 - cvdMin) / cvdRange) * 60}
                stroke="hsl(var(--wr-muted))"
                strokeDasharray="2,2"
                strokeWidth="0.5"
              />
              {s.cvdHistory.length > 1 && (
                <polyline
                  fill="none"
                  stroke={s.cvd >= 0 ? "hsl(var(--wr-green))" : "hsl(var(--wr-red))"}
                  strokeWidth="1.5"
                  points={s.cvdHistory
                    .map((c, i) => {
                      const x = (i / Math.max(1, s.cvdHistory.length - 1)) * 200;
                      const y = 60 - ((c.cvd - cvdMin) / cvdRange) * 60;
                      return `${x},${y}`;
                    })
                    .join(" ")}
                />
              )}
            </svg>
          </div>

          {/* Buy vs Sell volume bar */}
          <div className="border border-[hsl(var(--wr-border))] bg-[hsl(var(--wr-bg2))] rounded p-3">
            <div className="flex justify-between text-[11px] text-[hsl(var(--wr-green-dim))] mb-2">
              <span>FLOW · 60s</span>
              <span>
                {s.buyVol.toFixed(2)} / {s.sellVol.toFixed(2)}
              </span>
            </div>
            <div className="flex h-3 rounded overflow-hidden bg-[hsl(var(--wr-bg3))]">
              <div
                className="bg-[hsl(var(--wr-green))]"
                style={{
                  width: `${(s.buyVol / Math.max(1e-9, s.buyVol + s.sellVol)) * 100}%`,
                }}
              />
              <div
                className="bg-[hsl(var(--wr-red))]"
                style={{
                  width: `${(s.sellVol / Math.max(1e-9, s.buyVol + s.sellVol)) * 100}%`,
                }}
              />
            </div>
          </div>

          {/* Liquidation pressure */}
          <div className="border border-[hsl(var(--wr-border))] bg-[hsl(var(--wr-bg2))] rounded p-3 flex-1 min-h-[200px]">
            <div className="flex justify-between text-[11px] text-[hsl(var(--wr-green-dim))] mb-2">
              <span>LIQUIDATIONS · 60s</span>
              <span>{fmtUsd(liqTotal)}</span>
            </div>
            <div className="flex h-3 rounded overflow-hidden bg-[hsl(var(--wr-bg3))] mb-2">
              <div
                className="bg-[hsl(var(--wr-red))]"
                style={{ width: `${longPct}%` }}
                title={`Longs ${fmtUsd(s.liqLongUsd)}`}
              />
              <div
                className="bg-[hsl(var(--wr-green))]"
                style={{ width: `${100 - longPct}%` }}
                title={`Shorts ${fmtUsd(s.liqShortUsd)}`}
              />
            </div>
            <div className="flex justify-between text-[9px] text-[hsl(var(--wr-muted))] mb-2">
              <span>LONGS {fmtUsd(s.liqLongUsd)}</span>
              <span>SHORTS {fmtUsd(s.liqShortUsd)}</span>
            </div>
            <div className="overflow-y-auto max-h-[180px] divide-y divide-[hsl(var(--wr-border))]">
              {s.liquidations.length === 0 ? (
                <div className="text-[11px] text-[hsl(var(--wr-muted))] py-2">
                  No liquidations yet…
                </div>
              ) : (
                s.liquidations.map((l, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-[11px] py-1"
                  >
                    <span
                      className={
                        l.side === "long"
                          ? "text-[hsl(var(--wr-red))]"
                          : "text-[hsl(var(--wr-green))]"
                      }
                    >
                      {l.side === "long" ? "▼ LONG" : "▲ SHORT"}
                    </span>
                    <span className="text-[hsl(var(--wr-green-dim))]">{fmtPx(l.price)}</span>
                    <span>{fmtUsd(l.usd)}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Signal feed */}
        <section className="lg:col-span-3 border border-[hsl(var(--wr-border))] bg-[hsl(var(--wr-bg2))] rounded flex flex-col">
          <div className="px-3 py-2 border-b border-[hsl(var(--wr-border))] flex justify-between text-[11px] text-[hsl(var(--wr-green-dim))]">
            <h2 className="text-[11px] text-[hsl(var(--wr-green-dim))] m-0">SIGNALS</h2>
            <span>{s.signals.length}</span>
          </div>
          <div className="overflow-y-auto max-h-[600px] divide-y divide-[hsl(var(--wr-border))]">
            {s.signals.length === 0 ? (
              <div className="p-3 text-[11px] text-[hsl(var(--wr-muted))]">
                Listening for edge signals…
              </div>
            ) : (
              s.signals.map((sig) => (
                <div key={sig.id} className="p-2">
                  <div className="flex items-center justify-between gap-2">
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded border ${sigColor(sig.type)}`}
                    >
                      {sig.type.replace(/_/g, " ")}
                    </span>
                    <span className="text-[9px] text-[hsl(var(--wr-muted))]">
                      {new Date(sig.ts).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-[hsl(var(--wr-green))/0.85] break-words">
                    {sig.detail}
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      <footer className="text-center text-[10px] text-[hsl(var(--wr-muted))] py-4">
        Real-time data · Binance WebSocket (spot depth + aggTrades + futures forceOrder) · no mocks
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
}) {
  const color =
    tone === "good"
      ? "text-[hsl(var(--wr-green))]"
      : tone === "bad"
        ? "text-[hsl(var(--wr-red))]"
        : "text-[hsl(var(--wr-green-dim))]";
  return (
    <div className="border border-[hsl(var(--wr-border))] bg-[hsl(var(--wr-bg3))] rounded px-2 py-1">
      <div className="text-[9px] text-[hsl(var(--wr-muted))]">{label}</div>
      <div className={`text-[12px] font-bold ${color}`}>{value}</div>
    </div>
  );
}

function LadderRow({
  price,
  qty,
  pct,
  side,
}: {
  price: number;
  qty: number;
  pct: number;
  side: "bid" | "ask";
}) {
  const color = side === "bid" ? "hsl(var(--wr-green))" : "hsl(var(--wr-red))";
  return (
    <div className="relative px-2 py-0.5 text-[11px] flex justify-between leading-tight">
      <div
        className="absolute inset-y-0 right-0 opacity-20"
        style={{ width: `${pct}%`, background: color }}
      />
      {side === "bid" ? (
        <>
          <span className="relative text-[hsl(var(--wr-green-dim))]">{qty.toFixed(4)}</span>
          <span className="relative text-[hsl(var(--wr-green))] font-bold">{fmtPx(price)}</span>
        </>
      ) : (
        <>
          <span className="relative text-[hsl(var(--wr-red))] font-bold">{fmtPx(price)}</span>
          <span className="relative text-[hsl(var(--wr-green-dim))]">{qty.toFixed(4)}</span>
        </>
      )}
    </div>
  );
}
