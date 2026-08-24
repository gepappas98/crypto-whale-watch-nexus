/* ══ GLOBAL RUNTIME DEBUG OVERLAY ══════════════════════════════════════════
 * Renders every runtime error directly on the page so blank-screen bugs
 * are diagnosable without DevTools.
 *
 * Captures:
 *   - window.onerror (uncaught sync exceptions, resource load failures)
 *   - unhandledrejection (async/Promise rejections)
 *   - console.error (React render errors, library warnings)
 *   - fetch() failures + non-2xx responses (API errors)
 *   - WebSocket connection / message / close errors
 *
 * Toggle with Ctrl+Shift+D (or ?debug=1 in the URL). Auto-opens on the
 * first captured error so startup failures are visible immediately.
 * ═══════════════════════════════════════════════════════════════════════════ */

type EntryKind = 'error' | 'rejection' | 'console' | 'fetch' | 'websocket' | 'resource';

interface Entry {
  id: number;
  ts: number;
  kind: EntryKind;
  title: string;
  detail: string;
  stack?: string;
}

const MAX_ENTRIES = 200;
const STORAGE_KEY = 'wr_debug_overlay_open';
const IGNORED_CONSOLE_MESSAGES = [
  'Function components cannot be given refs',
  'React Router Future Flag Warning',
];

let installed = false;
let nextId = 1;
const entries: Entry[] = [];
let host: HTMLDivElement | null = null;
let listEl: HTMLDivElement | null = null;
let badgeEl: HTMLButtonElement | null = null;
let isOpen = false;

function isEnabled(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const url = new URL(window.location.href);
    if (url.searchParams.get('debug') === '0') return false;
    return true; // always on — overlay stays minimized until error or hotkey
  } catch {
    return true;
  }
}

