import { NavLink, Outlet, Link } from "react-router-dom";
import { Activity, BarChart3, Grid3X3, Volume2, Wallet, Waves, ArrowLeft, Brain } from "lucide-react";
import { useNexusBot } from "@/hooks/useNexusBot";
import { useNexusMarkets } from "@/hooks/useNexusMarkets";

const NAV = [
  { to: "/nexus/whale", icon: Waves, label: "Whale Watch" },
  { to: "/nexus/arbitrage", icon: BarChart3, label: "Arbitrage" },
  { to: "/nexus/grid", icon: Grid3X3, label: "Grid Studio" },
  { to: "/nexus/volume", icon: Volume2, label: "Volume Maker" },
  { to: "/nexus/portfolio", icon: Wallet, label: "Portfolio" },
  { to: "/nexus/crystal-ball", icon: Brain, label: "Crystal Ball" },
];

export default function NexusLayout() {
  const { connected: botConnected } = useNexusBot();
  const { data, isError } = useNexusMarkets();

  const liveExchanges =
    (data?.hyperliquid.length ? 1 : 0) +
    (data?.backpack.length ? 1 : 0) +
    (data?.binance.length ? 1 : 0);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <nav className="h-14 bg-card/90 backdrop-blur-md border-b border-border flex items-center px-4 gap-1 shrink-0 z-50">
        <Link to="/" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary mr-3">
          <ArrowLeft className="w-3.5 h-3.5" /> Radar
        </Link>
        <Link to="/trading-hub" className="text-[10px] tracking-[2px] px-2 py-0.5 rounded border border-primary/40 text-primary hover:bg-primary/10 mr-3">
          TRADING HUB →
        </Link>
        <div className="flex items-center gap-2 mr-6">
          <Activity className="w-5 h-5 text-primary" />
          <span className="font-bold text-lg tracking-tight">NEXUS</span>
          <div
            className={`w-2 h-2 rounded-full ml-2 ${
              liveExchanges === 3
                ? "bg-primary animate-pulse"
                : liveExchanges > 0
                ? "bg-yellow-500"
                : "bg-destructive"
            }`}
            title={`${liveExchanges}/3 exchanges live`}
          />
        </div>

        <div className="flex items-center gap-1 overflow-x-auto">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`
              }
            >
              <item.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{item.label}</span>
            </NavLink>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2 text-[10px] uppercase tracking-wider">
          <span
            className={`px-2 py-0.5 rounded border ${
              botConnected
                ? "bg-primary/10 text-primary border-primary/30"
                : "bg-muted text-muted-foreground border-border"
            }`}
          >
            Bot: {botConnected ? "Connected" : "Idle"}
          </span>
        </div>
      </nav>

      <main className="flex-1 p-4 overflow-auto">
        {isError && (
          <div className="mb-3 px-3 py-2 rounded border border-destructive/40 bg-destructive/10 text-xs">
            Live exchange feed temporarily unavailable. Retrying…
          </div>
        )}
        <Outlet />
      </main>
    </div>
  );
}
