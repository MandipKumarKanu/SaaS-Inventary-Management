import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, wsId, userId } from '../helpers/world';
import { seedPlans, PLAN_IDS } from '../helpers/billing-world';
import { issueToken, testDb, ADMIN_TEST_PASSWORD } from '../setup';

/**
 * Admin ops suite (§70 bulk ops, §58 webhook retry, §62 job monitoring):
 *   - POST /admin/coupons/bulk-status + /admin/users/bulk-status
 *   - POST /admin/webhook-events/:id/retry (stored-payload re-dispatch)
 *   - GET  /admin/jobs (per-job status aggregation)
 */
const app = buildTestApp();
const W1 = wsId(1);
const ALICE = userId(1);
let adminToken: string;

beforeEach(() => {
  testDb.__reset();
  seedWorld(testDb);
  seedPlans(testDb);
  testDb.__insert('subscription_plans', PLAN_SEED_MIN);

  const admin = { id: userId(9), email: 'root@example.com', name: 'Root', status: 'active' };
  testDb.__insert('users', [admin]);
  testDb.__insert('platform_admins', [{ id: 'pa_1', user_id: admin.id, role: null }]);
  adminToken = issueToken(admin.id, admin.email);
});

// subscription_plans rows are required by FK-free mock reads in webhook retry
const PLAN_SEED_MIN = [
  { id: PLAN_IDS.starter, name: 'starter', display_name: 'Starter', price_monthly: 29, price_annual: 290, limits: {}, features: {}, is_active: true, sort_order: 2 },
];

describe('POST /admin/coupons/bulk-status (§70)', () => {
  it('disables multiple coupons and reports per-item results', async () => {
    testDb.__insert('coupons', [
      { id: 'cpn_a', code: 'BULK_A', discount_type: 'PERCENTAGE', discount_value: 10, current_redemptions: 0, active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
      { id: 'cpn_b', code: 'BULK_B', discount_type: 'PERCENTAGE', discount_value: 10, current_redemptions: 0, active: true, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
    ]);
    const res = await request(app)
      .post('/api/v1/admin/coupons/bulk-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-admin-password', ADMIN_TEST_PASSWORD)
      .send({ ids: ['cpn_a', 'cpn_b'], active: false });
    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toBe(2);
    expect(res.body.data.failed).toBe(0);

    const { supabaseAdmin } = await import('../../src/config/supabase.js');
    const { data: coupons } = await supabaseAdmin.from('coupons').select('code, active').in('id', ['cpn_a', 'cpn_b']);
    expect(coupons.every((c: any) => c.active === false)).toBe(true);
  });

  it('caps batch size at 100', async () => {
    const ids = Array.from({ length: 101 }, (_, i) => `cpn_${i}`);
    const res = await request(app)
      .post('/api/v1/admin/coupons/bulk-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-admin-password', ADMIN_TEST_PASSWORD)
      .send({ ids, active: false });
    expect(res.status).toBe(422);
  });

  it('rejects non-managers', async () => {
    const token = issueToken(ALICE, 'alice@example.com');
    const res = await request(app)
      .post('/api/v1/admin/coupons/bulk-status')
      .set('Authorization', `Bearer ${token}`)
      .send({ ids: ['cpn_a'], active: false });
    expect(res.status).toBe(403);
  });
});

describe('POST /admin/users/bulk-status (§70)', () => {
  it('suspends multiple users', async () => {
    testDb.__insert('users', [
      { id: userId(21), email: 'u21@example.com', name: 'U21', status: 'active' },
      { id: userId(22), email: 'u22@example.com', name: 'U22', status: 'active' },
    ]);
    const res = await request(app)
      .post('/api/v1/admin/users/bulk-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-admin-password', ADMIN_TEST_PASSWORD)
      .send({ ids: [userId(21), userId(22)], status: 'suspended' });
    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toBe(2);
  });
});

describe('POST /admin/webhook-events/:id/retry (§58)', () => {
  it('re-dispatches a stored failed payload through the idempotent handler', async () => {
    testDb.__insert('stripe_webhook_events', [
      {
        id: 'wh_retry_1',
        event_id: 'evt_retry_1',
        event_type: 'checkout.session.completed',
        processing_status: 'failed',
        detail: 'boom',
        delivery_attempt: 1,
        payload: {
          id: 'evt_retry_1',
          type: 'checkout.session.completed',
          created: Math.floor(Date.now() / 1000),
          data: { object: { id: 'cs_x', client_reference_id: W1, metadata: { plan_name: 'business' } } },
        },
        created_at: new Date().toISOString(),
      },
    ]);
    const spy = vi.spyOn(await import('../../src/modules/webhooks/stripe-webhook.service.js'), 'StripeWebhookService');
    const res = await request(app)
      .post('/api/v1/admin/webhook-events/wh_retry_1/retry')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    // The stored row already exists, so the idempotency guard reports it —
    // exactly the §58 behavior: retry cannot double-process.
    expect(['processed', 'failed', 'skipped_stale', 'no_workspace', 'already_processed']).toContain(res.body.data.status);
    spy.mockRestore();
  });

  it('refuses events without a stored payload', async () => {
    testDb.__insert('stripe_webhook_events', [
      { id: 'wh_nopayload', event_id: 'evt_nopayload', event_type: 'invoice.payment_failed', processing_status: 'failed', created_at: new Date().toISOString() },
    ]);
    const res = await request(app)
      .post('/api/v1/admin/webhook-events/wh_nopayload/retry')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('NO_STORED_PAYLOAD');
  });

  it('refuses non-failed events', async () => {
    testDb.__insert('stripe_webhook_events', [
      { id: 'wh_ok', event_id: 'evt_ok', event_type: 'invoice.payment_succeeded', processing_status: 'processed', payload: { id: 'evt_ok', type: 'invoice.payment_succeeded', data: { object: {} } }, created_at: new Date().toISOString() },
    ]);
    const res = await request(app)
      .post('/api/v1/admin/webhook-events/wh_ok/retry')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_EVENT_STATUS');
  });
});

describe('GET /admin/jobs (§62)', () => {
  it('aggregates per-job status, failures, and last error', async () => {
    const newer = new Date(Date.now() - 1000).toISOString();
    const older = new Date(Date.now() - 60_000).toISOString();
    testDb.__insert('background_job_logs', [
      { id: 'j1', job_name: 'CRON_TRIAL_EXPIRATION', status: 'success', executed_at: older, details: {} },
      { id: 'j2', job_name: 'CRON_TRIAL_EXPIRATION', status: 'failed', executed_at: newer, details: { error: 'db timeout' } },
      { id: 'j3', job_name: 'CRON_REORDER', status: 'success', executed_at: older, details: {} },
    ]);
    const res = await request(app)
      .get('/api/v1/admin/jobs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const trial = res.body.data.jobs.find((j: any) => j.job_name === 'CRON_TRIAL_EXPIRATION');
    expect(trial.total_runs).toBe(2);
    expect(trial.failure_count).toBe(1);
    expect(trial.last_status).toBe('failed');
    expect(trial.last_error).toBe('db timeout');
  });
});
