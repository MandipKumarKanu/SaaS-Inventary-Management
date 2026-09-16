import { Router, Request, Response, NextFunction } from 'express';
import { SalesService } from './sales.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createSOSchema = z.object({
  customerId: z.string().uuid().optional(),
  warehouseId: z.string().uuid(),
  shippingAddress: z.string().max(300).optional(),
  notes: z.string().max(500).optional(),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      variantId: z.string().uuid().optional(),
      orderedQty: z.number().int().positive(),
      unitPrice: z.number().min(0),
    })
  ).min(1),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.SALES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query.status as string | undefined;
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await SalesService.list(req.workspace!.id, status, { page, pageSize });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  requirePermission(PERMISSIONS.SALES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const so = await SalesService.getById(req.params.id as string, req.workspace!.id);
      res.json({ success: true, data: so });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requirePermission(PERMISSIONS.SALES_CREATE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createSOSchema.parse(req.body);
      const so = await SalesService.createSO({
        ...body,
        workspaceId: req.workspace!.id,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: so });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/fulfill',
  requirePermission(PERMISSIONS.SALES_FULFILL) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await SalesService.fulfillOrder(
        req.params.id as string,
        req.workspace!.id,
        req.user!.id,
        req.membership?.permissions || []
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// Phase 4: generic status route — per-transition permissions are enforced
// inside the service via the state machine (e.g. reserved → sales.reserve)
const updateStatusSchema = z.object({
  status: z.enum(['draft', 'confirmed', 'reserved', 'picking', 'packed', 'shipped', 'delivered', 'cancelled']),
});

router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.SALES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = updateStatusSchema.parse(req.body);
      const updated = await SalesService.updateStatus(
        req.params.id as string,
        req.workspace!.id,
        status,
        req.user!.id,
        req.membership?.permissions || []
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

export const salesRoutes = router;
