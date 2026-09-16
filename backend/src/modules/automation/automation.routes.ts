import { Router, Request, Response, NextFunction } from 'express';
import { AutomationService } from './automation.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createRuleSchema = z.object({
  name: z.string().min(1),
  triggerEvent: z.string().min(1),
  actionType: z.string().min(1),
  conditions: z.record(z.any()).default({}),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const rules = await AutomationService.listRules(req.workspace!.id);
      res.json({ success: true, data: rules });
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
      const { name, triggerEvent, actionType, conditions } = createRuleSchema.parse(req.body);
      const rule = await AutomationService.createRule(req.workspace!.id, name, triggerEvent, actionType, conditions);
      res.status(201).json({ success: true, data: rule });
    } catch (err) {
      next(err);
    }
  }
);

router.patch(
  '/:id/toggle',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { isActive } = z.object({ isActive: z.boolean() }).parse(req.body);
      const updated = await AutomationService.toggleRule(req.workspace!.id, req.params.id as string, isActive);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

export const automationRoutes = router;
