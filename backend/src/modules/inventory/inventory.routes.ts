import { Router, Request, Response, NextFunction } from 'express';
import { InventoryService } from './inventory.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { parsePagination } from '../../shared/http.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const adjustStockSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().uuid().optional(),
  warehouseId: z.string().uuid(),
  locationId: z.string().uuid().optional(),
  qtyChange: z.number().int().refine((val) => val !== 0, { message: 'Quantity change must be non-zero' }),
  movementType: z.enum([
    'opening_balance', 'adjustment', 'purchase_received', 'sales_shipped',
    'transfer_in', 'transfer_out', 'return', 'customer_return',
    'damaged', 'expired', 'stock_count_correction',
  ]),
  referenceType: z.string().optional(),
  referenceId: z.string().uuid().optional(),
  notes: z.string().max(500).optional(),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.INVENTORY_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const productId = req.query.productId as string;
      const warehouseId = req.query.warehouseId as string;
      const levels = await InventoryService.getStockLevels(req.workspace!.id, { productId, warehouseId });
      res.json({ success: true, data: levels });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/adjust',
  requirePermission(PERMISSIONS.INVENTORY_ADJUST) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = adjustStockSchema.parse(req.body);
      const result = await InventoryService.adjustStock({
        ...body,
        workspaceId: req.workspace!.id,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/transactions',
  requirePermission(PERMISSIONS.INVENTORY_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const productId = req.query.productId as string;
      const warehouseId = req.query.warehouseId as string;
      const movementType = req.query.movementType as string;

      const result = await InventoryService.getLedgerHistory(req.workspace!.id, {
        page,
        pageSize,
        productId,
        warehouseId,
        movementType,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

export const inventoryRoutes = router;
