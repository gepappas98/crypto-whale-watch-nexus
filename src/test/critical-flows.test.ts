import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  canTrade,
  clearAllLocks,
  getActiveLocks,
  type ProtectionConfig,
} from "@/lib/nexus/protections";
import {
  clearBotTradeStore,
  recordBotTrade,
} from "@/lib/nexus/botTradeStore";
import {
  clearSignalStore,
  computeSignalEval,
  fillSignalPrices,
  getSignalStoreStats,
  saveSignal,
} from "@/lib/signalStore";
import { getCooldownRemaining, getActiveCooldowns, handleRateLimit, isRateLimited, RL_KEYS } from "@/lib/rateLimit";

const NOW = new Date("2026-08-29T12:00:00.000Z").getTime();

const disabledProtectionConfig = (): ProtectionConfig => ({
  cooldown: { enabled: false, lookbackMinutes: 15 },
  stoplossGuard: { enabled: false, lookbackMinutes: 60, tradeLimit: 2, lockMinutes: 30, onlyPerPair: false },
  maxDrawdown: { enabled: false, lookbackMinutes: 60, tradeLimit: 2, maxAllowedDrawdown: 0.1, lockMinutes: 30 },
  lowProfitPairs: { enabled: false, lookbackMinutes: 60, tradeLimit: 2, requiredProfit: 0, lockMinutes: 30 },
});

const trade = (overrides: Partial<Parameters<typeof recordBotTrade>[0]> = {}) => ({
  strategy: "arbitrage" as const,
  pair: "BTC-USD",
  side: "long" as const,
  closeProfit: 0.01,
  isStopExit: false,
  openedAt: NOW - 120_000,
  closedAt: NOW - 60_000,
  ...overrides,
});

const signal = (overrides: Partial<Parameters<typeof saveSignal>[0]> = {}) => ({
  symbol: "BTC",
  coin_id: "bitcoin",
  signal: "BUY",
  score: 80,
  category: "momentum",
  vmcap: 1_000_000,
  entry_price: 100,
  chg24: 2,
  volSpike: 1,
  supplyPct: 1,
  mcap: 1_000_000,
  dexHot: false,
  isSol: false,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  clearAllLocks();
  clearBotTradeStore();
  clearSignalStore();
});

describe("protection engine", () => {
  it("allows a trade when every protection is disabled", () => {
    expect(canTrade("BTC-USD", "long", disabledProtectionConfig())).toEqual({ allowed: true });
  });

  it("blocks a pair during cooldown after a recent close", () => {
    recordBotTrade(trade());
    const result = canTrade("BTC-USD", "long", {
      ...disabledProtectionConfig(),
      cooldown: { enabled: true, lookbackMinutes: 15 },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Cooldown");
    expect(getActiveLocks()).toHaveLength(1);
  });

  it("blocks after the stop-loss threshold and scopes the lock per pair", () => {
    for (let i = 0; i < 2; i += 1) recordBotTrade(trade({ isStopExit: true, pair: "ETH-USD" }));
    const result = canTrade("ETH-USD", "short", {
      ...disabledProtectionConfig(),
      stoplossGuard: { enabled: true, lookbackMinutes: 60, tradeLimit: 2, lockMinutes: 30, onlyPerPair: true },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("stop-losses");
    expect(getActiveLocks()[0]).toMatchObject({ pair: "ETH-USD", source: "stoploss_guard" });
  });

  it("blocks all pairs when max drawdown exceeds the configured threshold", () => {
    recordBotTrade(trade({ closeProfit: 0.2, closedAt: NOW - 180_000 }));
    recordBotTrade(trade({ closeProfit: -0.25, closedAt: NOW - 120_000 }));
    const result = canTrade("SOL-USD", "long", {
      ...disabledProtectionConfig(),
      maxDrawdown: { enabled: true, lookbackMinutes: 60, tradeLimit: 2, maxAllowedDrawdown: 0.1, lockMinutes: 30 },
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Max drawdown");
    expect(getActiveLocks()[0]).toMatchObject({ pair: "*", source: "max_drawdown" });
  });

  it("blocks a low-profit pair but permits a different pair", () => {
    for (let i = 0; i < 2; i += 1) recordBotTrade(trade({ pair: "DOGE-USD", closeProfit: -0.02 }));
    const config = {
      ...disabledProtectionConfig(),
      lowProfitPairs: { enabled: true, lookbackMinutes: 60, tradeLimit: 2, requiredProfit: 0, lockMinutes: 30 },
    };
    expect(canTrade("DOGE-USD", "long", config).allowed).toBe(false);
    clearAllLocks();
    expect(canTrade("ADA-USD", "long", config)).toEqual({ allowed: true });
  });

  it("reuses an active lock instead of creating duplicate locks", () => {
    recordBotTrade(trade());
    const config = { ...disabledProtectionConfig(), cooldown: { enabled: true, lookbackMinutes: 15 } };
    const first = canTrade("BTC-USD", "long", config);
    const second = canTrade("BTC-USD", "long", config);
    expect(second).toEqual(first);
    expect(getActiveLocks()).toHaveLength(1);
  });
});

describe("signal store", () => {
  it("deduplicates the same symbol and signal within one clock hour", () => {
    saveSignal(signal());
    saveSignal(signal());
    expect(getSignalStoreStats().total).toBe(1);
  });

  it("does not persist HOLD or invalid signals", () => {
    saveSignal(signal({ signal: "HOLD" }));
    saveSignal(signal({ symbol: "" }));
    expect(getSignalStoreStats().total).toBe(0);
  });

  it("computes evaluation metrics from resolved outcomes", () => {
    saveSignal(signal({ symbol: "BTC" }));
    vi.setSystemTime(NOW + 3_600_001);
    saveSignal(signal({ symbol: "ETH", entry_price: 200 }));
    const records = JSON.parse(localStorage.getItem("wr_v9_signals") ?? "[]") as Array<Record<string, unknown>>;
    records[0].outcome_4h = 4;
    records[1].outcome_4h = -2;
    localStorage.setItem("wr_v9_signals", JSON.stringify(records));
    const row = computeSignalEval().find((item) => item.signal === "BUY");
    expect(row).toMatchObject({ fires: 2, with_outcome: 2, positive_4h: 1, profitable_4h: 1, win_rate_4h: 50 });
  });

  it("fills eligible prices and calculates percentage outcome", async () => {
    saveSignal(signal());
    vi.setSystemTime(NOW + 3_600_001);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ bitcoin: { usd: 110 } }) }));
    await expect(fillSignalPrices()).resolves.toBe(1);
    const records = JSON.parse(localStorage.getItem("wr_v9_signals") ?? "[]") as Array<Record<string, unknown>>;
    expect(records[0]).toMatchObject({ price_1h: 110, outcome_1h: 10 });
    vi.unstubAllGlobals();
  });
});

describe("rate-limit manager", () => {
  it("parses Retry-After seconds and exposes the active cooldown", () => {
    handleRateLimit("CoinGecko", RL_KEYS.COINGECKO, "5");
    expect(isRateLimited(RL_KEYS.COINGECKO)).toBe(true);
    expect(getCooldownRemaining(RL_KEYS.COINGECKO)).toBe(5);
    expect(getActiveCooldowns()).toMatchObject([{ key: RL_KEYS.COINGECKO, source: "CoinGecko", remaining: 5 }]);
    vi.advanceTimersByTime(5_001);
    expect(isRateLimited(RL_KEYS.COINGECKO)).toBe(false);
  });
});
