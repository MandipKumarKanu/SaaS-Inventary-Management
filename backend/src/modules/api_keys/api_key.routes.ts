import { Router, Request, Response, NextFunction } from 'express';
import { APIKeyService } from './api_key.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createKeySchema = z.object({
  name: z.string().min(1).max(100),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await APIKeyService.list(req.workspace!.id, { page, pageSize });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { name } = createKeySchema.parse(req.body);
      const key = await APIKeyService.createKey(req.workspace!.id, name);
      res.status(201).json({ success: true, data: key });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await APIKeyService.revokeKey(req.params.id as string, req.workspace!.id);
      res.json({ success: true, data: { message: 'API key revoked' } });
    } catch (err) {
      next(err);
    }
  }
);

export const apiKeyRoutes = router;
