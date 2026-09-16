import { Router, Request, Response, NextFunction } from 'express';
import { ReorderService } from './reorder.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { parsePagination } from '../../shared/http.js';

const router = Router({ mergeParams: true });

router.get(
  '/',
  requirePermission(PERMISSIONS.PURCHASES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const urgency = (req.query.urgency as string) || undefined;
      const result = await ReorderService.getRecommendations(req.workspace!.id, { page, pageSize, urgency });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

export const reorderRoutes = router;
