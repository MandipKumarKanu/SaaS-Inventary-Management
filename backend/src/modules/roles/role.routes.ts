import { Router, Request, Response, NextFunction } from 'express';
import { RoleService } from './role.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createRoleSchema = z.object({
  name: z.string().min(1).max(50),
  description: z.string().max(200).optional(),
  permissionCodes: z.array(z.string()),
});

const updateRoleSchema = z.object({
  name: z.string().min(1).max(50).optional(),
  description: z.string().max(200).optional(),
  permissionCodes: z.array(z.string()).optional(),
});

/**
 * GET /api/v1/workspaces/:workspaceId/roles
 */
router.get(
  '/',
  requirePermission(PERMISSIONS.ROLES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roles = await RoleService.list(req.workspace!.id);
      res.json({ success: true, data: roles });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/v1/workspaces/:workspaceId/roles/:roleId
 */
router.get(
  '/:roleId',
  requirePermission(PERMISSIONS.ROLES_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roleId = req.params.roleId as string;
      const role = await RoleService.getById(roleId, req.workspace!.id);
      res.json({ success: true, data: role });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/workspaces/:workspaceId/roles
 */
router.post(
  '/',
  requirePermission(PERMISSIONS.ROLES_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createRoleSchema.parse(req.body);
      const role = await RoleService.create({
        workspaceId: req.workspace!.id,
        name: body.name,
        description: body.description,
        permissionCodes: body.permissionCodes,
        userId: req.user!.id,
      });
      res.status(201).json({ success: true, data: role });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/workspaces/:workspaceId/roles/:roleId
 */
router.patch(
  '/:roleId',
  requirePermission(PERMISSIONS.ROLES_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roleId = req.params.roleId as string;
      const body = updateRoleSchema.parse(req.body);
      const role = await RoleService.update(roleId, req.workspace!.id, body, req.user!.id);
      res.json({ success: true, data: role });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/workspaces/:workspaceId/roles/:roleId
 */
router.delete(
  '/:roleId',
  requirePermission(PERMISSIONS.ROLES_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roleId = req.params.roleId as string;
      await RoleService.delete(roleId, req.workspace!.id, req.user!.id);
      res.json({ success: true, data: { message: 'Role deleted' } });
    } catch (err) {
      next(err);
    }
  }
);

// ==============================
// Permissions listing (globally accessible, not workspace-scoped)
// Mounted at /api/v1/permissions
// ==============================
const permissionsRouter = Router();

/**
 * GET /api/v1/permissions
 * List all available permissions
 */
permissionsRouter.get(
  '/',
  authMiddleware as any,
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const permissions = await RoleService.listPermissions();
      res.json({ success: true, data: permissions });
    } catch (err) {
      next(err);
    }
  }
);

export const roleRoutes = router;
export const permissionsRoutes = permissionsRouter;
