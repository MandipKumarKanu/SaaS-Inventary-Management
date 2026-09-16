import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../shared/errors.js';
import { PlanCatalogService, PlanLimits } from './plan-catalog.service.js';

/**
 * Phase 3: central usage-limit enforcement (PRD §15/§16, Rule #8/#9).
 *
 * One enforcement point for all plan metrics. Live counts are the source of
 * truth for enforcement; `usage_records.current_value` is a fast-path cache
 * refreshed after mutations (and by workspace creation / webhook limit sync).
 */

export type UsageMetric = keyof Pick<
  PlanLimits,
  'users' | 'products' | 'warehouses' | 'transactions_per_month'
>;

export interface UsageSnapshot {
  metric: UsageMetric;
  current: number;
  limit: number; // -1 = unlimited
}

export class UsageService {
  /**
   * Current usage for a metric. Live counts (DB count queries) are the
   * authority — usage_records can drift, counts cannot.
   */
  static async getCurrentUsage(workspaceId: string, metric: UsageMetric): Promise<number> {
    switch (metric) {
      case 'users': {
        const { count } = await supabaseAdmin
          .from('workspace_members')
          .select('id', { count: 'exact' })
          .eq('workspace_id', workspaceId)
          .eq('status', 'active');
        return count || 0;
      }
      case 'products': {
        // Phase 5: archived products don't count against the plan limit
        const { count } = await supabaseAdmin
          .from('products')
          .select('id', { count: 'exact' })
          .eq('workspace_id', workspaceId)
          .is('archived_at', null);
        return count || 0;
      }
      case 'warehouses': {
        // Phase 5: archived warehouses don't count against the plan limit
        const { count } = await supabaseAdmin
          .from('warehouses')
          .select('id', { count: 'exact' })
          .eq('workspace_id', workspaceId)
          .is('archived_at', null);
        return count || 0;
      }
      case 'transactions_per_month': {
        // Ledger movements this calendar month
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);
        const { count } = await supabaseAdmin
          .from('inventory_transactions')
          .select('id', { count: 'exact' })
          .eq('workspace_id', workspaceId)
          .gte('created_at', startOfMonth.toISOString());
        return count || 0;
      }
      default:
        return 0;
    }
  }

  /** All metrics for a workspace (billing summary / UI meters). */
  static async getUsage(workspaceId: string, metrics: UsageMetric[]): Promise<UsageSnapshot[]> {
    const plan = await this.getWorkspacePlan(workspaceId);
    const out: UsageSnapshot[] = [];
    for (const metric of metrics) {
      out.push({
        metric,
        current: await this.getCurrentUsage(workspaceId, metric),
        limit: plan?.limits[metric] ?? -1,
      });
    }
    return out;
  }

  /**
   * Enforcement gate. Throws 403 PLAN_LIMIT_REACHED (with structured details)
   * when the workspace is at/over the plan's limit for this metric.
   * Call it BEFORE the resource is created.
   */
  static async assertWithinLimit(workspaceId: string, metric: UsageMetric): Promise<void> {
    const plan = await this.getWorkspacePlan(workspaceId);
    const limit = plan?.limits[metric] ?? -1;

    // Unlimited plan or unresolvable plan: don't block business operations.
    if (limit === -1) return;

    const current = await this.getCurrentUsage(workspaceId, metric);
    if (current >= limit) {
      throw AppError.planLimitReached(
        metric,
        limit,
        plan?.displayName || plan?.name || 'current'
      );
    }
  }

  /**
   * Recount a metric and upsert usage_records (fast-path cache + admin MRR
   * dashboards read this). Never throws into the caller — cache staleness
   * must not break the operation that just succeeded.
   */
  static async refreshUsage(workspaceId: string, metric: UsageMetric): Promise<void> {
    try {
      const current = await this.getCurrentUsage(workspaceId, metric);
      const plan = await this.getWorkspacePlan(workspaceId);
      const limit = plan?.limits[metric] ?? -1;

      await supabaseAdmin.from('usage_records').upsert(
        {
          workspace_id: workspaceId,
          metric,
          current_value: current,
          limit_value: limit,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'workspace_id,metric' }
      );
    } catch (err: any) {
      console.error('Failed to refresh usage cache', { workspaceId, metric, error: err.message });
    }
  }

  /** Resolve the workspace's current plan through subscriptions.plan_id. */
  static async getWorkspacePlan(workspaceId: string) {
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('plan_id')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (!sub?.plan_id) return null;
    return PlanCatalogService.getPlanById(sub.plan_id);
  }
}
