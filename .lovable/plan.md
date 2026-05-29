# Fix blank screen + apply requested log/server hardening

## 0. Root cause of the blank screen (new finding — must fix first)

Console shows:
```
TypeError: Cannot destructure property 'future' of 'React.useContext(...)' as it is null.
  at NavLinkWithRef (.../react-router-dom.js?v=eb05557f...)
...wrapped by BrowserRouter (.../react-router-dom.js?v=1b2d3f6d...)
```

Two different Vite dep-cache hashes for `react-router-dom` are live in the same page. The `<NavLink>` inside `TradingHubLayout` reads a different React context object than the one `<BrowserRouter>` populates → context is `null` → render crash → `ErrorBoundary` swallows the whole tree.

**Fix:** force a clean Vite optimize-deps so only one bundle of `react-router-dom` is served.

- Add `react-router-dom` (and `react`, `react-dom`) to `optimizeDeps.include` in `vite.config.ts` so Vite always pre-bundles them as a single chunk.
- Bump the dep-cache by adding `optimizeDeps.force: true` once, then revert; or instruct user to hard-reload (Ctrl+Shift+R) — the stale `?v=eb05557f` bundle goes away.
- Defensive: harden `src/components/ErrorBoundary.tsx` to render a visible fallback (it already does, but the inner boundary at `TradingHubLayout` swallows up to the outer App boundary — confirm fallback UI is rendered for the route, not for the whole app).

This single fix should restore the page.

## 1. Suppress intentional AbortError logs

**File:** `src/hooks/useWhaleWebSocket.ts`

- Line 107 (`seedFromHttp` catch): only `console.error` when `(err as DOMException).name !== 'AbortError'`.
- Line 145 (poll fallback catch): compute `const isAbort = (err as DOMException).name === 'AbortError'` and gate the log with `!parentSig.aborted && !isAbort`.

React Query already has `retry: 2` (`src/App.tsx:33`). Add `staleTime: 30_000` to `defaultOptions.queries` to reduce dev refetch churn.

## 2. WebSocket endpoints `/whale-stream` and `/stream`

Inspected — there is **no `/stream` or `/whale-stream` route on your own server**. They are:

- `src/hooks/useWhaleStream.ts:69` → `wss://${VITE_SUPABASE_PROJECT_ID}.functions.supabase.co/whale-stream` (Lovable Cloud edge function, already exists at `supabase/functions/whale-stream/index.ts`).
- `src/hooks/useWhaleWebSocket.ts:249` → `wss://stream.binance.com:9443/stream` (public Binance).
- `src/hooks/useWhaleWebSocket.ts:321` → `wss://stream.bybit.com/v5/public/linear` (public Bybit).

Do **not** rewrite to `wss://${window.location.host}/...` — Lovable does not proxy WebSocket upgrades to Supabase Edge Functions or Binance. Actions:

- In `useWhaleStream.ts`, add a one-time `console.warn` when `PROJECT_ID` is missing so the cause is obvious in the debug overlay.
- Keep existing exponential backoff for Binance/Bybit failures (no change).

## 3. Harden Express routes (Railway only — preview is unaffected)

**`server/index.ts`** — replace `/api/health` with a dependency-free handler:
```ts
app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), timestamp: Date.now() });
});
```
(Drop the `ping()` call. If you want DB status, add a separate `/api/health/db`.)

**`server/routes/scan.ts`** — already wraps in try/catch; tighten the 500 message to `'Scan service temporarily unavailable'`, log the full stack.

## 4. Env vars

No code change. On Railway confirm `API_AUTH_TOKEN`, `DATABASE_URL`, `CORS_ORIGIN`, optional `COINGECKO_API_KEY`. Lovable preview needs nothing extra — Supabase vars are auto-injected. No `BINANCE_API_KEY` is required (public streams).

## Files touched

- `vite.config.ts` — pre-bundle `react`/`react-dom`/`react-router-dom`
- `src/hooks/useWhaleWebSocket.ts` — silence two AbortError catches
- `src/App.tsx` — add `staleTime` to React Query defaults
- `src/hooks/useWhaleStream.ts` — warn if `PROJECT_ID` missing
- `server/index.ts` — simplify `/api/health`
- `server/routes/scan.ts` — tighten 500 message

## Verification

1. Hard-reload preview → `TradingHubLayout` renders, no more `null` context crash.
2. Open debug overlay → no AbortError noise from whale WS.
3. `curl https://<railway>/api/health` → 200 unconditionally.
