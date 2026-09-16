import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { CouponService, CouponRow } from '../billing/coupon.service.js';
import { SubscriptionService, SubscriptionRow } from '../billing/subscription.service.js';
import { PlanCatalogService } from '../../services/plan-catalog.service.js';
import { AuditService } from '../audit/audit.service.js';
import { BillingService } from '../billing/billing.service.js';
import { isStripeConfigured } from '../../config/stripe.js';

/**
 * SaaS Business Layer: platform-admin services (PRD §32, §35, §40, §42, §49,
 * §50, §52–§55, §73).
 *
 * All admin mutations are audited via AuditService with workspaceId = null
 * (platform-level actions); subscription mutations are delegated to
 * SubscriptionService so the same state machine + event history apply.
 */

// ── Coupon management (§32, §52–§55) ─────────────────────────────────────

export const AdminCouponService = {
  async list(filters: {
    status?: string;
    discount_type?: string;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    return CouponService.listCoupons(filters);
  },

  async getById(id: string) {
    const coupon = await CouponService.getCouponById(id);
    // Recent redemption history on the detail payload (§55)
    const { redemptions, total } = await CouponService.getRedemptions(id, 1, 20);
    return { ...coupon, recent_redemptions: redemptions, redemption_total: total };
  },

  async create(input: {
    code: string;
    description?: string | null;
    discount_type: CouponRow['discount_type'];
    discount_value: number;
    currency?: string;
    target_plan_name?: string | null;
    applicable_plan_names?: string[];
    applies_to?: CouponRow['applies_to'];
    duration?: CouponRow['duration'];
    duration_in_months?: number | null;
    starts_at?: string | null;
    expires_at?: string | null;
    max_redemptions?: number | null;
    max_redemptions_per_user?: number | null;
    max_redemptions_per_workspace?: number | null;
  }, adminId: string) {
    const coupon = await CouponService.createCoupon({ ...input, created_by: adminId });
    await AuditService.log({
      workspaceId: null,
      userId: adminId,
      action: 'platform.coupon_created',
      entity: 'coupon',
      entityId: coupon.id,
      newValue: { code: coupon.code, discount_type: coupon.discount_type, discount_value: Number(coupon.discount_value) },
    });
    return coupon;
  },

  async update(id: string, patch: {
    description?: string | null;
    active?: boolean;
    expires_at?: string | null;
    max_redemptions?: number | null;
    max_redemptions_per_user?: number | null;
    max_redemptions_per_workspace?: number | null;
  }, adminId: string) {
    const coupon = await CouponService.updateCoupon(id, patch, adminId);
    await AuditService.log({
      workspaceId: null,
      userId: adminId,
      action: 'platform.coupon_updated',
      entity: 'coupon',
      entityId: id,
      newValue: patch as Record<string, unknown>,
    });
    return coupon;
  },

  /** Secure bulk code generation (§33). Codes are returned uninserted. */
  async generateCodes(opts: { prefix: string; length: number; count: number; charset?: string }, adminId: string) {
    const codes = await CouponService.generateCodes(opts);
    await AuditService.log({
      workspaceId: null,
      userId: adminId,
      action: 'platform.coupon_codes_generated',
      entity: 'coupon',
      entityId: null,
      newValue: { count: codes.length, prefix: opts.prefix, length: opts.length },
    });
    return codes;
  },

  async getRedemptions(couponId: string, page: number, pageSize: number) {
    return CouponService.getRedemptions(couponId, page, pageSize);
  },
};

// ── Subscription management (§35, §49, §50) ──────────────────────────────

export const AdminSubscriptionService = {
  async list(filters: {
    status?: string;
    plan?: string;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    // Embed aliases match the frontend contract (s.workspace, s.plan).
    let query = supabaseAdmin
      .from('subscriptions')
      .select('*, workspace:workspaces(name, status), plan:subscription_plans(name, display_name, price_monthly)', { count: 'exact' });

    if (filters.status) query = query.eq('status', filters.status);
    if (filters.plan) {
      const plan = await PlanCatalogService.getPlanByName(filters.plan);
      if (!plan) throw AppError.badRequest(`Unknown plan: ${filters.plan}`, 'PLAN_NOT_FOUND');
      query = query.eq('plan_id', plan.id);
    }
    if (filters.search) {
      query = query.ilike('workspaces.name', `%${filters.search}%`);
    }

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize - 1);
    if (error) throw error;
    return { subscriptions: data ?? [], total: count ?? 0 };
  },

  async getById(workspaceId: string) {
    const sub = await SubscriptionService.requireSubscription(workspaceId);
    const plan = await PlanCatalogService.getPlanById(sub.plan_id);
    const { events, total } = await SubscriptionService.listEvents(workspaceId, 1, 30);
    // Override summary (§36) — active (non-expired) overrides
    const { data: overrides } = await supabaseAdmin
      .from('subscription_overrides')
      .select('*')
      .eq('subscription_id', sub.id)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false });
    return {
      subscription: sub,
      plan: plan ? { id: plan.id, name: plan.name, display_name: plan.displayName } : null,
      events: { items: events, total },
      active_overrides: overrides ?? [],
    };
  },

  /** Platform-admin actions (§48) — every one is audited with a reason. */
  async extendTrial(workspaceId: string, days: number, adminId: string, reason: string) {
    if (!reason || reason.trim().length < 3) {
      throw AppError.badRequest('A reason is required for this administrative action.', 'REASON_REQUIRED');
    }
    const sub = await SubscriptionService.extendTrial(workspaceId, days, adminId, 'admin');
    await AuditService.log({
      workspaceId,
      userId: adminId,
      action: 'platform.trial_extended',
      entity: 'subscription',
      entityId: sub.id,
      newValue: { days, reason },
    });
    return sub;
  },

  async changePlan(workspaceId: string, planName: string, adminId: string, reason: string) {
    if (!reason || reason.trim().length < 3) {
      throw AppError.badRequest('A reason is required for this administrative action.', 'REASON_REQUIRED');
    }
    if (isStripeConfigured()) {
      throw AppError.badRequest(
        'Stripe billing is enabled: plan changes must go through Stripe checkout/portal.',
        'STRIPE_REQUIRED'
      );
    }
    const sub = await SubscriptionService.requireSubscription(workspaceId);
    const summary = await BillingService.changePlan(workspaceId, planName, adminId);
    await SubscriptionService.recordEvent({
      subscription_id: sub.id,
      workspace_id: sub.workspace_id,
      event_type: 'plan_changed',
      previous_values: { plan_id: sub.plan_id },
      new_values: { plan_id: summary.planId },
      actor_type: 'admin',
      actor_id: adminId,
      reason,
    });
    await AuditService.log({
      workspaceId,
      userId: adminId,
      action: 'platform.plan_changed',
      entity: 'subscription',
      entityId: sub.id,
      newValue: { plan: planName, reason },
    });
    return summary;
  },

  async cancel(workspaceId: string, adminId: string, reason: string) {
    if (!reason || reason.trim().length < 3) {
      throw AppError.badRequest('A reason is required for this administrative action.', 'REASON_REQUIRED');
    }
    const sub = await SubscriptionService.cancelNow(workspaceId, adminId, reason);
    await AuditService.log({
      workspaceId,
      userId: adminId,
      action: 'platform.subscription_cancelled',
      entity: 'subscription',
      entityId: sub.id,
      newValue: { reason },
    });
    return sub;
  },

  async reactivate(workspaceId: string, adminId: string, reason: string) {
    if (!reason || reason.trim().length < 3) {
      throw AppError.badRequest('A reason is required for this administrative action.', 'REASON_REQUIRED');
    }
    const sub = await SubscriptionService.reactivate(workspaceId, adminId);
    await AuditService.log({
      workspaceId,
      userId: adminId,
      action: 'platform.subscription_reactivated',
      entity: 'subscription',
      entityId: sub.id,
      newValue: { reason },
    });
    return sub;
  },

  /** Administrative overrides (§36) — expiring, never silent subscription edits. */
  async addOverride(
    workspaceId: string,
    adminId: string,
    input: { override_type: 'trial_extension' | 'subscription_extension' | 'feature_grant' | 'limit_increase'; value: Record<string, unknown>; reason: string; expires_at: string }
  ) {
    if (!input.reason || input.reason.trim().length < 3) {
      throw AppError.badRequest('A reason is required for this administrative action.', 'REASON_REQUIRED');
    }
    if (!input.expires_at || new Date(input.expires_at) <= new Date()) {
      throw AppError.badRequest('expires_at must be in the future.', 'VALIDATION_ERROR');
    }
    const sub = await SubscriptionService.requireSubscription(workspaceId);
    const { data, error } = await supabaseAdmin
      .from('subscription_overrides')
      .insert({
        subscription_id: sub.id,
        workspace_id: sub.workspace_id,
        override_type: input.override_type,
        value: input.value,
        reason: input.reason,
        created_by: adminId,
        expires_at: input.expires_at,
      })
      .select('*')
      .single();
    if (error) throw error;
    await SubscriptionService.recordEvent({
      subscription_id: sub.id,
      workspace_id: sub.workspace_id,
      event_type: 'override_added',
      new_values: { override_type: input.override_type, value: input.value, expires_at: input.expires_at },
      actor_type: 'admin',
      actor_id: adminId,
      reason: input.reason,
    });
    await AuditService.log({
      workspaceId,
      userId: adminId,
      action: 'platform.override_added',
      entity: 'subscription',
      entityId: sub.id,
      newValue: { override_type: input.override_type, expires_at: input.expires_at, reason: input.reason },
    });
    return data;
  },
};

