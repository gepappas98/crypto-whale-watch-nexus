/* ══ WHALE RADAR — Express API Server ════════════════════════════════════════
 *  Runs alongside the Vite frontend on Railway.
 *  PORT defaults to 3001 (Vite proxies /api → :3001 in dev).
 * ═══════════════════════════════════════════════════════════════════════════ */
import express from 'express';
import cors from 'cors';
import { ping } from './db';
import { scansRouter }     from './routes/scans';
import { portfolioRouter } from './routes/portfolio';
import { trackedRouter }   from './routes/tracked';
import { alertsRouter }    from './routes/alerts';

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
app.use('/api/scans',     scansRouter);
app.use('/api/portfolio', portfolioRouter);
app.use('/api/tracked',   trackedRouter);
app.use('/api/alerts',    alertsRouter);

// ── 404 ────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log(`[API] Whale RADAR server listening on :${PORT}`);
  ping().then(ok => console.log(`[DB]  PostgreSQL ${ok ? '✓ connected' : '✗ OFFLINE'}`));
});
