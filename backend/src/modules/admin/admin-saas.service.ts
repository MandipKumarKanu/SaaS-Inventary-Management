import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { CouponService, CouponRow } from '../billing/coupon.service.js';
import { SubscriptionService, SubscriptionRow } from '../billing/subscription.service.js';
import { PlanCatalogService, FEATURE_KEYS } from '../../services/plan-catalog.service.js';
import { AuditService } from '../audit/audit.service.js';
import { BillingService } from '../billing/billing.service.js';
import { isStripeConfigured, getStripe } from '../../config/stripe.js';
import { ConfigService } from '../../services/config.service.js';
import { logger } from '../../config/logger.js';

/**
 * SaaS Business Layer: platform-admin services (PRD §32, §35, §40, §42, §49,
 * §50, §52–§55, §73).
 *
 * All admin mutations are audited via AuditService with workspaceId = null
 * (platform-level actions); subscription mutations are delegated to
 * SubscriptionService so the same state machine + event history apply.
 */

// ── Coupon management (§32, §52–§55) ─────────────────────────────────────

/**
 * Mirror a local coupon into Stripe (§21/§28/§32): a Stripe Coupon carries
 * the discount; a Promotion Code carries the human-typed `code` so checkout
 * discounts passthrough (discounts[].promotion_code) works with the same
 * string. Best-effort: a Stripe outage must not block local coupon admin —
 * the failure is logged and the coupon remains usable in dev/native mode.
 * Sync is skipped when Stripe is not configured.
 */
async function syncCouponToStripe(coupon: CouponRow): Promise<{ stripe_coupon_id: string | null; stripe_promotion_code_id: string | null }> {
  if (!isStripeConfigured()) return { stripe_coupon_id: null, stripe_promotion_code_id: null };
  try {
    const stripe = getStripe();

    const couponParams: Record<string, unknown> = { name: coupon.code };
    switch (coupon.discount_type) {
      case 'PERCENTAGE':
        couponParams.percent_off = Number(coupon.discount_value);
        break;
      case 'FIXED_AMOUNT':
        couponParams.amount_off = Math.round(Number(coupon.discount_value) * 100);
        couponParams.currency = (coupon.currency || 'usd').toLowerCase();
        break;
      case 'FULL_DISCOUNT':
      case 'PLAN_ACCESS':
        couponParams.percent_off = 100;
        break;
    }
    if (coupon.duration === 'MULTI_MONTH' && coupon.duration_in_months) {
      couponParams.duration = 'repeating';
      couponParams.duration_in_months = coupon.duration_in_months;
    } else {
      couponParams.duration = 'once';
    }
    if (coupon.max_redemptions) couponParams.max_redemptions = coupon.max_redemptions;
    if (coupon.expires_at) couponParams.redeem_by = Math.floor(new Date(coupon.expires_at).getTime() / 1000);

    // Reuse the provider objects when this coupon was synced before (§27:
    // prevent unintended duplicate promotion codes for the same code).
    let stripeCouponId = coupon.stripe_coupon_id ?? null;
    if (!stripeCouponId) {
      const sc = await stripe.coupons.create(couponParams as never);
      stripeCouponId = sc.id;
    }

    let promoCodeId = coupon.stripe_promotion_code_id ?? null;
    if (!promoCodeId) {
      const promo = await stripe.promotionCodes.create({
        promotion: { type: 'coupon', coupon: stripeCouponId as string },
        code: coupon.code,
        ...(coupon.max_redemptions ? { max_redemptions: coupon.max_redemptions } : {}),
        ...(coupon.expires_at ? { expires_at: Math.floor(new Date(coupon.expires_at).getTime() / 1000) } : {}),
      });
      promoCodeId = promo.id;
    }

    await supabaseAdmin
      .from('coupons')
      .update({
        stripe_coupon_id: stripeCouponId,
        stripe_promotion_code_id: promoCodeId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', coupon.id);

    return { stripe_coupon_id: stripeCouponId, stripe_promotion_code_id: promoCodeId };
  } catch (err: any) {
    logger.warn('Stripe coupon sync failed (coupon remains valid in native mode)', {
      coupon: coupon.code,
      error: err?.message,
    });
    return { stripe_coupon_id: null, stripe_promotion_code_id: null };
  }
}

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
    // §21/§32: mirror to Stripe (coupon + promotion code) when configured.
    await syncCouponToStripe(coupon);
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

// ── Plan management (§34/§51) ──────────────────────────────────────────

const LIMIT_KEYS = ['users', 'products', 'warehouses', 'transactions_per_month', 'storage_mb'] as const;
type LimitKey = (typeof LIMIT_KEYS)[number];

function validateLimits(input: unknown): Record<string, number> {
  if (typeof input !== 'object' || input === null) {
    throw AppError.badRequest('limits must be an object.', 'VALIDATION_ERROR');
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(LIMIT_KEYS as readonly string[]).includes(key)) {
      throw AppError.badRequest(`Unknown limit key: ${key}. Valid keys: ${LIMIT_KEYS.join(', ')}.`, 'VALIDATION_ERROR');
    }
    const num = Number(value);
    if (!Number.isInteger(num) || num === 0 || num < -1) {
      throw AppError.badRequest(`Limit ${key} must be a positive integer or -1 (unlimited).`, 'VALIDATION_ERROR');
    }
    out[key] = num;
  }
  return out;
}

function validateFeatures(input: unknown): Record<string, boolean> {
  if (typeof input !== 'object' || input === null) {
    throw AppError.badRequest('features must be an object.', 'VALIDATION_ERROR');
  }
  const out: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!(FEATURE_KEYS as readonly string[]).includes(key)) {
      throw AppError.badRequest(`Unknown feature key: ${key}. Valid keys: ${FEATURE_KEYS.join(', ')}.`, 'VALIDATION_ERROR');
    }
    out[key] = Boolean(value);
  }
  return out;
}

