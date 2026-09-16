import { Router, Request, Response, NextFunction } from 'express';
import { SeedingService } from './seeding.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';

const router = Router({ mergeParams: true });

router.post(
  '/seed-demo-data',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await SeedingService.seedDemoData(req.workspace!.id, req.user!.id);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

export const seedingRoutes = router;
