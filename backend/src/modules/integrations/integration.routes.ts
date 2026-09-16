import { Router, Request, Response, NextFunction } from 'express';
import { IntegrationService } from './integration.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const connectSchema = z.object({
  provider: z.enum(['shopify', 'woocommerce', 'amazon', 'easypost']),
  name: z.string().min(1),
  credentials: z.record(z.any()).default({}),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const connections = await IntegrationService.listConnections(req.workspace!.id);
      res.json({ success: true, data: connections });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/connect',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { provider, name, credentials } = connectSchema.parse(req.body);
      const conn = await IntegrationService.connectProvider(req.workspace!.id, provider, name, credentials);
      res.json({ success: true, data: conn });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:provider/disconnect',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await IntegrationService.disconnectProvider(req.workspace!.id, req.params.provider as string);
      res.json({ success: true, data: { message: 'Provider disconnected' } });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/:provider/sync',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await IntegrationService.triggerSync(req.workspace!.id, req.params.provider as string);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

export const integrationRoutes = router;
