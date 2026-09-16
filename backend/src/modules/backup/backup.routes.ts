import { Router, Request, Response, NextFunction } from 'express';
import { BackupService } from './backup.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';

const router = Router({ mergeParams: true });

router.get(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || undefined;
      const pageSize = parseInt(req.query.pageSize as string) || undefined;
      const result = await BackupService.listBackups(req.workspace!.id, { page, pageSize });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/export',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const backup = await BackupService.createBackup(req.workspace!.id, req.user!.id);
      res.status(201).json({ success: true, data: backup });
    } catch (err) {
      next(err);
    }
  }
);

export const backupRoutes = router;
