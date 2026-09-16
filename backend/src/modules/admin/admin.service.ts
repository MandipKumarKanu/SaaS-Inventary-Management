import { supabaseAdmin } from '../../config/supabase.js';

export class AdminService {
  static async getPlatformOverview() {
    // Phase 0 fix: `owner_id` did not exist on workspaces (column is `created_by`),
    // and `plan_name`/`monthly_price` did not exist on subscriptions
    // (plan lives in subscription_plans, joined via plan_id).
    const { data: workspaces, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .select('id, name, slug, status, created_at, created_by');

    if (wsError) throw wsError;

    const { data: users, error: usersError } = await supabaseAdmin
      .from('users')
      .select('id, email, name, status, created_at');

    if (usersError) throw usersError;

    const { data: subscriptions, error: subError } = await supabaseAdmin
      .from('subscriptions')
      .select('id, workspace_id, status, billing_interval, plan:subscription_plans(name, display_name, price_monthly)');

    if (subError) throw subError;

    const { count: productCount, error: prodError } = await supabaseAdmin
      .from('products')
      .select('id', { count: 'exact', head: true });

    if (prodError) throw prodError;

    // MRR from plan prices, treating annual as monthly/12 and skipping trials/cancellations
    const totalMRR = (subscriptions || []).reduce((acc: number, s: any) => {
      if (s.status === 'cancelled' || s.status === 'suspended') return acc;
      const price = s.plan?.price_monthly ? Number(s.plan.price_monthly) : 0;
      const divisor = s.billing_interval === 'annual' ? 12 : 1;
      return acc + price / divisor;
    }, 0);

    return {
      totalWorkspaces: (workspaces || []).length,
      activeWorkspaces: (workspaces || []).filter((w: any) => w.status === 'active').length,
      trialWorkspaces: (subscriptions || []).filter((s: any) => s.status === 'trialing').length,
      paidWorkspaces: (subscriptions || []).filter((s: any) => s.status === 'active').length,
      suspendedWorkspaces: (workspaces || []).filter((w: any) => w.status === 'suspended').length,
      totalUsers: (users || []).length,
      totalProducts: productCount || 0,
      totalMRR: Math.round(totalMRR * 100) / 100,
      // Only non-sensitive fields are exposed to the admin surface (PRD §14:
      // "Avoid exposing customer business data unnecessarily")
      workspaces: (workspaces || []).map((w: any) => ({
        id: w.id,
        name: w.name,
        slug: w.slug,
        status: w.status,
        created_at: w.created_at,
      })),
      subscriptions: (subscriptions || []).map((s: any) => ({
        id: s.id,
        workspace_id: s.workspace_id,
        status: s.status,
        billing_interval: s.billing_interval,
        plan_name: s.plan?.name ?? null,
        price_monthly: s.plan?.price_monthly ?? null,
      })),
    };
  }
}
