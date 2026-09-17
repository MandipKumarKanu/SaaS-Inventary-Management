import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, wsId, userId } from '../helpers/world';
import { seedPlans, upsertSubscription, PLAN_IDS } from '../helpers/billing-world';
import { issueToken, testDb, ADMIN_TEST_PASSWORD } from '../setup';

/**
 * Admin portal completion suite (PRD §44/§45, §52–§55, §56/§57, §63, §64, §71):
 *   - GET  /admin/users/:id            — user detail (§44/§45)
 *   - GET  /admin/payments             — platform-wide payments (§56)
 *   - POST /admin/payments/:id/refund  — refund initiation (§57)
 *   - GET/PATCH /admin/settings        — config_defaults management (§64)
 *   - GET  /admin/notifications        — failed jobs/webhooks feed (§63)
 *   - GET  /admin/exports/:entity      — CSV exports (§71)
 *   - Permission gates on every new endpoint (§65)
 */
const app = buildTestApp();
const W1 = wsId(1);
const ALICE = userId(1);
let adminToken: string;

beforeEach(() => {
  testDb.__reset();
  seedWorld(testDb);
  seedPlans(testDb);
  upsertSubscription(testDb, W1, PLAN_IDS.starter, 'active');

  const admin = { id: userId(9), email: 'root@example.com', name: 'Root', status: 'active' };
  testDb.__insert('users', [admin]);
  testDb.__insert('platform_admins', [{ id: 'pa_1', user_id: admin.id, role: null }]);
  adminToken = issueToken(admin.id, admin.email);
});

function seedPayment(overrides: Record<string, unknown> = {}) {
  const row = {
    id: 'pay_1',
    workspace_id: W1,
    subscription_id: null,
    provider: 'stripe',
    provider_reference: 'in_123',
    amount: 29,
    currency: 'USD',
    status: 'successful',
    invoice_id: 'in_123',
    discount_amount: 0,
    failure_reason: null,
    metadata: {},
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
  testDb.__insert('payments', [row]);
  return row;
}

describe('GET /admin/users/:id (§44/§45)', () => {
  it('returns profile, memberships with roles, and subscriptions', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/users/${ALICE}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe('alice@example.com');
    expect(res.body.data.user).not.toHaveProperty('password');
    // Memberships include a role name and workspace info
    expect(res.body.data.memberships.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.memberships[0].workspace).toBeTruthy();
    // Subscriptions resolve across the user's workspaces
    expect(res.body.data.subscriptions.length).toBeGreaterThanOrEqual(1);
    expect(res.body.data.subscriptions[0].plan.name).toBe('starter');
  });

  it('404s for an unknown user', async () => {
    const res = await request(app)
      .get('/api/v1/admin/users/11111111-1111-4111-8111-999999999999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects non-platform-admins with 403', async () => {
    const token = issueToken(ALICE, 'alice@example.com');
    const res = await request(app)
      .get(`/api/v1/admin/users/${ALICE}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /admin/payments (§56 platform-wide)', () => {
  it('lists payments across workspaces with workspace embed', async () => {
    seedPayment();
    const res = await request(app)
      .get('/api/v1/admin/payments')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].workspace.id).toBe(W1);
    expect(res.body.data[0]).not.toHaveProperty('metadata');
  });

  it('filters by status', async () => {
    seedPayment({ id: 'pay_ok', status: 'successful', provider_reference: 'in_ok' });
    seedPayment({ id: 'pay_bad', status: 'failed', provider_reference: 'in_bad', failure_reason: 'card_declined' });
    const res = await request(app)
      .get('/api/v1/admin/payments?status=failed')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].status).toBe('failed');
  });
});

describe('POST /admin/payments/:id/refund (§57)', () => {
  it('requires Stripe mode — dev mode is rejected', async () => {
    const payment = seedPayment();
    const res = await request(app)
      .post(`/api/v1/admin/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-admin-password', ADMIN_TEST_PASSWORD)
      .send({ reason: 'customer goodwill' });
    // Test env has no STRIPE_SECRET_KEY → the service must refuse (no invented offline refunds)
    expect([400, 502]).toContain(res.status);
  });

  it('rejects refunding a non-successful payment', async () => {
    const payment = seedPayment({ status: 'failed', failure_reason: 'card_declined' });
    const res = await request(app)
      .post(`/api/v1/admin/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-admin-password', ADMIN_TEST_PASSWORD)
      .send({ reason: 'duplicate charge' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_PAYMENT_STATUS');
  });

  it('requires a reason', async () => {
    const payment = seedPayment();
    const res = await request(app)
      .post(`/api/v1/admin/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-admin-password', ADMIN_TEST_PASSWORD)
      .send({ reason: '' });
    expect(res.status).toBe(422);
  });

  it('rejects non-admins', async () => {
    const payment = seedPayment();
    const token = issueToken(ALICE, 'alice@example.com');
    const res = await request(app)
      .post(`/api/v1/admin/payments/${payment.id}/refund`)
      .set('Authorization', `Bearer ${token}`)
      .send({ reason: 'customer goodwill' });
    expect(res.status).toBe(403);
  });
});

describe('GET/PATCH /admin/settings (§64)', () => {
  it('lists managed settings with values', async () => {
    const res = await request(app)
      .get('/api/v1/admin/settings')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const keys = res.body.data.settings.map((s: any) => s.key);
    expect(keys).toContain('trial_days');
    expect(keys).toContain('grace_period_days');
  });

  it('updates a setting and validates the type', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/settings/trial_days')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-admin-password', ADMIN_TEST_PASSWORD)
      .send({ value: 21 });
    expect(res.status).toBe(200);
    expect(Number(res.body.data.value)).toBe(21);

    const bad = await request(app)
      .patch('/api/v1/admin/settings/trial_days')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-admin-password', ADMIN_TEST_PASSWORD)
      .send({ value: 500 });
    expect(bad.status).toBe(400);
  });

  it('rejects unknown settings', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/settings/not_a_real_key')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-admin-password', ADMIN_TEST_PASSWORD)
      .send({ value: 1 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('UNKNOWN_SETTING');
  });
});

describe('GET /admin/notifications (§63)', () => {
  it('lists failed jobs and failed webhooks', async () => {
    testDb.__insert('background_job_logs', [
      {
        id: 'job_1', job_name: 'reorder_recs', status: 'failed',
        error: 'boom', started_at: new Date().toISOString(), finished_at: new Date().toISOString(),
      },
    ]);
    testDb.__insert('stripe_webhook_events', [
      {
        id: 'wh_1', event_id: 'evt_1', event_type: 'invoice.payment_failed',
        processing_status: 'failed', processing_error: 'no subscription',
        received_at: new Date().toISOString(),
      },
    ]);
    const res = await request(app)
      .get('/api/v1/admin/notifications')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.failed_jobs).toHaveLength(1);
    expect(res.body.data.failed_webhooks).toHaveLength(1);
  });
});

describe('GET /admin/exports/:entity (§71)', () => {
  it('exports users as CSV with a header row', async () => {
    const res = await request(app)
      .get('/api/v1/admin/exports/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.trim().split('\n');
    expect(lines[0]).toContain('email');
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('exports coupons as CSV', async () => {
    const res = await request(app)
      .get('/api/v1/admin/exports/coupons')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.text.trim().split('\n')[0]).toContain('code');
  });

  it('404s unknown entities', async () => {
    const res = await request(app)
      .get('/api/v1/admin/exports/secrets')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects non-admins', async () => {
    const token = issueToken(ALICE, 'alice@example.com');
    const res = await request(app)
      .get('/api/v1/admin/exports/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
