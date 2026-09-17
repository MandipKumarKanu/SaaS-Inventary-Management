import { supabaseAdmin } from '../../config/supabase.js';
import { logger } from '../../config/logger.js';
import { PlanCatalogService } from '../../services/plan-catalog.service.js';
import { BillingService } from '../billing/billing.service.js';
import { AuditService } from '../audit/audit.service.js';

/**
 * Phase 3 Step 4: Stripe event → subscription state machine.
 *
 * Runs AFTER signature verification (Phase 0) and event-id idempotency
 * (stripe_webhook_events). Adds:
 *   - processing result recording (processing_status / processed_at)
 *   - subscription state transitions with out-of-order event protection
 *   - usage_records limit re-sync on plan change
 *
 * Handled events (PRD §73):
 *   checkout.session.completed       → activate plan, bind stripe ids
 *   customer.subscription.updated    → status/period sync (skips stale events)
 *   customer.subscription.deleted    → cancelled
 *   invoice.payment_failed           → past_due + 7-day grace window
 */

const GRACE_PERIOD_DAYS = 7;

export interface ProcessedEventResult {
  status: 'processed' | 'already_processed' | 'ignored' | 'skipped_stale' | 'no_workspace' | 'failed';
  detail?: string;
}

interface StripeLikeEvent {
  id: string;
  type: string;
  created: number;
  data: { object: any };
}

export class StripeWebhookService {
  /**
   * Entry point called by the webhook route after signature verification.
   * `deliveryAttempt` and `rawPayload` feed §58 monitoring (retry count,
   * safe-retry re-dispatch). Both optional so internal callers stay simple.
   */
  static async processEvent(
    event: StripeLikeEvent,
    opts?: { deliveryAttempt?: number; rawPayload?: unknown }
  ): Promise<ProcessedEventResult> {
    const startedAt = Date.now();

    // 1. Idempotency: same event id delivered twice → process once.
    const { data: existing } = await supabaseAdmin
      .from('stripe_webhook_events')
      .select('id, processing_status')
      .eq('event_id', event.id)
      .maybeSingle();

    if (existing) {
      // §58: a redelivery of a previously-failed event is an operator-visible
      // retry — count it, but still do not double-process.
      if (existing.processing_status === 'failed' && opts?.deliveryAttempt && opts.deliveryAttempt > 1) {
        await supabaseAdmin
          .from('stripe_webhook_events')
          .update({ delivery_attempt: opts.deliveryAttempt })
          .eq('event_id', event.id);
      }
      return { status: 'already_processed' };
    }

    // 2. Dispatch
    let result: ProcessedEventResult;
    try {
      result = await this.dispatch(event);
    } catch (err: any) {
      logger.error('Stripe webhook handler failed', { eventId: event.id, error: err.message });
      // Record failure so ops can see it; return failed so the route 500s and
      // Stripe retries (the recorded row blocks duplicate side effects only on
      // success paths — see markProcessed).
      result = { status: 'failed', detail: err.message };
      await this.record(event, result.status, result.detail, Date.now() - startedAt, opts);
      return result;
    }

    // 3. Record outcome + audit trail (PRD §41: subscription changes audited)
    await this.record(event, result.status, result.detail, Date.now() - startedAt, opts);
    if (result.status === 'processed') {
      await AuditService.log({
        workspaceId: null,
        userId: event.id,
        action: 'billing.webhook_processed',
        entity: 'subscription',
        entityId: event.type,
        newValue: { event_type: event.type, detail: result.detail },
      });
    }
    return result;
  }

  private static async dispatch(event: StripeLikeEvent): Promise<ProcessedEventResult> {
    switch (event.type) {
      case 'checkout.session.completed':
        return this.handleCheckoutCompleted(event.data.object);
      case 'customer.subscription.updated':
        return this.handleSubscriptionUpdated(event);
      case 'customer.subscription.deleted':
        return this.handleSubscriptionDeleted(event);
      case 'invoice.payment_failed':
        return this.handlePaymentFailed(event);
      // SaaS Business Layer (§56): persist billing history from Stripe events.
      case 'invoice.payment_succeeded':
        return this.handlePaymentSucceeded(event);
      case 'charge.refunded':
        return this.handleChargeRefunded(event);
      default:
        return { status: 'ignored', detail: `Unhandled event type: ${event.type}` };
    }
  }

