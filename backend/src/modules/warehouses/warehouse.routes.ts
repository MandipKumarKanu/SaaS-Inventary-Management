import { Router, Request, Response, NextFunction } from 'express';
import { WarehouseService } from './warehouse.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { parsePagination } from '../../shared/http.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createWarehouseSchema = z.object({
  name: z.string().min(1).max(100),
  code: z.string().min(1).max(20),
  address: z.string().max(300).optional(),
  contactNumber: z.string().max(50).optional(),
});

const createLocationSchema = z.object({
  code: z.string().min(1).max(30),
  zone: z.string().optional(),
  rack: z.string().optional(),
  shelf: z.string().optional(),
  bin: z.string().optional(),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.WAREHOUSES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const includeArchived = req.query.includeArchived === 'true';
      const result = await WarehouseService.list(req.workspace!.id, { page, pageSize, includeArchived });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requirePermission(PERMISSIONS.WAREHOUSES_CREATE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createWarehouseSchema.parse(req.body);
      const warehouse = await WarehouseService.create({
        ...body,
        workspaceId: req.workspace!.id,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: warehouse });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/locations',
  requirePermission(PERMISSIONS.WAREHOUSES_UPDATE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createLocationSchema.parse(req.body);
      const location = await WarehouseService.addLocation(
        req.params.id as string,
        req.workspace!.id,
        body
      );
      res.status(201).json({ success: true, data: location });
    } catch (err) {
      next(err);
    }
  }
);

// Phase 5: soft delete — archives the warehouse (no hard-delete path exists)
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.WAREHOUSES_ARCHIVE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const warehouse = await WarehouseService.archive(req.params.id as string, req.workspace!.id, req.user!.id);
      res.json({ success: true, data: warehouse });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/restore',
  requirePermission(PERMISSIONS.WAREHOUSES_ARCHIVE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const warehouse = await WarehouseService.restore(req.params.id as string, req.workspace!.id, req.user!.id);
      res.json({ success: true, data: warehouse });
    } catch (err) {
      next(err);
    }
  }
);

export const warehouseRoutes = router;
