"""
smoke_test.py — Import-chain validator for real-time-stock-crypto-intelligence.

Runs every import that main.py, app/api.py, and app/mcp_server.py execute at
startup without starting the server or making any network calls.

Usage:
    pip install -r requirements.txt
    python smoke_test.py

A clean run prints "All imports OK" and exits 0.
Any ImportError / NameError / AttributeError prints the exact failure and exits 1.

Run this locally before every push.  If it passes here it will pass in the
MCPize/Cloud Run build container (same Python 3.11, same packages).
"""
import sys
import importlib
import traceback

# ── Modules to import, in the order the runtime loads them ────────────────
TARGETS = [
    # Standard-library / third-party — quick sanity check
    ("fastapi",             "FastAPI web framework"),
    ("fastmcp",             "FastMCP MCP framework"),
    ("uvicorn",             "ASGI server"),
    ("httpx",               "HTTP client"),
    ("bs4",                 "BeautifulSoup (SEC EDGAR fallback)"),
    ("dotenv",              "python-dotenv"),
    # Domain layer
    ("domain.models",       "Price, InsiderTrade, TradingContext dataclasses"),
    ("domain.services",     "TradingDecisionEngine"),
    # Infrastructure
    ("infrastructure.cache",                    "Redis / in-memory cache"),
    ("infrastructure.providers.yahoo",          "Yahoo Finance provider"),
    ("infrastructure.providers.binance",        "Binance provider"),
    ("infrastructure.providers.frankfurter",    "Frankfurter FX provider"),
    ("infrastructure.providers.sec",            "SEC EDGAR provider"),
    ("infrastructure.providers.revolut",        "Revolut asset registry"),
    # Usecases
    ("usecases.trading",    "get_trading_context"),
    ("usecases.insider",    "enrich_insider_context, get_cluster_context, get_weekly_summary"),
    # SEO
    ("seo.generator",       "render_page / render_ticker_page alias"),
    # App layer (imports everything above transitively)
    ("app.mcp_server",      "TOOL_HANDLERS, MCP_TOOLS_SCHEMA, FastMCP instance"),
    ("app.api",             "FastAPI app + /mcp endpoint"),
]

# ── Spot-check specific attributes that have caused runtime NameErrors ─────
ATTR_CHECKS = [
    # (module, attribute, human label)
    ("seo.generator",   "render_page",          "seo.generator.render_page"),
    ("seo.generator",   "render_ticker_page",   "seo.generator.render_ticker_page (alias)"),
    ("seo.generator",   "generate_all_symbols", "seo.generator.generate_all_symbols"),
    ("app.mcp_server",  "TOOL_HANDLERS",        "app.mcp_server.TOOL_HANDLERS dict"),
    ("app.mcp_server",  "MCP_TOOLS_SCHEMA",     "app.mcp_server.MCP_TOOLS_SCHEMA list"),
    ("app.mcp_server",  "mcp",                  "app.mcp_server.mcp (FastMCP instance)"),
    ("app.api",         "app",                  "app.api.app (FastAPI instance)"),
    ("infrastructure.providers.revolut", "KNOWN_CRYPTO",   "revolut.KNOWN_CRYPTO set"),
    ("infrastructure.providers.revolut", "REVOLUT_CRYPTO", "revolut.REVOLUT_CRYPTO set"),
    ("infrastructure.providers.revolut", "REVOLUT_STOCKS", "revolut.REVOLUT_STOCKS dict"),
]

PASS = "\033[32mPASS\033[0m"
FAIL = "\033[31mFAIL\033[0m"

errors: list[str] = []

print("=" * 60)
print("real-time-stock-crypto-intelligence — smoke test")
print("=" * 60)

# ── Import tests ───────────────────────────────────────────────────────────
print("\n[1/2] Module imports\n")
loaded: dict = {}
for modname, label in TARGETS:
    try:
        mod = importlib.import_module(modname)
        loaded[modname] = mod
        print(f"  {PASS}  {modname:<45} {label}")
    except Exception:
        tb = traceback.format_exc().strip().splitlines()[-1]
        print(f"  {FAIL}  {modname:<45} {tb}")
        errors.append(f"import {modname}: {tb}")

# ── Attribute tests ────────────────────────────────────────────────────────
print("\n[2/2] Attribute checks\n")
for modname, attr, label in ATTR_CHECKS:
    mod = loaded.get(modname)
    if mod is None:
        print(f"  SKIP  {label}  (module failed to import)")
        continue
    if hasattr(mod, attr):
        print(f"  {PASS}  {label}")
    else:
        msg = f"{modname}.{attr} not found"
        print(f"  {FAIL}  {label}  — {msg}")
        errors.append(msg)

# ── Summary ────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
if errors:
    print(f"FAILED — {len(errors)} error(s):")
    for e in errors:
        print(f"  * {e}")
    sys.exit(1)
else:
    print("All imports OK — safe to push and redeploy.")
    sys.exit(0)