// ── Dashboard: coupons + billing metrics (§40, §41) ─────────────────────

export async function getDashboardAddendum() {
  const nowIso = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();

  const [
    couponsActive,
    couponsExpiring,
    redemptionsTotal,
    redemptionsWeek,
    paymentsOk,
    paymentsFailed,
    revenue,
    refunds,
    subsExpiringSoon,
  ] = await Promise.all([
    supabaseAdmin.from('coupons').select('id', { count: 'exact', head: true }).eq('active', true),
    supabaseAdmin.from('coupons').select('id', { count: 'exact', head: true }).eq('active', true).lt('expires_at', new Date(Date.now() + 7 * 86400_000).toISOString()),
    supabaseAdmin.from('coupon_redemptions').select('id', { count: 'exact', head: true }),
    supabaseAdmin.from('coupon_redemptions').select('id', { count: 'exact', head: true }).gte('redeemed_at', weekAgo),
    supabaseAdmin.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'successful'),
    supabaseAdmin.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'failed'),
    supabaseAdmin.from('payments').select('amount', { count: 'exact' }).eq('status', 'successful'),
    supabaseAdmin.from('payments').select('id', { count: 'exact', head: true }).eq('status', 'refunded'),
    supabaseAdmin.from('subscriptions').select('id', { count: 'exact', head: true }).in('status', ['active', 'trialing']).lt('current_period_end', new Date(Date.now() + 7 * 86400_000).toISOString()),
  ]);

  const revenueTotal = (revenue.data ?? []).reduce((sum, r) => sum + Number((r as { amount: number }).amount), 0);

  return {
    coupons: {
      active: couponsActive.count ?? 0,
      expiring_within_7d: couponsExpiring.count ?? 0,
      redemptions_total: redemptionsTotal.count ?? 0,
      redemptions_7d: redemptionsWeek.count ?? 0,
    },
    billing: {
      payments_successful: paymentsOk.count ?? 0,
      payments_failed: paymentsFailed.count ?? 0,
      refunds: refunds.count ?? 0,
      revenue_total: Math.round(revenueTotal * 100) / 100,
    },
    subscriptions: {
      expiring_within_7d: subsExpiringSoon.count ?? 0,
    },
  };
}

