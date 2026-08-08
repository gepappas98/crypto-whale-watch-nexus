/* ══ ROUTE SEO ════════════════════════════════════════════════════════════════
 * Applies per-route <title>, meta description, canonical and og:* tags to
 * document.head on every navigation.
 *
 * NOTE: this is a client-side SPA, so these updates land after hydration.
 * JS-executing crawlers (Googlebot) see them; social-preview crawlers read only
 * the static tags in index.html, which stay as the sitewide fallback.
 */
import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { canonicalFor, resolveRouteMeta } from '@/lib/seo/routeMeta';

/** Create-or-update a <meta> tag, keyed by name or property. */
function setMeta(attr: 'name' | 'property', key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute('content', content);
}

/** Create-or-update the single <link rel="canonical">. */
function setCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement('link');
    el.setAttribute('rel', 'canonical');
    document.head.appendChild(el);
  }
  el.setAttribute('href', href);
}

export function RouteSeo() {
  const { pathname } = useLocation();

  useEffect(() => {
    const meta = resolveRouteMeta(pathname);
    const canonical = canonicalFor(pathname);

    document.title = meta.title;
    setMeta('name', 'description', meta.description);
    setMeta('name', 'robots', meta.noindex ? 'noindex, follow' : 'index, follow');

    // Mirror onto the social tags so they self-reference this route.
    setMeta('property', 'og:title', meta.title);
    setMeta('property', 'og:description', meta.description);
    setMeta('property', 'og:url', canonical);
    setMeta('name', 'twitter:title', meta.title);
    setMeta('name', 'twitter:description', meta.description);

    setCanonical(canonical);
  }, [pathname]);

  return null;
}
