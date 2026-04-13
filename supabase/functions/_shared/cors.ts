// ══ Shared CORS Headers ══════════════════════════════════════════════════════
// Import in any edge function that needs to handle cross-origin requests.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-hl-cache-debug',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: corsHeaders });
}

export function jsonResponse(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
      ...extra,
    },
  });
}

export function errorResponse(msg: string, status = 500): Response {
  return jsonResponse({ error: msg }, status);
}
