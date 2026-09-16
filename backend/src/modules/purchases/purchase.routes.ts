import { Router, Request, Response, NextFunction } from 'express';
import { PurchaseService } from './purchase.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createPOSchema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  expectedDeliveryDate: z.string().optional(),
  notes: z.string().max(500).optional(),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      variantId: z.string().uuid().optional(),
      orderedQty: z.number().int().positive(),
      unitCost: z.number().min(0),
    })
  ).min(1),
});

const receiveItemsSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.string().uuid(),
      qtyToReceive: z.number().int().positive(),
    })
  ).min(1),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.PURCHASES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query.status as string | undefined;
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await PurchaseService.list(req.workspace!.id, status, { page, pageSize });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  requirePermission(PERMISSIONS.PURCHASES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const po = await PurchaseService.getById(req.params.id as string, req.workspace!.id);
      res.json({ success: true, data: po });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requirePermission(PERMISSIONS.PURCHASES_CREATE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createPOSchema.parse(req.body);
      const po = await PurchaseService.createPO({
        ...body,
        workspaceId: req.workspace!.id,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: po });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/receive',
  requirePermission(PERMISSIONS.PURCHASES_RECEIVE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { items } = receiveItemsSchema.parse(req.body);
      const updated = await PurchaseService.receiveItems(
        req.params.id as string,
        req.workspace!.id,
        items,
        req.user!.id,
        req.membership?.permissions || [] // Phase 4: state machine re-checks per transition
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

// Phase 4: generic status route — per-transition permissions are enforced
// inside the service via the state machine (e.g. approved → purchases.approve)
const updateStatusSchema = z.object({
  status: z.enum(['draft', 'pending_approval', 'approved', 'ordered', 'partially_received', 'received', 'closed', 'cancelled']),
});

router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.PURCHASES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status } = updateStatusSchema.parse(req.body);
      const updated = await PurchaseService.updateStatus(
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

export const purchaseRoutes = router;
