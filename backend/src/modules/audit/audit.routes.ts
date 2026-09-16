import { Router, Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../../config/supabase.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { requirePermission } from '../../middleware/permission.middleware.js';

const router = Router();

/**
 * GET /audit-logs
 * List audit logs for the workspace (paginated)
 */
router.get(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = Math.min(parseInt(req.query.pageSize as string) || 25, 100);
      const action = req.query.action as string;
      const entity = req.query.entity as string;

      let query = supabaseAdmin
        .from('audit_logs')
        .select('*, user:users(id, name, email)', { count: 'exact' })
        .eq('workspace_id', req.workspace!.id)
        .order('created_at', { ascending: false })
        .range((page - 1) * pageSize, page * pageSize - 1);

      if (action) query = query.eq('action', action);
      if (entity) query = query.eq('entity', entity);

      const { data, error, count } = await query;

      if (error) throw error;

      res.json({
        success: true,
        data,
        meta: {
          page,
          pageSize,
          total: count || 0,
          totalPages: Math.ceil((count || 0) / pageSize),
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export const auditRoutes = router;
