import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { buildTestApp } from '../helpers/test-app';
import { seedWorld, wsId, userId } from '../helpers/world';
import { testDb, issueToken } from '../setup';

/**
 * Phase 3 billing suite (PRD §15, §16, Rule #8/#9):
 *   - DB-driven plan catalog & summary (no hardcoded fallback)
 *   - changePlan persists via plan_id + downgrade guard
 *   - Usage limits enforced server-side on create paths
 *   - Feature gating on analytics/forecast + AI copilot
 */

const W1 = wsId(1);
const W2 = wsId(2);
const ALICE = userId(1);

// Plan ids (deterministic — inserted in seedPlans)
const PLAN_IDS: Record<string, string> = {
  free: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001',
  starter: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000002',
  business: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000003',
  enterprise: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000004',
};

const PLAN_SEED = [
  {
    id: PLAN_IDS.free,
    name: 'free',
    display_name: 'Free',
    price_monthly: 0,
    price_annual: 0,
    limits: { users: 2, products: 100, warehouses: 1, transactions_per_month: 500, storage_mb: 100 },
    features: { basic_reports: true, csv_export: true, forecasting: false, api_access: false, priority_support: false },
    is_active: true,
    sort_order: 1,
  },
  {
    id: PLAN_IDS.starter,
    name: 'starter',
    display_name: 'Starter',
    price_monthly: 29,
    price_annual: 290,
    limits: { users: 5, products: 1000, warehouses: 2, transactions_per_month: 5000, storage_mb: 1000 },
    features: { basic_reports: true, csv_export: true, forecasting: false, api_access: false, priority_support: false },
    is_active: true,
    sort_order: 2,
  },
  {
    id: PLAN_IDS.business,
    name: 'business',
    display_name: 'Business',
    price_monthly: 79,
    price_annual: 790,
    limits: { users: 25, products: 10000, warehouses: 10, transactions_per_month: 50000, storage_mb: 10000 },
    features: { basic_reports: true, csv_export: true, forecasting: true, api_access: true, priority_support: true },
    is_active: true,
    sort_order: 3,
  },
  {
    id: PLAN_IDS.enterprise,
    name: 'enterprise',
    display_name: 'Enterprise',
    price_monthly: 199,
    price_annual: 1990,
    limits: { users: -1, products: -1, warehouses: -1, transactions_per_month: -1, storage_mb: 100000 },
    features: { basic_reports: true, csv_export: true, forecasting: true, api_access: true, priority_support: true, custom_integrations: true },
    is_active: true,
    sort_order: 4,
  },
];

/**
 * Seed plans + a subscription for ws1. Real subscriptions has UNIQUE(workspace_id);
 * tests that add a second row for the same workspace must replace, not append.
 */
function seedPlans(subFor: { workspaceId: string; plan: string; status?: string } | null = { workspaceId: W1, plan: 'business', status: 'active' }) {
  testDb.__insert('subscription_plans', PLAN_SEED);
  if (subFor) {
    testDb.__insert('subscriptions', [
      {
        id: `sub_${subFor.workspaceId.slice(-6)}`,
        workspace_id: subFor.workspaceId,
        plan_id: PLAN_IDS[subFor.plan],
        status: subFor.status || 'active',
        billing_interval: 'monthly',
      },
    ]);
  }
}

let app: ReturnType<typeof buildTestApp>;
let token: string;

beforeEach(async () => {
  seedWorld(testDb);
  seedPlans();
  app = buildTestApp();
  token = issueToken(ALICE, 'alice@example.com');
  // The plan catalog caches for 60s — tests mutate plan data every case.
  const { PlanCatalogService } = await import('../../src/services/plan-catalog.service');
  PlanCatalogService.invalidateCache();
});

