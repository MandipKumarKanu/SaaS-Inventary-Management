import { Router, Request, Response, NextFunction } from 'express';
import { ImportService } from './import.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const importProductsSchema = z.object({
  // Phase 8 (PRD §43): dry-run preview — run every check, write nothing.
  mode: z.enum(['validate', 'commit']).default('commit'),
  rows: z.array(
    z.object({
      name: z.string().min(1),
      sku: z.string().min(1),
      barcode: z.string().optional(),
      costPrice: z.number().optional(),
      sellingPrice: z.number().optional(),
      unit: z.string().optional(),
      reorderPoint: z.number().optional(),
    })
  ).min(1),
});

router.post(
  '/products',
  requirePermission(PERMISSIONS.PRODUCTS_CREATE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { rows, mode } = importProductsSchema.parse(req.body);
      const result = await ImportService.importProducts(
        req.workspace!.id,
        rows,
        req.user!.id,
        mode
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

export const importRoutes = router;
