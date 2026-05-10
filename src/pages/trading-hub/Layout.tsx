import { NavLink, Outlet, Link } from "react-router-dom";
import {
  TrendingUp, Activity, BarChart3, Search, MessageCircle, Clock,
  CandlestickChart, ArrowLeft,
} from "lucide-react";

const NAV = [
  { to: "/trading-hub", icon: TrendingUp, label: "Dashboard", end: true },
  { to: "/trading-hub/technical", icon: Activity, label: "Technicals" },
  { to: "/trading-hub/backtest", icon: BarChart3, label: "Backtest" },
  { to: "/trading-hub/screener", icon: Search, label: "Screener" },
  { to: "/trading-hub/sentiment", icon: MessageCircle, label: "Sentiment" },
  { to: "/trading-hub/timeframes", icon: Clock, label: "Timeframes" },
  { to: "/trading-hub/patterns", icon: CandlestickChart, label: "Patterns" },
];

export default function TradingHubLayout() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground">
      <nav className="h-14 bg-card/90 backdrop-blur-md border-b border-border flex items-center px-4 gap-1 shrink-0 z-50">
        <Link to="/" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary mr-3">
          <ArrowLeft className="w-3.5 h-3.5" /> Radar
        </Link>
        <div className="flex items-center gap-2 mr-6">
          <TrendingUp className="w-5 h-5 text-primary" />
          <span className="font-bold text-lg tracking-tight">TRADING HUB</span>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                `flex items-center gap-2 px-3 py-1.5 rounded text-xs font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? "bg-primary/20 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary"
                }`
              }
            >
              <n.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{n.label}</span>
            </NavLink>
          ))}
        </div>
        <div className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground hidden md:block">
          Live · TradingView · Yahoo · Reddit · RSS
        </div>
      </nav>
      <main className="flex-1 p-4 overflow-auto">
        <Outlet />
      </main>
      <footer className="px-4 py-2 border-t border-border text-[10px] text-muted-foreground text-center">
        Data sources: Yahoo Finance · Binance · Reddit · CoinDesk / CoinTelegraph / Decrypt RSS
      </footer>
    </div>
  );
}
