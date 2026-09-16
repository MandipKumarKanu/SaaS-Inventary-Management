import { Router, Request, Response, NextFunction } from 'express';
import { env } from '../../config/env.js';

const router = Router();

// Bing Webmaster Guidelines implementation notes:
// - robots.txt controls CRAWL access, not indexing. API responses must carry
//   `X-Robots-Tag: noindex, nofollow` so JSON endpoints never appear in
//   Bing / Copilot grounding (applied globally in app.ts as well).
// - Freshness: sitemap lastmod + ETag/Last-Modified help Bing detect changes.
// - IndexNow (Bing §4): notify Bing instantly on add/update/delete instead of
//   batch submissions. Streaming > batch.

const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/IndexNow';

function getKey(): string {
  return (process.env.INDEXNOW_KEY || '').trim();
}

function getHost(): string {
  try {
    return new URL(env.APP_URL).host;
  } catch {
    return 'www.example.com';
  }
}

// GET /api/v1/seo/indexnow/status — readiness check for Bing Webmaster Tools setup
router.get('/indexnow/status', (req: Request, res: Response) => {
  const key = getKey();
  const host = getHost();
  res.json({
    success: true,
    data: {
      configured: Boolean(key),
      host,
      keyLocation: key ? `https://${host}/${key}.txt` : null,
      endpoint: INDEXNOW_ENDPOINT,
      // 1) create key, 2) host key file at site root, 3) POST urls here
      setupSteps: [
        'Generate a key (e.g. openssl rand -hex 16) and set INDEXNOW_KEY env.',
        `Serve the key file at https://${host}/${key || '<key>'}.txt containing the key as plain text (frontend public/<key>.txt).`,
        'POST { "urls": ["https://.../login"] } to /api/v1/seo/indexnow/submit on every public URL add/update/delete.',
      ],
    },
  });
});

// POST /api/v1/seo/indexnow/submit — body: { urls: string[] } or { url: string }
// Forwards to api.indexnow.org so Bing (+ Yandex etc.) recrawls within hours
// instead of leaving URLs stuck at "Discovered but not crawled".
router.post('/indexnow/submit', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const key = getKey();
    if (!key) {
      res.status(503).json({
        success: false,
        error: {
          code: 'INDEXNOW_NOT_CONFIGURED',
          message: 'Set INDEXNOW_KEY env and host the key file before submitting.',
        },
      });
      return;
    }

    const raw = Array.isArray((req.body as any)?.urls)
      ? (req.body as any).urls
      : typeof (req.body as any)?.url === 'string'
        ? [(req.body as any).url]
        : [];
    const host = getHost();
    const urls = [...new Set(raw.filter((u: unknown) => typeof u === 'string'))].filter((u) =>
      (u as string).startsWith('http'),
    ) as string[];

    if (urls.length === 0 || urls.length > 100) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_URLS',
          message: 'Provide 1–100 absolute URLs via { urls: [...] }. Stream submits; avoid batches.',
        },
      });
      return;
    }

    // KeyLocation must be publicly fetchable or Bing rejects the submission.
    const keyLocation = `https://${host}/${key}.txt`;
    const response = await fetch(INDEXNOW_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host, key, keyLocation, urlList: urls }),
    });

    if (!response.ok) {
      res.status(502).json({
        success: false,
        error: {
          code: 'INDEXNOW_REJECTED',
          message: `IndexNow endpoint returned ${response.status}. Verify key file at ${keyLocation}.`,
        },
      });
      return;
    }

    res.json({ success: true, data: { submitted: urls.length, host } });
  } catch (err) {
    next(err);
  }
});

export const seoRoutes = router;
