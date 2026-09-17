import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, wsId, userId } from '../helpers/world';
import { seedPlans, upsertSubscription, PLAN_IDS } from '../helpers/billing-world';
import { issueToken, testDb } from '../setup';

/**
 * §85 webhook lifecycle suite — drives the REAL StripeWebhookService against
 * the mocked Supabase layer (no Stripe SDK needed here: lifecycle handlers
 * only touch the DB).
 *
 * Covered:
 *   - customer.subscription.updated mirrors Stripe status → DB
 *   - Out-of-order guard: stale events are skipped, fresh ones applied
 *   - customer.subscription.deleted → cancelled
 *   - Idempotency: same event id twice → processed once
 *   - Portal-link (billing portal) flows rely on the same updated/deleted
 *     sync paths exercised here
 */

const app = buildTestApp();
const W1 = wsId(1);

function baseSubscription(stripeSubId: string, updatedAtIso: string) {
  upsertSubscription(testDb, W1, PLAN_IDS.starter, 'active', {
    stripe_customer_id: 'cus_test_1',
    stripe_subscription_id: stripeSubId,
    updated_at: updatedAtIso,
  });
}

function makeEvent(id: string, createdSec: number, status: string) {
  return {
    id,
    type: 'customer.subscription.updated',
    created: createdSec,
    data: {
      object: {
        id: 'subStripe_1',
        status,
        current_period_start: Math.floor(Date.now() / 1000) - 3600,
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 86400,
      },
    },
  };
}

describe('Webhook lifecycle sync (§18/§85)', () => {
  beforeEach(() => {
    testDb.__reset();
    seedWorld(testDb);
    seedPlans(testDb);
  });

  it('applies a fresh subscription.updated event to the DB', async () => {
    baseSubscription('subStripe_1', new Date(Date.now() - 86_400_000).toISOString()); // row older than event

    const { StripeWebhookService } = await import('../../src/modules/webhooks/stripe-webhook.service.js');
    const event = makeEvent('evt_fresh_1', Math.floor(Date.now() / 1000), 'past_due');
    const result = await StripeWebhookService.processEvent(event);

    expect(result.status).toBe('processed');
    const { supabaseAdmin } = await import('../../src/config/supabase.js');
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('status')
      .eq('workspace_id', W1)
      .maybeSingle();
    expect(sub?.status).toBe('past_due');
  });

  it('skips a stale (out-of-order) event whose row was updated by a newer one', async () => {
    // Row updated "now" — the event below claims to be from 1 hour ago.
    baseSubscription('subStripe_1', new Date().toISOString());
    const staleCreated = Math.floor(Date.now() / 1000) - 3600;

    const { StripeWebhookService } = await import('../../src/modules/webhooks/stripe-webhook.service.js');
    const result = await StripeWebhookService.processEvent(
      makeEvent('evt_stale_1', staleCreated, 'canceled')
    );

    expect(result.status).toBe('skipped_stale');
    // Status unchanged — the newer state wins (§18 out-of-order protection)
    const { supabaseAdmin } = await import('../../src/config/supabase.js');
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('status')
      .eq('workspace_id', W1)
      .maybeSingle();
    expect(sub?.status).toBe('active');
  });

  it('skips events for unbound subscriptions (updated arrives before checkout completed)', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.starter, 'trialing'); // no stripe_subscription_id

    const { StripeWebhookService } = await import('../../src/modules/webhooks/stripe-webhook.service.js');
    const result = await StripeWebhookService.processEvent(
      makeEvent('evt_unbound_1', Math.floor(Date.now() / 1000), 'active')
    );
    expect(result.status).toBe('skipped_stale');
  });

  it('processes the same event id once (duplicate redelivery is a no-op)', async () => {
    baseSubscription('subStripe_1', new Date(Date.now() - 86_400_000).toISOString());

    const { StripeWebhookService } = await import('../../src/modules/webhooks/stripe-webhook.service.js');
    const event = makeEvent('evt_dup_1', Math.floor(Date.now() / 1000), 'past_due');

    const first = await StripeWebhookService.processEvent(event);
    expect(first.status).toBe('processed');

    const second = await StripeWebhookService.processEvent(event);
    expect(second.status).toBe('already_processed');
  });

  it('marks the subscription cancelled on customer.subscription.deleted', async () => {
    baseSubscription('subStripe_1', new Date(Date.now() - 86_400_000).toISOString());

    const { StripeWebhookService } = await import('../../src/modules/webhooks/stripe-webhook.service.js');
    const result = await StripeWebhookService.processEvent({
      id: 'evt_deleted_1',
      type: 'customer.subscription.deleted',
      created: Math.floor(Date.now() / 1000),
      data: { object: { id: 'subStripe_1', status: 'canceled' } },
    });

    expect(result.status).toBe('processed');
    const { supabaseAdmin } = await import('../../src/config/supabase.js');
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('status, cancelled_at')
      .eq('workspace_id', W1)
      .maybeSingle();
    expect(sub?.status).toBe('cancelled');
    expect(sub?.cancelled_at).toBeTruthy();
  });

  it('records every processed event with duration + attempt (§58 observability)', async () => {
    baseSubscription('subStripe_1', new Date(Date.now() - 86_400_000).toISOString());

    const { StripeWebhookService } = await import('../../src/modules/webhooks/stripe-webhook.service.js');
    await StripeWebhookService.processEvent(makeEvent('evt_obs_1', Math.floor(Date.now() / 1000), 'active'), {
      deliveryAttempt: 3,
      rawPayload: { id: 'evt_obs_1' },
    });

    const { supabaseAdmin } = await import('../../src/config/supabase.js');
    const { data: recorded } = await supabaseAdmin
      .from('stripe_webhook_events')
      .select('processing_status, delivery_attempt, payload')
      .eq('event_id', 'evt_obs_1')
      .maybeSingle();
    expect(recorded?.processing_status).toBe('processed');
    expect(recorded?.delivery_attempt).toBe(3);
    expect(recorded?.payload).toMatchObject({ id: 'evt_obs_1' });
  });
});
