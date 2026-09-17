import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { UsageService, UsageMetric } from '../../services/usage.service.js';

export class AdminService {
  /**
   * §68: shared sort-parameter handling. Only whitelisted column names are
   * accepted (never pass client input to order()); defaults to created_at
   * desc when absent or invalid.
   */
  static resolveSort(
    sortBy: string | undefined,
    sortDir: string | undefined,
    allowed: Record<string, string>
  ): { column: string; ascending: boolean } {
    const column = sortBy && allowed[sortBy] ? allowed[sortBy] : 'created_at';
    const ascending = sortDir === 'asc';
    return { column, ascending };
  }
  /**
   * §77: the overview is dashboard-hot — use indexed count/head queries and
   * a short TTL cache instead of loading every row into memory. MRR is
   * computed from paginated active subscriptions joined to plan prices via
   * count-grouped status/interval buckets (SQL-side), not a JS reduce.
   */
  private static overviewCache: { data: any; expires: number } | null = null;

  static invalidateOverviewCache(): void {
    this.overviewCache = null;
  }

  static async getPlatformOverview() {
    if (this.overviewCache && this.overviewCache.expires > Date.now()) {
      return this.overviewCache.data;
    }

    const [
      totalWorkspacesQ,
      activeWorkspacesQ,
      suspendedWorkspacesQ,
      totalUsersQ,
      trialSubsQ,
      activeSubsQ,
      productCountQ,
      mrrRowsQ,
      recentWorkspacesQ,
      recentSubsQ,
    ] = await Promise.all([
      supabaseAdmin.from('workspaces').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('workspaces').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabaseAdmin.from('workspaces').select('id', { count: 'exact', head: true }).eq('status', 'suspended'),
      supabaseAdmin.from('users').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'trialing'),
      supabaseAdmin.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      supabaseAdmin.from('products').select('id', { count: 'exact', head: true }),
      // MRR input: active subscriptions with plan prices. Capped page keeps
      // this bounded; groups in JS on a few hundred rows max (not full table).
      supabaseAdmin
        .from('subscriptions')
        .select('billing_interval, price:subscription_plans(price_monthly)')
        .eq('status', 'active')
        .limit(10_000),
      supabaseAdmin
        .from('workspaces')
        .select('id, name, slug, status, created_at')
        .order('created_at', { ascending: false })
        .limit(10),
      supabaseAdmin
        .from('subscriptions')
        .select('id, workspace_id, status, billing_interval, plan:subscription_plans(name, display_name, price_monthly)')
        .order('created_at', { ascending: false })
        .limit(10),
    ]);

    const totalMRR = (mrrRowsQ.data ?? []).reduce((acc: number, s: any) => {
      const price = s.price?.price_monthly ? Number(s.price.price_monthly) : 0;
      const divisor = s.billing_interval === 'annual' ? 12 : 1;
      return acc + price / divisor;
    }, 0);

    const data = {
      totalWorkspaces: totalWorkspacesQ.count ?? 0,
      activeWorkspaces: activeWorkspacesQ.count ?? 0,
      suspendedWorkspaces: suspendedWorkspacesQ.count ?? 0,
      trialWorkspaces: trialSubsQ.count ?? 0,
      paidWorkspaces: activeSubsQ.count ?? 0,
      totalUsers: totalUsersQ.count ?? 0,
      totalProducts: productCountQ.count ?? 0,
      totalMRR: Math.round(totalMRR * 100) / 100,
      workspaces: recentWorkspacesQ.data ?? [],
      subscriptions: (recentSubsQ.data ?? []).map((s: any) => ({
        id: s.id,
        workspace_id: s.workspace_id,
        status: s.status,
        billing_interval: s.billing_interval,
        plan_name: s.plan?.name ?? null,
        price_monthly: s.plan?.price_monthly ?? null,
      })),
    };

