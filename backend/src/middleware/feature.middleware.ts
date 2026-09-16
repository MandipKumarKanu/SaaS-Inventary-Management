import { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../shared/errors.js';
import { PlanCatalogService, FeatureKey } from '../services/plan-catalog.service.js';

/**
 * Phase 3: plan feature gating (PRD §16).
 *
 * Checks the workspace's subscription → plan → features JSONB. Additive to
 * permission checks: permissions ask "may this USER do this?", features ask
 * "does this WORKSPACE'S PLAN include this?" (PRD's literal example: a Starter
 * plan must be rejected server-side from forecast endpoints).
 *
 * Must be mounted AFTER workspaceMiddleware (needs req.workspace.id).
 */
export function requireFeature(feature: FeatureKey) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      // Workspace JWT context (req.workspace) or API-key context (req.workspaceId)
      const workspaceId = (req as any).workspace?.id ?? (req as any).workspaceId;
      if (!workspaceId) {
        throw AppError.forbidden('Workspace context required', 'WORKSPACE_REQUIRED');
      }

      const { data: sub } = await supabaseAdmin
        .from('subscriptions')
        .select('plan_id, status')
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      // No subscription row: treat as free-tier (fail closed for paid features).
      if (!sub?.plan_id) {
        const plan = await PlanCatalogService.getPlanByName('free');
        if (!plan?.features[feature]) {
          throw AppError.planFeatureDisabled(feature, plan?.displayName || 'Free');
        }
        (req as any).planTier = plan.name;
        next();
        return;
      }

      const plan = await PlanCatalogService.getPlanById(sub.plan_id);
      if (!plan) {
        throw AppError.internal('Workspace subscription references an unknown plan');
      }

      if (!plan.features[feature]) {
        throw AppError.planFeatureDisabled(feature, plan.displayName);
      }

      (req as any).planTier = plan.name;
      next();
    } catch (err) {
      next(err);
    }
  };
}
