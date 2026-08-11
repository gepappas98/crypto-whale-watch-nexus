# nexus-bot MCP server

Lets an MCP-compatible AI client (Claude Desktop, Claude Code, or any other
MCP host) drive the Nexus bot directly — as a trusted caller of the same
Express server the app's own browser bridge (`RestBridgeBot`) talks to. It
does not implement its own execution logic; it's a thin MCP wrapper around
`GET/POST/DELETE /api/nexus-bot/*`, so every gate the server enforces for the
browser (dry-run default, cooldown lock, pair plausibility) applies exactly
the same way here.

## Setup

```bash
cd mcp-nexus-bot
npm install
npm run build
```

## Configuration

Two environment variables, both required:

| Variable | Meaning |
|---|---|
| `NEXUS_BOT_API_URL` | Base URL of the running Express server, e.g. `http://localhost:3001` |
| `NEXUS_BOT_API_TOKEN` | Same value as `server/.env`'s `API_AUTH_TOKEN` |

## Claude Desktop / Claude Code config

Add to your MCP client's config (e.g. `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "nexus-bot": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-nexus-bot/dist/index.js"],
      "env": {
        "NEXUS_BOT_API_URL": "http://localhost:3001",
        "NEXUS_BOT_API_TOKEN": "your-token-here"
      }
    }
  }
}
```

## Tools exposed

Read-only (safe to call anytime):
- `nexus_get_safety_model` — read this first
- `nexus_get_portfolio`
- `nexus_list_grids`
- `nexus_scan_arbitrage`
- `nexus_get_volume_maker_stats`

Mutating (destructive once the server operator has opted into live trading —
see the main README's [Connecting a Trading Bot](../README.md#-connecting-a-trading-bot) section):
- `nexus_execute_arbitrage`
- `nexus_create_grid`
- `nexus_stop_grid` (risk-reducing, not gated the way opening a position is)

## Before trusting this end-to-end

This was written against the documented `@modelcontextprotocol/sdk` API
surface but has not been run through a live SDK install / MCP Inspector
session. Sanity-check it first:

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

And keep the server-side `NEXUS_DRY_RUN` default (on) until you've watched
it behave correctly against a paper/testnet setup.
