import { Router, Request, Response, NextFunction } from 'express';
import { CategoryService } from './category.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createCategorySchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100),
  parentId: z.string().uuid().optional(),
  description: z.string().max(300).optional(),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.PRODUCTS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await CategoryService.list(req.workspace!.id, { page, pageSize });
      res.json({ success: true, ...result });
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
      const body = createCategorySchema.parse(req.body);
      const category = await CategoryService.create({
        workspaceId: req.workspace!.id,
        name: body.name,
        slug: body.slug,
        parentId: body.parentId,
        description: body.description,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: category });
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
      await CategoryService.delete(req.params.id as string, req.workspace!.id, req.user!.id);
      res.json({ success: true, data: { message: 'Category deleted' } });
    } catch (err) {
      next(err);
    }
  }
);

export const categoryRoutes = router;
