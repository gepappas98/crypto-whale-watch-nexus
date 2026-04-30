/**
 * Bot Bridge Proxy — Express routes that forward to FastAPI bridge.
 * Set BOT_BRIDGE_URL in your Railway/Render env vars.
 */
import { Router, Request, Response } from "express";

const router = Router();
const BRIDGE = process.env.BOT_BRIDGE_URL || "http://localhost:8000";

async function proxyTo(path: string, method: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`${BRIDGE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

// ── Arbitrage ──────────────────────────────────────────────────────────────
router.get("/arbitrage/opportunities", async (_req: Request, res: Response) => {
  try { res.json(await proxyTo("/arbitrage/opportunities", "GET")); }
  catch (e) { res.status(502).json({ error: "Bot bridge unavailable", detail: String(e) }); }
});

router.post("/arbitrage/execute", async (req: Request, res: Response) => {
  try { res.json(await proxyTo("/arbitrage/execute", "POST", req.body)); }
  catch (e) { res.status(502).json({ error: "Bot bridge unavailable", detail: String(e) }); }
});

router.get("/arbitrage/status/:id", async (req: Request, res: Response) => {
  try { res.json(await proxyTo(`/arbitrage/status/${req.params.id}`, "GET")); }
  catch (e) { res.status(502).json({ error: "Bot bridge unavailable", detail: String(e) }); }
});

// ── Grid ───────────────────────────────────────────────────────────────────
router.post("/grid/create", async (req: Request, res: Response) => {
  try { res.json(await proxyTo("/grid/create", "POST", req.body)); }
  catch (e) { res.status(502).json({ error: "Bot bridge unavailable", detail: String(e) }); }
});

router.post("/grid/:id/stop", async (req: Request, res: Response) => {
  try { res.json(await proxyTo(`/grid/${req.params.id}/stop`, "POST")); }
  catch (e) { res.status(502).json({ error: "Bot bridge unavailable", detail: String(e) }); }
});

router.get("/grid/list", async (_req: Request, res: Response) => {
  try { res.json(await proxyTo("/grid/list", "GET")); }
  catch (e) { res.status(502).json({ error: "Bot bridge unavailable", detail: String(e) }); }
});

router.get("/grid/:id/status", async (req: Request, res: Response) => {
  try { res.json(await proxyTo(`/grid/${req.params.id}/status`, "GET")); }
  catch (e) { res.status(502).json({ error: "Bot bridge unavailable", detail: String(e) }); }
});

// ── Volume ─────────────────────────────────────────────────────────────────
router.post("/volume/start", async (req: Request, res: Response) => {
  try { res.json(await proxyTo("/volume/start", "POST", req.body)); }
  catch (e) { res.status(502).json({ error: "Bot bridge unavailable", detail: String(e) }); }
});

router.post("/volume/stop", async (req: Request, res: Response) => {
  try { res.json(await proxyTo("/volume/stop", "POST", req.body)); }
  catch (e) { res.status(502).json({ error: "Bot bridge unavailable", detail: String(e) }); }
});

router.get("/volume/stats", async (_req: Request, res: Response) => {
  try { res.json(await proxyTo("/volume/stats", "GET")); }
  catch (e) { res.status(502).json({ error: "Bot bridge unavailable", detail: String(e) }); }
});

// ── Health ─────────────────────────────────────────────────────────────────
router.get("/health", async (_req: Request, res: Response) => {
  try { res.json(await proxyTo("/health", "GET")); }
  catch { res.json({ status: "bridge_offline", bridge: BRIDGE }); }
});

export default router;
