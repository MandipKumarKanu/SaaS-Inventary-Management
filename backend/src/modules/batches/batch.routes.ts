import { Router, Request, Response, NextFunction } from 'express';
import { BatchService } from './batch.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createBatchSchema = z.object({
  productId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  batchNumber: z.string().min(1).max(100),
  mfgDate: z.string().optional(),
  expiryDate: z.string().optional(),
  // Phase 6: a batch create MOVES stock — zero-quantity batches are meaningless
  quantity: z.number().int().positive(),
  variantId: z.string().uuid().optional(),
});

const adjustBatchSchema = z.object({
  qtyChange: z.number().int().refine((v) => v !== 0, 'qtyChange must be non-zero'),
  reason: z.enum(['damaged', 'expired', 'adjustment']),
  notes: z.string().max(500).optional(),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.INVENTORY_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const warehouseId = req.query.warehouseId as string | undefined;
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await BatchService.list(req.workspace!.id, warehouseId, { page, pageSize });
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
      const batch = await BatchService.getById(req.params.id as string, req.workspace!.id);
      res.json({ success: true, data: batch });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requirePermission(PERMISSIONS.INVENTORY_ADJUST) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createBatchSchema.parse(req.body);
      const batch = await BatchService.create({
        ...body,
        workspaceId: req.workspace!.id,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: batch });
    } catch (err) {
      next(err);
    }
  }
);

// Phase 6 (PRD §33): batch write-offs / corrections move real stock
router.post(
  '/:id/adjust',
  requirePermission(PERMISSIONS.INVENTORY_ADJUST) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = adjustBatchSchema.parse(req.body);
      const batch = await BatchService.adjust(req.params.id as string, {
        ...body,
        workspaceId: req.workspace!.id,
        userId: req.user!.id,
      });
      res.json({ success: true, data: batch });
    } catch (err) {
      next(err);
    }
  }
);

export const batchRoutes = router;
