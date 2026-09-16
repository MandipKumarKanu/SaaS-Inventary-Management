import { Router, Request, Response, NextFunction } from 'express';
import { BrandService } from './brand.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createBrandSchema = z.object({
  name: z.string().min(1).max(100),
  logoUrl: z.string().url().optional(),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.PRODUCTS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const brands = await BrandService.list(req.workspace!.id);
      res.json({ success: true, data: brands });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requirePermission(PERMISSIONS.PRODUCTS_CREATE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createBrandSchema.parse(req.body);
      const brand = await BrandService.create({
        workspaceId: req.workspace!.id,
        name: body.name,
        logoUrl: body.logoUrl,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: brand });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requirePermission(PERMISSIONS.PRODUCTS_ARCHIVE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await BrandService.delete(req.params.id as string, req.workspace!.id, req.user!.id);
      res.json({ success: true, data: { message: 'Brand deleted' } });
    } catch (err) {
      next(err);
    }
  }
);

export const brandRoutes = router;
