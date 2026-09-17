import { Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../shared/errors.js';
import { AuthenticatedRequest } from '../shared/types.js';
import { logger } from '../config/logger.js';

/**
 * Re-authentication for dangerous admin operations (PRD §66).
 *
 * Verifies the caller's Supabase password BEFORE allowing the wrapped
 * handler. The admin must send their current password in the
 * `x-admin-password` header (never in the body — bodies get logged by
 * mistake far more often than headers). The value is never logged.
 *
 * Usage:
 *   router.post('/users/bulk-status',
 *     requirePlatformPermission('platform.users.manage'),
 *     requireReAuthentication,
 *     handler)
 */

// A successful verification grants a short re-auth window so a multi-step
// operation doesn't demand the password on every subrequest (§66: shorter
// session lifetime for dangerous ops, not per-keystroke prompts).
const REAUTH_WINDOW_MS = 5 * 60 * 1000;
const reauthCache = new Map<string, number>();

function isRecentlyReauthenticated(userId: string): boolean {
  const until = reauthCache.get(userId);
  if (until && until > Date.now()) return true;
  reauthCache.delete(userId);
  return false;
}

export function grantReAuthentication(userId: string): void {
  reauthCache.set(userId, Date.now() + REAUTH_WINDOW_MS);
}

export async function verifyAdminPassword(userId: string, password: string): Promise<boolean> {
  if (!password || password.length < 1) return false;
  try {
    // Resolve the admin's email, then verify via Supabase auth
    // (signInWithPassword) — the platform never stores or hashes its own
    // password copies (§79: reuse existing auth infrastructure).
    const { data: profile } = await supabaseAdmin
      .from('users')
      .select('email, status')
      .eq('id', userId)
      .maybeSingle();
    if (!profile?.email || profile.status === 'suspended') return false;

    const { data, error } = await supabaseAdmin.auth.signInWithPassword({
      email: profile.email,
      password,
    });
    if (error || !data.user || data.user.id !== userId) return false;

    // Sign the verification session out immediately — it exists only to
    // prove identity, not to become a live second session.
    await supabaseAdmin.auth.signOut({ scope: 'others' }).catch(() => undefined);
    return true;
  } catch (err: any) {
    logger.warn('Admin re-authentication failed', { userId, error: err.message });
    return false;
  }
}

/** Middleware: requires a fresh (≤5 min) password verification to continue. */
export function requireReAuthentication(req: AuthenticatedRequest, _res: Response, next: NextFunction): void {
  (async () => {
    try {
      const userId = req.user?.id;
      if (!userId) {
        throw AppError.unauthorized('Authentication required', 'REAUTH_REQUIRED');
      }

      if (isRecentlyReauthenticated(userId)) {
        next();
        return;
      }

      const password = req.headers['x-admin-password'] as string | undefined;
      if (!password) {
        throw AppError.unauthorized(
          'Re-authentication required: send your current password in the x-admin-password header.',
          'REAUTH_REQUIRED'
        );
      }

      const ok = await verifyAdminPassword(userId, password);
      if (!ok) {
        logger.warn('Admin re-authentication rejected', { userId });
        throw AppError.unauthorized('Password verification failed.', 'REAUTH_FAILED');
      }

      grantReAuthentication(userId);
      next();
    } catch (err) {
      next(err);
    }
  })();
}
