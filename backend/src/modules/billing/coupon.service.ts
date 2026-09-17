import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { PlanCatalogService } from '../../services/plan-catalog.service.js';
import { withTransaction, TxClient } from '../../db/pool.js';
import { logger } from '../../config/logger.js';
import crypto from 'crypto';

/**
 * SaaS Business Layer: coupons as first-class billing entities.
 * PRD refs: §21–§34 (model, types, eligibility, preview, redemption,
 *           duration, limits, expiration, security, admin management).
 *
 * Invariants enforced here (never in the frontend):
 *  - All pricing math is server-side from subscription_plans (§26).
 *  - Redemption is transactional: advisory lock + atomic conditional counter
 *    bump + DB-unique workspace constraint, so concurrent requests cannot
 *    bypass any limit (§29, §81).
 *  - Validation re-checks every rule at redemption time (§24); the preview
 *    endpoint is informational only.
 *  - Error messages never confirm whether an unknown code exists (§31).
 */

export type CouponRow = {
  id: string;
  code: string;
  description: string | null;
  discount_type: 'PERCENTAGE' | 'FIXED_AMOUNT' | 'FULL_DISCOUNT' | 'PLAN_ACCESS';
  discount_value: string | number;
  currency: string;
  target_plan_id: string | null;
  applicable_plan_ids: string[];
  applies_to: 'new_subscriptions' | 'upgrades' | 'renewals' | 'reactivations' | 'any';
  duration: 'ONE_TIME' | 'FIRST_PERIOD' | 'MULTI_MONTH';
  duration_in_months: number | null;
  starts_at: string;
  expires_at: string | null;
  max_redemptions: number | null;
  max_redemptions_per_user: number | null;
  max_redemptions_per_workspace: number | null;
  current_redemptions: number;
  active: boolean;
  stripe_coupon_id?: string | null;
  stripe_promotion_code_id?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type CouponOperation = 'new_subscription' | 'upgrade' | 'renewal' | 'reactivation';

export type CouponPricing = {
  originalAmount: number;
  discountAmount: number;
  finalAmount: number;
  currency: string;
};

export type CouponValidation =
  | { valid: true; coupon: CouponRow; pricing: CouponPricing; grantPlanId: string | null }
  | { valid: false; code: string; message: string };

const APPLIES_TO_BY_OPERATION: Record<CouponOperation, string[]> = {
  new_subscription: ['new_subscriptions', 'any'],
  upgrade: ['upgrades', 'any'],
  renewal: ['renewals', 'any'],
  reactivation: ['reactivations', 'any'],
};

/** Codes are normalized: uppercase, alphanumerics + hyphen only. */
export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}

const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{2,39}$/;

/** Compute the admin-facing lifecycle status (§75) at read time. */
export function computeCouponStatus(coupon: CouponRow): string {
  const now = Date.now();
  if (!coupon.active) return 'disabled';
  if (coupon.expires_at && new Date(coupon.expires_at).getTime() < now) return 'expired';
  if (new Date(coupon.starts_at).getTime() > now) return 'scheduled';
  if (coupon.max_redemptions !== null && coupon.current_redemptions >= coupon.max_redemptions)
    return 'exhausted';
  return 'active';
}

export class CouponService {
  // ── Validation core (shared by preview and redemption) ────────────────

  private static async loadCoupon(code: string): Promise<CouponRow | null> {
    const { data, error } = await supabaseAdmin
      .from('coupons')
      .select('*')
      .eq('code', code)
      .maybeSingle();
    if (error) throw error;
    return (data as CouponRow) ?? null;
  }

  private static checkTemporalState(coupon: CouponRow): { ok: boolean; code: string; message: string } {
    const now = Date.now();
    if (!coupon.active) return { ok: false, code: 'COUPON_DISABLED', message: 'This coupon is not active.' };
    if (new Date(coupon.starts_at).getTime() > now)
      return { ok: false, code: 'COUPON_NOT_STARTED', message: 'This coupon is not active yet.' };
    if (coupon.expires_at && new Date(coupon.expires_at).getTime() < now)
      return { ok: false, code: 'COUPON_EXPIRED', message: 'This coupon has expired.' };
    if (coupon.max_redemptions !== null && coupon.current_redemptions >= coupon.max_redemptions)
      return { ok: false, code: 'COUPON_EXHAUSTED', message: 'This coupon has reached its redemption limit.' };
    return { ok: true, code: '', message: '' };
  }

