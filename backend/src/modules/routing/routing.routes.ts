import { Router, Request, Response, NextFunction } from 'express';
import { RoutingService } from './routing.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { parsePagination } from '../../shared/http.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createRuleSchema = z.object({
  destinationRegion: z.string().min(1),
  preferredWarehouseId: z.string().uuid(),
  priority: z.number().int().positive().default(1),
});

const optimizeSchema = z.object({
  destinationRegion: z.string().min(1),
  productId: z.string().uuid(),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.WAREHOUSES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const result = await RoutingService.listRules(req.workspace!.id, { page, pageSize });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requirePermission(PERMISSIONS.WAREHOUSES_UPDATE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { destinationRegion, preferredWarehouseId, priority } = createRuleSchema.parse(req.body);
      const rule = await RoutingService.createRule(
        req.workspace!.id,
        destinationRegion,
        preferredWarehouseId,
        priority
      );
      res.status(201).json({ success: true, data: rule });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/optimize',
  requirePermission(PERMISSIONS.WAREHOUSES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { destinationRegion, productId } = optimizeSchema.parse(req.body);
      const result = await RoutingService.optimizeFulfillmentLocation(
        req.workspace!.id,
        destinationRegion,
        productId
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

export const routingRoutes = router;
