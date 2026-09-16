import { Router, Request, Response, NextFunction } from 'express';
import { AnalyticsService } from './analytics.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { requireFeature } from '../../middleware/feature.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';

const router = Router({ mergeParams: true });

router.get(
  '/abc',
  requirePermission(PERMISSIONS.REPORTS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const abc = await AnalyticsService.getABCAnalysis(req.workspace!.id);
      res.json({ success: true, data: abc });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/forecast',
  requirePermission(PERMISSIONS.REPORTS_VIEW) as any,
  requireFeature('forecasting') as any, // PRD §16: Starter plan rejected server-side
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Clamp: forecast horizon is bounded to keep the query plan sane
      const days = Math.min(Math.max(parseInt(req.query.days as string, 10) || 30, 7), 365);
      const forecast = await AnalyticsService.getDemandForecast(req.workspace!.id, days);
      res.json({ success: true, data: forecast });
    } catch (err) {
      next(err);
    }
  }
);

router.get(
  '/executive-report',
  requirePermission(PERMISSIONS.REPORTS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await AnalyticsService.getExecutiveReport(req.workspace!.id);
      res.json({ success: true, data: report });
    } catch (err) {
      next(err);
    }
  }
);

export const analyticsRoutes = router;