  /**
   * Pure validation + pricing. Mutates nothing. `originalAmountOverride`
   * lets renewal flows supply the actual renewal amount; everything else
   * prices from the plan catalog (server-side only — §26).
   */
  static async validate(
    code: string,
    workspaceId: string,
    userId: string,
    targetPlanName: string,
    operation: CouponOperation,
    originalAmountOverride?: number
  ): Promise<CouponValidation> {
    const normalized = normalizeCouponCode(code);
    if (!CODE_PATTERN.test(normalized)) {
      return { valid: false, code: 'COUPON_INVALID', message: 'This coupon code is not valid.' };
    }

    const coupon = await this.loadCoupon(normalized);
    if (!coupon) {
      // Generic on purpose (§31 — no enumeration aid).
      return { valid: false, code: 'COUPON_INVALID', message: 'This coupon code is not valid.' };
    }

    const temporal = this.checkTemporalState(coupon);
    if (!temporal.ok) {
      return { valid: false, code: temporal.code, message: temporal.message };
    }

    // Plan eligibility: explicit list wins; empty = all active plans.
    const targetPlan = await PlanCatalogService.requirePlanByName(targetPlanName);
    const applicable =
      coupon.applicable_plan_ids.length === 0 ||
      coupon.applicable_plan_ids.includes(targetPlan.id);
    if (!applicable || (coupon.target_plan_id && coupon.target_plan_id !== targetPlan.id)) {
      return { valid: false, code: 'COUPON_PLAN_NOT_ELIGIBLE', message: 'This coupon cannot be used for the selected plan.' };
    }

    // Operation compatibility (§27): config decides which flows it covers.
    if (!APPLIES_TO_BY_OPERATION[operation].includes(coupon.applies_to)) {
      return { valid: false, code: 'COUPON_OPERATION_NOT_ALLOWED', message: 'This coupon cannot be used for this operation.' };
    }

    // Per-user / per-workspace limits (§29) — counted from redemption
    // history; the authoritative re-check happens inside redeemInTx.
    const [{ count: userCount }, { count: wsCount }] = await Promise.all([
      supabaseAdmin.from('coupon_redemptions').select('id', { count: 'exact', head: true }).eq('coupon_id', coupon.id).eq('user_id', userId),
      supabaseAdmin.from('coupon_redemptions').select('id', { count: 'exact', head: true }).eq('coupon_id', coupon.id).eq('workspace_id', workspaceId),
    ]);
    if (coupon.max_redemptions_per_user !== null && (userCount ?? 0) >= coupon.max_redemptions_per_user) {
      return { valid: false, code: 'COUPON_USER_LIMIT', message: 'You have already redeemed this coupon.' };
    }
    if (coupon.max_redemptions_per_workspace !== null && (wsCount ?? 0) >= coupon.max_redemptions_per_workspace) {
      return { valid: false, code: 'COUPON_WORKSPACE_LIMIT', message: 'This workspace has already redeemed this coupon.' };
    }

    const originalAmount =
      originalAmountOverride !== undefined ? originalAmountOverride : Number(targetPlan.priceMonthly);
    const pricing = this.calculatePricing(coupon, originalAmount);
    const grantPlanId = coupon.discount_type === 'PLAN_ACCESS' ? targetPlan.id : null;

    return { valid: true, coupon, pricing, grantPlanId };
  }

  /** Pricing math is pure so preview and redemption can never diverge. */
  static calculatePricing(coupon: CouponRow, originalAmount: number): CouponPricing {
    let discount = 0;
    switch (coupon.discount_type) {
      case 'PERCENTAGE':
        discount = Math.round(originalAmount * (Number(coupon.discount_value) / 100) * 100) / 100;
        break;
      case 'FIXED_AMOUNT':
        discount = Math.min(Number(coupon.discount_value), originalAmount);
        break;
      case 'FULL_DISCOUNT':
      case 'PLAN_ACCESS':
        discount = originalAmount;
        break;
    }
    const finalAmount = Math.max(0, Math.round((originalAmount - discount) * 100) / 100);
    return {
      originalAmount: Math.round(originalAmount * 100) / 100,
      discountAmount: discount,
      finalAmount,
      currency: coupon.currency,
    };
  }