    this.overviewCache = { data, expires: Date.now() + 60_000 };
    return data;
  }

  static async listWorkspaces(options?: { page?: number; pageSize?: number; search?: string; status?: string; sortBy?: string; sortDir?: string }) {
    const page = options?.page || 1;
    const pageSize = Math.min(options?.pageSize || 25, 100);

    const wsSort = this.resolveSort(options?.sortBy, options?.sortDir, {
      created_at: 'created_at',
      name: 'name',
      status: 'status',
    });

    let query = supabaseAdmin
      .from('workspaces')
      .select('id, name, slug, status, created_at, created_by, updated_at', { count: 'exact' })
      .order(wsSort.column, { ascending: wsSort.ascending });

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

  static async listUsers(options?: { page?: number; pageSize?: number; search?: string; status?: string; sortBy?: string; sortDir?: string }) {
    const page = options?.page || 1;
    const pageSize = Math.min(options?.pageSize || 25, 100);

    const userSort = this.resolveSort(options?.sortBy, options?.sortDir, {
      created_at: 'created_at',
      email: 'email',
      name: 'name',
      status: 'status',
    });

    let query = supabaseAdmin
      .from('users')
      .select('id, email, name, avatar_url, status, is_platform_admin, created_at, updated_at', { count: 'exact' })
      .order(userSort.column, { ascending: userSort.ascending });

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

  /**
   * §69 webhook-event micro-detail: full event row (safe fields) for the
   * drill-in behind the Alerts tab. Payload is returned — it is the same
   * data Stripe sent (no secrets), needed to understand a failure.
   */
  static async getWebhookEventDetail(eventRowId: string) {
    const { data, error } = await supabaseAdmin
      .from('stripe_webhook_events')
      .select('id, event_id, event_type, processing_status, detail, processing_duration_ms, delivery_attempt, stripe_event_created, created_at, payload')
      .eq('id', eventRowId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw AppError.notFound('Webhook event not found');
    return data;
  }

  /**
   * §69 audit-event micro-detail: full audit row including before/after
   * values (previous_value/new_value are the point of a drill-in) plus
   * actor/workspace context.
   */
  static async getAuditEventDetail(auditId: string) {
    const { data, error } = await supabaseAdmin
      .from('audit_logs')
      .select('*, user:users(id, email, name), workspace:workspaces(id, name, slug)')
      .eq('id', auditId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw AppError.notFound('Audit event not found');
    return data;
  }

  /**
   * Admin user detail (§44/§45): profile, workspace memberships with roles,
   * related subscriptions, and recent audit activity. Never exposes secrets
   * (no password/token fields are selected).
   */
  static async getUserDetail(userId: string) {
    const { data: user, error } = await supabaseAdmin
      .from('users')
      .select('id, email, name, avatar_url, status, is_platform_admin, created_at, updated_at, last_login_at')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!user) throw AppError.notFound('User not found');

    // Memberships → workspace + role names (roles resolve through member_roles)
    const { data: memberships, error: memError } = await supabaseAdmin
      .from('workspace_members')
      .select(
        `id, status, created_at, workspace_id,
         workspace:workspaces(id, name, slug, status),
         member_roles(role:roles(id, name))`
      )
      .eq('user_id', userId);
    if (memError) throw memError;

    // Subscriptions across the user's workspaces (§44)
    const workspaceIds = (memberships ?? []).map((m: any) => m.workspace_id);
    let subscriptions: any[] = [];
    if (workspaceIds.length > 0) {
      const { data: subs, error: subsError } = await supabaseAdmin
        .from('subscriptions')
        .select('id, workspace_id, status, billing_interval, trial_ends_at, current_period_end, plan:subscription_plans(name, display_name)')
        .in('workspace_id', workspaceIds);
      if (subsError) throw subsError;
      subscriptions = subs ?? [];
    }

    // Recent audit rows involving this user (§44 audit section)
    const { data: audit } = await supabaseAdmin
      .from('audit_logs')
      .select('id, action, entity, entity_id, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    return {
      user,
      memberships: (memberships ?? []).map((m: any) => ({
        id: m.id,
        status: m.status,
        created_at: m.created_at,
        workspace: m.workspace ?? null,
        role_name: (m.member_roles as any[])?.[0]?.role?.name ?? null,
      })),
      subscriptions,
      recent_activity: audit ?? [],
    };
  }

  /**
   * §69 Payment detail: full payment row with related workspace,
   * subscription, and coupon context — the drill-in behind the payments
   * tables. Never exposes secrets or metadata blobs.
   */
  static async getPaymentDetail(paymentId: string) {
    const { data: payment, error } = await supabaseAdmin
      .from('payments')
      .select(
        'id, workspace_id, subscription_id, provider, provider_reference, amount, currency, status, invoice_id, coupon_id, discount_amount, failure_reason, created_at, updated_at, workspace:workspaces(id, name, slug), subscription:subscriptions(id, status, billing_interval), coupon:coupons(code, discount_type)'
      )
      .eq('id', paymentId)
      .maybeSingle();
    if (error) throw error;
    if (!payment) throw AppError.notFound('Payment not found');

    // Strip metadata (contains event ids/internal detail) before returning.
    const { metadata: _metadata, ...safe } = payment as Record<string, unknown> & { metadata?: unknown };
    return safe;
  }

  /**
   * Platform-wide payments listing (§56): all payments across workspaces
   * with status filter. Paginated; no secrets returned.
   */
  static async listAllPayments(options?: { page?: number; pageSize?: number; status?: string; search?: string; sortBy?: string; sortDir?: string }) {
    const page = options?.page || 1;
    const pageSize = Math.min(options?.pageSize || 25, 100);

    const sort = this.resolveSort(options?.sortBy, options?.sortDir, {
      created_at: 'created_at',
      amount: 'amount',
      status: 'status',
    });

    let query = supabaseAdmin
      .from('payments')
      .select(
        'id, provider, provider_reference, amount, currency, status, invoice_id, discount_amount, failure_reason, created_at, workspace:workspaces(id, name, slug)',
        { count: 'exact' }
      )
      .order(sort.column, { ascending: sort.ascending });

    if (options?.status && ['pending', 'successful', 'failed', 'refunded'].includes(options.status)) {
      query = query.eq('status', options.status);
    }
    if (options?.search) {
      const term = `%${options.search.trim()}%`;
      query = query.or(`provider_reference.ilike.${term},invoice_id.ilike.${term}`);
    }

    query = query.range((page - 1) * pageSize, page * pageSize - 1);

    const { data, error, count } = await query;
    if (error) throw error;
    const total = count || 0;
    return {
      data: data ?? [],
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    };
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

  static async getPlatformAuditLogs(options?: { page?: number; pageSize?: number; search?: string; from?: string; to?: string; action?: string }) {
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
    // §40/§60: date-range + action filters
    if (options?.from && !Number.isNaN(new Date(options.from).getTime())) {
      query = query.gte('created_at', new Date(options.from).toISOString());
    }
    if (options?.to && !Number.isNaN(new Date(options.to).getTime())) {
      query = query.lte('created_at', new Date(options.to).toISOString());
    }
    if (options?.action) {
      query = query.eq('action', options.action);
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