function fmtTime(ts: number): string {
  const d = new Date(ts);
  return d.toTimeString().slice(0, 8) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

function kindColor(kind: EntryKind): string {
  switch (kind) {
    case 'error':
    case 'rejection':
    case 'resource':
      return '#ff5d5d';
    case 'console':
      return '#ffb454';
    case 'fetch':
      return '#5dc8ff';
    case 'websocket':
      return '#c084fc';
    default:
      return '#f5f5f5';
  }
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

function ensureMounted() {
  if (host || typeof document === 'undefined') return;
  host = document.createElement('div');
  host.id = '__wr_debug_overlay';
  host.style.cssText =
    'position:fixed;inset:auto 0 0 0;z-index:2147483647;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;pointer-events:none;';

  // Badge (always visible toggle)
  badgeEl = document.createElement('button');
  badgeEl.type = 'button';
  badgeEl.style.cssText =
    'pointer-events:auto;position:fixed;right:12px;bottom:12px;background:#161616;color:#f5f5f5;border:1px solid #333;border-radius:999px;padding:6px 10px;cursor:pointer;font:600 11px ui-monospace,monospace;box-shadow:0 4px 12px rgba(0,0,0,.4);';
  badgeEl.textContent = '🐞 0';
  badgeEl.addEventListener('click', () => setOpen(!isOpen));
  host.appendChild(badgeEl);

  // Panel
  const panel = document.createElement('div');
  panel.id = '__wr_debug_panel';
  panel.style.cssText =
    'pointer-events:auto;position:fixed;left:0;right:0;bottom:0;max-height:60vh;background:#0a0a0a;color:#f5f5f5;border-top:1px solid #2dd4a8;display:none;flex-direction:column;';
  panel.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid #222;background:#0f0f0f;">
      <strong style="font-size:12px;">Runtime Debug</strong>
      <span id="__wr_debug_count" style="opacity:.6;">0 entries</span>
      <span style="flex:1;"></span>
      <button id="__wr_debug_copy" style="background:transparent;color:#5dc8ff;border:1px solid #2a2a2a;border-radius:4px;padding:3px 8px;cursor:pointer;font:11px ui-monospace,monospace;">Copy</button>
      <button id="__wr_debug_clear" style="background:transparent;color:#ffb454;border:1px solid #2a2a2a;border-radius:4px;padding:3px 8px;cursor:pointer;font:11px ui-monospace,monospace;">Clear</button>
      <button id="__wr_debug_close" style="background:transparent;color:#f5f5f5;border:1px solid #2a2a2a;border-radius:4px;padding:3px 8px;cursor:pointer;font:11px ui-monospace,monospace;">Hide</button>
    </div>
    <div id="__wr_debug_list" style="overflow:auto;padding:6px 0;"></div>
  `;
  host.appendChild(panel);

  document.body.appendChild(host);
  listEl = panel.querySelector('#__wr_debug_list') as HTMLDivElement;

  panel.querySelector('#__wr_debug_close')?.addEventListener('click', () => setOpen(false));
  panel.querySelector('#__wr_debug_clear')?.addEventListener('click', () => {
    entries.length = 0;
    render();
  });
  panel.querySelector('#__wr_debug_copy')?.addEventListener('click', () => {
    const text = entries
      .map((e) => `[${fmtTime(e.ts)}] ${e.kind.toUpperCase()} ${e.title}\n${e.detail}${e.stack ? '\n' + e.stack : ''}`)
      .join('\n\n');
    navigator.clipboard?.writeText(text).catch(() => {});
  });

  try {
    if (sessionStorage.getItem(STORAGE_KEY) === '1') setOpen(true);
  } catch {
    /* ignore */
  }
}

function setOpen(open: boolean) {
  isOpen = open;
  const panel = document.getElementById('__wr_debug_panel');
  if (panel) panel.style.display = open ? 'flex' : 'none';
  try {
    sessionStorage.setItem(STORAGE_KEY, open ? '1' : '0');
  } catch {
    /* ignore */
  }
}

function render() {
  if (!listEl || !badgeEl) return;
  const errCount = entries.filter((e) => e.kind !== 'console' && e.kind !== 'fetch').length;
  badgeEl.textContent = `🐞 ${entries.length}`;
  badgeEl.style.background = errCount > 0 ? '#3a0d0d' : '#161616';
  badgeEl.style.borderColor = errCount > 0 ? '#ff5d5d' : '#333';

  const countEl = document.getElementById('__wr_debug_count');
  if (countEl) countEl.textContent = `${entries.length} entries`;

  listEl.innerHTML = entries
    .slice()
    .reverse()
    .map(
      (e) => `
      <div style="padding:6px 12px;border-bottom:1px solid #161616;">
        <div style="display:flex;gap:8px;align-items:baseline;">
          <span style="color:${kindColor(e.kind)};font-weight:600;">${e.kind.toUpperCase()}</span>
          <span style="opacity:.5;">${fmtTime(e.ts)}</span>
          <span style="flex:1;color:#f5f5f5;word-break:break-word;">${escapeHtml(e.title)}</span>
        </div>
        ${e.detail ? `<pre style="margin:4px 0 0;white-space:pre-wrap;word-break:break-word;color:#cfcfcf;font-size:11px;">${escapeHtml(e.detail)}</pre>` : ''}
        ${e.stack ? `<pre style="margin:4px 0 0;white-space:pre-wrap;word-break:break-word;color:#888;font-size:11px;max-height:160px;overflow:auto;">${escapeHtml(e.stack)}</pre>` : ''}
      </div>`,
    )
    .join('');
}

function push(kind: EntryKind, title: string, detail = '', stack?: string) {
  ensureMounted();
  const previous = entries[entries.length - 1];
  if (previous?.kind === kind && previous.title === title && previous.detail === detail) return;
  entries.push({ id: nextId++, ts: Date.now(), kind, title, detail, stack });
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  // Auto-open the first time a real error lands so blank screens become visible.
  if (!isOpen && (kind === 'error' || kind === 'rejection' || kind === 'resource')) {
    setOpen(true);
  }
  render();
}

export function installDebugOverlay(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  if (!isEnabled()) return;

  // Mount immediately so even pre-React errors paint.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => ensureMounted(), { once: true });
  } else {
    ensureMounted();
  }

  // Hotkey: Ctrl/Cmd + Shift + D
  window.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'D' || e.key === 'd')) {
      e.preventDefault();
      setOpen(!isOpen);
    }
  });

  // 1) Uncaught errors + resource load failures
  window.addEventListener(
    'error',
    (event) => {
      const target = event.target as HTMLElement | null;
      if (target && target !== (window as unknown as HTMLElement) && (target.tagName === 'SCRIPT' || target.tagName === 'LINK' || target.tagName === 'IMG')) {
        const src = (target as HTMLScriptElement).src || (target as HTMLLinkElement).href || '';
        push('resource', `Failed to load <${target.tagName.toLowerCase()}>`, src);
        return;
      }
      const err = event.error as Error | undefined;
      push(
        'error',
        err?.message || event.message || 'Uncaught error',
        `${event.filename || ''}:${event.lineno || 0}:${event.colno || 0}`,
        err?.stack,
      );
    },
    true,
  );

  // 2) Unhandled promise rejections
  window.addEventListener('unhandledrejection', (event) => {
    const reason: unknown = event.reason;
    const message = reason && typeof reason === 'object' && 'message' in reason ? String((reason as { message: unknown }).message) : undefined;
    const stack = reason && typeof reason === 'object' && 'stack' in reason ? String((reason as { stack: unknown }).stack) : undefined;
    const title = message || (typeof reason === 'string' ? reason : 'Unhandled rejection');
    push('rejection', title, reason ? safeStringify(reason) : '', stack);
  });

  // 3) console.error — React render errors come through here
  const origErr = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    try {
      const first = args[0];
      const title = typeof first === 'string' ? first : (first && typeof first === 'object' && 'message' in first ? String((first as { message: unknown }).message) : 'console.error');
      if (IGNORED_CONSOLE_MESSAGES.some((message) => String(title).includes(message))) {
        origErr(...args);
        return;
      }
      const detail = args.slice(typeof first === 'string' ? 1 : 0).map(safeStringify).join(' ');
      const stack = args.map((a) => (a as Error)?.stack).find(Boolean) as string | undefined;
      push('console', String(title).slice(0, 300), detail.slice(0, 2000), stack);
    } catch {
      /* never let logging crash logging */
    }
    origErr(...args);
  };

  // 4) fetch — API failures + non-2xx
  if (typeof window.fetch === 'function') {
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const input = args[0];
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : (input as Request)?.url || '<unknown>';
      const method = (args[1]?.method || (input as Request)?.method || 'GET').toUpperCase();
      try {
        const res = await origFetch(...args);
        if (!res.ok) {
          push('fetch', `${method} ${res.status} ${shortUrl(url)}`, res.statusText || '');
        }
        return res;
      } catch (err) {
        const e = err instanceof Error ? err : undefined;
        push('fetch', `${method} FAILED ${shortUrl(url)}`, e?.message || String(err), e?.stack);
        throw err;
      }
    };
  }

  // 5) WebSocket — connection / message / close errors
  if (typeof window.WebSocket === 'function') {
    const OrigWS = window.WebSocket;
    interface PatchedWebSocketCtor {
      new (url: string | URL, protocols?: string | string[]): WebSocket;
      prototype: WebSocket;
      CONNECTING: number;
      OPEN: number;
      CLOSING: number;
      CLOSED: number;
    }
    function PatchedWSImpl(url: string | URL, protocols?: string | string[]): WebSocket {
      const ws = new OrigWS(url, protocols);
      const u = typeof url === 'string' ? url : url.toString();
      ws.addEventListener('error', () => push('websocket', `WS error ${shortUrl(u)}`));
      ws.addEventListener('close', (ev) => {
        if (ev.code !== 1000 && ev.code !== 1001) {
          push('websocket', `WS closed ${ev.code} ${shortUrl(u)}`, ev.reason || '');
        }
      });
      return ws;
    }
    PatchedWSImpl.prototype = OrigWS.prototype;
    const PatchedWS = PatchedWSImpl as unknown as PatchedWebSocketCtor;
    PatchedWS.CONNECTING = OrigWS.CONNECTING;
    PatchedWS.OPEN = OrigWS.OPEN;
    PatchedWS.CLOSING = OrigWS.CLOSING;
    PatchedWS.CLOSED = OrigWS.CLOSED;
    window.WebSocket = PatchedWS as unknown as typeof WebSocket;
  }

  push('console', 'Debug overlay installed', 'Ctrl/Cmd+Shift+D to toggle');
}

function safeStringify(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === 'string') return v;
  if (v instanceof Error) return v.message;
  try {
    return JSON.stringify(v, null, 2).slice(0, 2000);
  } catch {
    return String(v);
  }
}

function shortUrl(u: string): string {
  try {
    const url = new URL(u, window.location.href);
    return url.pathname + url.search;
  } catch {
    return u;
  }
}
