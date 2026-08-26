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
import { alertsRouter, fillAlertOutcomePrices }         from './routes/alerts';
import { whaleEventsRouter }    from './routes/whaleEvents';
import { whalesRouter }         from './routes/whales';
import { signalOutcomesRouter, fillOutcomePrices } from './routes/signalOutcomes';
import { nexusBotRouter } from './routes/nexusBot';
import { pushRouter } from './routes/push';
import { startNexusBotWorker } from './services/nexusBotWorker';

const app = express();
const PORT = Number(process.env.API_PORT) || 3001;

// Bug #7 fixed: CORS no longer mirrors any Origin when CORS_ORIGIN is unset.
// In production set CORS_ORIGIN to your Railway frontend URL, e.g.:
//   CORS_ORIGIN=https://your-app.up.railway.app
// In dev the Vite proxy handles /api so CORS is only needed for direct calls.
const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
  : (process.env.NODE_ENV === 'production' ? false : 'http://localhost:8080');

app.use(cors({
  origin: corsOrigin,
  credentials: false,
}));
app.use(express.json({ limit: '2mb' }));

// ── Auth middleware ────────────────────────────────────────────────────────
// Protects all /api/* routes with a shared bearer token (API_AUTH_TOKEN env).
// Whitelisted public paths: /api/health, /api/scan (used by the public SPA).
// Without API_AUTH_TOKEN set, the server refuses to start protected routes —
// fail-closed by design so a misconfigured deploy never silently exposes data.
const API_AUTH_TOKEN = process.env.API_AUTH_TOKEN || '';
// Public, agent-facing read endpoints (OpenAI Custom GPT Actions, LLM crawlers).
const PUBLIC_PATHS = new Set([
  '/api/health',
  '/api/health/db',
  '/api/scan',
  '/api/whales',
  '/api/whales/',
  '/api/whales/summary',
  '/api/alerts',
  '/api/push/vapid-public-key',
]);

if (!API_AUTH_TOKEN) {
  console.warn('[AUTH] ⚠ API_AUTH_TOKEN not set — all protected routes will return 503');
}

app.use('/api', (req, res, next) => {
  // Allow CORS preflight + whitelisted public reads
  if (req.method === 'OPTIONS') return next();
  const path = req.originalUrl.split('?')[0].replace(/\/+$/, '') || '/';
  if (req.method === 'GET' && (PUBLIC_PATHS.has(path) || PUBLIC_PATHS.has(req.baseUrl + req.path))) {
    // Agent-accessible: ChatGPT Actions and other bots issue cross-origin GETs.
    res.setHeader('Access-Control-Allow-Origin', '*');
    return next();
  }

  if (!API_AUTH_TOKEN) {
    return res.status(503).json({ error: 'Server auth not configured' });
  }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token !== API_AUTH_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ── Health ─────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});

app.get('/api/health/db', async (_req, res) => {
  try {
    const db = await ping();
    res.json({ ok: true, db, ts: new Date().toISOString() });
  } catch (err) {
    res.status(503).json({ ok: false, error: (err as Error).message });
  }
});

// ── Routes ─────────────────────────────────────────────────────────────────
app.use('/api/scan',             scanRouter);
app.use('/api/scans',            scansRouter);
app.use('/api/portfolio',        portfolioRouter);
app.use('/api/tracked',          trackedRouter);
app.use('/api/alerts',           alertsRouter);
app.use('/api/whale-events',     whaleEventsRouter);
app.use('/api/whales',           whalesRouter);
app.use('/api/signal-outcomes',  signalOutcomesRouter);
app.use('/api/nexus-bot',        nexusBotRouter);
app.use('/api/push',             pushRouter);

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Start ──────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[API] Whale RADAR server listening on :${PORT}`);
  ping().then(ok => console.log(`[DB]  PostgreSQL ${ok ? '✓ connected' : '✗ OFFLINE'}`));
  startNexusBotWorker();
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

// ── Background alert-decision price filler ─────────────────────────────────
// Same cadence as the signal_outcomes filler above — fills 24h forward
// price for any 'bought' alert decision that has a coin_id. Separate job,
// separate table (alert_outcomes), same reasoning: no point filling more
// often than the shortest horizon it tracks.
setTimeout(() => {
  fillAlertOutcomePrices().catch(e => console.error('[alertPriceFiller] init fill error:', e));
}, 15_000);

setInterval(() => {
  fillAlertOutcomePrices().catch(e => console.error('[alertPriceFiller] scheduled fill error:', e));
}, FILL_INTERVAL_MS);
