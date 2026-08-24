/* ══ CHUNK RECOVERY ════════════════════════════════════════════════════════
 * Automatically recovers from failed dynamic imports / module-script loads.
 *
 * Common triggers:
 *  - New deploy invalidates hashed chunk filenames while an old tab is open
 *  - Transient network blip during a lazy import()
 *  - HMR aborts an in-flight module request mid-load
 *
 * Strategy:
 *  1. Wrap `import()` failures so the same chunk is retried with backoff.
 *  2. Listen for window 'error' + 'unhandledrejection' that match
 *     ChunkLoadError / "Failed to fetch dynamically imported module".
 *  3. On unrecoverable failure, do ONE soft reload (sessionStorage sentinel
 *     prevents reload loops). On a second failure within the same session,
 *     surface a non-blocking toast instead of looping.
 * ═══════════════════════════════════════════════════════════════════════════ */

const RELOAD_SENTINEL = 'wr_chunk_reload_attempted_at';
const RELOAD_COOLDOWN_MS = 30_000;

function isChunkLoadError(err: unknown): boolean {
  if (!err) return false;
  const msg =
    (err as Error)?.message ??
    (typeof err === 'string' ? err : '') ??
    '';
  const name = (err as Error)?.name ?? '';
  return (
    name === 'ChunkLoadError' ||
    /Loading chunk [\w-]+ failed/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg) ||
    /error loading dynamically imported module/i.test(msg) ||
    /Unable to preload CSS/i.test(msg)
  );
}

function shouldAttemptReload(): boolean {
  try {
    const prev = sessionStorage.getItem(RELOAD_SENTINEL);
    if (!prev) return true;
    const ts = Number(prev);
    if (!Number.isFinite(ts)) return true;
    // Allow another reload only after cooldown — avoids tight loops.
    return Date.now() - ts > RELOAD_COOLDOWN_MS;
  } catch {
    return true;
  }
}

function markReload(): void {
  try {
    sessionStorage.setItem(RELOAD_SENTINEL, String(Date.now()));
  } catch {
    /* ignore */
  }
}

function softReload(): void {
  markReload();
  // Bust HTTP cache for the document on reload so we don't re-fetch a stale
  // index.html that still references the missing chunk.
  const url = new URL(window.location.href);
  url.searchParams.set('_r', String(Date.now()));
  window.location.replace(url.toString());
}

/**
 * Retry helper for lazy imports. Use in place of bare `import()`:
 *   const mod = await retryImport(() => import('./Heavy'));
 */
export async function retryImport<T>(
  loader: () => Promise<T>,
  { retries = 3, baseDelay = 400 }: { retries?: number; baseDelay?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await loader();
    } catch (err) {
      lastErr = err;
      if (!isChunkLoadError(err) || attempt === retries) break;
      await new Promise((r) => setTimeout(r, baseDelay * 2 ** attempt));
    }
  }
  throw lastErr;
}

let installed = false;

/**
 * Install global listeners. Safe to call multiple times — only installs once.
 */
export function installChunkRecovery(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const handle = (err: unknown, source: string) => {
    if (!isChunkLoadError(err)) return;
    console.warn(`[chunk-recovery] ${source} failure detected:`, err);
    if (shouldAttemptReload()) {
      console.warn('[chunk-recovery] performing one-time soft reload to recover');
      softReload();
    } else {
      console.error(
        '[chunk-recovery] reload already attempted recently — leaving page intact to avoid loop',
      );
    }
  };

  window.addEventListener('unhandledrejection', (event) => {
    handle(event.reason, 'unhandledrejection');
  });

  window.addEventListener(
    'error',
    (event) => {
      // Script/link/img load failures bubble here with no .error payload.
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'SCRIPT' || target.tagName === 'LINK') &&
        // Only trigger on our own hashed assets.
        ((target as HTMLScriptElement).src?.includes('/assets/') ||
          (target as HTMLLinkElement).href?.includes('/assets/'))
      ) {
        handle(new Error(`Failed to load ${target.tagName}: ${(target as HTMLScriptElement).src || (target as HTMLLinkElement).href}`), 'resource');
        return;
      }
      handle(event.error, 'error');
    },
    true, // capture — resource errors don't bubble
  );

  // Clear sentinel after a successful render window so future failures can
  // still trigger one fresh recovery.
  window.setTimeout(() => {
    try {
      sessionStorage.removeItem(RELOAD_SENTINEL);
    } catch {
      /* ignore */
    }
  }, RELOAD_COOLDOWN_MS);
}
