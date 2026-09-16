import { useEffect } from 'react';
import { useLocation } from 'react-router';

// Central SEO map: public routes are indexable, every authenticated app
// route is noindex (Bing: robots.txt controls crawl, NOINDEX controls index).
// Keep titles unique + descriptive per Bing § content-clarity; canonicals absolute.
const SITE_URL = (import.meta.env.VITE_SITE_URL || 'https://www.example.com').replace(/\/$/, '');

const PUBLIC_ROUTES = {
  '/login': {
    title: 'Sign In — Inventory SaaS Engine',
    description:
      'Sign in to your multi-tenant inventory & warehouse management platform.',
    index: true,
  },
  '/signup': {
    title: 'Create Account — Inventory SaaS Engine',
    description:
      'Create your multi-tenant inventory workspace. Manage products, warehouses, orders, and routing.',
    index: true,
  },
};

const DEFAULT_APP_META = {
  title: 'Inventory SaaS Engine',
  description:
    'Multi-tenant inventory & warehouse management platform.',
  index: false,
};

function upsertMeta(selector, create) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  return el;
}

export function Seo() {
  const { pathname } = useLocation();

  useEffect(() => {
    const route = PUBLIC_ROUTES[pathname] || DEFAULT_APP_META;
    const canonicalPath = PUBLIC_ROUTES[pathname] ? pathname : '/login';
    const canonical = `${SITE_URL}${canonicalPath}`;

    document.title = route.title;

    const desc = upsertMeta('meta[name="description"]', () => {
      const m = document.createElement('meta');
      m.setAttribute('name', 'description');
      return m;
    });
    desc.setAttribute('content', route.description);

    // robots: public => index,follow | app => noindex,nofollow (also honored by Bingbot)
    const robots = upsertMeta('meta[name="robots"]', () => {
      const m = document.createElement('meta');
      m.setAttribute('name', 'robots');
      return m;
    });
    robots.setAttribute('content', route.index ? 'index, follow' : 'noindex, nofollow');

    let bingbot = document.head.querySelector('meta[name="bingbot"]');
    if (!bingbot) {
      bingbot = document.createElement('meta');
      bingbot.setAttribute('name', 'bingbot');
      document.head.appendChild(bingbot);
    }
    bingbot.setAttribute('content', route.index ? 'index, follow' : 'noindex, nofollow');

    let link = document.head.querySelector('link[rel="canonical"]');
    if (!link) {
      link = document.createElement('link');
      link.setAttribute('rel', 'canonical');
      document.head.appendChild(link);
    }
    link.setAttribute('href', canonical);

    let ogUrl = document.head.querySelector('meta[property="og:url"]');
    if (!ogUrl) {
      ogUrl = document.createElement('meta');
      ogUrl.setAttribute('property', 'og:url');
      document.head.appendChild(ogUrl);
    }
    ogUrl.setAttribute('content', canonical);
  }, [pathname]);

  return null;
}

export { SITE_URL };