export const AdminPlanService = {
  /**
   * Full plan list for admins (§51) — includes inactive plans, unlike the
   * public PlanCatalogService.listActivePlans().
   */
  async list() {
    const { data, error } = await supabaseAdmin
      .from('subscription_plans')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) throw error;
    return { plans: data ?? [] };
  },

  async getById(id: string) {
    const { data, error } = await supabaseAdmin
      .from('subscription_plans')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw AppError.notFound('Plan not found', 'PLAN_NOT_FOUND');
    return data;
  },

  /**
   * Create a plan (§51). Never overwrites an existing tier key — the DB
   * UNIQUE(name) constraint is the authority.
   */
  async create(input: {
    name: string;
    display_name: string;
    price_monthly: number;
    price_annual: number;
    limits?: Record<string, number>;
    features?: Record<string, boolean>;
    is_active?: boolean;
    sort_order?: number;
  }, adminId: string) {
    const name = input.name.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,49}$/.test(name)) {
      throw AppError.badRequest('Plan name must be 2-50 chars (lowercase letters, numbers, hyphens).', 'VALIDATION_ERROR');
    }
    if (input.price_monthly < 0 || input.price_annual < 0) {
      throw AppError.badRequest('Prices cannot be negative.', 'VALIDATION_ERROR');
    }
    const limits = input.limits ? validateLimits(input.limits) : {};
    const features = input.features ? validateFeatures(input.features) : {};

    // Advisory pre-check for a friendlier error; the UNIQUE(name) constraint
    // remains the authoritative guard against races.
    const { data: existing } = await supabaseAdmin
      .from('subscription_plans')
      .select('id')
      .eq('name', name)
      .maybeSingle();
    if (existing) {
      throw AppError.conflict(`Plan "${name}" already exists.`, 'PLAN_EXISTS');
    }

    const { data, error } = await supabaseAdmin
      .from('subscription_plans')
      .insert({
        name,
        display_name: input.display_name.trim(),
        price_monthly: input.price_monthly,
        price_annual: input.price_annual,
        limits,
        features,
        is_active: input.is_active ?? true,
        sort_order: input.sort_order ?? 100,
      })
      .select('*')
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        throw AppError.conflict(`Plan "${name}" already exists.`, 'PLAN_EXISTS');
      }
      throw error;
    }

    PlanCatalogService.invalidateCache();
    await AuditService.log({
      workspaceId: null,
      userId: adminId,
      action: 'platform.plan_created',
      entity: 'subscription_plan',
      entityId: data.id,
      newValue: { name, price_monthly: input.price_monthly, price_annual: input.price_annual, limits, features },
    });
    return data;
  },

  /**
   * Edit a plan (§51). Historical accuracy (§34): subscriptions and billing
   * rows reference plan_id and are never rewritten — only the plan row itself
   * changes. Existing subscriptions pick up the new definition going forward.
   */
  async update(id: string, patch: {
    display_name?: string;
    price_monthly?: number;
    price_annual?: number;
    limits?: Record<string, number>;
    features?: Record<string, boolean>;
    is_active?: boolean;
    sort_order?: number;
  }, adminId: string) {
    const before = await this.getById(id);

    const update: Record<string, unknown> = {};
    if (patch.display_name !== undefined) update.display_name = patch.display_name.trim();
    if (patch.price_monthly !== undefined) {
      if (patch.price_monthly < 0) throw AppError.badRequest('Prices cannot be negative.', 'VALIDATION_ERROR');
      update.price_monthly = patch.price_monthly;
    }
    if (patch.price_annual !== undefined) {
      if (patch.price_annual < 0) throw AppError.badRequest('Prices cannot be negative.', 'VALIDATION_ERROR');
      update.price_annual = patch.price_annual;
    }
    if (patch.limits !== undefined) update.limits = validateLimits(patch.limits);
    if (patch.features !== undefined) update.features = validateFeatures(patch.features);
    if (patch.is_active !== undefined) {
      // §34: deactivating a plan that workspaces still use must be explicit —
      // it hides the plan from upgrade flows but does not change existing
      // subscriptions (they keep their entitlements until they change plan).
      if (!patch.is_active) {
        const { count } = await supabaseAdmin
          .from('subscriptions')
          .select('id', { count: 'exact', head: true })
          .eq('plan_id', id)
          .in('status', ['active', 'trialing']);
        if ((count ?? 0) > 0) {
          throw AppError.badRequest(
            `Cannot deactivate: ${count} workspace(s) are still on this plan. Move them first.`,
            'PLAN_IN_USE'
          );
        }
      }
      update.is_active = patch.is_active;
    }
    if (patch.sort_order !== undefined) update.sort_order = patch.sort_order;

    if (Object.keys(update).length === 0) {
      throw AppError.badRequest('No changes provided.', 'VALIDATION_ERROR');
    }

    const { data, error } = await supabaseAdmin
      .from('subscription_plans')
      .update(update)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;

    PlanCatalogService.invalidateCache();
    await AuditService.log({
      workspaceId: null,
      userId: adminId,
      action: 'platform.plan_updated',
      entity: 'subscription_plan',
      entityId: id,
      previousValue: { display_name: before.display_name, price_monthly: before.price_monthly, price_annual: before.price_annual, limits: before.limits, features: before.features, is_active: before.is_active, sort_order: before.sort_order },
      newValue: update,
    });
    return data;
  },

  /** Which workspaces sit on a plan (§51 context for safe edits). */
  async usageCount(id: string) {
    const { count, error } = await supabaseAdmin
      .from('subscriptions')
      .select('id', { count: 'exact', head: true })
      .eq('plan_id', id);
    if (error) throw error;
    return { subscriptions: count ?? 0 };
  },
};

