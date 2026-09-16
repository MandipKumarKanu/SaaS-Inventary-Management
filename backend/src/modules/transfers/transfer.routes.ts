import { Router, Request, Response, NextFunction } from 'express';
import { TransferService } from './transfer.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createTransferSchema = z.object({
  sourceWarehouseId: z.string().uuid(),
  destinationWarehouseId: z.string().uuid(),
  notes: z.string().max(500).optional(),
  items: z.array(
    z.object({
      productId: z.string().uuid(),
      variantId: z.string().uuid().optional(),
      requestedQty: z.number().int().positive(),
    })
  ).min(1),
});

const updateStatusSchema = z.object({
  status: z.enum(['requested', 'approved', 'shipped', 'in_transit', 'completed', 'received', 'cancelled']),
  // Phase 6 (PRD §24): optional per-item quantities for PARTIAL ship/receive.
  // Omitted = legacy full-quantity behavior.
  items: z
    .array(
      z.object({
        itemId: z.string().uuid(),
        qty: z.number().int().positive(),
      })
    )
    .optional(),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.TRANSFERS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query.status as string | undefined;
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await TransferService.list(req.workspace!.id, status, { page, pageSize });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  requirePermission(PERMISSIONS.TRANSFERS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const transfer = await TransferService.getById(req.params.id as string, req.workspace!.id);
      res.json({ success: true, data: transfer });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requirePermission(PERMISSIONS.TRANSFERS_CREATE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createTransferSchema.parse(req.body);
      const transfer = await TransferService.create({
        ...body,
        workspaceId: req.workspace!.id,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: transfer });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id/status',
  requirePermission(PERMISSIONS.TRANSFERS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { status, items } = updateStatusSchema.parse(req.body);
      // Phase 4: per-transition permission enforced inside the service
      // (approve→transfers.approve, ship→transfers.ship, receive→transfers.receive)
      const updated = await TransferService.updateStatus(
        req.params.id as string,
        req.workspace!.id,
        status,
        req.user!.id,
        req.membership?.permissions || [],
        items
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

export const transferRoutes = router;
