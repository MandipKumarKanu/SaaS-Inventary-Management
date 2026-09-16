import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../shared/errors.js';
import { AuthenticatedRequest } from '../shared/types.js';
import { logger } from '../config/logger.js';

/**
 * Authentication middleware
 * Verifies the Supabase JWT from the Authorization header
 * Attaches user info to req.user
 */
export async function authMiddleware(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw AppError.unauthorized('Missing or invalid authorization header');
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      throw AppError.unauthorized('Missing access token');
    }

    // Verify token with Supabase
    const { data: { user }, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !user) {
      logger.debug('Auth token verification failed', { error: error?.message });
      throw AppError.unauthorized('Invalid or expired token');
    }

    // Attach user and token to request
    const authReq = req as AuthenticatedRequest;
    authReq.user = {
      id: user.id,
      email: user.email!,
    };
    authReq.accessToken = token;

    next();
  } catch (err) {
    next(err);
  }
}