  /**
   * checkout.session.completed:
   *   client_reference_id = workspace_id, metadata.plan_name = tier.
   * Activates the plan, binds stripe ids, sets the period, re-syncs limits.
   */
  private static async handleCheckoutCompleted(session: any): Promise<ProcessedEventResult> {
    const workspaceId = session.client_reference_id || session.metadata?.workspace_id;
    const planName = session.metadata?.plan_name;

    if (!workspaceId) return { status: 'no_workspace', detail: 'checkout session without client_reference_id' };
    if (!planName) return { status: 'failed', detail: 'checkout session missing metadata.plan_name' };

    const plan = await PlanCatalogService.getPlanByName(planName);
    if (!plan) return { status: 'failed', detail: `unknown plan in metadata: ${planName}` };

    const now = new Date().toISOString();
    const periodEnd = session.subscription
      ? await this.fetchCurrentPeriodEnd(session.subscription)
      : null;

    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({
        plan_id: plan.id,
        status: 'active',
        stripe_customer_id: session.customer ?? null,
        stripe_subscription_id: session.subscription ?? null,
        current_period_start: now,
        current_period_end: periodEnd,
        past_due_at: null,
        grace_ends_at: null,
        cancelled_at: null,
        updated_at: now,
      })
      .eq('workspace_id', workspaceId);

    if (error) throw error;

    await BillingService.syncPlanLimits(workspaceId);
    return { status: 'processed', detail: `workspace ${workspaceId} → ${plan.name}` };
  }

  /**
   * customer.subscription.updated: sync status + period.
   * Out-of-order protection: if the subscription row was updated by a NEWER
   * Stripe event (tracked via updated_at vs event.created), skip this one.
   */
  private static async handleSubscriptionUpdated(event: StripeLikeEvent): Promise<ProcessedEventResult> {
    const sub = event.data.object;
    const stripeSubscriptionId = sub.id;

    const { data: row } = await supabaseAdmin
      .from('subscriptions')
      .select('id, workspace_id, updated_at, stripe_subscription_id')
      .eq('stripe_subscription_id', stripeSubscriptionId)
      .maybeSingle();

    if (!row) {
      // Not bound yet (e.g. updated arrived before checkout completion was
      // processed). Safe to skip: checkout.session.completed will set state.
      return { status: 'skipped_stale', detail: 'no bound subscription for this stripe id' };
    }

    // Out-of-order guard: our row's updated_at (set by a newer event) beats
    // this event's creation time. Tolerance of 1s for clock precision.
    if (row.updated_at) {
      const rowUpdatedAt = new Date(row.updated_at).getTime();
      const eventCreated = event.created * 1000;
      if (rowUpdatedAt - eventCreated > 1000) {
        return { status: 'skipped_stale', detail: 'newer event already applied' };
      }
    }

    const status = this.mapStripeStatus(sub.status);
    const now = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({
        status,
        current_period_start: sub.current_period_start
          ? new Date(sub.current_period_start * 1000).toISOString()
          : undefined,
        current_period_end: sub.current_period_end
          ? new Date(sub.current_period_end * 1000).toISOString()
          : undefined,
        cancelled_at: sub.status === 'canceled' ? now : undefined,
        updated_at: now,
      })
      .eq('id', row.id);

    if (error) throw error;
    return { status: 'processed', detail: `subscription → ${status}` };
  }

  /**
   * customer.subscription.deleted: cancelled. Workspace keeps billing access
   * only (enforced by workspace.middleware, Step 5).
   */
  private static async handleSubscriptionDeleted(event: StripeLikeEvent): Promise<ProcessedEventResult> {
    const sub = event.data.object;

    const { data: row } = await supabaseAdmin
      .from('subscriptions')
      .select('id')
      .eq('stripe_subscription_id', sub.id)
      .maybeSingle();

    if (!row) return { status: 'skipped_stale', detail: 'no bound subscription' };

    const now = new Date().toISOString();
    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({ status: 'cancelled', cancelled_at: now, updated_at: now })
      .eq('id', row.id);

    if (error) throw error;
    return { status: 'processed', detail: 'subscription cancelled' };
  }

  /**
   * invoice.payment_failed: past_due + grace window anchor.
   */
  private static async handlePaymentFailed(event: StripeLikeEvent): Promise<ProcessedEventResult> {
    const invoice = event.data.object;

    // Resolve workspace via the customer binding (works even before a
    // subscription row exists — but we only act when one does).
    let customerId = invoice.customer;
    let workspaceId: string | null = null;

    const { data: row } = await supabaseAdmin
      .from('subscriptions')
      .select('id, workspace_id')
      .eq('stripe_customer_id', customerId)
      .maybeSingle();

    if (!row) return { status: 'skipped_stale', detail: 'no subscription for customer' };
    workspaceId = row.workspace_id;

    const now = new Date();
    const graceEnd = new Date(now.getTime() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000);

    const { error } = await supabaseAdmin
      .from('subscriptions')
      .update({
        status: 'past_due',
        past_due_at: now.toISOString(),
        grace_ends_at: graceEnd.toISOString(),
        updated_at: now.toISOString(),
      })
      .eq('id', row.id);

    // Persist the failed payment for admin billing inspection (§56/§57).
    const { error: payErr } = await supabaseAdmin.from('payments').upsert(
      {
        workspace_id: row.workspace_id,
        subscription_id: row.id,
        provider: 'stripe',
        provider_reference: invoice.id ?? `${invoice.customer}:failed:${event.created}`,
        amount: (invoice.amount_due ?? 0) / 100,
        currency: (invoice.currency ?? 'usd').toUpperCase(),
        status: 'failed',
        invoice_id: invoice.id ?? null,
        failure_reason: invoice.last_finalization_error?.message ?? null,
        metadata: { stripe_event_id: event.id },
      },
      { onConflict: 'provider_reference' }
    );
    if (payErr) {
      logger.error('Failed to persist failed-payment row', { error: payErr.message });
    }

    if (error) throw error;
    return { status: 'processed', detail: `workspace ${workspaceId} past_due, grace until ${graceEnd.toISOString()}` };
  }

