# Hyperliquid Cache — Deploy Guide

## Overview

All Hypurrscan data now flows through a Supabase Edge Function (`hyperliquid-cache`)
that serves cached responses to the frontend. Direct calls to `api.hypurrscan.io`
from the browser are gone.

```
Browser  →  Edge Function (server-cached, 500ms TTL)  →  api.hypurrscan.io
                           ↑
                     Supabase Postgres (cache table + rate counter)
```

---

## 1. Apply database migrations

```bash
supabase db push
# Or manually run:
#   supabase/migrations/002_hyperliquid_cache.sql
#   supabase/migrations/003_hl_rate_counter_fn.sql
```

This creates:
- `hyperliquid_cache` — stores cached payloads (auto-purged after 10s)
- `hl_rate_counter` — tracks outgoing requests per minute (cap: 200/min)
- `increment_hl_counter()` — atomic Postgres function for race-safe counting

---

## 2. Deploy the edge function

```bash
supabase functions deploy hyperliquid-cache --no-verify-jwt
```

> `--no-verify-jwt` allows the frontend to call it with the anon key without
> requiring a logged-in user. RLS on the cache tables still protects writes.

---

## 3. Set frontend env vars

Copy `.env.example` to `.env.local` and fill in:

```bash
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...
```

> **For Lovable deployments:** `.env.local` has **no effect**. Set these in
> **Project Settings → Environment Variables** instead. Both `VITE_SUPABASE_URL`
> and `VITE_SUPABASE_ANON_KEY` must be configured there before publishing.

The edge function reads `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`
automatically from the Supabase runtime — no extra secrets needed.

---

## 4. Verify

Open the Whale Radar → click the **🔗 HL** tab in the right panel.

- Blocks and txs should load within ~300ms (first load shows skeleton).
- The `⚡ updated Xms ago` badge shows live cache age.
- Open DevTools → Network → filter by `hyperliquid-cache` — you should see
  `X-Cache: HIT` on subsequent requests.

---

## Cache TTLs

| Endpoint     | TTL   | SWR window (3×) | Poll interval |
|--------------|-------|-----------------|---------------|
| `blocks`     | 500ms | 1.5s            | 300ms         |
| `txs`        | 500ms | 1.5s            | 300ms         |
| `address`    | 2 000ms | 6s            | 2 000ms       |
| `balance`    | 2 000ms | 6s            | 2 000ms       |
| `leaderboard`| 5 000ms | 15s           | 5 000ms       |

---

## Rate limiting

The edge function tracks outgoing Hypurrscan calls in `hl_rate_counter`.
Hard cap: **200 requests/minute**.

If the cap is hit the function returns stale cached data (if available)
or a `429` with no cache. The frontend TanStack Query retries with exponential
backoff automatically.

---

## Local development (no Supabase)

The frontend degrades gracefully when `VITE_SUPABASE_URL` is not set —
`hlFetch()` throws a descriptive `HLApiError` and the UI shows the error state
instead of crashing.

To test the edge function locally:

```bash
supabase start          # starts local Postgres + auth
supabase functions serve hyperliquid-cache
```

Then set `VITE_SUPABASE_URL=http://localhost:54321` in `.env.local`.
