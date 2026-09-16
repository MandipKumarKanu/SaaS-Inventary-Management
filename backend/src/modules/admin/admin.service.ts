import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { UsageService, UsageMetric } from '../../services/usage.service.js';

export class AdminService {
  static async getPlatformOverview() {
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

  static async listWorkspaces(options?: { page?: number; pageSize?: number; search?: string; status?: string }) {
    const page = options?.page || 1;
    const pageSize = Math.min(options?.pageSize || 25, 100);

    let query = supabaseAdmin
      .from('workspaces')
      .select('id, name, slug, status, created_at, created_by, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    if (options?.search) {
      const term = `%${options.search.trim()}%`;
      query = query.or(`name.ilike.${term},slug.ilike.${term}`);
    }

    query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data: workspaces, error, count } = await query;
    if (error) throw error;

    const total = count || 0;

    // Fetch members and product counts for each workspace
    const enriched = await Promise.all(
      (workspaces || []).map(async (ws) => {
        const [{ count: memberCount }, { count: productCount }, { data: sub }] = await Promise.all([
          supabaseAdmin.from('workspace_members').select('id', { count: 'exact', head: true }).eq('workspace_id', ws.id),
          supabaseAdmin.from('products').select('id', { count: 'exact', head: true }).eq('workspace_id', ws.id),
          supabaseAdmin.from('subscriptions').select('status, plan:subscription_plans(name, display_name)').eq('workspace_id', ws.id).maybeSingle(),
        ]);
        const planRow = sub?.plan as any;
        return {
          ...ws,
          memberCount: memberCount || 0,
          productCount: productCount || 0,
          planName: planRow?.display_name || planRow?.name || 'Free',
          subscriptionStatus: sub?.status || 'active',
        };
      })
    );

    return {
      data: enriched,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  static async updateWorkspaceStatus(id: string, status: 'active' | 'suspended') {
    const { data: ws, error: findError } = await supabaseAdmin
      .from('workspaces')
      .select('id, name, status')
      .eq('id', id)
      .maybeSingle();

    if (findError) throw findError;
    if (!ws) throw AppError.notFound('Workspace not found');

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('workspaces')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();

    if (updateError) throw updateError;
    return updated;
  }

  static async listUsers(options?: { page?: number; pageSize?: number; search?: string; status?: string }) {
    const page = options?.page || 1;
    const pageSize = Math.min(options?.pageSize || 25, 100);

    let query = supabaseAdmin
      .from('users')
      .select('id, email, name, avatar_url, status, is_platform_admin, created_at, updated_at', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    if (options?.search) {
      const term = `%${options.search.trim()}%`;
      query = query.or(`email.ilike.${term},name.ilike.${term}`);
    }

    query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data: users, error, count } = await query;
    if (error) throw error;
    const total = count || 0;

    const enriched = await Promise.all(
      (users || []).map(async (u) => {
        const { count: wsCount } = await supabaseAdmin
          .from('workspace_members')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', u.id);
        return {
          ...u,
          workspaceCount: wsCount || 0,
        };
      })
    );

    return {
      data: enriched,
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  static async updateUserStatus(userId: string, status: 'active' | 'suspended') {
    const { data: user, error: findError } = await supabaseAdmin
      .from('users')
      .select('id, email')
      .eq('id', userId)
      .maybeSingle();

    if (findError) throw findError;
    if (!user) throw AppError.notFound('User not found');

    const { data: updated, error: updateError } = await supabaseAdmin
      .from('users')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', userId)
      .select('id, email, name, status, is_platform_admin, created_at')
      .single();

    if (updateError) throw updateError;
    return updated;
  }

  static async listSubscriptions(options?: { page?: number; pageSize?: number }) {
    const page = options?.page || 1;
    const pageSize = Math.min(options?.pageSize || 25, 100);

    const { data, error, count } = await supabaseAdmin
      .from('subscriptions')
      .select('*, workspace:workspaces(id, name, slug), plan:subscription_plans(name, display_name, price_monthly)', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);

    if (error) throw error;
    const total = count || 0;

    return {
      data: data || [],
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  /**
   * Admin workspace detail (§47): overview + members + subscription + usage
   * + coupon redemptions + recent audit activity. Billing sections (payments)
   * have their own paginated endpoint.
   */
  static async getWorkspaceDetail(workspaceId: string) {
    const { data: workspace, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .select('id, name, slug, status, created_at, updated_at, created_by')
      .eq('id', workspaceId)
      .maybeSingle();
    if (wsError) throw wsError;
    if (!workspace) throw AppError.notFound('Workspace not found');

    // Members with their role names — roles resolve through member_roles
    // (the same join path the members module uses; workspace_members has no
    // direct roles FK).
    const { data: members, error: membersError } = await supabaseAdmin
      .from('workspace_members')
      .select(
        `id, status, created_at,
         user:users(id, email, name, status),
         member_roles(role:roles(id, name))`
      )
      .eq('workspace_id', workspaceId);
    if (membersError) throw membersError;

    const [{ data: sub }, counts] = await Promise.all([
      supabaseAdmin
        .from('subscriptions')
        .select('*, plan:subscription_plans(id, name, display_name, price_monthly, price_annual, features, limits)')
        .eq('workspace_id', workspaceId)
        .maybeSingle(),
      Promise.all([
        supabaseAdmin.from('products').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
        supabaseAdmin.from('warehouses').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
        supabaseAdmin.from('workspace_members').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId),
      ] as const),
    ]);

    // Resource counts + usage cache (§47 usage section)
    const [productCount, warehouseCount, memberCount] = counts.map((r) => r.count ?? 0);
    const usage = await UsageService.getUsage(workspaceId, ['users', 'products', 'warehouses', 'transactions_per_month']);
    const usageByMetric = Object.fromEntries(usage.map((u) => [u.metric, u.current]));

    // Coupon redemptions applied to this workspace (§47 coupons section)
    const { data: redemptions } = await supabaseAdmin
      .from('coupon_redemptions')
      .select('id, redeemed_at, operation, discount_amount, final_amount, currency, coupon:coupons(code, discount_type)')
      .eq('workspace_id', workspaceId)
      .order('redeemed_at', { ascending: false })
      .limit(10);

    // Recent workspace audit activity (§47 activity section)
    const { data: audit } = await supabaseAdmin
      .from('audit_logs')
      .select('id, action, entity, entity_id, created_at, user:users(email)')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .limit(15);

    return {
      workspace,
      members: (members ?? []).map((m: any) => ({
        id: m.id,
        status: m.status,
        created_at: m.created_at,
        email: m.user?.email ?? null,
        name: m.user?.name ?? null,
        user_status: m.user?.status ?? null,
        role_name: (m.member_roles as any[])?.[0]?.role?.name ?? null,
      })),
      subscription: sub ?? null,
      usage: {
        products: productCount,
        warehouses: warehouseCount,
        members: memberCount,
        usage_records: usageByMetric,
      },
      coupon_redemptions: redemptions ?? [],
      recent_activity: audit ?? [],
    };
  }

  /** Payments for a workspace (§56/§57) — paginated, no secrets returned. */
  static async listWorkspacePayments(workspaceId: string, page: number, pageSize: number) {
    const { data, error, count } = await supabaseAdmin
      .from('payments')
      .select('id, provider, provider_reference, amount, currency, status, invoice_id, discount_amount, failure_reason, created_at', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw error;
    return { data: data ?? [], meta: { page, pageSize, total: count ?? 0 } };
  }

  static async getPlatformAuditLogs(options?: { page?: number; pageSize?: number; search?: string }) {
    const page = options?.page || 1;
    const pageSize = Math.min(options?.pageSize || 25, 100);

    let query = supabaseAdmin
      .from('audit_logs')
      .select('*, user:users(id, email, name), workspace:workspaces(id, name)', { count: 'exact' })
      .order('created_at', { ascending: false });

    if (options?.search) {
      const term = `%${options.search.trim()}%`;
      query = query.or(`action.ilike.${term},entity.ilike.${term}`);
    }

    query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    const total = count || 0;

    return {
      data: data || [],
      meta: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }
}
