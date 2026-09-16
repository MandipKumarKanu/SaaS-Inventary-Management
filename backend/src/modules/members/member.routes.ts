import { Router, Request, Response, NextFunction } from 'express';
import { MemberService } from './member.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';

const router = Router({ mergeParams: true });

/**
 * GET /api/v1/workspaces/:workspaceId/members
 */
router.get(
  '/',
  requirePermission(PERMISSIONS.TEAM_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 25;
      const result = await MemberService.list(req.workspace!.id, page, pageSize);
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/workspaces/:workspaceId/members/me
 * Current user's membership + effective permissions (app shell bootstrap).
 * No TEAM_VIEW gate: every active member needs their own permission set.
 * Must be registered BEFORE /:memberId so "me" isn't treated as an id.
 */
router.get(
  '/me',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const member = await MemberService.getMe(req.user!.id, req.workspace!.id);
      res.json({ success: true, data: member });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/workspaces/:workspaceId/members/:memberId
 */
router.get(
  '/:memberId',
  requirePermission(PERMISSIONS.TEAM_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const memberId = req.params.memberId as string;
      const member = await MemberService.getById(memberId, req.workspace!.id);
      res.json({ success: true, data: member });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/v1/workspaces/:workspaceId/members/:memberId/roles
 */
router.put(
  '/:memberId/roles',
  requirePermission(PERMISSIONS.TEAM_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const memberId = req.params.memberId as string;
      const { roleIds } = req.body;
      if (!Array.isArray(roleIds)) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'roleIds must be an array' } });
        return;
      }
      const member = await MemberService.updateRoles(memberId, req.workspace!.id, roleIds, req.user!.id);
      res.json({ success: true, data: member });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/v1/workspaces/:workspaceId/members/:memberId/permissions
 */
router.put(
  '/:memberId/permissions',
  requirePermission(PERMISSIONS.TEAM_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const memberId = req.params.memberId as string;
      const { permissions } = req.body;
      if (!Array.isArray(permissions)) {
        res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'permissions must be an array of permission codes' } });
        return;
      }
      const member = await MemberService.updateDirectPermissions(memberId, req.workspace!.id, permissions, req.user!.id);
      res.json({ success: true, data: member });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/workspaces/:workspaceId/members/:memberId
 */
router.delete(
  '/:memberId',
  requirePermission(PERMISSIONS.TEAM_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const memberId = req.params.memberId as string;
      await MemberService.remove(memberId, req.workspace!.id, req.user!.id);
      res.json({ success: true, data: { message: 'Member removed' } });
    } catch (err) {
      next(err);
    }
  }
);

export const memberRoutes = router;
