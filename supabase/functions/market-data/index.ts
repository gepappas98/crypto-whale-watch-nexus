// Server-side proxy + cache for CoinGecko & Binance public endpoints.
// Eliminates browser CORS issues and the failing free-proxy chain.
import { corsHeaders } from "https://esm.sh/@supabase/supabase-js@2.95.0/cors";

interface CacheEntry { data: unknown; ts: number; }
const cache = new Map<string, CacheEntry>();

const TTL: Record<string, number> = {
  "coingecko-markets": 30_000,
  "binance-klines": 15_000,
  "binance-ticker": 5_000,
  "default": 10_000,
};

async function fetchUpstream(url: string, headers: Record<string, string> = {}): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 9000);
  try {
    return await fetch(url, { headers, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const url = new URL(req.url);
    const source = url.searchParams.get("source") || "";
    const path = url.searchParams.get("path") || "";
    const qs = url.searchParams.get("qs") || "";

    let upstream = "";
    let kind = "default";
    const headers: Record<string, string> = { "accept": "application/json" };

    if (source === "coingecko") {
      upstream = `https://api.coingecko.com/api/v3${path}${qs ? "?" + qs : ""}`;
      kind = "coingecko-markets";
      const key = Deno.env.get("COINGECKO_API_KEY");
      if (key) headers["x-cg-demo-api-key"] = key;
    } else if (source === "binance") {
      // Binance has multiple base hosts; try primary then mirror.
      upstream = `https://api.binance.com${path}${qs ? "?" + qs : ""}`;
      kind = path.includes("klines") ? "binance-klines" : "binance-ticker";
    } else if (source === "hyperliquid") {
      // POST passthrough
      const body = await req.text();
      const r = await fetch("https://api.hyperliquid.xyz/info", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const data = await r.text();
      return new Response(data, {
        status: r.status,
        headers: { ...corsHeaders, "content-type": "application/json", "x-cache": "BYPASS" },
      });
    } else {
      return new Response(JSON.stringify({ error: "unknown source" }), {
        status: 400, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const cacheKey = `${source}:${path}:${qs}`;
    const now = Date.now();
    const ttl = TTL[kind] ?? TTL.default;
    const hit = cache.get(cacheKey);
    if (hit && now - hit.ts < ttl) {
      return new Response(JSON.stringify(hit.data), {
        headers: { ...corsHeaders, "content-type": "application/json", "x-cache": "HIT", "x-age": String(now - hit.ts) },
      });
    }

    let res: Response;
    try {
      res = await fetchUpstream(upstream, headers);
    } catch (e) {
      // Fallback for binance: try data-api.binance.vision mirror
      if (source === "binance") {
        const mirror = upstream.replace("api.binance.com", "data-api.binance.vision");
        res = await fetchUpstream(mirror, headers);
      } else {
        throw e;
      }
    }

    if (!res.ok) {
      // Stale-while-error: return cached even if expired
      if (hit) {
        return new Response(JSON.stringify(hit.data), {
          headers: { ...corsHeaders, "content-type": "application/json", "x-cache": "STALE", "x-upstream-status": String(res.status) },
        });
      }
      const text = await res.text();
      return new Response(JSON.stringify({ error: "upstream error", status: res.status, body: text.slice(0, 500) }), {
        status: res.status, headers: { ...corsHeaders, "content-type": "application/json" },
      });
    }

    const data = await res.json();
    cache.set(cacheKey, { data, ts: now });
    // Trim cache
    if (cache.size > 500) {
      const oldest = [...cache.entries()].sort((a, b) => a[1].ts - b[1].ts).slice(0, 100);
      oldest.forEach(([k]) => cache.delete(k));
    }

    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, "content-type": "application/json", "x-cache": "MISS" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, "content-type": "application/json" },
    });
  }
});
