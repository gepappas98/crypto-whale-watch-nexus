/**
 * Bot Bridge WebSocket Hook
 * Handles real-time communication with the trading bot backend
 */

import { useEffect, useState, useRef, useCallback } from "react";
import type {
  ArbitrageOpportunity,
  GridBotStatus,
  PortfolioAsset,
  TradeHistory,
} from "@/lib/botApi";

const BOT_BRIDGE_URL = import.meta.env.VITE_BOT_BRIDGE_URL || "";

export type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export interface WhaleSignal {
  id: string;
  timestamp: number;
  symbol: string;
  exchange: string;
  amount: number;
  type: "buy" | "sell";
  usdValue: number;
  txHash?: string;
}

export interface BotBridgeState {
  // Connection
  status: ConnectionStatus;
  isConfigured: boolean;
  errorMessage: string | null;

  // Real-time data
  whaleSignals: WhaleSignal[];
  arbitrageOpportunities: ArbitrageOpportunity[];
  gridBots: GridBotStatus[];
  portfolio: PortfolioAsset[];
  recentTrades: TradeHistory[];

  // Stats
  totalPnl: number;
  dailyPnl: number;
  activeBotsCount: number;
}

type MessageType =
  | "whale_signal"
  | "arbitrage_update"
  | "grid_update"
  | "portfolio_update"
  | "trade"
  | "pnl_update"
  | "error";

interface WsMessage {
  type: MessageType;
  data: unknown;
  timestamp: number;
}

export function useBotBridge() {
  const [state, setState] = useState<BotBridgeState>({
    status: "disconnected",
    isConfigured: Boolean(BOT_BRIDGE_URL),
    errorMessage: null,
    whaleSignals: [],
    arbitrageOpportunities: [],
    gridBots: [],
    portfolio: [],
    recentTrades: [],
    totalPnl: 0,
    dailyPnl: 0,
    activeBotsCount: 0,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const reconnectAttemptsRef = useRef(0);
  const maxReconnectAttempts = 5;

  const connect = useCallback(() => {
    if (!BOT_BRIDGE_URL) {
      setState((prev) => ({
        ...prev,
        status: "disconnected",
        isConfigured: false,
      }));
      return;
    }

    // Clean up existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    setState((prev) => ({ ...prev, status: "connecting", errorMessage: null }));

    try {
      const ws = new WebSocket(BOT_BRIDGE_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptsRef.current = 0;
        setState((prev) => ({ ...prev, status: "connected", errorMessage: null }));
        
        // Subscribe to all channels
        ws.send(JSON.stringify({ type: "subscribe", channels: ["whale", "arbitrage", "grid", "portfolio", "trades"] }));
      };

      ws.onmessage = (event) => {
        try {
          const message: WsMessage = JSON.parse(event.data);
          handleMessage(message);
        } catch (err) {
          console.error("Failed to parse WebSocket message:", err);
        }
      };

      ws.onerror = () => {
        setState((prev) => ({
          ...prev,
          status: "error",
          errorMessage: "WebSocket connection error",
        }));
      };

      ws.onclose = (event) => {
        wsRef.current = null;

        if (!event.wasClean && reconnectAttemptsRef.current < maxReconnectAttempts) {
          reconnectAttemptsRef.current += 1;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          
          setState((prev) => ({
            ...prev,
            status: "connecting",
            errorMessage: `Reconnecting... (attempt ${reconnectAttemptsRef.current})`,
          }));

          reconnectTimeoutRef.current = setTimeout(connect, delay);
        } else if (reconnectAttemptsRef.current >= maxReconnectAttempts) {
          setState((prev) => ({
            ...prev,
            status: "error",
            errorMessage: "Max reconnection attempts reached. Please refresh the page.",
          }));
        } else {
          setState((prev) => ({ ...prev, status: "disconnected" }));
        }
      };
    } catch (err) {
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: `Connection failed: ${(err as Error).message}`,
      }));
    }
  }, []);

  const handleMessage = useCallback((message: WsMessage) => {
    switch (message.type) {
      case "whale_signal":
        setState((prev) => ({
          ...prev,
          whaleSignals: [message.data as WhaleSignal, ...prev.whaleSignals].slice(0, 100),
        }));
        break;

      case "arbitrage_update":
        setState((prev) => ({
          ...prev,
          arbitrageOpportunities: message.data as ArbitrageOpportunity[],
        }));
        break;

      case "grid_update":
        setState((prev) => ({
          ...prev,
          gridBots: message.data as GridBotStatus[],
          activeBotsCount: (message.data as GridBotStatus[]).filter((b) => b.status === "running").length,
        }));
        break;

      case "portfolio_update":
        setState((prev) => ({
          ...prev,
          portfolio: message.data as PortfolioAsset[],
        }));
        break;

      case "trade":
        setState((prev) => ({
          ...prev,
          recentTrades: [message.data as TradeHistory, ...prev.recentTrades].slice(0, 50),
        }));
        break;

      case "pnl_update":
        const pnlData = message.data as { total: number; daily: number };
        setState((prev) => ({
          ...prev,
          totalPnl: pnlData.total,
          dailyPnl: pnlData.daily,
        }));
        break;

      case "error":
        console.error("Bot bridge error:", message.data);
        break;
    }
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setState((prev) => ({ ...prev, status: "disconnected" }));
  }, []);

  const sendMessage = useCallback((type: string, data: unknown) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type, data, timestamp: Date.now() }));
    }
  }, []);

  useEffect(() => {
    if (BOT_BRIDGE_URL) {
      connect();
    }

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [connect]);

  return {
    ...state,
    connect,
    disconnect,
    sendMessage,
  };
}
