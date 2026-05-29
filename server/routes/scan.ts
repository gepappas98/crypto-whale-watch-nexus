/* ══ WHALE RADAR — /api/scan route ════════════════════════════════════════════ */
import { Router, Request, Response } from 'express';
import { performScan } from '../services/scan';

export const scanRouter = Router();

// GET /api/scan — unified scan endpoint
// Proxies CoinGecko server-side. Returns cached/fallback on failure.
scanRouter.get('/', async (req: Request, res: Response) => {
  try {
    const apiKey = (req.headers['x-cg-api-key'] as string) || process.env.COINGECKO_API_KEY || '';
    const result = await performScan(apiKey);
    res.json(result);
  } catch (err) {
    console.error('[scan GET] failed:', (err as Error).stack || err);
    res.status(500).json({
      success: false,
      data: [],
      source: 'error',
      ts: new Date().toISOString(),
      error: 'Scan service temporarily unavailable',
    });
  }
});
