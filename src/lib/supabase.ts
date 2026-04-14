/* ══ SUPABASE CLIENT — Frontend Singleton ════════════════════════════════════
 *  Supports both build-time env vars AND runtime localStorage overrides.
 *  Runtime keys (set via Settings panel):
 *    localStorage['wr_supabase_url']       → Supabase project URL
 *    localStorage['wr_supabase_anon_key']  → Supabase anon/public key
 *
 *  Build-time fallbacks:
 *    VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
 * ═══════════════════════════════════════════════════════════════════════════ */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

function getRuntimeUrl(): string | undefined {
  try { return localStorage.getItem('wr_supabase_url') ?? undefined; } catch { return undefined; }
}

function getRuntimeKey(): string | undefined {
  try { return localStorage.getItem('wr_supabase_anon_key') ?? undefined; } catch { return undefined; }
}

function resolveUrl(): string | undefined {
  return getRuntimeUrl() || (import.meta.env.VITE_SUPABASE_URL as string | undefined);
}

function resolveKey(): string | undefined {
  return getRuntimeKey() || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined);
}

export const supabaseConfigured = !!(resolveUrl() && resolveKey());

// Build the client lazily so runtime overrides set before first use are picked up.
let _client: SupabaseClient | null = null;

function buildClient(): SupabaseClient | null {
  const url = resolveUrl();
  const key = resolveKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-app-name': 'whale-radar-v9' },
    },
  });
}

/** Returns the Supabase client, or null if not configured. */
export function getSupabase(): SupabaseClient | null {
  if (!_client) _client = buildClient();
  return _client;
}

/** Legacy named export for backwards compat with existing imports. */
export const supabase = getSupabase();

// ── Cache table helpers (read-only, for debug/stats UI) ───────────────────────

export interface CacheTableRow {
  cache_key: string;
  fetched_at: string;
  ttl_ms: number;
}

/** Returns current rows in hyperliquid_cache — useful for debug panel. */
export async function fetchCacheRows(): Promise<CacheTableRow[]> {
  const sb = getSupabase();
  if (!sb) return [];
  const { data, error } = await sb
    .from('hyperliquid_cache')
    .select('cache_key, fetched_at, ttl_ms')
    .order('fetched_at', { ascending: false })
    .limit(20);
  if (error) {
    console.warn('[supabase] fetchCacheRows error:', error.message);
    return [];
  }
  return (data as CacheTableRow[]) ?? [];
}

/** Returns the current-minute outgoing request count from hl_rate_counter. */
export async function fetchRateCounterRow(): Promise<number> {
  const sb = getSupabase();
  if (!sb) return 0;
  const windowKey = new Date().toISOString().slice(0, 16);
  const { data, error } = await sb
    .from('hl_rate_counter')
    .select('count')
    .eq('window_key', windowKey)
    .single();
  if (error || !data) return 0;
  return (data as { count: number }).count ?? 0;
}
