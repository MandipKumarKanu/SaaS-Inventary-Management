import { Request, Response, NextFunction } from 'express';

// Bing Webmaster Guidelines: robots.txt controls crawl access, NOT indexing.
// API JSON must never be indexed (nor surface in Copilot grounding), so every
// /api response carries an explicit NOINDEX. Public HTML pages control their
// own indexing via <meta name="robots"> in the frontend Seo.jsx component.
export function seoHeadersMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path.startsWith('/api') || req.originalUrl.startsWith('/api')) {
    // Never index API payloads; also keeps them out of grounding citations.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    // API responses are dynamic — prevent stale cache from being treated as content.
    if (!res.getHeader('Cache-Control')) {
      res.setHeader('Cache-Control', 'no-store');
    }
  }
  next();
}
