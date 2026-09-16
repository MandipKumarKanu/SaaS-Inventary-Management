import { Router, Request, Response, NextFunction } from 'express';
import { CountService } from './count.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createCountSchema = z.object({
  warehouseId: z.string().uuid(),
  notes: z.string().max(500).optional(),
});

const submitCountsSchema = z.object({
  items: z.array(
    z.object({
      itemId: z.string().uuid(),
      physicalQty: z.number().int().nonnegative(),
      notes: z.string().optional(),
    })
  ).min(1),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.INVENTORY_COUNT) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const status = req.query.status as string | undefined;
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await CountService.list(req.workspace!.id, status, { page, pageSize });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  requirePermission(PERMISSIONS.INVENTORY_COUNT) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await CountService.getById(req.params.id as string, req.workspace!.id);
      res.json({ success: true, data: count });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requirePermission(PERMISSIONS.INVENTORY_COUNT) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createCountSchema.parse(req.body);
      const count = await CountService.createCountSheet({
        ...body,
        workspaceId: req.workspace!.id,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: count });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/submit',
  requirePermission(PERMISSIONS.INVENTORY_COUNT) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { items } = submitCountsSchema.parse(req.body);
      const updated = await CountService.submitPhysicalCounts(
        req.params.id as string,
        req.workspace!.id,
        items,
        req.user!.id
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/approve',
  requirePermission(PERMISSIONS.INVENTORY_ADJUST) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await CountService.approveCount(
        req.params.id as string,
        req.workspace!.id,
        req.user!.id,
        req.membership?.permissions || [] // Phase 4: state machine checks inventory.count
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

export const countRoutes = router;
