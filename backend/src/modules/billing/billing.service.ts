import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { PlanCatalogService, Plan, PlanLimits } from '../../services/plan-catalog.service.js';
import { UsageService, UsageMetric } from '../../services/usage.service.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * Phase 3: billing is now DB-driven truth (PRD §15, Rule #8/#9).
 *
 * - Plans resolve through subscriptions.plan_id → subscription_plans (the
 *   columns the old code wrote — plan_name/monthly_price — never existed on
 *   the subscriptions table).
 * - All limits come from subscription_plans.limits JSONB. The hardcoded
 *   PLAN_LIMITS records were deleted.
 * - Response keys match what BillingSettingsPage.jsx consumes:
 *     plan_tier, status, price_monthly, limits.maxUsers/maxProducts/
 *     maxWarehouses, usage.users/products/warehouses — plus richer fields
 *     (features, transactions_this_month) for gating-aware UIs.
 */

const SUMMARY_METRICS: UsageMetric[] = ['users', 'products', 'warehouses', 'transactions_per_month'];

export class BillingService {
  static async getBillingSummary(workspaceId: string) {
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    let plan: Plan | null = null;
    if (sub?.plan_id) {
      plan = await PlanCatalogService.getPlanById(sub.plan_id);
    }

    // Defensive: a workspace without a subscription row gets the free plan.
    // (workspace creation inserts one; this only fires on tampered data)
    if (!sub) {
      plan = await PlanCatalogService.getPlanByName('free');
    }

    const usage = await UsageService.getUsage(workspaceId, SUMMARY_METRICS);
    const byMetric = Object.fromEntries(usage.map((u) => [u.metric, u]));

    const usageMap = {
      users: byMetric.users?.current ?? 0,
      products: byMetric.products?.current ?? 0,
      warehouses: byMetric.warehouses?.current ?? 0,
    };

    return {
      planId: plan?.id ?? null,
      plan_tier: plan?.name ?? 'free',
      plan_display_name: plan?.displayName ?? 'Free',
      status: sub?.status ?? 'trialing',
      billing_interval: sub?.billing_interval ?? 'monthly',
      price_monthly: plan?.priceMonthly ?? 0,
      price_annual: plan?.priceAnnual ?? 0,
      trial_ends_at: sub?.trial_ends_at ?? null,
      current_period_end: sub?.current_period_end ?? null,
      past_due_at: sub?.past_due_at ?? null,
      grace_ends_at: sub?.grace_ends_at ?? null,
      has_stripe_customer: Boolean(sub?.stripe_customer_id),
      features: plan?.features ?? null,
      // Limits in BOTH shapes: raw DB limits and the max* keys the UI reads.
      rawLimits: plan?.limits ?? null,
      limits: {
        maxUsers: plan?.limits.users ?? -1,
        maxProducts: plan?.limits.products ?? -1,
        maxWarehouses: plan?.limits.warehouses ?? -1,
        maxTransactionsPerMonth: plan?.limits.transactions_per_month ?? -1,
      },
      usage: usageMap,
      transactions_this_month: byMetric.transactions_per_month?.current ?? 0,
    };
  }

  /**
   * Dev/demo plan change (no Stripe configured): writes plan_id directly.
   * Downgrades below current usage are blocked; change is audited.
   * When Stripe env is configured this endpoint is disabled — use
   * checkout (deferred to the Stripe session, see phase3 plan Step 4).
   */
  static async changePlan(workspaceId: string, newPlanName: string, userId: string) {
    const { env } = await import('../../config/env.js');
    if (env.STRIPE_SECRET_KEY) {
      throw AppError.badRequest(
        'Stripe billing is enabled: plan changes must go through checkout.',
        'STRIPE_REQUIRED'
      );
    }

    const plan = await PlanCatalogService.requirePlanByName(newPlanName);

    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('id, plan_id, status')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!sub) throw AppError.notFound('No subscription found for this workspace');

    const currentPlan = await PlanCatalogService.getPlanById(sub.plan_id);

    // Downgrade guard: cannot drop below live usage on any metric (PRD §15).
    if (currentPlan) {
      const blocked: Array<{ metric: string; used: number; newLimit: number }> = [];
      for (const metric of ['users', 'products', 'warehouses'] as UsageMetric[]) {
        const newLimit = plan.limits[metric];
        if (newLimit === -1) continue;
        const used = await UsageService.getCurrentUsage(workspaceId, metric);
        if (used > newLimit) {
          blocked.push({ metric, used, newLimit });
        }
      }
      if (blocked.length > 0) {
        throw new AppError(
          `Cannot downgrade to ${plan.displayName}: current usage exceeds its limits.`,
          400,
          'PLAN_DOWNGRADE_BLOCKED',
          true,
          { violations: blocked }
        );
      }
    }

    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({
        plan_id: plan.id,
        status: 'active',
        updated_at: new Date().toISOString(),
      })
      .eq('id', sub.id);

    if (error) throw error;

    // Re-seed usage_records limits for the new plan
    for (const metric of SUMMARY_METRICS) {
      await UsageService.refreshUsage(workspaceId, metric);
    }

    PlanCatalogService.invalidateCache();

    await AuditService.log({
      workspaceId,
      userId,
      action: 'billing.plan_changed',
      entity: 'subscription',
      entityId: sub.id,
      previousValue: { plan_id: sub.plan_id, plan_name: currentPlan?.name ?? null },
      newValue: { plan_id: plan.id, plan_name: plan.name },
    });

    return this.getBillingSummary(workspaceId);
  }

  /** Used by webhook handlers (deferred Stripe step) to sync limits on plan change. */
  static async syncPlanLimits(workspaceId: string) {
    for (const metric of SUMMARY_METRICS) {
      await UsageService.refreshUsage(workspaceId, metric);
    }
  }
}