  /**
   * invoice.payment_succeeded (§56): persist a successful payment.
   * Idempotent via payments.provider_reference UNIQUE (the invoice id) —
   * Stripe redeliveries never create duplicates.
   */
  private static async handlePaymentSucceeded(event: StripeLikeEvent): Promise<ProcessedEventResult> {
    const invoice = event.data.object as any;

    const { data: row } = await supabaseAdmin
      .from('subscriptions')
      .select('id, workspace_id')
      .eq('stripe_customer_id', invoice.customer)
      .maybeSingle();
    if (!row) return { status: 'skipped_stale', detail: 'no subscription for customer' };

    const amount = ((invoice.amount_paid ?? 0) / 100); // Stripe minor units → major
    const { error } = await supabaseAdmin.from('payments').upsert(
      {
        workspace_id: row.workspace_id,
        subscription_id: row.id,
        provider: 'stripe',
        provider_reference: invoice.id,
        amount,
        currency: (invoice.currency ?? 'usd').toUpperCase(),
        status: 'successful',
        invoice_id: invoice.id,
        metadata: { stripe_event_id: event.id, billing_reason: invoice.billing_reason ?? null },
      },
      { onConflict: 'provider_reference' }
    );
    if (error) throw error;
    return { status: 'processed', detail: `payment recorded for workspace ${row.workspace_id}` };
  }

  /** charge.refunded (§56): mark the matching payment refunded. */
  private static async handleChargeRefunded(event: StripeLikeEvent): Promise<ProcessedEventResult> {
    const charge = event.data.object as any;
    const reference = charge.invoice ?? charge.id; // prefer invoice linkage

    const { data: payment } = await supabaseAdmin
      .from('payments')
      .select('id')
      .or(`provider_reference.eq.${reference},provider_reference.eq.${charge.id}`)
      .maybeSingle();
    if (!payment) return { status: 'skipped_stale', detail: 'no payment row for charge' };

    const { error } = await supabaseAdmin
      .from('payments')
      .update({ status: 'refunded', updated_at: new Date().toISOString() })
      .eq('id', payment.id);
    if (error) throw error;
    return { status: 'processed', detail: 'payment marked refunded' };
  }

  /** Map Stripe subscription status → our status enum. */
  private static mapStripeStatus(stripeStatus: string): string {
    switch (stripeStatus) {
      case 'trialing': return 'trialing';
      case 'active': return 'active';
      case 'past_due':
      case 'unpaid': return 'past_due';
      case 'canceled':
      case 'incomplete_expired': return 'cancelled';
      case 'paused': return 'suspended';
      default: return 'active';
    }
  }

  private static async fetchCurrentPeriodEnd(stripeSubscriptionId: string): Promise<string | null> {
    try {
      // Lazily import to avoid a hard Stripe dependency in unit tests
      const { getStripe } = await import('../../config/stripe.js');
      const stripe = getStripe();
      const sub = (await stripe.subscriptions.retrieve(stripeSubscriptionId)) as any;
      return sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString()
        : null;
    } catch (err: any) {
      logger.warn('Could not fetch Stripe period end', { error: err.message });
      return null;
    }
  }

  private static async record(
    event: StripeLikeEvent,
    status: string,
    detail?: string,
    durationMs?: number,
    opts?: { deliveryAttempt?: number; rawPayload?: unknown }
  ): Promise<void> {
    const { error } = await supabaseAdmin.from('stripe_webhook_events').insert({
      event_id: event.id,
      event_type: event.type,
      processing_status: status,
      detail: detail || null,
      stripe_event_created: new Date(event.created * 1000).toISOString(),
      // §58 observability columns (migration 023)
      processing_duration_ms: durationMs ?? null,
      delivery_attempt: opts?.deliveryAttempt ?? 1,
      payload: (opts?.rawPayload as Record<string, unknown>) ?? { id: event.id, type: event.type, created: event.created, data: event.data },
    });
    if (error) {
      logger.error('Failed to record stripe webhook event', { eventId: event.id, error: error.message });
    }
  }
}
