import { Request, Response, NextFunction, RequestHandler } from 'express';

/**
 * Shared HTTP handler utilities (backend-wide audit refactor).
 *
 * The codebase already standardizes on:
 *   - services throwing AppError (shared/errors.ts)
 *   - routes calling next(err)
 *   - one global errorHandler middleware
 *
 * These helpers remove the remaining duplicated boilerplate WITHOUT changing
 * any response shape — clients see identical JSON as before.
 */

/**
 * Wrap an async route handler so rejections reach the central error handler.
 *
 *   router.get('/', requirePermission(P.X), asyncHandler(async (req, res) => {
 *     ...
 *   }));
 *
 * Handlers may `return` early; they never need try/catch for error routing.
 */
export function asyncHandler(
  fn: (req: Request, res: Response) => Promise<void>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

export interface Pagination {
  page: number;
  pageSize: number;
}

/**
 * Parse `page` / `pageSize` (or `limit` / `offset`) query params with
 * defensive clamping:
 *   - NaN / negative / zero values fall back to the defaults
 *   - pageSize is capped (default 100) so a client can never request
 *     an unbounded result set
 *   - page is floored at 1
 *
 * Services keep their own `Math.min(pageSize, 100)` — this is the input-side
 * guard that also protects services without their own cap.
 */
export function parsePagination(
  query: Request['query'],
  defaults: { page?: number; pageSize?: number; maxPageSize?: number } = {}
): Pagination {
  const maxPageSize = defaults.maxPageSize ?? 100;
  const defPage = defaults.page ?? 1;
  const defPageSize = defaults.pageSize ?? 25;

  const rawPage = Number(query.page);
  const rawPageSize = Number(query.pageSize ?? query.limit);

  const page =
    Number.isFinite(rawPage) && rawPage >= 1
      ? Math.floor(rawPage)
      : defPage;

  const rawSize =
    Number.isFinite(rawPageSize) && rawPageSize >= 1
      ? Math.floor(rawPageSize)
      : defPageSize;

  const pageSize = Math.min(rawSize, maxPageSize);

  return { page, pageSize };
}
