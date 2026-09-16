import { Router, Request, Response, NextFunction } from 'express';
import { NotificationService } from './notification.service.js';
import { parsePagination } from '../../shared/http.js';

const router = Router({ mergeParams: true });

router.get(
  '/',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const severity = (req.query.severity as string) || undefined;
      const result = await NotificationService.getWorkspaceNotifications(req.workspace!.id, { page, pageSize, severity });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

export const notificationRoutes = router;