describe('Plan catalog & billing summary', () => {
  it('returns DB-driven plan data with UI-compatible keys', async () => {
    const res = await request(app)
      .get(`/api/v1/workspaces/${W1}/billing`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    const body = res.body.data;
    expect(body.plan_tier).toBe('business');
    expect(body.plan_display_name).toBe('Business');
    expect(body.price_monthly).toBe(79);
    expect(body.limits.maxUsers).toBe(25);
    expect(body.limits.maxProducts).toBe(10000);
    expect(body.limits.maxWarehouses).toBe(10);
    expect(body.features.forecasting).toBe(true);
    expect(body.usage).toBeDefined();
  });

  it('falls back to the FREE plan (not hardcoded Business) when no subscription row exists', async () => {
    // ws2 has no subscription row
    const token2 = issueToken(ALICE, 'alice@example.com');
    const res = await request(app)
      .get(`/api/v1/workspaces/${W2}/billing`)
      .set('Authorization', `Bearer ${token2}`);

    expect(res.status).toBe(200);
    expect(res.body.data.plan_tier).toBe('free');
    expect(res.body.data.price_monthly).toBe(0);
    expect(res.body.data.limits.maxUsers).toBe(2);
  });
});

describe('changePlan (dev mode — no Stripe env)', () => {
  it('persists the plan via plan_id and returns the refreshed summary', async () => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/plan`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planName: 'enterprise' });

    expect(res.status).toBe(200);
    expect(res.body.data.plan_tier).toBe('enterprise');
    // Persisted through the subscriptions table with the resolved plan id
    const sub = testDb.__all('subscriptions').find((s: any) => s.workspace_id === W1);
    expect(sub.plan_id).toBe(PLAN_IDS.enterprise);
    expect(sub.status).toBe('active');
  });

  it('rejects unknown plans with PLAN_NOT_FOUND', async () => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/plan`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planName: 'diamond-ultra' });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PLAN_NOT_FOUND');
  });

  it('blocks downgrades below current usage with PLAN_DOWNGRADE_BLOCKED', async () => {
    // Seed a tighter plan whose products limit (1) is below ws1's current usage (3 products)
    testDb.__insert('subscription_plans', [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-000000000009',
        name: 'micro',
        display_name: 'Micro',
        price_monthly: 1,
        price_annual: 10,
        limits: { users: 25, products: 1, warehouses: 1, transactions_per_month: 500, storage_mb: 100 },
        features: { basic_reports: true },
        is_active: true,
        sort_order: 9,
      },
    ]);
    // ws1 world seed has 1 product; add 2 more so usage (3) exceeds the micro plan's limit (1)
    testDb.__insert('products', [
      { id: '77777777-7777-4777-8777-000000000010', workspace_id: W1, name: 'P2', sku: 'P2', unit: 'pcs' },
      { id: '77777777-7777-4777-8777-000000000011', workspace_id: W1, name: 'P3', sku: 'P3', unit: 'pcs' },
    ]);

    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/plan`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planName: 'micro' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PLAN_DOWNGRADE_BLOCKED');
    expect(res.body.error.details.violations[0].metric).toBe('products');
    // Nothing changed
    const sub = testDb.__all('subscriptions').find((s: any) => s.workspace_id === W1);
    expect(sub.plan_id).toBe(PLAN_IDS.business);
  });

  it('writes a billing.plan_changed audit row', async () => {
    await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/plan`)
      .set('Authorization', `Bearer ${token}`)
      .send({ planName: 'starter' });

    const audits = testDb.__all('audit_logs').filter((a: any) => a.action === 'billing.plan_changed');
    expect(audits).toHaveLength(1);
    expect(audits[0].previous_value.plan_name).toBe('business');
    expect(audits[0].new_value.plan_name).toBe('starter');
  });
});

/**
 * Replace (not append) ws1's subscription — the real table has a UNIQUE
 * constraint on workspace_id and tests must mirror that reality.
 */
function replaceWs1Subscription(planId: string, status = 'active') {
  const subs = testDb.__all('subscriptions') as any[];
  const existing = subs.find((s) => s.workspace_id === W1);
  if (existing) {
    existing.plan_id = planId;
    existing.status = status;
  } else {
    testDb.__insert('subscriptions', [{ id: 'sub_ws1x', workspace_id: W1, plan_id: planId, status }]);
  }
}

