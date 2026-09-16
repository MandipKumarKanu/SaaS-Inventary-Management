import { Router, Request, Response, NextFunction } from 'express';
import { SecurityService } from './security.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';

const router = Router({ mergeParams: true });

router.get(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 50, 100);
      const result = await SecurityService.listEvents(req.workspace!.id, { page, pageSize });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

export const securityRoutes = router;
