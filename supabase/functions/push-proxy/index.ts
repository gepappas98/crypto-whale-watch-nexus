// ══ PUSH PROXY ════════════════════════════════════════════════════════════════
// Same reasoning as nexus-bot-proxy: the browser must never hold
// API_AUTH_TOKEN. This forwards /subscribe, /unsubscribe, and /send to the
// Express server's protected /api/push/* routes. GET /vapid-public-key
// doesn't strictly need this indirection (it's on the server's own public
// allowlist) but is included for a single consistent client call-site.
//
// Required secrets (same ones nexus-bot-proxy already uses — set once):
//   NEXUS_BOT_API_URL   — base URL of the Express server
//   API_AUTH_TOKEN      — the SAME token the Express server checks
//
// ⚠️ CANDIDATE FOR REMOVAL AS OF v9.44 — supabase/functions/push/index.ts now
// implements push subscribe/unsubscribe/send natively (Deno's npm: support
// for the 'web-push' package), talking to Postgres directly with no Express
// involved at all. This proxy's entire reason to exist — protecting
// API_AUTH_TOKEN on the way to Express — evaporates once there's no Express
// in the path to protect a token for. Not deleted here (same caution as
// market-data/index.ts's note in v9.40: can't rule out something outside
// this repo still calling this specific URL), but once the client is
// pointed at the new push function, this one has no remaining purpose.

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_PATHS = [
  /^\/vapid-public-key$/,
  /^\/subscribe$/,
  /^\/unsubscribe$/,
  /^\/send$/,
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const baseUrl = Deno.env.get('NEXUS_BOT_API_URL');
  const token = Deno.env.get('API_AUTH_TOKEN');
  if (!baseUrl || !token) {
    // Push is an OPTIONAL self-hosted feature. Returning 503 here made every
    // call surface as a hard edge-function error in the client; a 200 with an
    // `error` field lets the app treat it as "push disabled" and degrade.
    return json({
      configured: false,
      error: 'Push bridge is not configured — set NEXUS_BOT_API_URL and API_AUTH_TOKEN as Supabase secrets',
    });
  }

  try {
    const body = await req.json() as { method?: string; path?: string; payload?: unknown };
    const method = (body.method || 'GET').toUpperCase();
    const path = body.path || '';

    if (!['GET', 'POST'].includes(method)) {
      return json({ error: `unsupported method "${method}"` }, 400);
    }
    if (!ALLOWED_PATHS.some((re) => re.test(path))) {
      return json({ error: `path "${path}" is not on the allowlist` }, 400);
    }

    const upstream = await fetch(`${baseUrl}/api/push${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: method === 'GET' ? undefined : JSON.stringify(body.payload ?? {}),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    return json({ error: `push-proxy failed: ${(err as Error).message}` }, 502);
  }
});