// ── Global admin search (§42) ────────────────────────────────────────────

export async function globalSearch(term: string) {
  const t = term.trim();
  if (t.length < 2) return { users: [], workspaces: [], coupons: [], payments: [] };
  const like = `%${t}%`;

  const [users, workspaces, coupons, payments] = await Promise.all([
    supabaseAdmin.from('users').select('id, email, full_name, status').or(`email.ilike.${like},full_name.ilike.${like},id.eq.${t}`).limit(5),
    supabaseAdmin.from('workspaces').select('id, name, status').ilike('name', like).limit(5),
    supabaseAdmin.from('coupons').select('id, code, active').ilike('code', like).limit(5),
    supabaseAdmin.from('payments').select('id, provider_reference, amount, status, workspace_id').or(`provider_reference.ilike.${like},invoice_id.ilike.${like}`).limit(5),
  ]);

  return {
    users: users.data ?? [],
    workspaces: workspaces.data ?? [],
    coupons: coupons.data ?? [],
    payments: payments.data ?? [],
  };
}

// ── Entitlement diagnostics (§73) — read-only decision explainer ────────

export async function getEntitlementDiagnostics(workspaceId: string) {
  const sub = await SubscriptionService.requireSubscription(workspaceId);
  const plan = await PlanCatalogService.getPlanById(sub.plan_id);

  const effective = await resolveEffectiveState(workspaceId, sub, plan);

  return {
    workspace_id: workspaceId,
    plan: plan ? { name: plan.name, display_name: plan.displayName } : null,
    subscription: {
      status: sub.status,
      trial_ends_at: sub.trial_ends_at,
      current_period_end: sub.current_period_end,
      grace_ends_at: sub.grace_ends_at,
      cancel_at_period_end: sub.cancel_at_period_end,
      expires_at: sub.expires_at,
    },
    access: effective,
  };
}

async function resolveEffectiveState(workspaceId: string, sub: SubscriptionRow, plan: Awaited<ReturnType<typeof PlanCatalogService.getPlanById>>) {
  const now = Date.now();
  const trialActive =
    sub.status === 'trialing' &&
    Boolean(sub.trial_ends_at) &&
    new Date(sub.trial_ends_at as string).getTime() > now;
  const graceActive =
    sub.status === 'past_due' &&
    Boolean(sub.grace_ends_at) &&
    new Date(sub.grace_ends_at as string).getTime() > now;

  const access: 'allowed' | 'restricted' | 'denied' =
    sub.status === 'active' || trialActive
      ? 'allowed'
      : graceActive
        ? 'restricted'
        : 'denied';

  const features = (plan?.features ?? {}) as Record<string, boolean>;
  const limits = (plan?.limits ?? {}) as Record<string, number>;

  return {
    effective_access: access,
    explanation:
      access === 'allowed'
        ? 'Subscription is active (or trial is running) — full access per plan entitlements.'
        : access === 'restricted'
          ? 'Payment is past due but within the grace period — data view and billing management remain available; new resource creation and premium features are restricted.'
          : 'Subscription is expired/cancelled and outside any grace period — access is denied (billing management only).',
    features,
    limits,
  };
}
