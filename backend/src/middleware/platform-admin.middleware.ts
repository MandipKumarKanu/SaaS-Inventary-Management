import { Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../shared/errors.js';
import { AuthenticatedRequest } from '../shared/types.js';
import { logger } from '../config/logger.js';

const EMAIL_HEADER_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Small in-process cache so the fallback email check doesn't re-run per request.
let envAdminEmailsCache: { emails: Set<string>; loadedAt: number } | null = null;

function getEnvAdminEmails(): Set<string> {
  const now = Date.now();
  if (envAdminEmailsCache && now - envAdminEmailsCache.loadedAt < EMAIL_HEADER_CACHE_TTL_MS) {
    return envAdminEmailsCache.emails;
  }
  const emails = new Set(
    (process.env.PLATFORM_ADMIN_EMAILS || process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean)
  );
  envAdminEmailsCache = { emails, loadedAt: now };
  return emails;
}

export function invalidatePlatformAdminCache(): void {
  envAdminEmailsCache = null;
}

/**
 * Check if a user is a platform admin (without throwing errors)
 */
export async function checkIsPlatformAdmin(userId: string, email?: string): Promise<boolean> {
  if (!userId) return false;
  try {
    const { data: adminRow } = await supabaseAdmin
      .from('platform_admins')
      .select('id')
      .eq('user_id', userId)
      .maybeSingle();

    if (adminRow) return true;

    const normalizedEmail = (email || '').toLowerCase();
    if (normalizedEmail && getEnvAdminEmails().has(normalizedEmail)) {
      return true;
    }
  } catch (err) {
    logger.error('Error checking platform admin status', { error: (err as any)?.message, userId });
  }
  return false;
}

/**
 * Platform admin middleware (Phase 0 hardening, PRD §14)
 * Must run AFTER authMiddleware: it requires req.user.
 *
 * Grants access when EITHER:
 *  1. The authenticated user has a row in platform_admins (authoritative), or
 *  2. The user's verified email is listed in PLATFORM_ADMIN_EMAILS (bootstrap
 *     fallback so the very first admin can log in before seeding runs).
 *
 * Fails closed: any DB error results in 403, never open access.
 */
export async function requirePlatformAdmin(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.user?.id) {
      throw AppError.unauthorized('Authentication required', 'PLATFORM_ADMIN_REQUIRED');
    }

    const isAdmin = await checkIsPlatformAdmin(req.user.id, req.user.email);
    if (isAdmin) {
      next();
      return;
    }

    logger.warn('Platform admin access denied', { userId: req.user.id, email: req.user.email });
    throw AppError.forbidden('Platform administrator access required', 'PLATFORM_ADMIN_REQUIRED');
  } catch (err) {
    next(err);
  }
}
