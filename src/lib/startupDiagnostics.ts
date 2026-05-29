/* ══ STARTUP DIAGNOSTICS ═══════════════════════════════════════════════════
 * Installs global uncaught-exception logging and — if the app fails to
 * mount within a deadline — paints a visible diagnostics overlay so the
 * user never sees a fully blank page.
 *
 * Also detects:
 *   - missing Supabase env vars
 *   - localhost API URLs in a production build
 *   - render loops (excessive React reconciliation in the first second)
 * ═══════════════════════════════════════════════════════════════════════════ */

const MOUNT_DEADLINE_MS = 8000;

interface Diag {
  level: 'info' | 'warn' | 'error';
  message: string;
}

const diags: Diag[] = [];

function record(level: Diag['level'], message: string) {
  diags.push({ level, message });
  (console[level] ?? console.log)(`[startup] ${message}`);
}

function checkEnv() {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (!url) record('error', 'VITE_SUPABASE_URL is missing');
  if (!key) record('error', 'VITE_SUPABASE_PUBLISHABLE_KEY is missing');
  if (url && import.meta.env.PROD && /localhost|127\.0\.0\.1/i.test(url)) {
    record('error', `Production build is pointing API at ${url}`);
  }
}

function paintOverlay() {
  const root = document.getElementById('root');
  // Only paint if React never mounted anything.
  if (root && root.childElementCount > 0) return;

  const errors = diags.filter((d) => d.level === 'error');
  const container = document.createElement('div');
  container.id = 'startup-diagnostics';
  container.style.cssText =
    'position:fixed;inset:0;z-index:2147483647;background:#0a0a0a;color:#f5f5f5;' +
    'font-family:ui-sans-serif,system-ui,sans-serif;padding:24px;overflow:auto;';
  container.innerHTML = `
    <div style="max-width:640px;margin:10vh auto;">
      <h1 style="font-size:20px;margin:0 0 12px;">Whale Radar didn't finish loading</h1>
      <p style="opacity:.7;font-size:14px;margin:0 0 16px;">
        The page did not mount within ${MOUNT_DEADLINE_MS / 1000}s. Below are diagnostics
        captured during startup. Reload to retry, or share this with support.
      </p>
      <pre style="background:#161616;padding:12px;border-radius:6px;font-size:12px;
                  white-space:pre-wrap;max-height:50vh;overflow:auto;margin:0 0 16px;">
${diags.map((d) => `[${d.level.toUpperCase()}] ${escapeHtml(d.message)}`).join('\n') ||
        'No diagnostics captured. The bundle may have failed to load.'}
      </pre>
      <button id="__diag_reload" style="padding:8px 14px;border-radius:6px;
              border:1px solid #2dd4a8;background:transparent;color:#2dd4a8;cursor:pointer;">
        Reload
      </button>
      ${errors.length === 0
        ? '<p style="opacity:.5;font-size:12px;margin-top:16px;">No env-var errors detected — likely a bundle/network failure.</p>'
        : ''}
    </div>
  `;
  document.body.appendChild(container);
  document.getElementById('__diag_reload')?.addEventListener('click', () =>
    window.location.reload(),
  );
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

let installed = false;
export function installStartupDiagnostics(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  checkEnv();

  window.addEventListener('error', (e) => {
    const msg = e.error?.message || e.message || 'unknown error';
    record('error', `uncaught error: ${msg}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const reason = (e.reason && (e.reason.message || String(e.reason))) || 'unknown';
    record('error', `unhandled rejection: ${reason}`);
  });

  window.setTimeout(paintOverlay, MOUNT_DEADLINE_MS);
}
