// server/bridge.ts
// Minimal bot bridge for Whale Radar v9
// Connects to Binance/Bybit WebSocket streams real-time and forwards large trades to the frontend.
import { WebSocketServer, WebSocket } from 'ws';
import * as http from 'http';

const PORT = parseInt(process.env.BRIDGE_PORT || '3001', 10);
const WHALE_THRESHOLD = parseFloat(process.env.BRIDGE_WHALE_THRESHOLD || '100000');

// ------------------------- Exchange WebSocket Streams -------------------------
interface TickerStream {
    symbol: string;
    price: string;
    volume: string;
    quoteVolume?: string;
}

function connectBinanceTickers() {
    const streams = ['btcusdt', 'ethusdt', 'solusdt', 'bnbusdt', 'xrpusdt']
        .map(s => `${s}@ticker`)
        .join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;
    const ws = new WebSocket(url);
    ws.on('open', () => console.log('[Binance] connected to ticker streams'));
    ws.on('message', (data: Buffer) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.data) {
                const ticker: TickerStream = {
                    symbol: msg.data.s,
                    price: msg.data.c,
                    volume: msg.data.v,
                    quoteVolume: msg.data.q
                };
                // Simulate whale detection: large volume relative to price
                const volumeUsd = parseFloat(ticker.quoteVolume || '0');
                if (volumeUsd > WHALE_THRESHOLD) {
                    const signal = {
                        timestamp: Date.now(),
                        symbol: ticker.symbol,
                        exchange: 'binance',
                        amount: parseFloat(ticker.volume),
                        type: 'buy', // simplified
                        usdValue: volumeUsd
                    };
                    broadcastSignal(signal);
                }
            }
        } catch (e) {
            // ignore parse errors
        }
    });
    ws.on('error', console.error);
    ws.on('close', () => setTimeout(connectBinanceTickers, 3000));
}

function connectBybitTickers() {
    const topics = ['publicTrade.BTCUSDT', 'publicTrade.ETHUSDT', 'publicTrade.SOLUSDT'];
    const url = `wss://stream.bybit.com/v5/public/spot`; // Bybit unified public stream
    const ws = new WebSocket(url);
    ws.on('open', () => {
        console.log('[Bybit] connected');
        ws.send(JSON.stringify({ op: 'subscribe', args: topics }));
    });
    ws.on('message', (data: Buffer) => {
        try {
            const msg = JSON.parse(data.toString());
            if (msg.topic && msg.data && Array.isArray(msg.data)) {
                for (const trade of msg.data) {
                    const price = parseFloat(trade.p);
                    const size = parseFloat(trade.v);
                    const usdValue = price * size;
                    if (usdValue > WHALE_THRESHOLD) {
                        const signal = {
                            timestamp: trade.T,
                            symbol: trade.s || msg.topic.split('.')[1],
                            exchange: 'bybit',
                            amount: size,
                            type: trade.S === 'Buy' ? 'buy' : 'sell',
                            usdValue
                        };
                        broadcastSignal(signal);
                    }
                }
            }
        } catch (e) {
            // ignore
        }
    });
    ws.on('error', console.error);
    ws.on('close', () => setTimeout(connectBybitTickers, 3000));
}

// ------------------------- Frontend Bridge Server -------------------------
const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Whale Bridge OK');
});

const wss = new WebSocketServer({ server });
const frontendClients = new Set<WebSocket>();

wss.on('connection', (ws: WebSocket) => {
    console.log('Frontend client connected');
    frontendClients.add(ws);
    ws.on('close', () => frontendClients.delete(ws));
});

function broadcastSignal(signal: object) {
    const payload = JSON.stringify(signal);
    for (const client of frontendClients) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(payload);
        }
    }
}

// Initialize exchange connections
connectBinanceTickers();
connectBybitTickers();

server.listen(PORT, () => {
    console.log(`✅ Whale Bridge running on ws://localhost:${PORT}`);
});
