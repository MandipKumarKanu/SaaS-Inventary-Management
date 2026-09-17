import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, wsId, userId } from '../helpers/world';
import { seedPlans, PLAN_IDS } from '../helpers/billing-world';
import { issueToken, testDb } from '../setup';

/**
 * Plan management (§34/§51) + analytics (§59) suite:
 *   - GET/POST/PATCH /admin/plans — gated by platform.plans.view/manage
 *   - Deactivation guard for plans still in use
 *   - Limit/feature key validation, cache invalidation
 *   - GET /admin/analytics — date-range validation + supported metrics
 */
const app = buildTestApp();
const W1 = wsId(1);
const ALICE = userId(1);
let adminToken: string;

beforeEach(() => {
  testDb.__reset();
  seedWorld(testDb);
  seedPlans(testDb);

  const admin = { id: userId(9), email: 'root@example.com', name: 'Root', status: 'active' };
  testDb.__insert('users', [admin]);
  testDb.__insert('platform_admins', [{ id: 'pa_1', user_id: admin.id, role: null }]);
  adminToken = issueToken(admin.id, admin.email);
});

describe('GET /admin/plans (§51)', () => {
  it('lists all plans including inactive ones', async () => {
    const res = await request(app)
      .get('/api/v1/admin/plans')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const names = res.body.plans.map((p: any) => p.name);
    expect(names).toEqual(expect.arrayContaining(['free', 'starter', 'business', 'enterprise']));
  });

  it('rejects non-admins', async () => {
    const token = issueToken(ALICE, 'alice@example.com');
    const res = await request(app)
      .get('/api/v1/admin/plans')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /admin/plans (§51)', () => {
  it('creates a plan with validated limits/features and audits it', async () => {
    const res = await request(app)
      .post('/api/v1/admin/plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Pro',
        display_name: 'Pro',
        price_monthly: 79,
        price_annual: 790,
        limits: { users: 25, products: 5000, warehouses: -1 },
        features: { forecasting: true, api_access: true },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('pro');
    expect(res.body.data.limits.users).toBe(25);
    expect(res.body.data.limits.warehouses).toBe(-1);
    expect(res.body.data.features.forecasting).toBe(true);

    const audit = await request(app)
      .get('/api/v1/admin/audit-logs?search=plan_created')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(audit.body.data.some((a: any) => a.action === 'platform.plan_created')).toBe(true);
  });

  it('rejects unknown limit/feature keys and bad values', async () => {
    const bad = await request(app)
      .post('/api/v1/admin/plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'pro2',
        display_name: 'Pro 2',
        price_monthly: 10,
        price_annual: 100,
        limits: { maxSpaceships: 5 },
      });
    expect(bad.status).toBe(400);

    const neg = await request(app)
      .post('/api/v1/admin/plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'pro3',
        display_name: 'Pro 3',
        price_monthly: 10,
        price_annual: 100,
        limits: { users: -5 },
      });
    expect(neg.status).toBe(400);
  });

  it('409s on a duplicate tier name', async () => {
    const res = await request(app)
      .post('/api/v1/admin/plans')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'starter', display_name: 'Starter', price_monthly: 1, price_annual: 10 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PLAN_EXISTS');
  });

  it('is gated to platform.plans.manage (SUPPORT_ADMIN denied)', async () => {
    // Seed a SUPPORT_ADMIN — role map denies platform.plans.manage (§65)
    const support = { id: userId(8), email: 'support@example.com', name: 'Support', status: 'active' };
    testDb.__insert('users', [support]);
    testDb.__insert('platform_admins', [{ id: 'pa_2', user_id: support.id, role: 'SUPPORT_ADMIN' }]);
    const token = issueToken(support.id, support.email);

    const res = await request(app)
      .post('/api/v1/admin/plans')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'nope', display_name: 'Nope', price_monthly: 1, price_annual: 10 });
    expect(res.status).toBe(403);
  });
});

describe('PATCH /admin/plans/:id (§34 historical accuracy + §51)', () => {
  it('updates pricing without touching historical subscriptions', async () => {
    // A subscription on starter — must keep pointing at the same plan_id
    const { upsertSubscription } = await import('../helpers/billing-world');
    upsertSubscription(testDb, W1, PLAN_IDS.starter, 'active');

    const res = await request(app)
      .patch(`/api/v1/admin/plans/${PLAN_IDS.starter}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ price_monthly: 39 });
    expect(res.status).toBe(200);
    expect(Number(res.body.data.price_monthly)).toBe(39);

    // The subscription row still references the same plan (§34: never rewritten)
    const { supabaseAdmin } = await import('../../src/config/supabase.js');
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('plan_id')
      .eq('workspace_id', W1)
      .maybeSingle();
    expect(sub?.plan_id).toBe(PLAN_IDS.starter);
  });

  it('blocks deactivation while workspaces are still on the plan', async () => {
    const { upsertSubscription } = await import('../helpers/billing-world');
    upsertSubscription(testDb, W1, PLAN_IDS.starter, 'active');

    const res = await request(app)
      .patch(`/api/v1/admin/plans/${PLAN_IDS.starter}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PLAN_IN_USE');
  });

  it('allows deactivating an unused plan', async () => {
    const res = await request(app)
      .patch(`/api/v1/admin/plans/${PLAN_IDS.enterprise}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ is_active: false });
    expect(res.status).toBe(200);
    expect(res.body.data.is_active).toBe(false);
  });
});

describe('GET /admin/analytics (§59)', () => {
  it('returns supported metrics over the default window', async () => {
    const res = await request(app)
      .get('/api/v1/admin/analytics')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.growth).toHaveProperty('new_users');
    expect(res.body.data.growth).toHaveProperty('new_workspaces');
    expect(res.body.data.subscriptions).toHaveProperty('upgrades');
    expect(res.body.data.subscriptions).toHaveProperty('downgrades');
    expect(res.body.data.coupons).toHaveProperty('redemptions');
  });

  it('accepts an explicit date range', async () => {
    const from = new Date(Date.now() - 10 * 86400_000).toISOString();
    const to = new Date().toISOString();
    const res = await request(app)
      .get(`/api/v1/admin/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.range.from).toBe(from);
  });

  it('422s/400s on an inverted range', async () => {
    const from = new Date().toISOString();
    const to = new Date(Date.now() - 10 * 86400_000).toISOString();
    const res = await request(app)
      .get(`/api/v1/admin/analytics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects non-admins', async () => {
    const token = issueToken(ALICE, 'alice@example.com');
    const res = await request(app)
      .get('/api/v1/admin/analytics')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
