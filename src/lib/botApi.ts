/**
 * Bot Bridge API Client
 * Handles REST communication with the trading bot backend
 */

const BOT_BRIDGE_URL = import.meta.env.VITE_BOT_BRIDGE_URL || "";

export interface BotConfig {
  id: string;
  name: string;
  type: "arbitrage" | "grid" | "volume";
  status: "running" | "stopped" | "paused";
  config: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ArbitrageOpportunity {
  id: string;
  pair: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spreadPercent: number;
  potentialProfit: number;
  volume: number;
  timestamp: number;
}

export interface GridBotConfig {
  pair: string;
  exchange: string;
  upperPrice: number;
  lowerPrice: number;
  gridLevels: number;
  totalInvestment: number;
  stopLoss?: number;
  takeProfit?: number;
}

export interface GridBotStatus {
  id: string;
  pair: string;
  exchange: string;
  status: "running" | "stopped" | "paused";
  activeOrders: number;
  filledOrders: number;
  totalProfit: number;
  profitPercent: number;
  createdAt: number;
}

export interface VolumeConfig {
  pair: string;
  exchange: string;
  targetVolume: number;
  minOrderSize: number;
  maxOrderSize: number;
  interval: number; // seconds between orders
}

export interface PortfolioAsset {
  symbol: string;
  amount: number;
  valueUsd: number;
  price: number;
  change24h: number;
  exchange: string;
}

export interface TradeHistory {
  id: string;
  pair: string;
  exchange: string;
  side: "buy" | "sell";
  price: number;
  amount: number;
  total: number;
  fee: number;
  timestamp: number;
  botId?: string;
  botType?: string;
}

class BotApiClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = BOT_BRIDGE_URL.replace(/^ws/, "http").replace(/\/ws$/, "");
  }

  get isConfigured(): boolean {
    return Boolean(BOT_BRIDGE_URL);
  }

  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    if (!this.isConfigured) {
      throw new Error("Bot bridge URL not configured");
    }

    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`);
    }

    return response.json();
  }

  // Arbitrage endpoints
  async getArbitrageOpportunities(): Promise<ArbitrageOpportunity[]> {
    return this.request("/api/arbitrage/opportunities");
  }

  async executeArbitrage(opportunityId: string): Promise<{ success: boolean; txId?: string }> {
    return this.request("/api/arbitrage/execute", {
      method: "POST",
      body: JSON.stringify({ opportunityId }),
    });
  }

  // Grid bot endpoints
  async getGridBots(): Promise<GridBotStatus[]> {
    return this.request("/api/grid/bots");
  }

  async createGridBot(config: GridBotConfig): Promise<GridBotStatus> {
    return this.request("/api/grid/create", {
      method: "POST",
      body: JSON.stringify(config),
    });
  }

  async startGridBot(botId: string): Promise<{ success: boolean }> {
    return this.request(`/api/grid/${botId}/start`, { method: "POST" });
  }

  async stopGridBot(botId: string): Promise<{ success: boolean }> {
    return this.request(`/api/grid/${botId}/stop`, { method: "POST" });
  }

  async deleteGridBot(botId: string): Promise<{ success: boolean }> {
    return this.request(`/api/grid/${botId}`, { method: "DELETE" });
  }

  // Volume maker endpoints
  async getVolumeConfigs(): Promise<VolumeConfig[]> {
    return this.request("/api/volume/configs");
  }

  async createVolumeConfig(config: VolumeConfig): Promise<{ id: string }> {
    return this.request("/api/volume/create", {
      method: "POST",
      body: JSON.stringify(config),
    });
  }

  async startVolumeMaker(configId: string): Promise<{ success: boolean }> {
    return this.request(`/api/volume/${configId}/start`, { method: "POST" });
  }

  async stopVolumeMaker(configId: string): Promise<{ success: boolean }> {
    return this.request(`/api/volume/${configId}/stop`, { method: "POST" });
  }

  // Portfolio endpoints
  async getPortfolio(): Promise<PortfolioAsset[]> {
    return this.request("/api/portfolio");
  }

  async getTradeHistory(limit?: number): Promise<TradeHistory[]> {
    const query = limit ? `?limit=${limit}` : "";
    return this.request(`/api/trades${query}`);
  }

  // Health check
  async healthCheck(): Promise<{ status: string; version: string }> {
    return this.request("/api/health");
  }
}

export const botApi = new BotApiClient();
