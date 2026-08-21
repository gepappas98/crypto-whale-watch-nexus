// Server-side CORS-free proxy for the public CoinGecko API.
// Avoids the corsproxy.io 403 ("free usage limited to localhost") by routing
// browser requests through this edge function instead.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const ALLOWED_HOSTS = new Set([
  'api.coingecko.com',
  'pro-api.coingecko.com',
  'api.binance.com',
  'fapi.binance.com',
  'api.bybit.com',
  'api.alternative.me',
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const incoming = new URL(req.url);
    const target = incoming.searchParams.get('url');
    if (!target) {
      return new Response(JSON.stringify({ error: 'Missing url query param' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    let parsed: URL;
    try { parsed = new URL(target); } catch {
      return new Response(JSON.stringify({ error: 'Invalid url' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!ALLOWED_HOSTS.has(parsed.hostname)) {
      return new Response(JSON.stringify({ error: `Host not allowed: ${parsed.hostname}` }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const upstream = await fetch(parsed.toString(), {
      headers: { 'Accept': 'application/json', 'User-Agent': 'lovable-coingecko-proxy/1.0' },
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: {
        ...corsHeaders,
        'Content-Type': upstream.headers.get('content-type') ?? 'application/json',
        'Cache-Control': 'public, max-age=20',
      },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
