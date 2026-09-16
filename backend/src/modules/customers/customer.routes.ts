import { Router, Request, Response, NextFunction } from 'express';
import { CustomerService } from './customer.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createCustomerSchema = z.object({
  name: z.string().min(1).max(150),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().max(50).optional(),
  address: z.string().max(300).optional(),
  taxId: z.string().max(50).optional(),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.SALES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await CustomerService.list(req.workspace!.id, { page, pageSize });
      res.json({ success: true, ...result });
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
      const body = createCustomerSchema.parse(req.body);
      const customer = await CustomerService.create({
        ...body,
        workspaceId: req.workspace!.id,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: customer });
    } catch (err) {
      next(err);
    }
  }
);

export const customerRoutes = router;
