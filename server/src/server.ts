// server/src/server.ts
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config({ path: '../.env' });

const PORT = parseInt(process.env.BRIDGE_PORT || '3001', 10);
const WHALE_THRESHOLD = parseFloat(process.env.BRIDGE_WHALE_THRESHOLD || '100000');

// Express API
const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/signal-outcomes/fill-prices', (req, res) => {
    res.json({ success: true, message: 'Prices filled (demo)' });
});

app.get('/api/health', (_, res) => res.json({ status: 'ok' }));

// HTTP + WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server });
const frontendClients = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
    console.log('[Bridge] Frontend client connected');
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

// Interfaces
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

// Exchange Adapter Base
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
        console.log(`[${this.exchangeName}] Connecting...`);
        this.ws = new WebSocket(this.url);

        this.ws.on('open', () => {
            console.log(`[${this.exchangeName}] Connected`);
            this.onOpen();
        });

        this.ws.on('message', (data: Buffer) => {
            try {
                const msg = JSON.parse(data.toString());
                this.onMessage(msg);
            } catch {}
        });

        this.ws.on('error', (err) => console.error(`[${this.exchangeName}] Error:`, err.message));
        this.ws.on('close', (code) => {
            console.log(`[${this.exchangeName}] Closed (${code}). Reconnecting in 5s...`);
            this.ws = null;
            setTimeout(() => this.connect(), 5000);
        });
    }

    protected onOpen(): void {}
    protected onMessage(msg: any): void {}

    protected processTrade(trade: RawTrade): void {
        const usdValue = trade.price * trade.size;
        if (usdValue >= WHALE_THRESHOLD) {
            broadcastSignal({
                ...trade,
                usdValue,
                triggerReason: `Large ${trade.side} on ${trade.exchange}`
            });
        }
    }
}

// Binance
class BinanceAdapter extends BaseWebSocketAdapter {
    constructor() {
        const streams = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt']
            .map(s => `${s}@trade`).join('/');
        super('Binance', `wss://stream.binance.com:9443/stream?streams=${streams}`);
    }
    protected onMessage(msg: any): void {
        if (msg.data) {
            const t = msg.data;
            this.processTrade({
                exchange: 'binance',
                symbol: t.s,
                price: parseFloat(t.p),
                size: parseFloat(t.q),
                side: t.m ? 'sell' : 'buy',
                timestamp: t.T,
                tradeId: t.t
            });
        }
    }
}

// OKX
class OKXAdapter extends BaseWebSocketAdapter {
    constructor() { super('OKX', 'wss://ws.okx.com:8443/ws/v5/public'); }
    protected onOpen(): void {
        this.ws?.send(JSON.stringify({
            op: 'subscribe',
            args: [
                { channel: 'trades', instId: 'BTC-USDT' },
                { channel: 'trades', instId: 'ETH-USDT' },
                { channel: 'trades', instId: 'SOL-USDT' }
            ]
        }));
    }
    protected onMessage(msg: any): void {
        if (msg.arg?.channel === 'trades' && msg.data) {
            for (const t of msg.data) {
                this.processTrade({
                    exchange: 'okx',
                    symbol: t.instId,
                    price: parseFloat(t.px),
                    size: parseFloat(t.sz),
                    side: t.side.toLowerCase(),
                    timestamp: parseInt(t.ts),
                    tradeId: t.tradeId
                });
            }
        }
    }
}

// Hyperliquid
class HyperliquidAdapter extends BaseWebSocketAdapter {
    constructor() { super('Hyperliquid', 'wss://api.hyperliquid.xyz/ws'); }
    protected onOpen(): void {
        for (const coin of ['BTC', 'ETH', 'SOL']) {
            this.ws?.send(JSON.stringify({
                method: 'subscribe',
                subscription: { type: 'trades', coin }
            }));
        }
    }
    protected onMessage(msg: any): void {
        if (msg.channel === 'trades' && msg.data) {
            for (const t of msg.data) {
                this.processTrade({
                    exchange: 'hyperliquid',
                    symbol: t.coin,
                    price: parseFloat(t.px),
                    size: parseFloat(t.sz),
                    side: t.side,
                    timestamp: t.time,
                    tradeId: t.tid
                });
            }
        }
    }
}

// Backpack
class BackpackAdapter extends BaseWebSocketAdapter {
    constructor() { super('Backpack', 'wss://ws.backpack.exchange'); }
    protected onOpen(): void {
        for (const sym of ['SOL_USDC', 'BTC_USDC', 'ETH_USDC']) {
            this.ws?.send(JSON.stringify({
                method: 'SUBSCRIBE',
                params: [`trade.${sym}`],
                id: 1
            }));
        }
    }
    protected onMessage(msg: any): void {
        if (msg.stream?.startsWith('trade.') && msg.data) {
            const t = msg.data;
            this.processTrade({
                exchange: 'backpack',
                symbol: t.s,
                price: parseFloat(t.p),
                size: parseFloat(t.q),
                side: t.m ? 'sell' : 'buy',
                timestamp: t.T,
                tradeId: t.t
            });
        }
    }
}

// Bybit
class BybitAdapter extends BaseWebSocketAdapter {
    constructor() { super('Bybit', 'wss://stream.bybit.com/v5/public/spot'); }
    protected onOpen(): void {
        this.ws?.send(JSON.stringify({
            op: 'subscribe',
            args: ['publicTrade.BTCUSDT', 'publicTrade.ETHUSDT', 'publicTrade.SOLUSDT']
        }));
    }
    protected onMessage(msg: any): void {
        if (msg.topic?.startsWith('publicTrade.') && msg.data) {
            for (const t of msg.data) {
                this.processTrade({
                    exchange: 'bybit',
                    symbol: t.s,
                    price: parseFloat(t.p),
                    size: parseFloat(t.v),
                    side: t.S === 'Buy' ? 'buy' : 'sell',
                    timestamp: t.T,
                    tradeId: t.i
                });
            }
        }
    }
}

// Start all adapters
const adapters = [
    new BinanceAdapter(),
    new OKXAdapter(),
    new HyperliquidAdapter(),
    new BackpackAdapter(),
    new BybitAdapter()
];
adapters.forEach(a => a.connect());

server.listen(PORT, () => {
    console.log(`✅ Whale Radar Server running on port ${PORT}`);
    console.log(`   API: http://localhost:${PORT}/api`);
    console.log(`   WebSocket: ws://localhost:${PORT}`);
});
