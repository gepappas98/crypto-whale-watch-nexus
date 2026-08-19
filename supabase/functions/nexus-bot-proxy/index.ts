// ══ NEXUS BOT PROXY ═══════════════════════════════════════════════════════════
// The browser must never hold the Express server's API_AUTH_TOKEN — any
// VITE_-prefixed value ends up in the public JS bundle (see .env.example's
// own warning about this). This edge function is the bridge: the browser
// calls it via supabase.functions.invoke() (authenticated by Supabase's own
// anon key, which IS meant to be public), and THIS function attaches the
// real server token — held only as a Supabase secret, never shipped to any
// client — before forwarding to the Express server's protected
// /api/nexus-bot/* routes.
//
// Required secrets (set with `supabase secrets set NAME=value`):
//   NEXUS_BOT_API_URL   — base URL of the Express server, e.g. https://your-app.up.railway.app
//   API_AUTH_TOKEN      — the SAME token the Express server checks (server/.env)
//
// Body shape expected from the client:
//   { method: 'GET'|'POST'|'DELETE', path: '/grids' | '/arbitrage/execute' | ..., payload?: unknown }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const ALLOWED_PATHS = [
  /^\/arbitrage\/scan$/,
  /^\/arbitrage\/execute$/,
  /^\/grids$/,
  /^\/grids\/[A-Za-z0-9_-]+$/,
  /^\/volume-maker\/(start|stop|stats)$/,
  /^\/portfolio$/,
  /^\/strategy-trader\/status$/,
  /^\/strategy-trader\/locks$/,
  /^\/strategy-trader\/locks\/\d+$/,
  /^\/strategy-trader\/enter$/,
  /^\/strategy-trader\/exit$/,
];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  const baseUrl = Deno.env.get('NEXUS_BOT_API_URL');
  const token = Deno.env.get('API_AUTH_TOKEN');
  if (!baseUrl || !token) {
    // This bridge is optional. Returning a 5xx here makes the platform report
    // a runtime failure (and can trip the app error boundary) even though an
    // unconfigured bot is a valid disabled state.
    return json({
      configured: false,
      reachable: false,
      error: 'Nexus bot bridge is not configured',
    });
  }

  try {
    const body = await req.json() as { method?: string; path?: string; payload?: unknown };
    const method = (body.method || 'GET').toUpperCase();
    const path = body.path || '';

    if (!['GET', 'POST', 'DELETE'].includes(method)) {
      return json({ error: `unsupported method "${method}"` }, 400);
    }
    if (!ALLOWED_PATHS.some((re) => re.test(path))) {
      return json({ error: `path "${path}" is not on the allowlist — this proxy only forwards known nexus-bot routes` }, 400);
    }

    const upstream = await fetch(`${baseUrl}/api/nexus-bot${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: method === 'GET' ? undefined : JSON.stringify(body.payload ?? {}),
    });

    const text = await upstream.text();
    // Pass the upstream status + body straight through — the client's error
    // handling already expects { error: string } shapes from the Express side.
    return new Response(text, {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    return json({ error: `nexus-bot-proxy failed: ${(err as Error).message}` }, 502);
  }
});
