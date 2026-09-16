import { Router, Request, Response, NextFunction } from 'express';
import { SupplierService } from './supplier.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createSupplierSchema = z.object({
  name: z.string().min(1).max(150),
  contactName: z.string().max(100).optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  address: z.string().max(300).optional(),
  taxId: z.string().max(50).optional(),
  paymentTerms: z.string().max(50).optional(),
  leadTimeDays: z.number().int().nonnegative().optional(),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.PURCHASES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await SupplierService.list(req.workspace!.id, { page, pageSize });
      res.json({ success: true, ...result });
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
      const body = createSupplierSchema.parse(req.body);
      const supplier = await SupplierService.create({
        ...body,
        workspaceId: req.workspace!.id,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: supplier });
    } catch (err) {
      next(err);
    }
  }
);

export const supplierRoutes = router;
