import { Router, Request, Response, NextFunction } from 'express';
import { AuthService } from './auth.service.js';
import { signupSchema, loginSchema, forgotPasswordSchema } from './auth.validators.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { AuthenticatedRequest } from '../../shared/types.js';
import { AuditService } from '../audit/audit.service.js';

const router = Router();

/**
 * POST /api/v1/auth/signup
 */
router.post('/signup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = signupSchema.parse(req.body);
    const result = await AuthService.signup(body);

    res.status(201).json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/login
 */
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = loginSchema.parse(req.body);
    const ip = req.ip || req.headers['x-forwarded-for'] as string;
    const result = await AuthService.login(body, ip);

    res.json({
      success: true,
      data: result,
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/logout
 * Supabase handles session invalidation client-side; we audit the event
 * server-side (PRD §41 audit list).
 */
router.post('/logout', authMiddleware as any, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    await AuditService.log({
      userId: authReq.user.id,
      action: 'user.logout',
      entity: 'user',
      entityId: authReq.user.id,
    });
    res.json({ success: true, data: { message: 'Logged out' } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/refresh
 */
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) {
      res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'refresh_token is required' } });
      return;
    }
    const result = await AuthService.refreshToken(refresh_token);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/auth/forgot-password
 */
router.post('/forgot-password', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = forgotPasswordSchema.parse(req.body);
    const result = await AuthService.forgotPassword(body.email);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/auth/me
 * Get current user profile (requires auth)
 */
router.get('/me', authMiddleware as any, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const profile = await AuthService.getProfile(authReq.user.id);
    res.json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/v1/auth/me
 * Update current user profile (requires auth)
 */
router.patch('/me', authMiddleware as any, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const { name, avatar_url } = req.body;
    const profile = await AuthService.updateProfile(authReq.user.id, { name, avatar_url });
    res.json({ success: true, data: profile });
  } catch (err) {
    next(err);
  }
});

export const authRoutes = router;
