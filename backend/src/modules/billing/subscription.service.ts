import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { PlanCatalogService, Plan } from '../../services/plan-catalog.service.js';
import { UsageService, UsageMetric } from '../../services/usage.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ConfigService } from '../../services/config.service.js';
import { logger } from '../../config/logger.js';
import { BillingService } from './billing.service.js';
import { CouponService, CouponRow, CouponOperation, CouponValidation } from './coupon.service.js';
import { isStripeConfigured, getStripe } from '../../config/stripe.js';

/**
 * SaaS Business Layer: subscription lifecycle (PRD §6, §12, §14, §15, §19,
 * §20, §26, §80).
 *
 * - Every state transition writes a `subscription_events` row (§50 history).
 * - Cancellation at period end does NOT disable an otherwise active
 *   subscription (§19) — middleware keeps granting access until the period
 *   actually ends.
 * - Expiration/grace processing methods are idempotent and used by the
 *   background worker (§16); Stripe-managed subscriptions are skipped by the
 *   worker because webhooks drive their lifecycle.
 * - Coupon-based upgrades run in ONE database transaction (§80): subscription
 *   update + coupon redemption + lifecycle events commit or roll back
 *   together.
 */

export type SubscriptionRow = {
  id: string;
  workspace_id: string;
  plan_id: string;
  status: 'trialing' | 'active' | 'past_due' | 'cancelled' | 'suspended';
  billing_interval: 'monthly' | 'annual';
  trial_ends_at: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  past_due_at: string | null;
  grace_ends_at: string | null;
  cancel_at_period_end: boolean;
  expires_at: string | null;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

type SubscriptionEventInput = {
  subscription_id: string;
  workspace_id: string;
  event_type: string;
  previous_values?: Record<string, unknown>;
  new_values?: Record<string, unknown>;
  actor_type?: 'system' | 'user' | 'admin' | 'webhook';
  actor_id?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
};

function periodEnd(from: Date, interval: 'monthly' | 'annual'): Date {
  const end = new Date(from);
  if (interval === 'annual') end.setFullYear(end.getFullYear() + 1);
  else end.setMonth(end.getMonth() + 1);
  return end;
}

export class SubscriptionService {
  // ── Event history (append-only) ───────────────────────────────────────

  static async recordEvent(input: SubscriptionEventInput): Promise<void> {
    const { error } = await supabaseAdmin.from('subscription_events').insert({
      subscription_id: input.subscription_id,
      workspace_id: input.workspace_id,
      event_type: input.event_type,
      previous_values: input.previous_values ?? {},
      new_values: input.new_values ?? {},
      actor_type: input.actor_type ?? 'system',
      actor_id: input.actor_id ?? null,
      reason: input.reason ?? null,
      metadata: input.metadata ?? {},
    });
    if (error) {
      // History must never break the operation it describes — log and move on.
      logger.error('Failed to record subscription event', {
        event_type: input.event_type,
        subscription_id: input.subscription_id,
        error: error.message,
      });
    }
  }

  private static async recordEventTx(client: import('../../db/pool.js').TxClient, input: SubscriptionEventInput): Promise<void> {
    await client.query(
      `INSERT INTO public.subscription_events (
         subscription_id, workspace_id, event_type, previous_values,
         new_values, actor_type, actor_id, reason, metadata
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.subscription_id, input.workspace_id, input.event_type,
        JSON.stringify(input.previous_values ?? {}), JSON.stringify(input.new_values ?? {}),
        input.actor_type ?? 'system', input.actor_id ?? null, input.reason ?? null,
        JSON.stringify(input.metadata ?? {}),
      ]
    );
  }

  // ── Reads ─────────────────────────────────────────────────────────────

  static async getSubscription(workspaceId: string): Promise<SubscriptionRow | null> {
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .select('*')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error) throw error;
    return (data as SubscriptionRow) ?? null;
  }

  static async requireSubscription(workspaceId: string): Promise<SubscriptionRow> {
    const sub = await this.getSubscription(workspaceId);
    if (!sub) throw AppError.notFound('No subscription found for this workspace', 'NO_SUBSCRIPTION');
    return sub;
  }

  static async listEvents(workspaceId: string, page: number, pageSize: number) {
    const { data, error, count } = await supabaseAdmin
      .from('subscription_events')
      .select('*, users(email)', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw error;
    return { events: data ?? [], total: count ?? 0 };
  }

  // ── Cancellation (§19) ────────────────────────────────────────────────

  /** Schedule cancellation at period end — access continues until then. */
  static async cancelAtPeriodEnd(workspaceId: string, userId: string): Promise<SubscriptionRow> {
    const sub = await this.requireSubscription(workspaceId);
    if (!['active', 'trialing', 'past_due'].includes(sub.status)) {
      throw AppError.unprocessable(`Cannot schedule cancellation for a ${sub.status} subscription.`, 'INVALID_SUBSCRIPTION_STATE');
    }
    if (sub.cancel_at_period_end) {
      throw AppError.conflict('Cancellation is already scheduled for this subscription.', 'CANCEL_ALREADY_SCHEDULED');
    }

    if (isStripeConfigured() && sub.stripe_subscription_id) {
      const stripe = getStripe();
      await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: true });
    }

    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .update({ cancel_at_period_end: true, updated_at: new Date().toISOString() })
      .eq('id', sub.id)
      .select('*')
      .single();
    if (error) throw error;

    await this.recordEvent({
      subscription_id: sub.id,
      workspace_id: sub.workspace_id,
      event_type: 'cancel_scheduled',
      previous_values: { cancel_at_period_end: sub.cancel_at_period_end },
      new_values: { cancel_at_period_end: true, effective_at: sub.current_period_end },
      actor_type: 'user',
      actor_id: userId,
    });
    await AuditService.log({
      workspaceId,
      userId,
      action: 'billing.cancel_scheduled',
      entity: 'subscription',
      entityId: sub.id,
      newValue: { effective_at: sub.current_period_end },
    });
    logger.info('Subscription cancellation scheduled', { workspaceId, effective_at: sub.current_period_end });
    return data as SubscriptionRow;
  }

  /** Cancel immediately — access ends now (subject to grace, §15). */
  static async cancelNow(workspaceId: string, userId: string, reason?: string): Promise<SubscriptionRow> {
    const sub = await this.requireSubscription(workspaceId);
    if (sub.status === 'cancelled') {
      throw AppError.conflict('Subscription is already cancelled.', 'ALREADY_CANCELLED');
    }

    if (isStripeConfigured() && sub.stripe_subscription_id) {
      const stripe = getStripe();
      await stripe.subscriptions.cancel(sub.stripe_subscription_id);
    }

    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancel_at_period_end: false,
        updated_at: new Date().toISOString(),
      })
      .eq('id', sub.id)
      .select('*')
      .single();
    if (error) throw error;

    await this.recordEvent({
      subscription_id: sub.id,
      workspace_id: sub.workspace_id,
      event_type: 'cancelled',
      previous_values: { status: sub.status },
      new_values: { status: 'cancelled' },
      actor_type: 'user',
      actor_id: userId,
      reason: reason ?? null,
    });
    await AuditService.log({
      workspaceId,
      userId,
      action: 'billing.cancelled',
      entity: 'subscription',
      entityId: sub.id,
      previousValue: { status: sub.status },
      newValue: { status: 'cancelled' },
    });
    return data as SubscriptionRow;
  }

  /** Undo a scheduled period-end cancellation (§19). */
  static async resume(workspaceId: string, userId: string): Promise<SubscriptionRow> {
    const sub = await this.requireSubscription(workspaceId);
    if (!sub.cancel_at_period_end) {
      throw AppError.conflict('No scheduled cancellation to resume.', 'NOT_SCHEDULED');
    }
    if (!['active', 'trialing', 'past_due'].includes(sub.status)) {
      throw AppError.unprocessable(`Cannot resume a ${sub.status} subscription — use reactivate.`, 'INVALID_SUBSCRIPTION_STATE');
    }

    if (isStripeConfigured() && sub.stripe_subscription_id) {
      const stripe = getStripe();
      await stripe.subscriptions.update(sub.stripe_subscription_id, { cancel_at_period_end: false });
    }

    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .update({ cancel_at_period_end: false, updated_at: new Date().toISOString() })
      .eq('id', sub.id)
      .select('*')
      .single();
    if (error) throw error;

    await this.recordEvent({
      subscription_id: sub.id,
      workspace_id: sub.workspace_id,
      event_type: 'cancel_resumed',
      previous_values: { cancel_at_period_end: true },
      new_values: { cancel_at_period_end: false },
      actor_type: 'user',
      actor_id: userId,
    });
    await AuditService.log({
      workspaceId,
      userId,
      action: 'billing.cancel_resumed',
      entity: 'subscription',
      entityId: sub.id,
      newValue: { cancel_at_period_end: false },
    });
    return data as SubscriptionRow;
  }

  /** Reactivate a cancelled subscription (dev mode). Stripe mode goes through checkout. */
  static async reactivate(workspaceId: string, userId: string): Promise<SubscriptionRow> {
    if (isStripeConfigured()) {
      throw AppError.badRequest(
        'Stripe billing is enabled: reactivate via checkout or the customer portal.',
        'STRIPE_REQUIRED'
      );
    }
    const sub = await this.requireSubscription(workspaceId);
    if (sub.status !== 'cancelled') {
      throw AppError.conflict('Only cancelled subscriptions can be reactivated.', 'NOT_CANCELLED');
    }

    const now = new Date();
    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .update({
        status: 'active',
        cancelled_at: null,
        expires_at: null,
        past_due_at: null,
        grace_ends_at: null,
        cancel_at_period_end: false,
        current_period_start: now.toISOString(),
        current_period_end: periodEnd(now, sub.billing_interval).toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', sub.id)
      .select('*')
      .single();
    if (error) throw error;

    await this.recordEvent({
      subscription_id: sub.id,
      workspace_id: sub.workspace_id,
      event_type: 'reactivated',
      previous_values: { status: sub.status },
      new_values: { status: 'active', current_period_end: (data as SubscriptionRow).current_period_end },
      actor_type: 'user',
      actor_id: userId,
    });
    await AuditService.log({
      workspaceId,
      userId,
      action: 'billing.reactivated',
      entity: 'subscription',
      entityId: sub.id,
      newValue: { status: 'active' },
    });
    return data as SubscriptionRow;
  }

  // ── Trial (§13) ───────────────────────────────────────────────────────

  /** Extend a running trial (workspace admin or platform admin; audited). */
  static async extendTrial(workspaceId: string, days: number, actorId: string, actorType: 'user' | 'admin' = 'user'): Promise<SubscriptionRow> {
    if (!Number.isInteger(days) || days <= 0 || days > 90) {
      throw AppError.badRequest('Trial extension must be between 1 and 90 days.', 'VALIDATION_ERROR');
    }
    const sub = await this.requireSubscription(workspaceId);
    if (sub.status !== 'trialing') {
      throw AppError.unprocessable('Only trialing subscriptions can have their trial extended.', 'NOT_TRIALING');
    }

    const base = sub.trial_ends_at ? new Date(sub.trial_ends_at) : new Date();
    const newTrialEnd = new Date(base.getTime() + days * 24 * 3600 * 1000);

    const { data, error } = await supabaseAdmin
      .from('subscriptions')
      .update({ trial_ends_at: newTrialEnd.toISOString(), updated_at: new Date().toISOString() })
      .eq('id', sub.id)
      .select('*')
      .single();
    if (error) throw error;

    await this.recordEvent({
      subscription_id: sub.id,
      workspace_id: sub.workspace_id,
      event_type: 'trial_extended',
      previous_values: { trial_ends_at: sub.trial_ends_at },
      new_values: { trial_ends_at: newTrialEnd.toISOString() },
      actor_type: actorType,
      actor_id: actorId,
      metadata: { days },
    });
    await AuditService.log({
      workspaceId,
      userId: actorId,
      action: 'billing.trial_extended',
      entity: 'subscription',
      entityId: sub.id,
      previousValue: { trial_ends_at: sub.trial_ends_at },
      newValue: { trial_ends_at: newTrialEnd.toISOString(), days },
    });
    return data as SubscriptionRow;
  }

  // ── Plan change (§20) — dev mode; Stripe mode requires checkout ───────

  static async changePlan(workspaceId: string, newPlanName: string, userId: string) {
    const sub = await this.requireSubscription(workspaceId);
    const summary = await BillingService.changePlan(workspaceId, newPlanName, userId);
    await this.recordEvent({
      subscription_id: sub.id,
      workspace_id: sub.workspace_id,
      event_type: 'plan_changed',
      previous_values: { plan_id: sub.plan_id },
      new_values: { plan_id: summary.planId },
      actor_type: 'user',
      actor_id: userId,
    });
    return summary;
  }

  // ── Coupon-based upgrade (§26, §27, §80) — ONE transaction ────────────

  /**
   * Server-side only pricing: the client sends plan name + coupon code and
   * nothing else. Price, discount, and final amount are computed from the
   * plan catalog and coupon row inside this method (§26, §83).
   */
  static async upgradeWithCoupon(
    workspaceId: string,
    userId: string,
    planName: string,
    couponCode: string
  ) {
    if (isStripeConfigured()) {
      throw AppError.badRequest(
        'Stripe billing is enabled: redeem coupons during Stripe checkout.',
        'STRIPE_REQUIRED'
      );
    }

    const sub = await this.requireSubscription(workspaceId);
    if (!['trialing', 'active', 'past_due', 'cancelled'].includes(sub.status)) {
      throw AppError.unprocessable(`Cannot apply a coupon to a ${sub.status} subscription.`, 'INVALID_SUBSCRIPTION_STATE');
    }

    // Operation classification (§27): the coupon config decides which flows
    // it covers. Cancelled → reactivation; everything else → upgrade.
    const operation: CouponOperation = sub.status === 'cancelled' ? 'reactivation' : 'upgrade';

    const targetPlan = await PlanCatalogService.requirePlanByName(planName);

    // Downgrade guard (same semantics as BillingService.changePlan).
    const currentPlan = await PlanCatalogService.getPlanById(sub.plan_id);
    if (currentPlan && Number(currentPlan.priceMonthly) > Number(targetPlan.priceMonthly)) {
      const blocked: Array<{ metric: string; used: number; newLimit: number }> = [];
      for (const metric of ['users', 'products', 'warehouses'] as UsageMetric[]) {
        const newLimit = targetPlan.limits[metric];
        if (newLimit === -1) continue;
        const used = await UsageService.getCurrentUsage(workspaceId, metric);
        if (used > newLimit) blocked.push({ metric, used, newLimit });
      }
      if (blocked.length > 0) {
        throw new AppError(
          `Cannot downgrade to ${targetPlan.displayName}: current usage exceeds its limits.`,
          400,
          'PLAN_DOWNGRADE_BLOCKED',
          true,
          { violations: blocked }
        );
      }
    }

    const validation: CouponValidation = await CouponService.validate(
      couponCode, workspaceId, userId, planName, operation
    );
    if (!validation.valid) {
      throw new AppError(validation.message, 422, validation.code);
    }
    const { coupon, pricing, grantPlanId } = validation;

    // For PLAN_ACCESS the "price" is the plan grant; effective plan comes
    // from the coupon's target plan.
    const effectivePlan: Plan =
      coupon.discount_type === 'PLAN_ACCESS' && grantPlanId
        ? targetPlan
        : targetPlan;

    const now = new Date();
    const newPeriodEnd = periodEnd(now, sub.billing_interval);

    const result = await CouponService.runInTx(async (client) => {
      // 1. Subscription update
      const updateSql =
        sub.status === 'cancelled'
          ? `UPDATE public.subscriptions
               SET status = 'active', plan_id = $2, cancelled_at = NULL, expires_at = NULL,
                   past_due_at = NULL, grace_ends_at = NULL, cancel_at_period_end = false,
                   current_period_start = $3, current_period_end = $4, trial_ends_at = NULL,
                   updated_at = NOW()
             WHERE id = $1
             RETURNING id, status`
          : `UPDATE public.subscriptions
               SET status = 'active', plan_id = $2, cancel_at_period_end = false,
                   past_due_at = NULL, grace_ends_at = NULL,
                   current_period_start = $3, current_period_end = $4, trial_ends_at = NULL,
                   updated_at = NOW()
             WHERE id = $1
             RETURNING id, status`;
      const updated = await client.query(updateSql, [sub.id, effectivePlan.id, now.toISOString(), newPeriodEnd.toISOString()]);
      if (updated.rowCount === 0) {
        throw AppError.notFound('Subscription not found', 'NO_SUBSCRIPTION');
      }

      // 2. Coupon redemption (atomic limits — throws to roll back everything)
      const redemptionId = await CouponService.redeemInTx(client, coupon as CouponRow, {
        workspaceId,
        userId,
        subscriptionId: sub.id,
        planId: effectivePlan.id,
        operation,
        pricing,
        metadata: { previous_plan_id: sub.plan_id, previous_status: sub.status },
      });

      // 3. Lifecycle events (same transaction)
      await this.recordEventTx(client, {
        subscription_id: sub.id,
        workspace_id: sub.workspace_id,
        event_type: 'coupon_applied',
        new_values: {
          coupon_id: coupon.id, coupon_code: coupon.code, operation,
          original_amount: pricing.originalAmount, discount_amount: pricing.discountAmount,
          final_amount: pricing.finalAmount,
        },
        actor_type: 'user',
        actor_id: userId,
      });
      await this.recordEventTx(client, {
        subscription_id: sub.id,
        workspace_id: sub.workspace_id,
        event_type: 'plan_changed',
        previous_values: { plan_id: sub.plan_id, status: sub.status },
        new_values: { plan_id: effectivePlan.id, status: 'active' },
        actor_type: 'user',
        actor_id: userId,
        metadata: { via_coupon: coupon.code, redemption_id: redemptionId },
      });

      return { redemptionId, newPeriodEnd: newPeriodEnd.toISOString() };
    });

    // Post-commit (non-critical): usage limits re-seed + audit.
    await BillingService.syncPlanLimits(workspaceId);
    await AuditService.log({
      workspaceId,
      userId,
      action: 'billing.coupon_upgrade',
      entity: 'subscription',
      entityId: sub.id,
      previousValue: { plan_id: sub.plan_id, status: sub.status },
      newValue: {
        plan_id: effectivePlan.id, status: 'active', coupon_code: coupon.code,
        discount_amount: pricing.discountAmount, final_amount: pricing.finalAmount,
      },
    });
    logger.info('Coupon upgrade applied', { workspaceId, coupon: coupon.code, plan: effectivePlan.name });

    return {
      plan_tier: effectivePlan.name,
      status: 'active',
      current_period_end: result.newPeriodEnd,
      coupon: {
        code: coupon.code,
        discount_type: coupon.discount_type,
        discount_value: Number(coupon.discount_value),
      },
      pricing,
    };
  }

  // ── Lifecycle processing (worker; idempotent — §14, §15, §16) ─────────

  /**
   * Expire finished trials. Stripe-managed subscriptions are skipped
   * (their webhook flow owns the state). Returns rows changed.
   */
  static async expireTrials(): Promise<number> {
    const now = new Date().toISOString();
    const { data: subs, error } = await supabaseAdmin
      .from('subscriptions')
      .select('id, workspace_id, trial_ends_at, stripe_subscription_id')
      .eq('status', 'trialing')
      .not('trial_ends_at', 'is', null)
      .lt('trial_ends_at', now)
      .is('stripe_subscription_id', null);
    if (error) throw error;
    if (!subs || subs.length === 0) return 0;

    for (const sub of subs as Array<Pick<SubscriptionRow, 'id' | 'workspace_id' | 'trial_ends_at'>>) {
      const { error: updErr } = await supabaseAdmin
        .from('subscriptions')
        .update({
          status: 'cancelled',
          cancelled_at: now,
          expires_at: sub.trial_ends_at,
          updated_at: now,
        })
        .eq('id', sub.id)
        .eq('status', 'trialing'); // guard: still trialing at write time
      if (updErr) {
        logger.error('Trial expiration update failed', { subscriptionId: sub.id, error: updErr.message });
        continue;
      }
      await this.recordEvent({
        subscription_id: sub.id,
        workspace_id: sub.workspace_id,
        event_type: 'expired',
        previous_values: { status: 'trialing' },
        new_values: { status: 'cancelled', expires_at: sub.trial_ends_at },
        actor_type: 'system',
        reason: 'trial_ended',
      });
    }
    return subs.length;
  }

  /**
   * Process period ends for dev-mode (non-Stripe) subscriptions:
   *  - scheduled-cancel → cancelled
   *  - otherwise → past_due with a grace window (§15); grace length comes
   *    from config_defaults (`grace_period_days`).
   */
  static async processPeriodEnds(): Promise<number> {
    const now = new Date();
    const nowIso = now.toISOString();
    const { data: subs, error } = await supabaseAdmin
      .from('subscriptions')
      .select('id, workspace_id, cancel_at_period_end, billing_interval, current_period_end, stripe_subscription_id')
      .eq('status', 'active')
      .not('current_period_end', 'is', null)
      .lt('current_period_end', nowIso)
      .is('stripe_subscription_id', null);
    if (error) throw error;
    if (!subs || subs.length === 0) return 0;

    const graceDays = Number(await ConfigService.getOr<number>('grace_period_days', 7));
    let changed = 0;

    for (const sub of subs as Array<Pick<SubscriptionRow, 'id' | 'workspace_id' | 'cancel_at_period_end' | 'current_period_end'>>) {
      if (sub.cancel_at_period_end) {
        const { error: updErr } = await supabaseAdmin
          .from('subscriptions')
          .update({
            status: 'cancelled',
            cancelled_at: nowIso,
            expires_at: sub.current_period_end,
            cancel_at_period_end: false,
            updated_at: nowIso,
          })
          .eq('id', sub.id)
          .eq('status', 'active');
        if (updErr) {
          logger.error('Period-end cancellation failed', { subscriptionId: sub.id, error: updErr.message });
          continue;
        }
        await this.recordEvent({
          subscription_id: sub.id,
          workspace_id: sub.workspace_id,
          event_type: 'cancelled',
          previous_values: { status: 'active' },
          new_values: { status: 'cancelled', expires_at: sub.current_period_end },
          actor_type: 'system',
          reason: 'period_ended_with_scheduled_cancel',
        });
      } else {
        const graceEndsAt = new Date(now.getTime() + graceDays * 24 * 3600 * 1000).toISOString();
        const { error: updErr } = await supabaseAdmin
          .from('subscriptions')
          .update({
            status: 'past_due',
            past_due_at: nowIso,
            grace_ends_at: graceEndsAt,
            updated_at: nowIso,
          })
          .eq('id', sub.id)
          .eq('status', 'active');
        if (updErr) {
          logger.error('Grace period transition failed', { subscriptionId: sub.id, error: updErr.message });
          continue;
        }
        await this.recordEvent({
          subscription_id: sub.id,
          workspace_id: sub.workspace_id,
          event_type: 'grace_started',
          previous_values: { status: 'active' },
          new_values: { status: 'past_due', grace_ends_at: graceEndsAt },
          actor_type: 'system',
          reason: 'payment_pending',
        });
      }
      changed += 1;
    }
    return changed;
  }

  /** Expire grace periods (§15). Idempotent. */
  static async expireGracePeriods(): Promise<number> {
    const nowIso = new Date().toISOString();
    const { data: subs, error } = await supabaseAdmin
      .from('subscriptions')
      .select('id, workspace_id, grace_ends_at, stripe_subscription_id')
      .eq('status', 'past_due')
      .not('grace_ends_at', 'is', null)
      .lt('grace_ends_at', nowIso)
      .is('stripe_subscription_id', null);
    if (error) throw error;
    if (!subs || subs.length === 0) return 0;

    for (const sub of subs as Array<Pick<SubscriptionRow, 'id' | 'workspace_id' | 'grace_ends_at'>>) {
      const { error: updErr } = await supabaseAdmin
        .from('subscriptions')
        .update({
          status: 'cancelled',
          expires_at: sub.grace_ends_at,
          cancel_at_period_end: false,
          updated_at: nowIso,
        })
        .eq('id', sub.id)
        .eq('status', 'past_due');
      if (updErr) {
        logger.error('Grace expiration update failed', { subscriptionId: sub.id, error: updErr.message });
        continue;
      }
      await this.recordEvent({
        subscription_id: sub.id,
        workspace_id: sub.workspace_id,
        event_type: 'expired',
        previous_values: { status: 'past_due' },
        new_values: { status: 'cancelled', expires_at: sub.grace_ends_at },
        actor_type: 'system',
        reason: 'grace_period_ended',
      });
    }
    return subs.length;
  }
}
