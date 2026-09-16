import { Router, Request, Response, NextFunction } from 'express';
import { AdminService } from './admin.service.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requirePlatformAdmin } from '../../middleware/platform-admin.middleware.js';

const router = Router();

// Phase 0 hardening (PRD §14, §58): the platform admin area is a separate
// administration surface and must never be reachable without both
// authentication and an explicit platform-admin grant.
router.use(authMiddleware as any);
router.use(requirePlatformAdmin as any);

router.get('/check-access', (req: Request, res: Response) => {
  res.json({ success: true, is_platform_admin: true });
});

router.get(
  '/overview',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const overview = await AdminService.getPlatformOverview();
      res.json({ success: true, data: overview });
    } catch (err) {
      next(err);
    }
  }
);

export const adminRoutes = router;
