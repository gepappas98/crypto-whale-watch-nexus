/* ══ MCP Plugin Store (user-defined tools) ══════════════════════════════════
 *  Lets operators register external MCP / HTTP tool endpoints (Dune, Birdeye,
 *  DexScreener proxies, custom analytics) from the UI. Tools are persisted
 *  locally; invocation is best-effort HTTP POST with a fixed JSON envelope.
 *  This is a registry + caller, not a full MCP protocol client.
 * ═══════════════════════════════════════════════════════════════════════════ */

const STORE_KEY = "wr_mcp_plugin_store_v1";

export interface McpPlugin {
  id: string;
  name: string;
  description: string;
  /** HTTPS endpoint that accepts POST { tool, args }. */
  endpoint: string;
  enabled: boolean;
  headers?: Record<string, string>;
  createdAt: number;
}

function load(): McpPlugin[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as McpPlugin[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(plugins: McpPlugin[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(plugins));
  } catch (e) {
    console.error("[McpPluginStore] persist failed:", e);
  }
}

export function listMcpPlugins(): McpPlugin[] {
  return load();
}

export function upsertMcpPlugin(
  plugin: Omit<McpPlugin, "id" | "createdAt"> & { id?: string },
): McpPlugin {
  const list = load();
  const id = plugin.id || `mcp_${Date.now().toString(36)}`;
  const next: McpPlugin = {
    id,
    name: plugin.name.trim(),
    description: plugin.description.trim(),
    endpoint: plugin.endpoint.trim(),
    enabled: plugin.enabled !== false,
    headers: plugin.headers,
    createdAt: list.find((p) => p.id === id)?.createdAt ?? Date.now(),
  };
  const idx = list.findIndex((p) => p.id === id);
  if (idx >= 0) list[idx] = next;
  else list.push(next);
  save(list);
  return next;
}

export function removeMcpPlugin(id: string): void {
  save(load().filter((p) => p.id !== id));
}

export function setMcpPluginEnabled(id: string, enabled: boolean): void {
  const list = load().map((p) => (p.id === id ? { ...p, enabled } : p));
  save(list);
}

export async function invokeMcpPlugin(
  id: string,
  tool: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  const plugin = load().find((p) => p.id === id && p.enabled);
  if (!plugin) throw new Error(`MCP plugin ${id} not found or disabled`);
  if (!/^https:\/\//i.test(plugin.endpoint)) {
    throw new Error("MCP plugin endpoint must be HTTPS");
  }
  const res = await fetch(plugin.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(plugin.headers || {}),
    },
    body: JSON.stringify({ tool, args }),
  });
  if (!res.ok) {
    throw new Error(`MCP plugin HTTP ${res.status}`);
  }
  return res.json();
}
