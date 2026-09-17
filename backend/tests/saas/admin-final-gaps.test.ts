import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, wsId, userId } from '../helpers/world';
import { seedPlans, upsertSubscription, PLAN_IDS } from '../helpers/billing-world';
import { issueToken, testDb, ADMIN_TEST_PASSWORD } from '../setup';

/**
 * Final-gaps suite (§77, §66 extension, §40, §69):
 *   - GET /admin/overview — SQL aggregate counts + MRR (not in-memory reduce)
 *   - Subscription admin actions now re-auth gated (§66)
 *   - GET /admin/audit-logs?from&to&action — date-range + action filters
 *   - GET /admin/payments/:id — payment drill-in (§69)
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

describe('GET /admin/overview (§77 SQL aggregation)', () => {
  it('returns aggregate counts without embedding full table dumps', async () => {
    const res = await request(app)
      .get('/api/v1/admin/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.totalWorkspaces).toBeGreaterThanOrEqual(1);
    expect(res.body.data.activeWorkspaces).toBeGreaterThanOrEqual(1);
    expect(res.body.data.totalUsers).toBeGreaterThanOrEqual(1);
    // Recent-only samples (10), not full datasets
    expect(res.body.data.workspaces.length).toBeLessThanOrEqual(10);
    expect(res.body.data.subscriptions.length).toBeLessThanOrEqual(10);
  });

  it('reflects new users without a deploy or stale cache across tests', async () => {
    const res = await request(app)
      .get('/api/v1/admin/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    // fresh db per test → totals are small and exact
    expect(res.body.data.trialWorkspaces + res.body.data.paidWorkspaces).toBe(1);
  });
});

describe('§66 re-auth on subscription admin actions', () => {
  it('blocks subscription cancel without re-auth', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/workspaces/${W1}/subscription/cancel`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ reason: 'customer request' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REAUTH_REQUIRED');
  });

  it('blocks change-plan without re-auth', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/workspaces/${W1}/subscription/change-plan`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ planName: 'business', reason: 'upgrade request' });
    expect(res.status).toBe(401);
  });

  it('blocks extend-trial without re-auth', async () => {
    const res = await request(app)
      .post(`/api/v1/admin/workspaces/${W1}/subscription/extend-trial`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ days: 14, reason: 'goodwill' });
    expect(res.status).toBe(401);
  });
});

describe('GET /admin/audit-logs date filters (§40/§60)', () => {
  it('filters by date range', async () => {
    const from = new Date(Date.now() + 60_000).toISOString(); // future: excludes all
    const res = await request(app)
      .get(`/api/v1/admin/audit-logs?from=${encodeURIComponent(from)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('filters by exact action', async () => {
    testDb.__insert('audit_logs', [
      { id: 'al_1', action: 'platform.plan_created', entity: 'subscription_plan', entity_id: 'x', user_id: userId(9), created_at: new Date().toISOString() },
      { id: 'al_2', action: 'user.login', entity: 'user', entity_id: userId(9), user_id: userId(9), created_at: new Date().toISOString() },
    ]);
    const res = await request(app)
      .get('/api/v1/admin/audit-logs?action=platform.plan_created')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].action).toBe('platform.plan_created');
  });
});

describe('GET /admin/payments/:id (§69)', () => {
  it('returns payment with workspace/subscription/coupon context and no metadata', async () => {
    testDb.__insert('payments', [
      {
        id: 'pay_detail_1', workspace_id: W1, subscription_id: null, provider: 'stripe',
        provider_reference: 'in_detail', amount: 29, currency: 'USD', status: 'successful',
        invoice_id: 'in_detail', discount_amount: 0, failure_reason: null,
        metadata: { stripe_event_id: 'evt_secret' },
        created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ]);
    const res = await request(app)
      .get('/api/v1/admin/payments/pay_detail_1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.provider_reference).toBe('in_detail');
    expect(res.body.data.workspace.id).toBe(W1);
    expect(res.body.data).not.toHaveProperty('metadata');
    expect(JSON.stringify(res.body)).not.toContain('evt_secret');
  });

  it('404s for unknown payments', async () => {
    const res = await request(app)
      .get('/api/v1/admin/payments/11111111-1111-4111-8111-999999999999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects non-admins', async () => {
    const token = issueToken(ALICE, 'alice@example.com');
    const res = await request(app)
      .get('/api/v1/admin/payments/pay_detail_1')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
