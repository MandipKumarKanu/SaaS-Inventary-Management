import { Router, Request, Response, NextFunction } from 'express';
import { MonitoringService } from './monitoring.service.js';
import { getMetricsSnapshot } from '../../middleware/metrics.middleware.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { requirePlatformAdmin } from '../../middleware/platform-admin.middleware.js';

const router = Router();

// Phase 0 hardening: monitoring exposes infrastructure internals (memory,
// uptime, DB latency, worker job logs). This belongs to the platform admin
// area (PRD §14 "System health") and must not be public.
router.use(authMiddleware as any);
router.use(requirePlatformAdmin as any);

// GET /api/v1/monitoring/health
router.get('/health', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const health = await MonitoringService.getSystemHealth();
    res.json({ success: true, data: health });
  } catch (err) {
    next(err);
  }
});

// GET /api/v1/monitoring/metrics — real, measured request metrics
router.get('/metrics', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({ success: true, data: getMetricsSnapshot() });
  } catch (err) {
    next(err);
  }
});

export const monitoringRoutes = router;