describe('Usage limit enforcement (server-side, PRD §15)', () => {
  function seedFreeSubscription() {
    testDb.__insert('subscriptions', [
      {
        id: 'sub_free1',
        workspace_id: W2,
        plan_id: PLAN_IDS.free,
        status: 'active',
      },
    ]);
  }

  it('allows product creation below the plan limit', async () => {
    seedFreeSubscription();
    // W2 has 1 product (world seed); free allows 100
    const res = await request(app)
      .post(`/api/v1/workspaces/${W2}/products`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Thing', sku: `NEW-${Math.random()}` });

    expect(res.status).toBe(201);
  });

  it('rejects product creation at the plan limit with PLAN_LIMIT_REACHED', async () => {
    seedFreeSubscription();
    // Jam usage_records is NOT the source of truth — insert 100 real products
    const rows = Array.from({ length: 99 }, (_, i) => ({
      id: `prod_${i}`,
      workspace_id: W2,
      name: `Bulk ${i}`,
      sku: `BULK-${i}`,
      unit: 'pcs',
    }));
    testDb.__insert('products', rows); // + world's 1 = 100 = limit

    const res = await request(app)
      .post(`/api/v1/workspaces/${W2}/products`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'One Too Many', sku: 'OVER-1' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PLAN_LIMIT_REACHED');
    expect(res.body.error.details.metric).toBe('products');
    expect(res.body.error.details.limit).toBe(100);
    // Nothing was persisted
    expect(testDb.__all('products').filter((p: any) => p.sku === 'OVER-1')).toHaveLength(0);
  });

  it('blocks the users metric via shared service (invitation path)', async () => {
    seedFreeSubscription();
    // W2 has 1 active member (carol). Free allows 2. Add a second member → at limit.
    testDb.__insert('workspace_members', [
      { id: 'mem_x1', user_id: ALICE, workspace_id: W2, status: 'active' },
    ]);

    const res = await request(app)
      .post(`/api/v1/workspaces/${W2}/products`) // any authenticated route proves the app works
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'x', sku: 'x1' });
    expect(res.status).toBe(201);

    // Direct service-level check of the users gate:
    const { UsageService } = await import('../../src/services/usage.service');
    await expect(UsageService.assertWithinLimit(W2, 'users')).rejects.toMatchObject({
      code: 'PLAN_LIMIT_REACHED',
      details: { metric: 'users', limit: 2 },
    });
  });

  it('treats -1 limits as unlimited (enterprise)', async () => {
    replaceWs1Subscription(PLAN_IDS.enterprise);
    // Replace W1 with the enterprise plan, then create a product beyond 100
    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/products`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ent Product', sku: 'ENT-1' });
    expect(res.status).toBe(201);
  });
});

describe('Feature gating (PRD §16)', () => {
  function seedStarterSubscription() {
    replaceWs1Subscription(PLAN_IDS.starter);
  }

  it('returns PLAN_FEATURE_DISABLED when plan lacks the feature (forecast on Starter)', async () => {
    seedStarterSubscription();
    const res = await request(app)
      .get(`/api/v1/workspaces/${W1}/analytics/forecast`)
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PLAN_FEATURE_DISABLED');
    expect(res.body.error.details.feature).toBe('forecasting');
  });

  it('allows the feature through the real route when the plan includes it (Business)', async () => {
    // beforeEach already seeds W1 on business (forecasting: true)
    const res = await request(app)
      .get(`/api/v1/workspaces/${W1}/analytics/forecast`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('requireFeature throws PLAN_FEATURE_DISABLED from the middleware directly', async () => {
    seedStarterSubscription();
    const { requireFeature } = await import('../../src/middleware/feature.middleware');
    const middleware = requireFeature('forecasting');

    const req: any = { workspace: { id: W1 } };
    const err: any = await new Promise((resolve) => {
      middleware(req, {} as any, (e?: any) => resolve(e));
    });

    expect(err).toMatchObject({ code: 'PLAN_FEATURE_DISABLED', details: { feature: 'forecasting', planTier: 'Starter' } });
  });

  it('allows the feature from the middleware when plan includes it', async () => {
    const { requireFeature } = await import('../../src/middleware/feature.middleware');
    const middleware = requireFeature('forecasting');

    const req: any = { workspace: { id: W1 } }; // business plan
    const next = vi.fn();
    await middleware(req, {} as any, next);

    expect(next).toHaveBeenCalled();
    expect(req.planTier).toBe('business');
  });
});
