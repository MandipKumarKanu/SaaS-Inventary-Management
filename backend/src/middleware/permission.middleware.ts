import { Response, NextFunction } from 'express';
import { AppError } from '../shared/errors.js';
import { WorkspaceRequest } from '../shared/types.js';
import { logger } from '../config/logger.js';

/**
 * Permission middleware factory
 * Creates middleware that checks if the user has the required permission(s)
 * Must be used AFTER authMiddleware and workspaceMiddleware
 *
 * @param requiredPermissions - One or more permission codes to check
 * @param requireAll - If true, user must have ALL permissions. If false, any one suffices.
 */
export function requirePermission(
  requiredPermissions: string | string[],
  requireAll: boolean = true
) {
  const perms = Array.isArray(requiredPermissions) ? requiredPermissions : [requiredPermissions];

  return (req: WorkspaceRequest, _res: Response, next: NextFunction): void => {
    try {
      const userPermissions = req.membership?.permissions || [];

      const hasPermission = requireAll
        ? perms.every(p => userPermissions.includes(p))
        : perms.some(p => userPermissions.includes(p));

      if (!hasPermission) {
        logger.debug('Permission denied', {
          userId: req.user.id,
          workspaceId: req.workspace.id,
          required: perms,
          has: userPermissions,
        });
        throw AppError.forbidden(
          `You do not have the required permission: ${perms.join(', ')}`
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
