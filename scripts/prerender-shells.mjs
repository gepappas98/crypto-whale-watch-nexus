#!/usr/bin/env node
/* ══ PRERENDER SHELLS — postbuild static HTML per route ═══════════════════════
 *
 * PROBLEM: Whale Radar is a pure client-rendered SPA (see src/main.tsx —
 * ReactDOM.createRoot(...).render(<App/>), no SSR). vite build produces one
 * dist/index.html with <div id="root"></div> and sitewide-only <title>/meta
 * tags. <RouteSeo/> (src/components/RouteSeo.tsx) updates those tags per
 * route, but only after React mounts — so any crawler that reads raw HTML
 * without executing JS (this includes most AI-assistant crawlers: ClaudeBot,
 * GPTBot, PerplexityBot, and similar — see public/robots.txt, which already
 * explicitly allows them) only ever sees the sitewide "/" title/description
 * and an empty <div id="root">, regardless of which route was requested.
 *
 * FIX: after `vite build`, copy dist/index.html into a real dist/<route>/
 * index.html for every route in src/lib/seo/routes.json (the same file
 * RouteSeo's routeMeta.ts reads — one source of truth, not a second
 * hand-maintained list to drift out of sync), with that route's real
 * title/description/canonical/OG tags AND a visible <h1>/<p> inside #root
 * so a non-JS crawler reads actual descriptive text, not an empty div.
 *
 * WHY THIS IS SAFE FOR REAL USERS (the open question this design started
 * from): main.tsx uses createRoot(rootEl).render(...), not hydrateRoot(). A
 * plain .render() on a container that already has children doesn't diff or
 * hydrate against them — it just replaces them outright. So the static
 * shell content is visible for the ~50-200ms before JS takes over (a nicer
 * first paint than a blank page, if anything) and is then cleanly
 * overwritten with zero hydration-mismatch warnings. No removal script
 * needed. This is NOT full prerendering/SSR (no headless browser, nothing
 * executes React) — it's plain string templating over the one built
 * index.html, so it adds no new dependencies and no new failure surface
 * beyond what's already here.
 *
 * ⚠ ONE UNVERIFIED ASSUMPTION — this script cannot check it in this
 * environment, since it depends on Lovable's actual deploy/rewrite config,
 * not anything in this repo: that Lovable's static host serves
 * dist/<route>/index.html when a crawler requests that path directly,
 * rather than SPA-rewriting every path to the top-level dist/index.html.
 * If it's the latter, this script's output is simply never served and this
 * whole approach is moot. VERIFY by deploying, then `curl -s
 * https://crypto-whale-watch-nexus.lovable.app/orderflow | grep '<title>'`
 * (or "view source" in a browser with JS disabled) — if it shows "Orderflow
 * Pro — Whale Radar" rather than the sitewide default title, it's working.
 *
 * Zero new dependencies — Node's fs/path only. Run automatically via npm's
 * postbuild lifecycle hook (see package.json) right after `npm run build`.
 *
 * Bonus fix found while wiring this up: dist/sitemap.xml (copied verbatim
 * from public/sitemap.xml) only listed 3 of these 15 routes, so most pages
 * were never being surfaced to crawlers for discovery in the first place —
 * this script regenerates both sitemap.xml and llms.txt from routes.json
 * too, so they can't drift out of sync with the real route list again.
 * ═══════════════════════════════════════════════════════════════════════════ */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const ROUTES_JSON = join(ROOT, 'src/lib/seo/routes.json');

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Replace a `<meta name|property="key" content="...">` tag's content, or a
 *  `<title>`/`<link rel="canonical" href="...">`. Regex-based, not a DOM
 *  parser — deliberately: index.html is small and hand-controlled, and a
 *  DOM library would be the first new dependency this approach was chosen
 *  to avoid. Falls through unchanged (with a warning) if a tag isn't found,
 *  rather than throwing and failing the whole build over an SEO tag. */
function replaceTag(html, pattern, replacement, label) {
  if (!pattern.test(html)) {
    console.warn(`  ⚠ prerender-shells: couldn't find ${label} tag — left unchanged`);
    return html;
  }
  return html.replace(pattern, replacement);
}