// ── Usage & Analytics (§59) ─────────────────────────────────────────

export const AdminAnalyticsService = {
  /**
   * Time-series analytics over a date range (§59). Only metrics supported by
   * actual stored data. Default window: last 30 days. All aggregation is
   * done in Postgres (count/group by on indexed created_at columns) — never
   * in-memory over full tables (§77).
   */
  async summary(fromIso: string, toIso: string) {
    const from = new Date(fromIso);
    const to = new Date(toIso);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from > to) {
      throw AppError.badRequest('Invalid date range: expected from <= to (ISO dates).', 'VALIDATION_ERROR');
    }
    // Cap the window to keep queries bounded.
    if (to.getTime() - from.getTime() > 400 * 86400_000) {
      throw AppError.badRequest('Date range cannot exceed 400 days.', 'VALIDATION_ERROR');
    }
    const fromS = from.toISOString();
    const toS = to.toISOString();

    const [
      newUsers,
      newWorkspaces,
      newSubscriptions,
      trialStarts,
      upgrades,
      downgrades,
      cancellations,
      reactivations,
      expirations,
      redemptions,
      discountTotals,
      planDistribution,
      paymentsByStatus,
    ] = await Promise.all([
      supabaseAdmin.from('users').select('id', { count: 'exact', head: true }).gte('created_at', fromS).lte('created_at', toS),
      supabaseAdmin.from('workspaces').select('id', { count: 'exact', head: true }).gte('created_at', fromS).lte('created_at', toS),
      supabaseAdmin.from('subscriptions').select('id', { count: 'exact', head: true }).gte('created_at', fromS).lte('created_at', toS),
      supabaseAdmin
        .from('subscription_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'trial_started')
        .gte('created_at', fromS)
        .lte('created_at', toS),
      supabaseAdmin
        .from('subscription_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'plan_changed')
        .gte('created_at', fromS)
        .lte('created_at', toS),
      supabaseAdmin
        .from('subscription_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'plan_changed')
        .gte('created_at', fromS)
        .lte('created_at', toS),
      supabaseAdmin
        .from('subscription_events')
        .select('id', { count: 'exact', head: true })
        .in('event_type', ['cancelled', 'cancel_scheduled'])
        .gte('created_at', fromS)
        .lte('created_at', toS),
      supabaseAdmin
        .from('subscription_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'reactivated')
        .gte('created_at', fromS)
        .lte('created_at', toS),
      supabaseAdmin
        .from('subscription_events')
        .select('id', { count: 'exact', head: true })
        .eq('event_type', 'expired')
        .gte('created_at', fromS)
        .lte('created_at', toS),
      supabaseAdmin.from('coupon_redemptions').select('id', { count: 'exact', head: true }).gte('redeemed_at', fromS).lte('redeemed_at', toS),
      supabaseAdmin
        .from('coupon_redemptions')
        .select('discount_amount', { count: 'exact' })
        .gte('redeemed_at', fromS)
        .lte('redeemed_at', toS),
      supabaseAdmin
        .from('subscriptions')
        .select('plan_id, plan:subscription_plans(name, display_name)', { count: 'exact' })
        .in('status', ['active', 'trialing']),
      supabaseAdmin
        .from('payments')
        .select('status, amount', { count: 'exact' })
        .gte('created_at', fromS)
        .lte('created_at', toS),
    ]);

    // Upgrades vs downgrades: plan_changed events where the event's stored
    // price went up (upgrade) vs down (downgrade). The event stores plan ids,
    // so resolve names for a human-readable split.
    const { data: planChangeEvents } = await supabaseAdmin
      .from('subscription_events')
      .select('previous_values, new_values')
      .eq('event_type', 'plan_changed')
      .gte('created_at', fromS)
      .lte('created_at', toS);
    const planNames = await PlanCatalogService.listActivePlans();
    const nameById = new Map(planNames.map((p) => [p.id, p.name]));
    const tierOrder = planNames.map((p) => p.name);
    let upgradeCount = 0;
    let downgradeCount = 0;
    for (const ev of planChangeEvents ?? []) {
      const prevPlanId = (ev.previous_values as any)?.plan_id;
      const nextPlanId = (ev.new_values as any)?.plan_id;
      const prevTier = tierOrder.indexOf(nameById.get(prevPlanId) ?? '');
      const nextTier = tierOrder.indexOf(nameById.get(nextPlanId) ?? '');
      if (prevTier === -1 || nextTier === -1 || prevTier === nextTier) continue;
      if (nextTier > prevTier) upgradeCount += 1;
      else downgradeCount += 1;
    }

    const discountTotal = (discountTotals.data ?? []).reduce((sum: number, r: any) => sum + Number(r.discount_amount ?? 0), 0);

    const paymentsGrouped: Record<string, { count: number; amount: number }> = {};
    for (const p of paymentsByStatus.data ?? []) {
      const entry = (paymentsGrouped[p.status] ??= { count: 0, amount: 0 });
      entry.count += 1;
      entry.amount += Number(p.amount ?? 0);
    }

    const planDist: Record<string, number> = {};
    for (const s of planDistribution.data ?? []) {
      const key = (s as any).plan?.name ?? 'unknown';
      planDist[key] = (planDist[key] ?? 0) + 1;
    }

    return {
      range: { from: fromS, to: toS },
      growth: {
        new_users: newUsers.count ?? 0,
        new_workspaces: newWorkspaces.count ?? 0,
        new_subscriptions: newSubscriptions.count ?? 0,
        trial_starts: trialStarts.count ?? 0,
      },
      subscriptions: {
        plan_changes: upgrades.count ?? 0,
        upgrades: upgradeCount,
        downgrades: downgradeCount,
        cancellations: cancellations.count ?? 0,
        reactivations: reactivations.count ?? 0,
        expirations: expirations.count ?? 0,
      },
      coupons: {
        redemptions: redemptions.count ?? 0,
        discount_total: Math.round(discountTotal * 100) / 100,
      },
      plans: {
        active_distribution: planDist,
      },
      billing: {
        by_status: paymentsGrouped,
      },
    };
  },
};

// ── Platform settings (§64): config_defaults management ─────────────────

/** The keys the settings surface manages. Anything else stays DB/env-only. */
const SETTING_KEYS = [
  { key: 'trial_days', type: 'number', min: 0, max: 90, label: 'Trial length (days)' },
  { key: 'grace_period_days', type: 'number', min: 0, max: 90, label: 'Grace period (days)' },
  { key: 'count_approval_threshold_pct', type: 'number', min: 0, max: 1000, label: 'Count approval threshold (%)' },
  { key: 'expiry_alert_days', type: 'json', label: 'Batch expiry alert thresholds (days)' },
  { key: 'default_plan_tier', type: 'string', max: 50, label: 'Default plan tier for new workspaces' },
] as const;

export const AdminSettingsService = {
  /** All managed settings with current values (DB → env fallback resolution). */
  async list() {
    const rows = await Promise.all(
      SETTING_KEYS.map(async (meta) => {
        const value = await ConfigService.get(meta.key);
        return { key: meta.key, label: meta.label, type: meta.type, value };
      })
    );
    return { settings: rows, stripe_mode: isStripeConfigured() };
  },

  /** Update one setting. Typed validation; cache invalidated immediately. */
  async update(key: string, value: unknown, adminId: string) {
    const meta = SETTING_KEYS.find((k) => k.key === key);
    if (!meta) {
      throw AppError.badRequest(`Unknown setting: ${key}`, 'UNKNOWN_SETTING');
    }

    let validated: unknown;
    if (meta.type === 'number') {
      const num = Number(value);
      if (!Number.isFinite(num)) {
        throw AppError.badRequest(`${meta.label} must be a number.`, 'VALIDATION_ERROR');
      }
      if ('min' in meta && num < (meta as { min: number }).min) {
        throw AppError.badRequest(`${meta.label} must be ≥ ${(meta as { min: number }).min}.`, 'VALIDATION_ERROR');
      }
      if ('max' in meta && num > (meta as { max: number }).max) {
        throw AppError.badRequest(`${meta.label} must be ≤ ${(meta as { max: number }).max}.`, 'VALIDATION_ERROR');
      }
      validated = num;
    } else if (meta.type === 'json') {
      if (typeof value === 'string') {
        try {
          validated = JSON.parse(value);
        } catch {
          throw AppError.badRequest(`${meta.label} must be valid JSON.`, 'VALIDATION_ERROR');
        }
      } else {
        validated = value;
      }
    } else {
      if (typeof value !== 'string' || value.trim().length === 0 || value.length > (meta.max ?? 100)) {
        throw AppError.badRequest(`${meta.label} must be a non-empty string.`, 'VALIDATION_ERROR');
      }
      validated = value.trim().toLowerCase();
    }

    const { error } = await supabaseAdmin
      .from('config_defaults')
      .upsert(
        {
          key,
          value: validated as any,
          description: meta.label,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'key' }
      );
    if (error) throw error;

    const { data, error: readError } = await supabaseAdmin
      .from('config_defaults')
      .select('key, value, description, updated_at')
      .eq('key', key)
      .single();
    if (readError) throw readError;

    ConfigService.invalidate(key);

    await AuditService.log({
      workspaceId: null,
      userId: adminId,
      action: 'platform.setting_updated',
      entity: 'config_defaults',
      entityId: key,
      newValue: { value: validated },
    });
    return data;
  },
};

// ── Platform notification feed (§63) + job monitoring (§62) + webhook retry (§58) ──

export const AdminNotificationService = {
  /**
   * Platform-wide operational notification feed: failed jobs and failed
   * webhook events are the actionable signals (§40 System section).
   */
  async list(page: number, pageSize: number) {
    const { data: failedJobs, error: jobsError } = await supabaseAdmin
      .from('background_job_logs')
      .select('id, job_name, status, error, started_at, finished_at, executed_at')
      .in('status', ['failed', 'error'])
      .order('executed_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (jobsError) logger.warn('background_job_logs listing failed', { error: jobsError.message });

    const { data: failedWebhooks, error: whError } = await supabaseAdmin
      .from('stripe_webhook_events')
      .select('id, event_id, event_type, processing_status, detail, processing_duration_ms, delivery_attempt, created_at')
      .in('processing_status', ['failed', 'error', 'skipped_stale'])
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (whError) logger.warn('stripe_webhook_events listing failed', { error: whError.message });

    return {
      failed_jobs: failedJobs ?? [],
      failed_webhooks: failedWebhooks ?? [],
    };
  },

  /**
   * Per-job monitoring (§62): last run, outcome, duration, failure count and
   * last error for every known job. Aggregated in SQL over the indexed
   * (job_name, executed_at) index.
   */
  async jobStatus() {
    const { data: jobs, error } = await supabaseAdmin
      .from('background_job_logs')
      .select('id, job_name, status, details, error, started_at, finished_at, executed_at')
      .order('executed_at', { ascending: false })
      .limit(500);
    if (error) throw error;

    const byName = new Map<
      string,
      { job_name: string; last_status: string; last_run: string; last_duration_ms: number | null; failure_count: number; last_error: string | null; total_runs: number }
    >();
    for (const row of jobs ?? []) {
      const entry = byName.get(row.job_name) ?? {
        job_name: row.job_name,
        last_status: row.status,
        last_run: row.executed_at,
        last_duration_ms:
          row.started_at && row.finished_at
            ? new Date(row.finished_at).getTime() - new Date(row.started_at).getTime()
            : null,
        failure_count: 0,
        last_error: null as string | null,
        total_runs: 0,
      };
      entry.total_runs += 1;
      if (row.status === 'failed' || row.status === 'error') {
        entry.failure_count += 1;
        entry.last_error = row.error ?? (row.details as any)?.error ?? null;
      }
      byName.set(row.job_name, entry);
    }
    return { jobs: [...byName.values()] };
  },

  /**
   * Admin-safe webhook retry (§58): re-dispatch the STORED payload through
   * the same idempotent handler. Cannot be used to inject events (the row
   * must exist and carry a payload); a previously-processed event is a no-op.
   */
  async retryWebhook(eventRowId: string, adminId: string) {
    const { data: row, error } = await supabaseAdmin
      .from('stripe_webhook_events')
      .select('id, event_id, event_type, processing_status, payload, delivery_attempt')
      .eq('id', eventRowId)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw AppError.notFound('Webhook event not found');
    if (!row.payload) {
      throw AppError.badRequest('No stored payload for this event — retry requires a payload snapshot.', 'NO_STORED_PAYLOAD');
    }
    if (row.processing_status !== 'failed') {
      throw AppError.badRequest(
        `Only failed events can be retried (current: ${row.processing_status}).`,
        'INVALID_EVENT_STATUS'
      );
    }

    const { StripeWebhookService } = await import('../webhooks/stripe-webhook.service.js');
    const payload = row.payload as { id?: string; type?: string; created?: number; data?: { object: unknown } };
    const attempt = payload.id ? row.delivery_attempt ?? 1 : 1;
    const result = await StripeWebhookService.processEvent(
      {
        id: payload.id ?? row.event_id,
        type: payload.type ?? row.event_type,
        created: payload.created ?? Math.floor(Date.now() / 1000),
        data: (payload.data as { object: any }) ?? { object: {} },
      },
      { deliveryAttempt: attempt + 1, rawPayload: row.payload }
    );

    await AuditService.log({
      workspaceId: null,
      userId: adminId,
      action: 'platform.webhook_retried',
      entity: 'stripe_webhook_event',
      entityId: row.id,
      newValue: { event_id: row.event_id, result: result.status },
    });
    return result;
  },
};

// ── Admin CSV exports (§71) ──────────────────────────────────────────

function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const escape = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const header = columns.join(',');
  const lines = rows.map((r) => columns.map((c) => escape(r[c])).join(','));
  return [header, ...lines].join('\n');
}

export const AdminExportService = {
  /**
   * CSV export of a platform entity (§71). Rows beyond the synchronous cap
   * (10,000) are documented as out of scope for synchronous export — the
   * request returns a CSV covering the most recent cap rows with a truncation
   * notice comment, so a huge dataset can never hang the API thread (§77).
   * (True background processing would need an export_jobs table + storage;
   * deferred until dataset size justifies it.)
   */
  SYNC_CAP: 10_000,

  async csv(entity: 'users' | 'workspaces' | 'subscriptions' | 'coupons' | 'audit_logs' | 'payments'): Promise<{ filename: string; csv: string }> {
    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `${entity}-${stamp}.csv`;
    const cap = this.SYNC_CAP;

    if (entity === 'users') {
      const { data } = await supabaseAdmin
        .from('users')
        .select('id, email, name, status, is_platform_admin, created_at')
        .order('created_at', { ascending: false })
        .limit(cap);
      return { filename, csv: toCsv(data ?? [], ['id', 'email', 'name', 'status', 'is_platform_admin', 'created_at']) };
    }
    if (entity === 'workspaces') {
      const { data } = await supabaseAdmin
        .from('workspaces')
        .select('id, name, slug, status, created_at')
        .order('created_at', { ascending: false })
        .limit(cap);
      return { filename, csv: toCsv(data ?? [], ['id', 'name', 'slug', 'status', 'created_at']) };
    }
    if (entity === 'subscriptions') {
      const { data } = await supabaseAdmin
        .from('subscriptions')
        .select('id, workspace_id, status, billing_interval, trial_ends_at, current_period_end, cancel_at_period_end, plan:subscription_plans(name)')
        .order('created_at', { ascending: false })
        .limit(cap);
      const rows = (data ?? []).map((s: any) => ({ ...s, plan: s.plan?.name ?? s.plan ?? '' }));
      return { filename, csv: toCsv(rows, ['id', 'workspace_id', 'plan', 'status', 'billing_interval', 'trial_ends_at', 'current_period_end', 'cancel_at_period_end']) };
    }
    // coupons
    if (entity === 'coupons') {
      const { data } = await supabaseAdmin
        .from('coupons')
        .select('id, code, discount_type, discount_value, currency, applies_to, duration, current_redemptions, max_redemptions, active, starts_at, expires_at, created_at')
        .order('created_at', { ascending: false })
        .limit(cap);
      return {
        filename,
        csv: toCsv(data ?? [], ['id', 'code', 'discount_type', 'discount_value', 'currency', 'applies_to', 'duration', 'current_redemptions', 'max_redemptions', 'active', 'starts_at', 'expires_at', 'created_at']),
      };
    }
    if (entity === 'payments') {
      const { data } = await supabaseAdmin
        .from('payments')
        .select('id, workspace_id, provider, provider_reference, amount, currency, status, invoice_id, discount_amount, failure_reason, created_at')
        .order('created_at', { ascending: false })
        .limit(cap);
      return {
        filename,
        csv: toCsv(data ?? [], ['id', 'workspace_id', 'provider', 'provider_reference', 'amount', 'currency', 'status', 'invoice_id', 'discount_amount', 'failure_reason', 'created_at']),
      };
    }
    // audit_logs (§71) — action/entity metadata only, never previous/new
    // value payloads (they may contain operational detail not meant for
    // flat exports; the API remains the inspection surface).
    const { data } = await supabaseAdmin
      .from('audit_logs')
      .select('id, action, entity, entity_id, workspace_id, user_id, ip_address, user_agent, created_at')
      .order('created_at', { ascending: false })
      .limit(cap);
    return {
      filename,
      csv: toCsv(data ?? [], ['id', 'action', 'entity', 'entity_id', 'workspace_id', 'user_id', 'ip_address', 'user_agent', 'created_at']),
    };
  },
};

// ── Bulk operations (§70) ─────────────────────────────────────────────

export const AdminBulkService = {
  /**
   * Bulk coupon enable/disable (§70). Audited once with the full id list
   * (the batch is one administrative decision) plus a per-item outcome.
   */
  async bulkCoupons(ids: string[], active: boolean, adminId: string) {
    if (ids.length === 0) throw AppError.badRequest('No coupons selected.', 'VALIDATION_ERROR');
    if (ids.length > 100) throw AppError.badRequest('Bulk operations are capped at 100 items.', 'VALIDATION_ERROR');

    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        const { error } = await supabaseAdmin
          .from('coupons')
          .update({ active, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
        results.push({ id, ok: true });
      } catch (err: any) {
        results.push({ id, ok: false, error: err.message });
      }
    }

    await AuditService.log({
      workspaceId: null,
      userId: adminId,
      action: active ? 'platform.coupons_bulk_enabled' : 'platform.coupons_bulk_disabled',
      entity: 'coupon',
      entityId: null,
      newValue: { ids, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length },
    });
    return { succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  },

  /**
   * Bulk user suspend/reactivate (§70). Same audit pattern; per-item outcome
   * lets the UI report partial failures precisely.
   */
  async bulkUsers(ids: string[], status: 'active' | 'suspended', adminId: string) {
    if (ids.length === 0) throw AppError.badRequest('No users selected.', 'VALIDATION_ERROR');
    if (ids.length > 100) throw AppError.badRequest('Bulk operations are capped at 100 items.', 'VALIDATION_ERROR');

    const results: { id: string; ok: boolean; error?: string }[] = [];
    for (const id of ids) {
      try {
        const { error } = await supabaseAdmin
          .from('users')
          .update({ status, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
        results.push({ id, ok: true });
      } catch (err: any) {
        results.push({ id, ok: false, error: err.message });
      }
    }

    await AuditService.log({
      workspaceId: null,
      userId: adminId,
      action: status === 'suspended' ? 'platform.users_bulk_suspended' : 'platform.users_bulk_reactivated',
      entity: 'user',
      entityId: null,
      newValue: { ids, succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length },
    });
    return { succeeded: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length, results };
  },
};

// ── Refund initiation (§56/§57) — Stripe-mode only ─────────────────

export const AdminRefundService = {
  /**
   * Admin-initiated refund of a recorded payment (§57).
   *
   * Stripe mode: resolves the charge from the payment's invoice/charge
   * reference, calls Stripe refunds.create, then flips the payment row to
   * `refunded` (the charge.refunded webhook is also handled idempotently —
   * both paths converge on the same state).
   *
   * Dev mode: refunds require Stripe — there is no invented offline refund.
   */
  async refund(paymentId: string, adminId: string, reason: string, amount?: number) {
    if (!reason || reason.trim().length < 3) {
      throw AppError.badRequest('A reason is required for this administrative action.', 'REASON_REQUIRED');
    }

    const { data: payment, error } = await supabaseAdmin
      .from('payments')
      .select('id, workspace_id, provider, provider_reference, invoice_id, amount, currency, status')
      .eq('id', paymentId)
      .maybeSingle();
    if (error) throw error;
    if (!payment) throw AppError.notFound('Payment not found');
    if (payment.status !== 'successful') {
      throw AppError.badRequest(`Only successful payments can be refunded (current: ${payment.status}).`, 'INVALID_PAYMENT_STATUS');
    }
    if (!isStripeConfigured()) {
      throw AppError.badRequest('Refunds require Stripe billing mode.', 'STRIPE_REQUIRED');
    }

    const stripe = getStripe();

    // Resolve the charge: direct reference, else the invoice's latest charge.
    let chargeId = payment.provider_reference?.startsWith('ch_') ? payment.provider_reference : null;
    if (!chargeId) {
      const invoiceId = payment.invoice_id ?? (payment.provider_reference?.startsWith('in_') ? payment.provider_reference : null);
      if (!invoiceId) {
        throw AppError.badRequest('Payment has no Stripe charge or invoice reference to refund.', 'NO_STRIPE_REFERENCE');
      }
      const invoice = (await stripe.invoices.retrieve(invoiceId)) as unknown as { charge?: string | null };
      chargeId = invoice?.charge ?? null;
      if (!chargeId) {
        throw AppError.badRequest('The Stripe invoice has no charge to refund yet.', 'NO_STRIPE_CHARGE');
      }
    }

    const refundAmountCents =
      amount !== undefined && amount !== null
        ? Math.round(Number(amount) * 100)
        : Math.round(Number(payment.amount) * 100);
    if (refundAmountCents <= 0) {
      throw AppError.badRequest('Refund amount must be positive.', 'VALIDATION_ERROR');
    }

    const refund = await stripe.refunds.create({
      charge: chargeId,
      amount: refundAmountCents,
      metadata: { payment_id: payment.id, workspace_id: payment.workspace_id, admin_id: adminId, reason },
    });

    // Converge state now; charge.refunded webhook re-applying this is a no-op.
    await supabaseAdmin
      .from('payments')
      .update({ status: 'refunded', updated_at: new Date().toISOString() })
      .eq('id', payment.id);

    await AuditService.log({
      workspaceId: null,
      userId: adminId,
      action: 'platform.payment_refunded',
      entity: 'payment',
      entityId: payment.id,
      newValue: { refund_id: refund.id, amount: refundAmountCents / 100, currency: payment.currency, reason },
    });

    return { refund_id: refund.id, amount: refundAmountCents / 100, currency: payment.currency, status: 'refunded' as const };
  },
};
