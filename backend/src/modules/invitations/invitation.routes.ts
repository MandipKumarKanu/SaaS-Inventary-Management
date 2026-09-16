import { Router, Request, Response, NextFunction } from 'express';
import { InvitationService } from './invitation.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { authMiddleware } from '../../middleware/auth.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createInvitationSchema = z.object({
  email: z.string().email(),
  roleId: z.string().uuid().optional(),
  customPermissions: z.array(z.string()).optional(),
});

/**
 * GET /api/v1/workspaces/:workspaceId/invitations
 */
router.get(
  '/',
  requirePermission(PERMISSIONS.TEAM_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invitations = await InvitationService.listForWorkspace(req.workspace!.id);
      res.json({ success: true, data: invitations });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/workspaces/:workspaceId/invitations
 */
router.post(
  '/',
  requirePermission(PERMISSIONS.TEAM_INVITE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = createInvitationSchema.parse(req.body);
      const invitation = await InvitationService.create({
        email: body.email,
        workspaceId: req.workspace!.id,
        invitedBy: req.user!.id,
        roleId: body.roleId,
        customPermissions: body.customPermissions,
      });
      res.status(201).json({ success: true, data: invitation });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/v1/workspaces/:workspaceId/invitations/:invitationId
 * Revoke invitation
 */
router.delete(
  '/:invitationId',
  requirePermission(PERMISSIONS.TEAM_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invitationId = req.params.invitationId as string;
      await InvitationService.revoke(invitationId, req.workspace!.id, req.user!.id);
      res.json({ success: true, data: { message: 'Invitation revoked' } });
    } catch (err) {
      next(err);
    }
  }
);

// ==============================
// User-facing invitation routes (not workspace-scoped)
// These are mounted separately at /api/v1/invitations
// ==============================
const userInvitationRouter = Router();

/**
 * GET /api/v1/invitations
 * List pending invitations for the current user
 */
userInvitationRouter.get(
  '/',
  authMiddleware as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invitations = await InvitationService.listForUser(req.user!.email);
      res.json({ success: true, data: invitations });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/v1/invitations/:invitationId/accept
 * Accept an invitation
 */
userInvitationRouter.post(
  '/:invitationId/accept',
  authMiddleware as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const invitationId = req.params.invitationId as string;
      const result = await InvitationService.accept(
        invitationId,
        req.user!.id,
        req.user!.email
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

export const invitationRoutes = router;
export const userInvitationRoutes = userInvitationRouter;
