import { Request, Response, NextFunction } from 'express';
import { AsyncLocalStorage } from 'async_hooks';

/**
 * Phase 4: request-scoped audit context (PRD §41).
 *
 * Stores { ip, userAgent } for the lifetime of a request so AuditService can
 * stamp every audit row with the request origin — no service signature
 * changes needed. Must be mounted BEFORE the routes that log audits
 * (right after the global json parser is fine).
 */

export interface AuditContext {
  ipAddress: string | null;
  userAgent: string | null;
}

const auditStorage = new AsyncLocalStorage<AuditContext>();

export function auditContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const ip =
    (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ||
    req.ip ||
    null;

  const ctx: AuditContext = {
    ipAddress: ip,
    userAgent: (req.headers['user-agent'] as string | undefined) || null,
  };

  auditStorage.run(ctx, () => next());
}

/** Current request's audit context, or null outside a request. */
export function getAuditContext(): AuditContext | null {
  return auditStorage.getStore() || null;
}
