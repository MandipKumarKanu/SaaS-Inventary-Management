import { Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../shared/errors.js';
import { AuthenticatedRequest } from '../shared/types.js';
import { logger } from '../config/logger.js';
import { PlatformAdminRole, roleHasPermission, PlatformPermission } from '../shared/platform-rbac.js';

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
 * Resolve a platform admin's role (§38). Env-bootstrapped admins
 * (PLATFORM_ADMIN_EMAILS) are treated as SUPER_ADMIN; DB rows carry an
 * explicit role column (migration 021).
 */
export async function getPlatformAdminRole(userId: string, email?: string): Promise<PlatformAdminRole | null> {
  if (!userId) return null;
  try {
    const { data: adminRow } = await supabaseAdmin
      .from('platform_admins')
      .select('id, role')
      .eq('user_id', userId)
      .maybeSingle();

    if (adminRow) return (adminRow.role as PlatformAdminRole) ?? 'SUPER_ADMIN';

    const normalizedEmail = (email || '').toLowerCase();
    if (normalizedEmail && getEnvAdminEmails().has(normalizedEmail)) {
      return 'SUPER_ADMIN';
    }
  } catch (err) {
    logger.error('Error resolving platform admin role', { error: (err as any)?.message, userId });
  }
  return null;
}

/**
 * Per-permission platform authorization (§65, §78). Must run AFTER
 * requirePlatformAdmin; reads the role resolved and attached by it.
 */
export function requirePlatformPermission(permission: PlatformPermission) {
  return async (req: AuthenticatedRequest, _res: Response, next: NextFunction): Promise<void> => {
    try {
      // Per-request resolution — role changes take effect immediately.
      const role = await getPlatformAdminRole(req.user.id, req.user.email);
      if (!role || !roleHasPermission(role, permission)) {
        logger.warn('Platform permission denied', { userId: req.user.id, role, permission });
        throw AppError.forbidden(`Platform permission required: ${permission}`, 'PLATFORM_PERMISSION_REQUIRED');
      }
      (req as AuthenticatedRequest & { platformRole?: PlatformAdminRole }).platformRole = role;
      next();
    } catch (err) {
      next(err);
    }
  };
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