function applyRouteMeta(baseHtml, route, site) {
  const title = esc(route.title ?? site.defaultTitle);
  const description = esc(route.description ?? site.defaultDescription);
  const canonical = `${site.siteOrigin}${route.path}`;
  const robots = route.noindex ? 'noindex, follow' : 'index, follow';

  let html = baseHtml;
  html = replaceTag(html, /<title>[^<]*<\/title>/, `<title>${title}</title>`, '<title>');
  html = replaceTag(html, /(<meta\s+name="description"\s+content=")[^"]*(")/,
    `$1${description}$2`, 'meta[name=description]');
  html = replaceTag(html, /(<meta\s+name="robots"\s+content=")[^"]*(")/,
    `$1${robots}$2`, 'meta[name=robots]');
  html = replaceTag(html, /(<meta\s+property="og:title"\s+content=")[^"]*(")/,
    `$1${title}$2`, 'meta[og:title]');
  html = replaceTag(html, /(<meta\s+property="og:description"\s+content=")[^"]*(")/,
    `$1${description}$2`, 'meta[og:description]');
  html = replaceTag(html, /(<meta\s+property="og:url"\s+content=")[^"]*(")/,
    `$1${esc(canonical)}$2`, 'meta[og:url]');
  html = replaceTag(html, /(<meta\s+name="twitter:title"\s+content=")[^"]*(")/,
    `$1${title}$2`, 'meta[twitter:title]');
  html = replaceTag(html, /(<meta\s+name="twitter:description"\s+content=")[^"]*(")/,
    `$1${description}$2`, 'meta[twitter:description]');
  html = replaceTag(html, /(<link\s+rel="canonical"\s+href=")[^"]*(")/,
    `$1${esc(canonical)}$2`, 'link[canonical]');

  // The actual content fix: real visible text inside #root for crawlers
  // that don't run JS. Inline-styled to roughly match the dark theme
  // (index.html's own theme-color) so it doesn't flash white. Safe to
  // overwrite on hydration — see docstring above.
  html = replaceTag(
    html,
    /<div id="root"><\/div>/,
    `<div id="root"><main style="max-width:720px;margin:0 auto;padding:3rem 1.25rem;` +
      `font-family:system-ui,-apple-system,sans-serif;color:#e2e8f0;background:#0f172a;">` +
      `<h1 style="font-size:1.4rem;line-height:1.3;margin:0 0 .75rem;">${title}</h1>` +
      `<p style="font-size:1rem;line-height:1.6;margin:0;color:#94a3b8;">${description}</p>` +
      `</main></div>`,
    'div#root',
  );

  return html;
}

function buildSitemap(site) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = site.routes
    .filter((r) => !r.noindex)
    .map((r) => `  <url>
    <loc>${esc(site.siteOrigin + r.path)}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${(r.priority ?? 0.6).toFixed(1)}</priority>
  </url>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function buildLlmsTxt(site) {
  const pages = site.routes
    .map((r) => `- ${site.siteOrigin}${r.path} — ${r.title ?? site.defaultTitle}: ${r.description ?? site.defaultDescription}`)
    .join('\n');
  return `# ${site.siteName}\n\n> ${site.defaultDescription}\n\n## Pages\n${pages}\n\n## API & Documentation\n- Website: ${site.siteOrigin}/\n- Repository: https://github.com/gepappas98/crypto-whale-watch-nexus\n- OpenAPI spec: ${site.siteOrigin}/openapi.json\n`;
}

function main() {
  if (!existsSync(DIST)) {
    console.error('prerender-shells: dist/ not found — run `vite build` first.');
    process.exit(1);
  }
  const indexPath = join(DIST, 'index.html');
  if (!existsSync(indexPath)) {
    console.error('prerender-shells: dist/index.html not found — nothing to prerender from.');
    process.exit(1);
  }

  const site = JSON.parse(readFileSync(ROUTES_JSON, 'utf8'));
  const baseHtml = readFileSync(indexPath, 'utf8');

  let written = 0;
  for (const route of site.routes) {
    // "/" already IS dist/index.html — the sitewide static tags already
    // match it (see routes.json's comment-equivalent: '/' has no
    // title/description override, it uses the defaults index.html already
    // has). Still worth re-applying in case index.html's tags ever drift
    // from routes.json's defaults, so it's not skipped.
    const outDir = route.path === '/' ? DIST : join(DIST, route.path.replace(/^\//, ''));
    const outPath = join(outDir, 'index.html');
    if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
    writeFileSync(outPath, applyRouteMeta(baseHtml, route, site), 'utf8');
    written++;
  }

  // public/sitemap.xml and public/llms.txt already get copied verbatim into
  // dist/ by vite as static assets — this overwrites those copies with
  // versions regenerated from routes.json, so both stay complete and in
  // sync with the actual route list automatically instead of needing a
  // manual edit every time a route is added (the actual bug found here:
  // the checked-in sitemap.xml only listed 3 of 15 routes).
  writeFileSync(join(DIST, 'sitemap.xml'), buildSitemap(site), 'utf8');
  writeFileSync(join(DIST, 'llms.txt'), buildLlmsTxt(site), 'utf8');

  console.log(`prerender-shells: wrote ${written} route shells, sitemap.xml and llms.txt to dist/.`);
  console.log('⚠ Unverified: whether the deploy host actually serves these per-route');
  console.log('  files for a direct request, or SPA-rewrites everything to dist/index.html.');
  console.log('  Verify after deploy: curl -s <site>/orderflow | grep "<title>"');
}

main();
