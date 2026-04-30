// server/bridge.ts
// Enhanced Whale Bridge: Multi-Exchange Tick Aggregation & AI-Ready Pattern Analysis
// Architecture derived from the cryptocj520/crypto-trading-open repository.

import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';

// ------------------------------------------------------------
// 1. Configuration & Environment
// ------------------------------------------------------------
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || '3001', 10);
const WHALE_THRESHOLD_USD = parseFloat(process.env.BRIDGE_WHALE_THRESHOLD || '100000');

// ------------------------------------------------------------
// 2. Core Data Model & Signal Definitions
// ------------------------------------------------------------
interface RawTrade {
    exchange: string;
    symbol: string;
    price: number;
    size: number;
    side: 'buy' | 'sell';
    timestamp: number;
    tradeId?: string;
}

interface WhaleSignal extends RawTrade {
    usdValue: number;
    triggerReason: string;
}

// ------------------------------------------------------------
// 3. Exchange Adapter Pattern (Derived from crypto-trading-open)
//    Each adapter normalizes exchange-specific data to the RawTrade interface.
// ------------------------------------------------------------
class BaseWebSocketAdapter {
    protected url: string;
    protected ws: WebSocket | null = null;
    public exchangeName: string;

    constructor(exchangeName: string, url: string) {
        this.exchangeName = exchangeName;
        this.url = url;
    }

    public connect(): void {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
        console.log(`[${this.exchangeName}] Connecting to ${this.url}...`);
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
            console.log(`[${this.exchangeName}] Connected successfully.`);
            this.onOpen();
        });

        this.ws.on('message', (data: Buffer) => {
            try {
                const msg = JSON.parse(data.toString());
                this.onMessage(msg);
            } catch (e) {
                // Ignore parse errors for partial or non-JSON messages
            }
        });

        this.ws.on('error', (error) => {
            console.error(`[${this.exchangeName}] WebSocket error:`, error.message);
        });

        this.ws.on('close', (code, reason) => {
            console.log(`[${this.exchangeName}] Connection closed (code: ${code}). Reconnecting in 5s...`);
            this.ws = null;
            setTimeout(() => this.connect(), 5000);
        });
    }

    protected onOpen(): void {
        // Override in subclasses to send subscription messages
    }

    protected onMessage(msg: any): void {
        // Override in subclasses to parse exchange-specific messages and call processTrade()
    }

    protected processTrade(trade: RawTrade): void {
        const usdValue = trade.price * trade.size;
        if (usdValue >= WHALE_THRESHOLD_USD) {
            const signal: WhaleSignal = {
                ...trade,
                usdValue,
                triggerReason: `Large ${trade.side} trade detected on ${trade.exchange}`
            };
            broadcastSignal(signal);
        }
    }
}

// ------------------------------------------------------------
// 4. Exchange-Specific Adapter Implementations
// ------------------------------------------------------------

// 4.1 Binance Adapter (Tick-level trade stream)
class BinanceAdapter extends BaseWebSocketAdapter {
    constructor() {
        // Streams for multiple symbols: individual trade streams
        const streams = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt']
            .map(s => `${s}@trade`).join('/');
        super('Binance', `wss://stream.binance.com:9443/stream?streams=${streams}`);
    }

    protected onMessage(msg: any): void {
        if (msg.data) {
            const trade = msg.data;
            this.processTrade({
                exchange: 'binance',
                symbol: trade.s,
                price: parseFloat(trade.p),
                size: parseFloat(trade.q),
                side: trade.m ? 'sell' : 'buy', // m = isBuyerMaker
                timestamp: trade.T,
                tradeId: trade.t
            });
        }
    }
}

// 4.2 OKX Adapter (Tick-level trade stream)
class OKXAdapter extends BaseWebSocketAdapter {
    constructor() {
        super('OKX', 'wss://ws.okx.com:8443/ws/v5/public');
    }

    protected onOpen(): void {
        const subscribeMsg = {
            op: 'subscribe',
            args: [
                { channel: 'trades', instId: 'BTC-USDT' },
                { channel: 'trades', instId: 'ETH-USDT' },
                { channel: 'trades', instId: 'SOL-USDT' }
            ]
        };
        this.ws?.send(JSON.stringify(subscribeMsg));
    }

    protected onMessage(msg: any): void {
        if (msg.arg?.channel === 'trades' && msg.data) {
            for (const trade of msg.data) {
                this.processTrade({
                    exchange: 'okx',
                    symbol: trade.instId,
                    price: parseFloat(trade.px),
                    size: parseFloat(trade.sz),
                    side: trade.side.toLowerCase(),
                    timestamp: parseInt(trade.ts),
                    tradeId: trade.tradeId
                });
            }
        }
    }
}

