import { Router, Request, Response, NextFunction } from 'express';
import { ReturnService } from './return.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createReturnSchema = z.object({
  salesOrderId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
  warehouseId: z.string().uuid(),
  notes: z.string().max(500).optional(),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      variantId: z.string().uuid().optional(),
      returnedQty: z.number().int().positive(),
      reason: z.string().optional(),
      condition: z.enum(['resellable', 'damaged', 'defective']).optional(),
    })
  ).min(1),
});

const restockSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.string().uuid(),
      restockQty: z.number().int().nonnegative(),
    })
  ).min(1),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.RETURNS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query.status as string | undefined;
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await ReturnService.list(req.workspace!.id, status, { page, pageSize });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  requirePermission(PERMISSIONS.RETURNS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const ret = await ReturnService.getById(req.params.id as string, req.workspace!.id);
      res.json({ success: true, data: ret });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requirePermission(PERMISSIONS.RETURNS_CREATE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createReturnSchema.parse(req.body);
      const ret = await ReturnService.createReturn({
        ...body,
        workspaceId: req.workspace!.id,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: ret });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/restock',
  requirePermission(PERMISSIONS.RETURNS_RESTOCK) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { items } = restockSchema.parse(req.body);
      const updated = await ReturnService.inspectAndRestock(
        req.params.id as string,
        req.workspace!.id,
        items,
        req.user!.id,
        req.membership?.permissions || []
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

export const returnRoutes = router;
