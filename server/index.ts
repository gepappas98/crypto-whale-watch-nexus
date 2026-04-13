/* ══ WHALE RADAR — Express API Server ════════════════════════════════════════
 *  Runs alongside the Vite frontend on Railway.
 *  PORT defaults to 3001 (Vite proxies /api → :3001 in dev).
 * ═══════════════════════════════════════════════════════════════════════════ */
import express from 'express';
import cors from 'cors';
import { ping } from './db';
import { scansRouter }          from './routes/scans';
import { scanRouter }           from './routes/scan';
import { portfolioRouter }      from './routes/portfolio';
import { trackedRouter }        from './routes/tracked';
import { alertsRouter }         from './routes/alerts';
import { whaleEventsRouter }    from './routes/whaleEvents';
import { signalOutcomesRouter, fillOutcomePrices } from './routes/signalOutcomes';

const app = express();
const PORT = Number(process.env.API_PORT) || 3001;

app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
app.use(express.json({ limit: '2mb' }));

// ── Health ─────────────────────────────────────────────────────────────────
app.get('/api/health', async (_req, res) => {
  const db = await ping();
  res.json({ ok: true, db, ts: new Date().toISOString() });
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/scan',             scanRouter);
app.use('/api/scans',            scansRouter);
app.use('/api/portfolio',        portfolioRouter);
app.use('/api/tracked',          trackedRouter);
app.use('/api/alerts',           alertsRouter);
app.use('/api/whale-events',     whaleEventsRouter);
app.use('/api/signal-outcomes',  signalOutcomesRouter);

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[API] Whale RADAR server listening on :${PORT}`);
  ping().then(ok => console.log(`[DB]  PostgreSQL ${ok ? '✓ connected' : '✗ OFFLINE'}`));
});

// ── Background price filler ────────────────────────────────────────────────
// Runs every 30 minutes to fill in 1h/4h/24h outcome prices for recorded signals.
// This is what turns signal_outcomes from a log into a profit-proof layer.
const FILL_INTERVAL_MS = 30 * 60 * 1000;

// Initial fill 10s after boot (let DB settle first)
setTimeout(() => {
  fillOutcomePrices().catch(e => console.error('[priceFiller] init fill error:', e));
}, 10_000);

// Recurring fill every 30 minutes
setInterval(() => {
  fillOutcomePrices().catch(e => console.error('[priceFiller] scheduled fill error:', e));
}, FILL_INTERVAL_MS);

console.log(`[priceFiller] Background price filler scheduled every ${FILL_INTERVAL_MS / 60_000}min`);
