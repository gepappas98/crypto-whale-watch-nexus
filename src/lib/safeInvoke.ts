/* ══ SAFE SUPABASE INVOKE ══════════════════════════════════════════════════
 * Guards every `supabase.functions.invoke` call so a missing env var,
 * a network blip, or a bad runtime URL (e.g. localhost in production)
 * never crashes the page — callers get a normal { data, error } back.
 * ═══════════════════════════════════════════════════════════════════════════ */

import { supabase } from '@/integrations/supabase/client';

type InvokeOptions = Parameters<typeof supabase.functions.invoke>[1];
export type InvokeResult<T> = { data: T | null; error: Error | null };

function looksMisconfigured(): string | null {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
  if (!url) return 'VITE_SUPABASE_URL is not set';
  if (import.meta.env.PROD && /localhost|127\.0\.0\.1/i.test(url)) {
    return 'Supabase URL points to localhost in a production build';
  }
  return null;
}

export async function safeInvoke<T = unknown>(
  fnName: string,
  options?: InvokeOptions,
): Promise<InvokeResult<T>> {
  const cfgError = looksMisconfigured();
  if (cfgError) {
    console.warn(`[safeInvoke] skipping ${fnName}: ${cfgError}`);
    return { data: null, error: new Error(cfgError) };
  }
  try {
    const { data, error } = await supabase.functions.invoke(fnName, options);
    if (error) return { data: null, error: new Error(error.message ?? String(error)) };
    if (data && typeof data === 'object' && 'error' in (data as Record<string, unknown>)) {
      return { data: null, error: new Error(String((data as Record<string, unknown>).error)) };
    }
    return { data: data as T, error: null };
  } catch (err) {
    console.error(`[safeInvoke] ${fnName} threw:`, err);
    return { data: null, error: err instanceof Error ? err : new Error(String(err)) };
  }
}
