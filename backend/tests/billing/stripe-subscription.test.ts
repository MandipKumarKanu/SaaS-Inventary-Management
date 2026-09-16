import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, wsId, userId } from '../helpers/world';
import { seedPlans, upsertSubscription, PLAN_IDS } from '../helpers/billing-world';
import { testDb, issueToken } from '../setup';

/**
 * Phase 3 Step 4+5 suite:
 *   - Stripe webhook state machine (checkout/updated/deleted/payment_failed)
 *   - Duplicate delivery → single state change
 *   - Out-of-order event protection
 *   - Subscription-aware access control (grace/dunning in workspace middleware)
 */

const app = buildTestApp();
const SECRET = 'whsec_test_secret';

const W1 = wsId(1);
const ALICE = userId(1);
let token: string;

function sign(payload: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const sig = crypto.createHmac('sha256', SECRET).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function postWebhook(event: any) {
  const payload = JSON.stringify(event);
  return request(app)
    .post('/api/v1/webhooks/stripe')
    .set('Content-Type', 'application/json')
    .set('Stripe-Signature', sign(payload))
    .send(payload);
}

let eventCounter = 0;
function makeEvent(type: string, dataObject: any, createdOffsetSec = 0) {
  eventCounter += 1;
  return {
    id: `evt_test_${eventCounter}_${Math.random().toString(36).slice(2, 8)}`,
    type,
    created: Math.floor(Date.now() / 1000) + createdOffsetSec,
    livemode: false,
    data: { object: dataObject },
  };
}

beforeEach(async () => {
  seedWorld(testDb);
  seedPlans(testDb);
  upsertSubscription(testDb, W1, PLAN_IDS.business, 'active');
  token = issueToken(ALICE, 'alice@example.com');
  const { PlanCatalogService } = await import('../../src/services/plan-catalog.service');
  PlanCatalogService.invalidateCache();
});

describe('Stripe webhook state machine (Phase 3 Step 4)', () => {
  it('checkout.session.completed activates the plan and binds stripe ids', async () => {
    const event = makeEvent('checkout.session.completed', {
      id: 'cs_123',
      status: 'complete',
      client_reference_id: W1,
      customer: 'cus_test_1',
      subscription: 'sub_stripe_1',
      metadata: { workspace_id: W1, plan_name: 'enterprise' },
    });

    const res = await postWebhook(event);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('processed');

    const sub = testDb.__all('subscriptions').find((s: any) => s.workspace_id === W1);
    expect(sub.plan_id).toBe(PLAN_IDS.enterprise);
    expect(sub.status).toBe('active');
    expect(sub.stripe_customer_id).toBe('cus_test_1');
    expect(sub.stripe_subscription_id).toBe('sub_stripe_1');

    // Usage limits were re-synced to the new plan (users: -1 for enterprise)
    const usage = testDb.__all('usage_records').filter((u: any) => u.workspace_id === W1);
    expect(usage.length).toBeGreaterThan(0);
  });

  it('duplicate delivery of the same event causes no double state change', async () => {
    const event = makeEvent('checkout.session.completed', {
      id: 'cs_dup',
      client_reference_id: W1,
      customer: 'cus_dup',
      subscription: 'sub_dup',
      metadata: { workspace_id: W1, plan_name: 'starter' },
    });

    const first = await postWebhook(event);
    expect(first.body.data.status).toBe('processed');

    // Deliver the EXACT same event id again
    const second = await postWebhook(event);
    expect(second.status).toBe(200);
    expect(second.body.data.status).toBe('already_processed');

    // Recorded once, and the subscription state is identical
    const events = testDb.__all('stripe_webhook_events').filter((e: any) => e.event_id === event.id);
    expect(events).toHaveLength(1);
    const sub = testDb.__all('subscriptions').find((s: any) => s.workspace_id === W1);
    expect(sub.plan_id).toBe(PLAN_IDS.starter);
  });

  it('customer.subscription.updated syncs status (past_due)', async () => {
    // Bind the stripe subscription first
    upsertSubscription(testDb, W1, PLAN_IDS.business, 'active', { stripe_subscription_id: 'sub_upd_1' });

    const event = makeEvent('customer.subscription.updated', {
      id: 'sub_upd_1',
      status: 'past_due',
      current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    });

    const res = await postWebhook(event);
    expect(res.body.data.status).toBe('processed');

    const sub = testDb.__all('subscriptions').find((s: any) => s.workspace_id === W1);
    expect(sub.status).toBe('past_due');
  });

  it('skips a stale out-of-order updated event (newer state already applied)', async () => {
    // Simulate the row having been updated AFTER this event was created
    upsertSubscription(testDb, W1, PLAN_IDS.business, 'cancelled', {
      stripe_subscription_id: 'sub_ooo',
      updated_at: new Date(Date.now() + 60_000).toISOString(), // 1 min in the future vs event.created
    });

    const event = makeEvent('customer.subscription.updated', {
      id: 'sub_ooo',
      status: 'active', // stale: someone already cancelled later
    });

    const res = await postWebhook(event);
    expect(res.body.data.status).toBe('skipped_stale');

    const sub = testDb.__all('subscriptions').find((s: any) => s.workspace_id === W1);
    expect(sub.status).toBe('cancelled'); // unchanged
  });

  it('customer.subscription.deleted cancels the subscription', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.business, 'active', { stripe_subscription_id: 'sub_del' });

    const event = makeEvent('customer.subscription.deleted', { id: 'sub_del' });
    const res = await postWebhook(event);
    expect(res.body.data.status).toBe('processed');

    const sub = testDb.__all('subscriptions').find((s: any) => s.workspace_id === W1);
    expect(sub.status).toBe('cancelled');
    expect(sub.cancelled_at).toBeTruthy();
  });

  it('invoice.payment_failed sets past_due with a 7-day grace window', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.business, 'active', { stripe_customer_id: 'cus_pf' });

    const before = Date.now();
    const event = makeEvent('invoice.payment_failed', { id: 'in_1', customer: 'cus_pf' });
    const res = await postWebhook(event);
    expect(res.body.data.status).toBe('processed');

    const sub = testDb.__all('subscriptions').find((s: any) => s.workspace_id === W1);
    expect(sub.status).toBe('past_due');
    expect(sub.past_due_at).toBeTruthy();

    const grace = new Date(sub.grace_ends_at).getTime();
    const expectedMin = before + 7 * 24 * 3600 * 1000 - 2000;
    const expectedMax = Date.now() + 7 * 24 * 3600 * 1000 + 2000;
    expect(grace).toBeGreaterThanOrEqual(expectedMin);
    expect(grace).toBeLessThanOrEqual(expectedMax);
  });

  it('ignores unhandled event types with 200 (no infinite retries)', async () => {
    const event = makeEvent('charge.succeeded', { id: 'ch_1' });
    const res = await postWebhook(event);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ignored');
    expect(testDb.__all('stripe_webhook_events').filter((e: any) => e.event_id === event.id)).toHaveLength(1);
  });
});

