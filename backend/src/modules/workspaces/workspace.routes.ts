import { Router, Request, Response, NextFunction } from 'express';
import { WorkspaceService } from './workspace.service.js';
import { createWorkspaceSchema, updateWorkspaceSchema } from './workspace.validators.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { workspaceMiddleware } from '../../middleware/workspace.middleware.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { AuthenticatedRequest, WorkspaceRequest } from '../../shared/types.js';
import { PERMISSIONS } from '../../shared/permissions.js';

const router = Router();

/**
 * GET /api/v1/workspaces
 * List current user's workspaces
 */
router.get('/', authMiddleware as any, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const workspaces = await WorkspaceService.listForUser(authReq.user.id);
    res.json({ success: true, data: workspaces });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/workspaces/check-slug
 * Check if a workspace slug is available
 */
router.get('/check-slug', authMiddleware as any, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = (req.query.slug as string || '').trim();
    if (!slug) {
      return res.status(400).json({
        success: false,
        error: { message: 'Slug query parameter is required' },
      });
    }
    const result = await WorkspaceService.checkSlug(slug);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/v1/workspaces
 * Create a new workspace
 */
router.post('/', authMiddleware as any, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const body = createWorkspaceSchema.parse(req.body);
    const workspace = await WorkspaceService.create({
      name: body.name,
      slug: body.slug,
      currency: body.currency,
      userId: authReq.user.id,
    });
    res.status(201).json({ success: true, data: workspace });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/v1/workspaces/:workspaceId
 * Get workspace details (requires membership)
 */
router.get(
  '/:workspaceId',
  authMiddleware as any,
  workspaceMiddleware as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wsReq = req as unknown as WorkspaceRequest;
      const workspace = await WorkspaceService.getByIdOrSlug(wsReq.workspace.id);
      res.json({ success: true, data: workspace });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/v1/workspaces/:workspaceId
 * Update workspace (requires settings.manage)
 */
router.patch(
  '/:workspaceId',
  authMiddleware as any,
  workspaceMiddleware as any,
  requirePermission(PERMISSIONS.SETTINGS_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wsReq = req as unknown as WorkspaceRequest;
      const body = updateWorkspaceSchema.parse(req.body);
      const workspace = await WorkspaceService.update(wsReq.workspace.id, wsReq.user.id, body);
      res.json({ success: true, data: workspace });
    } catch (err) {
      next(err);
    }
  }
);

export const workspaceRoutes = router;