  /** Informational preview for the billing UI (§24). Rate-limited at the route. */
  static async preview(
    code: string,
    workspaceId: string,
    userId: string,
    targetPlanName: string,
    operation: CouponOperation,
    originalAmountOverride?: number
  ) {
    const result = await this.validate(code, workspaceId, userId, targetPlanName, operation, originalAmountOverride);
    if (!result.valid) return { valid: false as const, error: { code: result.code, message: result.message } };
    return {
      valid: true as const,
      coupon: {
        code: result.coupon.code,
        discount_type: result.coupon.discount_type,
        discount_value: Number(result.coupon.discount_value),
        duration: result.coupon.duration,
        duration_in_months: result.coupon.duration_in_months,
        applies_to: result.coupon.applies_to,
      },
      pricing: result.pricing,
      grantPlanId: result.grantPlanId,
    };
  }

  // ── Redemption (atomic; runs INSIDE the billing transaction, §80) ─────

  /**
   * Insert the redemption row + bump the global counter. Concurrency:
   *  - `pg_advisory_xact_lock` serializes redemptions per coupon (cheap —
   *    redemptions are rare, correctness is paramount).
   *  - Global limit: conditional `UPDATE ... WHERE current < max` (atomic).
   *  - Per-workspace limit: UNIQUE(coupon_id, workspace_id) at the DB level.
   *  - Per-user limit: counted check under the advisory lock.
   * Any violation throws → the caller's whole transaction rolls back.
   */
  static async redeemInTx(
    client: TxClient,
    coupon: CouponRow,
    params: {
      workspaceId: string;
      userId: string;
      subscriptionId: string | null;
      planId: string | null;
      operation: CouponOperation;
      pricing: CouponPricing;
      metadata?: Record<string, unknown>;
    }
  ): Promise<string> {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1)::bigint)`, [coupon.id]);

    // Per-user limit (re-checked under the lock — the preview check is not
    // authoritative: §24).
    if (coupon.max_redemptions_per_user !== null) {
      const { rows } = await client.query(
        `SELECT COUNT(*)::int AS n FROM public.coupon_redemptions WHERE coupon_id = $1 AND user_id = $2`,
        [coupon.id, params.userId]
      );
      if (rows[0].n >= coupon.max_redemptions_per_user) {
        throw new AppError('You have already redeemed this coupon.', 409, 'COUPON_USER_LIMIT');
      }
    }

    // Atomic global counter bump — only succeeds if a slot remains.
    const bumpSql =
      coupon.max_redemptions === null
        ? `UPDATE public.coupons SET current_redemptions = current_redemptions + 1, updated_at = NOW() WHERE id = $1 RETURNING id`
        : `UPDATE public.coupons SET current_redemptions = current_redemptions + 1, updated_at = NOW() WHERE id = $1 AND current_redemptions < max_redemptions RETURNING id`;
    const bump = await client.query(bumpSql, [coupon.id]);
    if (bump.rowCount === 0) {
      throw new AppError('This coupon has reached its redemption limit.', 409, 'COUPON_EXHAUSTED');
    }

    // Redemption row; UNIQUE(coupon_id, workspace_id) guards per-workspace.
    const { rows } = await client.query(
      `INSERT INTO public.coupon_redemptions (
         coupon_id, user_id, workspace_id, subscription_id, plan_id,
         operation, original_amount, discount_amount, final_amount,
         currency, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (coupon_id, workspace_id) DO NOTHING
       RETURNING id`,
      [
        coupon.id, params.userId, params.workspaceId, params.subscriptionId, params.planId,
        params.operation, params.pricing.originalAmount, params.pricing.discountAmount,
        params.pricing.finalAmount, params.pricing.currency,
        JSON.stringify(params.metadata ?? {}),
      ]
    );
    if (rows.length === 0) {
      throw new AppError('This coupon has already been redeemed for this workspace.', 409, 'COUPON_WORKSPACE_LIMIT');
    }
    return rows[0].id as string;
  }

  // ── Admin CRUD (§32, §52–§55) ─────────────────────────────────────────

  static async listCoupons(filters: {
    status?: string;
    discount_type?: string;
    search?: string;
    page: number;
    pageSize: number;
  }) {
    let query = supabaseAdmin.from('coupons').select('*', { count: 'exact' });

    if (filters.status) query = query.eq('active', filters.status === 'active' ? true : filters.status === 'disabled' ? false : undefined as never);
    if (filters.discount_type) query = query.eq('discount_type', filters.discount_type);
    if (filters.search) query = query.or(`code.ilike.%${filters.search}%,description.ilike.%${filters.search}%`);

    const { data, error, count } = await query
      .order('created_at', { ascending: false })
      .range((filters.page - 1) * filters.pageSize, filters.page * filters.pageSize - 1);
    if (error) throw error;

    let coupons = (data ?? []) as CouponRow[];
    // Statuses beyond active/disabled are computed (time/comparison based —
    // PostgREST cannot compare two columns), so filter after fetch.
    if (filters.status && !['active', 'disabled'].includes(filters.status)) {
      coupons = coupons.filter((c) => computeCouponStatus(c) === filters.status);
    }
    return {
      coupons: coupons.map((c) => ({ ...c, status: computeCouponStatus(c) })),
      total: count ?? 0,
    };
  }

  static async getCouponById(id: string) {
    const { data, error } = await supabaseAdmin.from('coupons').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw AppError.notFound('Coupon not found');
    const coupon = data as CouponRow;
    return { ...coupon, status: computeCouponStatus(coupon) };
  }

  static async getRedemptions(couponId: string, page: number, pageSize: number) {
    const { data, error, count } = await supabaseAdmin
      .from('coupon_redemptions')
      .select('*, workspaces(name), users(email)', { count: 'exact' })
      .eq('coupon_id', couponId)
      .order('redeemed_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw error;
    return { redemptions: data ?? [], total: count ?? 0 };
  }

  static async createCoupon(input: {
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
    created_by: string;
  }): Promise<CouponRow> {
    const code = normalizeCouponCode(input.code);
    if (!CODE_PATTERN.test(code)) {
      throw AppError.badRequest('Coupon code must be 3-40 characters (letters, numbers, hyphens).', 'VALIDATION_ERROR');
    }
    if (input.discount_type === 'PERCENTAGE' && (input.discount_value < 0 || input.discount_value > 100)) {
      throw AppError.badRequest('Percentage discount must be between 0 and 100.', 'VALIDATION_ERROR');
    }
    if (input.discount_type === 'FIXED_AMOUNT' && input.discount_value <= 0) {
      throw AppError.badRequest('Fixed amount discount must be positive.', 'VALIDATION_ERROR');
    }
    if (input.expires_at && input.starts_at && new Date(input.expires_at) <= new Date(input.starts_at)) {
      throw AppError.badRequest('Coupon expiration must be after its start date.', 'VALIDATION_ERROR');
    }
    if (input.discount_type === 'PLAN_ACCESS' && !input.target_plan_name) {
      throw AppError.badRequest('PLAN_ACCESS coupons require a target plan.', 'VALIDATION_ERROR');
    }

    let target_plan_id: string | null = null;
    if (input.target_plan_name) {
      const plan = await PlanCatalogService.requirePlanByName(input.target_plan_name);
      target_plan_id = plan.id;
    }

    let applicable_plan_ids: string[] = [];
    if (input.applicable_plan_names && input.applicable_plan_names.length > 0) {
      const plans = await Promise.all(input.applicable_plan_names.map((n) => PlanCatalogService.requirePlanByName(n)));
      applicable_plan_ids = plans.map((p) => p.id);
    }

    // Advisory pre-check for a friendlier error; the UNIQUE(code) constraint
    // remains the authoritative guard against races.
    const { data: existing } = await supabaseAdmin
      .from('coupons')
      .select('id')
      .eq('code', code)
      .maybeSingle();
    if (existing) {
      throw AppError.conflict(`Coupon code "${code}" already exists.`, 'COUPON_CODE_EXISTS');
    }

    const { data, error } = await supabaseAdmin
      .from('coupons')
      .insert({
        code,
        description: input.description ?? null,
        discount_type: input.discount_type,
        discount_value: input.discount_value,
        currency: input.currency ?? 'USD',
        target_plan_id,
        applicable_plan_ids,
        applies_to: input.applies_to ?? 'new_subscriptions',
        duration: input.duration ?? 'ONE_TIME',
        duration_in_months: input.duration === 'MULTI_MONTH' ? input.duration_in_months ?? null : null,
        starts_at: input.starts_at ?? new Date().toISOString(),
        expires_at: input.expires_at ?? null,
        max_redemptions: input.max_redemptions ?? null,
        max_redemptions_per_user: input.max_redemptions_per_user ?? null,
        max_redemptions_per_workspace: input.max_redemptions_per_workspace ?? null,
        created_by: input.created_by,
      })
      .select('*')
      .single();
    if (error) {
      if ((error as { code?: string }).code === '23505') {
        throw AppError.conflict(`Coupon code "${code}" already exists.`, 'COUPON_CODE_EXISTS');
      }
      throw error;
    }
    return data as CouponRow;
  }

  static async updateCoupon(
    id: string,
    patch: Partial<{
      description: string | null;
      active: boolean;
      expires_at: string | null;
      max_redemptions: number | null;
      max_redemptions_per_user: number | null;
      max_redemptions_per_workspace: number | null;
    }>,
    adminId: string
  ): Promise<CouponRow> {
    const before = await this.getCouponById(id);
    const { data, error } = await supabaseAdmin
      .from('coupons')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    logger.info('Coupon updated by admin', { couponId: id, adminId, fields: Object.keys(patch) });
    const coupon = data as CouponRow;
    return { ...coupon, status: computeCouponStatus(coupon), _previous_status: before.status } as CouponRow;
  }

  /**
   * Secure code generation (§33): crypto.randomBytes, unambiguous charset by
   * default, duplicate-safe bulk generation. Codes are returned uninserted —
   * the admin applies plan/limits per batch via createCoupon.
   */
  static async generateCodes(opts: {
    prefix: string;
    length: number;
    count: number;
    charset?: string;
  }): Promise<string[]> {
    const prefix = normalizeCouponCode(opts.prefix).replace(/[^A-Z0-9-]/g, '');
    const charset = (opts.charset ?? 'ABCDEFGHJKMNPQRSTUVWXYZ23456789').replace(/[^A-Z0-9]/g, '');
    if (!charset) throw AppError.badRequest('Charset must contain alphanumeric characters.', 'VALIDATION_ERROR');
    if (opts.length < 6 || opts.length > 24) {
      throw AppError.badRequest('Generated code body length must be 6-24 characters.', 'VALIDATION_ERROR');
    }
    if (opts.count < 1 || opts.count > 500) {
      throw AppError.badRequest('Count must be between 1 and 500.', 'VALIDATION_ERROR');
    }

    const codes: string[] = [];
    const seen = new Set<string>();
    let attempts = 0;
    while (codes.length < opts.count && attempts < opts.count * 20) {
      attempts += 1;
      const bytes = crypto.randomBytes(opts.length);
      let body = '';
      for (let i = 0; i < opts.length; i++) body += charset[bytes[i] % charset.length];
      const code = prefix ? `${prefix}-${body}` : body;
      if (seen.has(code)) continue;
      seen.add(code);
      codes.push(code);
    }
    if (codes.length < opts.count) {
      throw AppError.conflict('Could not generate enough unique codes; widen the charset or shorten the prefix.', 'CODE_GENERATION_FAILED');
    }
    return codes;
  }

  // ── Transaction helper (used by the coupon upgrade flow, §80) ─────────

  static runInTx<T>(fn: (client: TxClient) => Promise<T>): Promise<T> {
    return withTransaction(fn);
  }
}