describe('Subscription-aware access control (Phase 3 Step 5, PRD §17)', () => {
  it('allows normal access when subscription is active', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.business, 'active');

    const res = await request(app)
      .get(`/api/v1/workspaces/${W1}/products`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('blocks non-billing routes when subscription is cancelled', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.business, 'cancelled');

    const res = await request(app)
      .get(`/api/v1/workspaces/${W1}/products`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
  });

  it('still allows billing routes when cancelled (so the user can reactivate)', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.business, 'cancelled');

    const res = await request(app)
      .get(`/api/v1/workspaces/${W1}/billing`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('allows access during the past_due grace window', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.business, 'past_due', {
      past_due_at: new Date().toISOString(),
      grace_ends_at: new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString(), // 5 days left
    });

    const res = await request(app)
      .get(`/api/v1/workspaces/${W1}/products`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('blocks non-billing routes after the grace window expires', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.business, 'past_due', {
      past_due_at: new Date(Date.now() - 10 * 24 * 3600 * 1000).toISOString(),
      grace_ends_at: new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString(), // expired 3 days ago
    });

    const res = await request(app)
      .get(`/api/v1/workspaces/${W1}/products`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SUBSCRIPTION_PAST_DUE');

    // Billing remains reachable
    const billing = await request(app)
      .get(`/api/v1/workspaces/${W1}/billing`)
      .set('Authorization', `Bearer ${token}`);
    expect(billing.status).toBe(200);
  });

  it('treats an expired trial as needing payment (blocked)', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.starter, 'trialing', {
      trial_ends_at: new Date(Date.now() - 24 * 3600 * 1000).toISOString(), // expired yesterday
    });

    const res = await request(app)
      .get(`/api/v1/workspaces/${W1}/products`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('SUBSCRIPTION_PAST_DUE');
  });

  it('allows an active trial', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.starter, 'trialing', {
      trial_ends_at: new Date(Date.now() + 10 * 24 * 3600 * 1000).toISOString(),
    });

    const res = await request(app)
      .get(`/api/v1/workspaces/${W1}/products`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
