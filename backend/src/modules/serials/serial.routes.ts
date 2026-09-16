import { Router, Request, Response, NextFunction } from 'express';
import { SerialService } from './serial.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';

const router = Router({ mergeParams: true });

router.get(
  '/',
  requirePermission(PERMISSIONS.INVENTORY_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await SerialService.list(
        req.workspace!.id,
        {
          productId: req.query.productId as string | undefined,
          warehouseId: req.query.warehouseId as string | undefined,
          status: req.query.status as string | undefined,
          search: req.query.search as string | undefined,
        },
        { page, pageSize }
      );
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  requirePermission(PERMISSIONS.INVENTORY_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const serial = await SerialService.getById(req.params.id as string, req.workspace!.id);
      res.json({ success: true, data: serial });
    } catch (err) {
      next(err);
    }
  }
);

// Lifecycle mutations are driven by operational events (PO receipt, SO
// fulfillment, transfers, returns) — no direct mutation endpoint by design.

export const serialRoutes = router;
