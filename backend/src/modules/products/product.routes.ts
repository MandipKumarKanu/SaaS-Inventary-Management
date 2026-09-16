import { Router, Request, Response, NextFunction } from 'express';
import { ProductService } from './product.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createVariantSchema = z.object({
  sku: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  attributes: z.record(z.any()).optional(),
  costPrice: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
});

const createProductSchema = z.object({
  name: z.string().min(1).max(150),
  sku: z.string().min(1).max(50),
  barcode: z.string().max(50).optional(),
  categoryId: z.string().uuid().optional(),
  brandId: z.string().uuid().optional(),
  description: z.string().max(500).optional(),
  unit: z.string().default('pcs'),
  costPrice: z.number().min(0).optional(),
  sellingPrice: z.number().min(0).optional(),
  reorderPoint: z.number().min(0).optional(),
  minStock: z.number().min(0).optional(),
  maxStock: z.number().min(0).optional(),
  variants: z.array(createVariantSchema).optional(),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.PRODUCTS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 25;
      const search = req.query.search as string;
      const categoryId = req.query.categoryId as string;
      const brandId = req.query.brandId as string;
      const includeArchived = req.query.includeArchived === 'true';

      const result = await ProductService.list(req.workspace!.id, {
        page,
        pageSize,
        search,
        categoryId,
        brandId,
        includeArchived,
      });

      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/lookup',
  requirePermission(PERMISSIONS.PRODUCTS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const code = req.query.code as string;
      const result = await ProductService.lookupByCode(req.workspace!.id, code);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/:id',
  requirePermission(PERMISSIONS.PRODUCTS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const product = await ProductService.getById(req.params.id as string, req.workspace!.id);
      res.json({ success: true, data: product });
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
      const body = createProductSchema.parse(req.body);
      const product = await ProductService.create({
        ...body,
        workspaceId: req.workspace!.id,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: product });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id',
  requirePermission(PERMISSIONS.PRODUCTS_UPDATE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const product = await ProductService.update(
        req.params.id as string,
        req.workspace!.id,
        req.body,
        req.user!.id
      );
      res.json({ success: true, data: product });
    } catch (err) {
      next(err);
    }
  }
);

// Phase 5: soft delete — archives the product (no hard-delete path exists)
router.delete(
  '/:id',
  requirePermission(PERMISSIONS.PRODUCTS_ARCHIVE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const product = await ProductService.archive(req.params.id as string, req.workspace!.id, req.user!.id);
      res.json({ success: true, data: product });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:id/restore',
  requirePermission(PERMISSIONS.PRODUCTS_ARCHIVE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const product = await ProductService.restore(req.params.id as string, req.workspace!.id, req.user!.id);
      res.json({ success: true, data: product });
    } catch (err) {
      next(err);
    }
  }
);

export const productRoutes = router;
