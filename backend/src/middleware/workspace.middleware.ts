import { Response, NextFunction } from 'express';
import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../shared/errors.js';
import { AuthenticatedRequest, WorkspaceRequest, MembershipContext } from '../shared/types.js';
import { logger } from '../config/logger.js';

/**
 * Workspace context middleware
 * Resolves :workspaceId (slug or UUID) from route params
 * Verifies the authenticated user is a member of this workspace
 * Loads the user's effective permissions for this workspace
 * Attaches workspace + membership to request
 */
export async function workspaceMiddleware(
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const paramVal = req.params.workspaceId;
    const workspaceIdOrSlug = Array.isArray(paramVal) ? paramVal[0] : paramVal;

    if (!workspaceIdOrSlug) {
      throw AppError.badRequest('Workspace ID is required');
    }

    // Resolve workspace by slug or UUID
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(workspaceIdOrSlug);

    const { data: workspace, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .select('id, name, slug, status')
      .eq(isUUID ? 'id' : 'slug', workspaceIdOrSlug)
      .single();

    if (wsError || !workspace) {
      throw AppError.notFound('Workspace not found');
    }

    if (workspace.status === 'suspended') {
      throw AppError.forbidden('This workspace has been suspended', 'WORKSPACE_SUSPENDED');
    }

    // Verify membership
    const { data: member, error: memberError } = await supabaseAdmin
      .from('workspace_members')
      .select('id, user_id, workspace_id, status')
      .eq('workspace_id', workspace.id)
      .eq('user_id', req.user.id)
      .eq('status', 'active')
      .single();

    if (memberError || !member) {
      logger.debug('Workspace access denied', { userId: req.user.id, workspaceId: workspace.id });
      throw AppError.forbidden('You are not a member of this workspace');
    }

    // Phase 3 Step 5: subscription-aware access control (PRD §17, Rule #9).
    // Cancelled/suspended → block; past_due → allowed during the grace window
    // only. Billing routes stay reachable so the workspace can fix its state.
    const subscriptionState = await resolveSubscriptionState(workspace.id);
    if (subscriptionState !== 'active' && subscriptionState !== 'trialing') {
      const isBillingRoute = req.path === '/billing' || req.path.startsWith('/billing/');
      if (!isBillingRoute) {
        if (subscriptionState === 'cancelled' || subscriptionState === 'suspended') {
          throw AppError.forbidden(
            'This workspace subscription is inactive. Visit billing to reactivate.',
            'SUBSCRIPTION_INACTIVE'
          );
        }
        if (subscriptionState === 'past_due_expired') {
          throw AppError.forbidden(
            'Payment failed and the grace period has ended. Visit billing to update payment details.',
            'SUBSCRIPTION_PAST_DUE'
          );
        }
      }
    }

    // Load effective permissions (from roles + direct permissions)
    const permissions = await loadEffectivePermissions(member.id);

    // Attach to request
    const wsReq = req as unknown as WorkspaceRequest;
    wsReq.subscriptionState = subscriptionState;
    wsReq.workspace = {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status,
    };
    wsReq.membership = {
      id: member.id,
      userId: member.user_id,
      workspaceId: member.workspace_id,
      status: member.status,
      permissions,
    };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Resolve the workspace's effective subscription state (Phase 3 Step 5).
 *
 * Time-based and self-healing — no cron needed:
 *   - trialing with expired trial   → past_due_expired (blocked; add payment)
 *   - past_due, grace window open   → past_due_grace (allowed, banner data)
 *   - past_due, grace window closed → past_due_expired (blocked)
 *   - cancelled / suspended         → inactive (blocked)
 * A missing subscription row resolves to 'active' so the gate can never
 * lock out workspaces on data hiccups (workspace creation always seeds one).
 */
async function resolveSubscriptionState(
  workspaceId: string
): Promise<'trialing' | 'active' | 'past_due_grace' | 'past_due_expired' | 'cancelled' | 'suspended'> {
  const { data: sub } = await supabaseAdmin
    .from('subscriptions')
    .select('status, trial_ends_at, past_due_at, grace_ends_at')
    .eq('workspace_id', workspaceId)
    .maybeSingle();

  if (!sub) return 'active';

  const now = Date.now();

  switch (sub.status) {
    case 'active':
      return 'active';

    case 'trialing': {
      const trialEnd = sub.trial_ends_at ? new Date(sub.trial_ends_at).getTime() : null;
      if (trialEnd && trialEnd < now) return 'past_due_expired'; // expired trial
      return 'trialing';
    }

    case 'past_due': {
      const graceEnd = sub.grace_ends_at ? new Date(sub.grace_ends_at).getTime() : null;
      if (graceEnd && graceEnd > now) return 'past_due_grace';
      return 'past_due_expired';
    }

    case 'cancelled':
      return 'cancelled';

    case 'suspended':
      return 'suspended';

    default:
      return 'active';
  }
}

/**
 * Load effective permissions for a member
 * Combines: role permissions + direct member permissions
 *
 * Exported for reuse by the "current member" endpoint
 * (GET /workspaces/:workspaceId/members/me).
 */
export async function loadEffectivePermissions(memberId: string): Promise<string[]> {
  // Get permissions from roles
  const { data: rolePerms } = await supabaseAdmin
    .from('member_roles')
    .select(`
      role:roles(
        role_permissions(
          permission:permissions(code)
        )
      )
    `)
    .eq('member_id', memberId);

  // Get direct permissions
  const { data: directPerms } = await supabaseAdmin
    .from('member_permissions')
    .select('permission:permissions(code)')
    .eq('member_id', memberId);

  const permSet = new Set<string>();

  // Extract role permissions
  if (rolePerms) {
    for (const mr of rolePerms) {
      const role = mr.role as any;
      if (role?.role_permissions) {
        for (const rp of role.role_permissions) {
          if (rp.permission?.code) {
            permSet.add(rp.permission.code);
          }
        }
      }
    }
  }

  // Extract direct permissions
  if (directPerms) {
    for (const dp of directPerms) {
      const perm = dp.permission as any;
      if (perm?.code) {
        permSet.add(perm.code);
      }
    }
  }

  return Array.from(permSet);
}
