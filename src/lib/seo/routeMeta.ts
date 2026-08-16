/* ══ ROUTE METADATA ═══════════════════════════════════════════════════════════
 * Single source of truth for per-route <title>, description and canonical URL.
 * Consumed by <RouteSeo /> (client-side, for JS-executing crawlers) AND by
 * scripts/prerender-shells.mjs (build-time, for text-only crawlers — see that
 * script's docstring for why both are needed). The actual data lives in
 * routes.json, not here — a plain JSON file so the postbuild script (plain
 * Node, no TS toolchain) can read the exact same data with zero duplication,
 * rather than two hand-maintained copies drifting apart.
 */
import routesData from './routes.json';

export const SITE_NAME = routesData.siteName;
export const SITE_ORIGIN = routesData.siteOrigin;

/** Sitewide defaults — must stay in sync with the static tags in index.html. */
export const DEFAULT_TITLE = routesData.defaultTitle;
export const DEFAULT_DESCRIPTION = routesData.defaultDescription;

export interface RouteMeta {
  title: string;
  description: string;
  /** Exclude from search indexes (error pages, redirects). */
  noindex?: boolean;
}

/** Exact pathname → metadata, built from routes.json. Entries that omit
 *  title/description (currently just "/") fall back to the sitewide default,
 *  same as the old hand-written table did for "/". */
export const ROUTE_META: Record<string, RouteMeta> = Object.fromEntries(
  routesData.routes.map((r) => [
    r.path,
    {
      title: r.title ?? DEFAULT_TITLE,
      description: r.description ?? DEFAULT_DESCRIPTION,
    },
  ]),
);

/** Metadata used for unmatched routes (404). Kept out of search indexes. */
export const NOT_FOUND_META: RouteMeta = routesData.notFound;

/** Strip trailing slash (except root) so "/orderflow/" resolves like "/orderflow". */
export function normalisePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1);
  return pathname;
}

export function resolveRouteMeta(pathname: string): RouteMeta {
  return ROUTE_META[normalisePath(pathname)] ?? NOT_FOUND_META;
}

export function canonicalFor(pathname: string): string {
  return `${SITE_ORIGIN}${normalisePath(pathname)}`;
}