// 4.3 Hyperliquid Adapter (Tick-level trade stream via JSON-RPC)
class HyperliquidAdapter extends BaseWebSocketAdapter {
    private coins: string[] = ['BTC', 'ETH', 'SOL'];

    constructor() {
        super('Hyperliquid', 'wss://api.hyperliquid.xyz/ws');
    }

    protected onOpen(): void {
        for (const coin of this.coins) {
            const subscribeMsg = {
                method: 'subscribe',
                subscription: { type: 'trades', coin: coin }
            };
            this.ws?.send(JSON.stringify(subscribeMsg));
        }
    }

    protected onMessage(msg: any): void {
        if (msg.channel === 'trades' && msg.data) {
            for (const trade of msg.data) {
                this.processTrade({
                    exchange: 'hyperliquid',
                    symbol: trade.coin,
                    price: parseFloat(trade.px),
                    size: parseFloat(trade.sz),
                    side: trade.side,
                    timestamp: trade.time,
                    tradeId: trade.tid
                });
            }
        }
    }
}

// 4.4 Additional Exchange Adapters (Following the same pattern)

class BackpackAdapter extends BaseWebSocketAdapter {
    constructor() {
        super('Backpack', 'wss://ws.backpack.exchange');
    }

    protected onOpen(): void {
        const symbols = ['SOL_USDC', 'BTC_USDC', 'ETH_USDC'];
        symbols.forEach(symbol => {
            const subscribeMsg = {
                method: 'SUBSCRIBE',
                params: [`trade.${symbol}`],
                id: 1
            };
            this.ws?.send(JSON.stringify(subscribeMsg));
        });
    }

    protected onMessage(msg: any): void {
        if (msg.stream?.startsWith('trade.') && msg.data) {
            this.processTrade({
                exchange: 'backpack',
                symbol: msg.data.s,
                price: parseFloat(msg.data.p),
                size: parseFloat(msg.data.q),
                side: msg.data.m ? 'sell' : 'buy',
                timestamp: msg.data.T,
                tradeId: msg.data.t
            });
        }
    }
}

class BybitAdapter extends BaseWebSocketAdapter {
    constructor() {
        super('Bybit', 'wss://stream.bybit.com/v5/public/spot');
    }

    protected onOpen(): void {
        const subscribeMsg = {
            op: 'subscribe',
            args: ['publicTrade.BTCUSDT', 'publicTrade.ETHUSDT', 'publicTrade.SOLUSDT']
        };
        this.ws?.send(JSON.stringify(subscribeMsg));
    }

    protected onMessage(msg: any): void {
        if (msg.topic?.startsWith('publicTrade.') && msg.data) {
            for (const trade of msg.data) {
                this.processTrade({
                    exchange: 'bybit',
                    symbol: trade.s,
                    price: parseFloat(trade.p),
                    size: parseFloat(trade.v),
                    side: trade.S === 'Buy' ? 'buy' : 'sell',
                    timestamp: trade.T,
                    tradeId: trade.i
                });
            }
        }
    }
}

// ------------------------------------------------------------
// 5. WebSocket Server & Client Broadcasting
// ------------------------------------------------------------
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
});

const wss = new WebSocketServer({ server });
const frontendClients = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
    console.log('Frontend client connected');
    frontendClients.add(ws);
    ws.on('close', () => frontendClients.delete(ws));
    ws.on('error', () => frontendClients.delete(ws));
});

function broadcastSignal(signal: WhaleSignal) {
    const payload = JSON.stringify(signal);
    for (const client of frontendClients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    }
}

// ------------------------------------------------------------
// 6. Initialization of All Exchange Adapters
// ------------------------------------------------------------
const adapters: BaseWebSocketAdapter[] = [
    new BinanceAdapter(),
    new OKXAdapter(),
    new HyperliquidAdapter(),
    new BackpackAdapter(),
    new BybitAdapter(),
];

adapters.forEach(adapter => {
    adapter.connect();
    console.log(`[Bridge] ${adapter.exchangeName} adapter initialized.`);
});

server.listen(BRIDGE_PORT, () => {
    console.log(`✅ Enhanced Whale Bridge live on ws://localhost:${BRIDGE_PORT}`);
    console.log(`   Threshold: $${WHALE_THRESHOLD_USD.toLocaleString()}`);
    console.log(`   Exchanges: ${adapters.map(a => a.exchangeName).join(', ')}`);
});
