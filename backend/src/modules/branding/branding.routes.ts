import { Router, Request, Response, NextFunction } from 'express';
import { BrandingService } from './branding.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const updateBrandingSchema = z.object({
  company_name: z.string().optional(),
  logo_url: z.string().optional(),
  primary_color: z.string().default('#6366f1'),
  accent_color: z.string().default('#10b981'),
  company_address: z.string().optional(),
  tax_id: z.string().optional(),
  invoice_footer_text: z.string().optional(),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const branding = await BrandingService.getBranding(req.workspace!.id);
      res.json({ success: true, data: branding });
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
      const parsed = updateBrandingSchema.parse(req.body);
      const updated = await BrandingService.updateBranding(req.workspace!.id, parsed);
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

export const brandingRoutes = router;
