import { useEffect, useState, useRef, useCallback } from "react";
import { toast } from "sonner";

interface WhaleSignal {
  timestamp: number;
  symbol: string;
  exchange: string;
  amount: number;
  type: "buy" | "sell";
  usdValue: number;
}

const DEMO_SYMBOLS = ["BTC", "ETH", "SOL", "DOGE", "XRP", "ADA", "AVAX", "MATIC", "LINK", "DOT"];
const DEMO_EXCHANGES = ["Binance", "Coinbase", "Kraken", "Bybit", "OKX"];

function generateMockSignal(): WhaleSignal {
  const symbol = DEMO_SYMBOLS[Math.floor(Math.random() * DEMO_SYMBOLS.length)];
  const exchange = DEMO_EXCHANGES[Math.floor(Math.random() * DEMO_EXCHANGES.length)];
  const type = Math.random() > 0.5 ? "buy" : "sell";
  const usdValue = Math.floor(Math.random() * 2_000_000) + 100_000;
  const priceMap: Record<string, number> = {
    BTC: 67000, ETH: 3500, SOL: 145, DOGE: 0.12, XRP: 0.52,
    ADA: 0.45, AVAX: 35, MATIC: 0.7, LINK: 14, DOT: 7
  };
  const price = priceMap[symbol] || 100;
  const amount = usdValue / price;

  return {
    timestamp: Date.now(),
    symbol,
    exchange,
    amount,
    type,
    usdValue,
  };
}

export default function NexusPro() {
  const [data, setData] = useState<WhaleSignal[]>([]);
  const [status, setStatus] = useState<"connecting" | "connected" | "demo" | "error">("connecting");
  const [errorMessage, setErrorMessage] = useState("");
  const [isDemo, setIsDemo] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const demoIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startDemoMode = useCallback(() => {
    setIsDemo(true);
    setStatus("demo");
    toast.info("Running in demo mode with simulated data");
    
    // Generate initial batch of signals
    const initialSignals = Array.from({ length: 5 }, () => generateMockSignal());
    setData(initialSignals);

    // Add new signals periodically
    demoIntervalRef.current = setInterval(() => {
      const newSignal = generateMockSignal();
      setData((prev) => [newSignal, ...prev].slice(0, 50));
      
      if (newSignal.usdValue > 1_000_000) {
        toast.info(`Demo: Large ${newSignal.type}: ${newSignal.symbol} $${newSignal.usdValue.toLocaleString()}`, {
          duration: 3000,
        });
      }
    }, 3000);
  }, []);

  useEffect(() => {
    const bridgeUrl = import.meta.env.VITE_BOT_BRIDGE_URL;

    if (!bridgeUrl) {
      // No bridge URL - start demo mode automatically
      startDemoMode();
      return;
    }

    let reconnectTimeout: ReturnType<typeof setTimeout>;

    function connect() {
      try {
        const ws = new WebSocket(bridgeUrl);
        wsRef.current = ws;
        setStatus("connecting");

        ws.onopen = () => {
          setStatus("connected");
          toast.success("Connected to whale bridge");
          console.log("NexusPro WebSocket connected");
        };

        ws.onmessage = (event) => {
          try {
            const signal: WhaleSignal = JSON.parse(event.data);
            setData((prev) => [signal, ...prev].slice(0, 50));
            if (signal.usdValue > 500_000) {
              toast.info(`Large ${signal.type}: ${signal.symbol} $${signal.usdValue.toLocaleString()}`, {
                duration: 5000,
              });
            }
          } catch (err) {
            console.error("WebSocket message parse error", err);
          }
        };

        ws.onerror = () => {
          setStatus("error");
          setErrorMessage("WebSocket connection failed.");
          toast.error("WebSocket connection failed");
        };

        ws.onclose = (event) => {
          if (!event.wasClean) {
            setStatus("error");
            setErrorMessage("Connection closed. Reconnecting...");
            toast.warning("Connection lost, reconnecting in 5s...");
            reconnectTimeout = setTimeout(connect, 5000);
          }
        };
      } catch (err) {
        setStatus("error");
        setErrorMessage(`Initialization error: ${(err as Error).message}`);
        toast.error(`Failed to init: ${(err as Error).message}`);
      }
    }

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      wsRef.current?.close();
      if (demoIntervalRef.current) {
        clearInterval(demoIntervalRef.current);
      }
    };
  }, [startDemoMode]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-blue-500 mb-8">
          🐋 Nexus Pro · Real‑time Whale Feed
        </h1>

        {status === "demo" && (
          <div className="flex items-center gap-3 bg-amber-900/30 p-4 rounded-lg border border-amber-500/50 mb-6">
            <span className="text-amber-300 font-medium">Demo Mode</span>
            <span className="text-slate-400 text-sm">Showing simulated whale signals. Connect VITE_BOT_BRIDGE_URL for live data.</span>
          </div>
        )}

        {status === "connecting" && (
          <div className="flex items-center gap-3 bg-slate-800/50 p-4 rounded-lg border border-slate-700 mb-6">
            <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-cyan-400" />
            <span className="text-slate-300">Connecting to whale bridge...</span>
          </div>
        )}

        {status === "error" && (
          <div className="bg-red-900/20 border border-red-500/50 rounded-lg p-6 mb-6">
            <p className="text-red-300 font-mono text-sm">{errorMessage}</p>
            <p className="text-slate-400 text-xs mt-2">
              Add{" "}
              <code className="bg-slate-800 px-2 py-0.5 rounded">VITE_BOT_BRIDGE_URL</code>{" "}
              to your Vercel environment variables or <code className="bg-slate-800 px-2 py-0.5 rounded">.env.local</code>
            </p>
          </div>
        )}

        {status === "connected" && data.length === 0 && (
          <div className="text-center py-12 text-slate-400 border border-dashed border-slate-700 rounded-lg">
            Awaiting whale signals… No data received yet.
          </div>
        )}

        <div className="space-y-4">
          {data.map((signal, i) => (
            <div
              key={`${signal.timestamp}-${i}-${signal.tradeId || ""}`}
              className={`p-4 rounded-lg border-l-4 ${
                signal.type === "buy"
                  ? "border-green-400 bg-green-500/10"
                  : "border-red-400 bg-red-500/10"
              }`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-bold text-lg">{signal.symbol}</span>
                <span className="text-xs uppercase bg-slate-800 px-3 py-1 rounded-full">
                  {signal.exchange}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm mt-2">
                <span className={signal.type === "buy" ? "text-green-300" : "text-red-300"}>
                  {signal.type.toUpperCase()} {signal.amount.toFixed(6)}
                </span>
                <span className="text-slate-400">
                  ${signal.usdValue.toLocaleString()}
                </span>
                <span className="text-slate-500">
                  {new Date(signal.timestamp).toLocaleTimeString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
