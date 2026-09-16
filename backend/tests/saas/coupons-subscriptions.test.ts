import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, wsId, userId } from '../helpers/world';
import { seedPlans, upsertSubscription, PLAN_IDS } from '../helpers/billing-world';
import { issueToken, testDb } from '../setup';

/**
 * SaaS Business Layer suite (coupons §21–§34, subscription lifecycle §19–§20,
 * platform admin RBAC §38/§65, transaction safety §80):
 *
 *   - Coupon validation: invalid/unknown/disabled/expired/plan-gated
 *   - Coupon redemption: server-side pricing, limits, atomic bump
 *   - Coupon upgrade: full HTTP flow (plan change + redemption + events)
 *   - Subscription lifecycle: cancel/resume semantics
 *   - Platform RBAC: SUPPORT_ADMIN cannot manage coupons; BILLING_ADMIN can;
 *     missing role column defaults to SUPER_ADMIN
 *
 * HTTP-level tests use the real middleware chain + in-memory supabase mock.
 * The coupon upgrade transaction runs through a mocked pg pool fake.
 */

const h = vi.hoisted(() => ({
  fakeClient: null as any,
}));

vi.mock('../../src/db/pool.js', () => ({
  withTransaction: async (fn: any) => {
    if (!h.fakeClient) throw new Error('fakeClient not configured');
    return fn(h.fakeClient);
  },
  closePgPool: async () => {},
}));

const app = buildTestApp();
const W1 = wsId(1);
const ALICE = userId(1);

function makeFakeClient() {
  const queries: Array<{ text: string; params: any[] }> = [];
  return {
    queries,
    bumpCalls() {
      return queries.filter((q) => q.text.includes('current_redemptions = current_redemptions + 1'));
    },
    redemptionInserts() {
      return queries.filter((q) => q.text.toLowerCase().includes('insert into public.coupon_redemptions'));
    },
    async query(text: string, params: any[] = []) {
      queries.push({ text, params });
      const t = text.toLowerCase();
      if (t.includes('pg_advisory_xact_lock')) return { rows: [], rowCount: 0 };
      if (t.trim().startsWith('select count(')) return { rows: [{ n: 0 }], rowCount: 1 };
      if (t.includes('current_redemptions = current_redemptions + 1')) {
        return { rows: [{ id: 'c1' }], rowCount: 1 };
      }
      if (t.trim().startsWith('insert into public.coupon_redemptions')) {
        return { rows: [{ id: 'red_1' }], rowCount: 1 };
      }
      if (t.trim().startsWith('insert into public.subscription_events')) {
        return { rows: [], rowCount: 1 };
      }
      if (t.includes('update public.subscriptions')) {
        return { rows: [{ id: 'sub1', status: 'active' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    },
    async release() {},
  };
}

let aliceToken: string;
let adminToken: string;
let supportToken: string;
let billingToken: string;

function seedCoupons() {
  testDb.__insert('coupons', [
    {
      id: 'cpn_1', code: 'WELCOME20', description: '20% off upgrades',
      discount_type: 'PERCENTAGE', discount_value: 20, currency: 'USD',
      target_plan_id: null, applicable_plan_ids: [PLAN_IDS.starter],
      applies_to: 'upgrades', duration: 'ONE_TIME', duration_in_months: null,
      starts_at: new Date(Date.now() - 86400_000).toISOString(), expires_at: null,
      max_redemptions: null, max_redemptions_per_user: 1, max_redemptions_per_workspace: 1,
      current_redemptions: 0, active: true, created_by: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: 'cpn_2', code: 'OLD10', description: 'expired',
      discount_type: 'PERCENTAGE', discount_value: 10, currency: 'USD',
      target_plan_id: null, applicable_plan_ids: [],
      applies_to: 'upgrades', duration: 'ONE_TIME', duration_in_months: null,
      starts_at: new Date(Date.now() - 30 * 86400_000).toISOString(),
      expires_at: new Date(Date.now() - 86400_000).toISOString(),
      max_redemptions: null, max_redemptions_per_user: null, max_redemptions_per_workspace: null,
      current_redemptions: 0, active: true, created_by: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
    {
      id: 'cpn_3', code: 'OFFCAT', description: 'disabled by admin',
      discount_type: 'PERCENTAGE', discount_value: 10, currency: 'USD',
      target_plan_id: null, applicable_plan_ids: [],
      applies_to: 'upgrades', duration: 'ONE_TIME', duration_in_months: null,
      starts_at: new Date(Date.now() - 86400_000).toISOString(), expires_at: null,
      max_redemptions: null, max_redemptions_per_user: null, max_redemptions_per_workspace: null,
      current_redemptions: 0, active: false, created_by: null,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    },
  ]);
}

beforeEach(() => {
  testDb.__reset();
  seedWorld(testDb);
  seedPlans(testDb);
  upsertSubscription(testDb, W1, PLAN_IDS.free, 'trialing');
  seedCoupons();

  const alice = { id: ALICE, email: 'alice@example.com', name: 'Alice', status: 'active' };
  testDb.__insert('platform_admins', [
    { id: 'pa_1', user_id: alice.id, role: null }, // null role → SUPER_ADMIN default
  ]);
  aliceToken = issueToken(alice.id, alice.email);

  // Role-restricted admins
  const support = { id: userId(5), email: 'support@example.com', name: 'Support', status: 'active' };
  testDb.__insert('users', [support]);
  testDb.__insert('platform_admins', [{ id: 'pa_2', user_id: support.id, role: 'SUPPORT_ADMIN' }]);
  supportToken = issueToken(support.id, support.email);

  const billing = { id: userId(6), email: 'billing@example.com', name: 'Billing', status: 'active' };
  testDb.__insert('users', [billing]);
  testDb.__insert('platform_admins', [{ id: 'pa_3', user_id: billing.id, role: 'BILLING_ADMIN' }]);
  billingToken = issueToken(billing.id, billing.email);
  adminToken = aliceToken;
});

describe('Coupon validation & preview (§23, §24)', () => {
  it('previews a valid coupon with server-computed pricing', async () => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/coupons/preview`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'welcome20', planName: 'starter' }); // case-insensitive normalize
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(true);
    expect(res.body.data.coupon.code).toBe('WELCOME20');
    expect(res.body.data.pricing).toEqual({ originalAmount: 29, discountAmount: 5.8, finalAmount: 23.2, currency: 'USD' });
  });

  it('rejects unknown codes with a generic message (no enumeration, §31)', async () => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/coupons/preview`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'NOTAREALCODE', planName: 'starter' });
    expect(res.status).toBe(200);
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.error.code).toBe('COUPON_INVALID');
  });

  it('rejects expired and disabled coupons with distinct codes', async () => {
    for (const [code, expected] of [['OLD10', 'COUPON_EXPIRED'], ['OFFCAT', 'COUPON_DISABLED']] as const) {
      const res = await request(app)
        .post(`/api/v1/workspaces/${W1}/billing/coupons/preview`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ code, planName: 'starter' });
      expect(res.body.data.valid).toBe(false);
      expect(res.body.data.error.code).toBe(expected);
    }
  });

  it('rejects coupons not applicable to the target plan (§23)', async () => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/coupons/preview`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'WELCOME20', planName: 'business' });
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.error.code).toBe('COUPON_PLAN_NOT_ELIGIBLE');
  });

  it('rejects invalid bodies with 422 + VALIDATION_ERROR', async () => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/coupons/preview`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'x' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Coupon-based upgrade (§26, §80 — one transaction)', () => {
  it('upgrades the plan and records the redemption + lifecycle events', async () => {
    const client = makeFakeClient();
    h.fakeClient = client;

    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/coupons/redeem`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'WELCOME20', planName: 'starter' });

    expect(res.status).toBe(200);
    expect(res.body.data.plan_tier).toBe('starter');
    expect(res.body.data.status).toBe('active');
    expect(res.body.data.pricing.finalAmount).toBe(23.2);
    // Server-side pricing only (§26): 20% of starter's 29 = 5.8 off
    expect(res.body.data.coupon.code).toBe('WELCOME20');

    // Transaction contents: subscription update + redemption + 2 events
    expect(client.redemptionInserts()).toHaveLength(1);
    const redemptionParams = client.redemptionInserts()[0].params;
    expect(redemptionParams[5]).toBe('upgrade'); // operation
    expect(Number(redemptionParams[8])).toBe(23.2); // final_amount
    const eventInserts = client.queries.filter((q) => q.text.toLowerCase().includes('insert into public.subscription_events'));
    expect(eventInserts).toHaveLength(2);
    // Atomic counter bump ran once
    expect(client.bumpCalls()).toHaveLength(1);

    h.fakeClient = null;
  });

  it('rejects coupon use when already redeemed for the workspace (§29)', async () => {
    testDb.__insert('coupon_redemptions', [
      {
        id: 'red_existing', coupon_id: 'cpn_1', user_id: userId(9), workspace_id: W1,
        subscription_id: null, plan_id: PLAN_IDS.starter, operation: 'upgrade',
        original_amount: 29, discount_amount: 5.8, final_amount: 23.2, currency: 'USD',
        status: 'applied', metadata: {}, redeemed_at: new Date().toISOString(),
      },
    ]);
    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/coupons/preview`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'WELCOME20', planName: 'starter' });
    expect(res.body.data.valid).toBe(false);
    expect(res.body.data.error.code).toBe('COUPON_WORKSPACE_LIMIT');
  });

  it('blocks the whole transaction if the redemption insert conflicts (§80)', async () => {
    const client = makeFakeClient();
    // Simulate the DB unique constraint firing (0 rows returned)
    const realQuery = client.query.bind(client);
    client.query = async (text: string, params: any[] = []) => {
      if (text.toLowerCase().trim().startsWith('insert into public.coupon_redemptions')) {
        return { rows: [], rowCount: 0 };
      }
      return realQuery(text, params);
    };
    h.fakeClient = client;

    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/coupons/redeem`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'WELCOME20', planName: 'starter' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUPON_WORKSPACE_LIMIT');
    h.fakeClient = null;
  });
});

describe('Subscription lifecycle (§19)', () => {
  it('schedules cancellation at period end without disabling access', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.starter, 'active');
    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/cancel-at-period-end`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.cancel_at_period_end).toBe(true);
    expect(res.body.data.status).toBe('active'); // NOT disabled immediately

    // History recorded
    const events = testDb.__all('subscription_events') as any[];
    expect(events.some((e) => e.event_type === 'cancel_scheduled')).toBe(true);
  });

  it('resumes a scheduled cancellation', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.starter, 'active', { cancel_at_period_end: true });
    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/resume`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.cancel_at_period_end).toBe(false);
  });

  it('writes plan_changed history on dev plan change', async () => {
    const res = await request(app)
      .post(`/api/v1/workspaces/${W1}/billing/plan`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ planName: 'business' });
    expect(res.status).toBe(200);
    const events = testDb.__all('subscription_events') as any[];
    expect(events.some((e) => e.event_type === 'plan_changed')).toBe(true);
  });
});

describe('Platform admin RBAC (§38, §65)', () => {
  it('lets a coupon-less role row default to SUPER_ADMIN (migration 021 default)', async () => {
    const res = await request(app).get('/api/v1/admin/coupons').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.coupons.length).toBeGreaterThanOrEqual(3);
  });

  it('denies SUPPORT_ADMIN coupon management with 403 (§78)', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coupons')
      .set('Authorization', `Bearer ${supportToken}`)
      .send({ code: 'NOPE', discount_type: 'PERCENTAGE', discount_value: 10 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PLATFORM_PERMISSION_REQUIRED');
  });

  it('allows BILLING_ADMIN to create and list coupons (§65)', async () => {
    const create = await request(app)
      .post('/api/v1/admin/coupons')
      .set('Authorization', `Bearer ${billingToken}`)
      .send({
        code: 'BILLING10',
        discount_type: 'PERCENTAGE',
        discount_value: 10,
        applicable_plan_names: ['business'],
      });
    expect(create.status).toBe(201);
    expect(create.body.data.code).toBe('BILLING10');

    const list = await request(app).get('/api/v1/admin/coupons').set('Authorization', `Bearer ${billingToken}`);
    expect(list.status).toBe(200);
    expect(list.body.coupons.some((c: any) => c.code === 'BILLING10')).toBe(true);
  });

  it('rejects duplicate coupon codes with 409 COUPON_CODE_EXISTS', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ code: 'WELCOME20', discount_type: 'PERCENTAGE', discount_value: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('COUPON_CODE_EXISTS');
  });

  it('generates bulk codes with prefix and secure randomness (§33)', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coupons/generate')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ prefix: 'PROMO', length: 10, count: 5 });
    expect(res.status).toBe(200);
    const codes = res.body.data.codes as string[];
    expect(codes).toHaveLength(5);
    expect(codes.every((c) => c.startsWith('PROMO-') && c.length === 16)).toBe(true);
    expect(new Set(codes).size).toBe(5);
  });

  it('admin trial extension requires a reason and is audited (§48)', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.starter, 'trialing');
    const missing = await request(app)
      .post(`/api/v1/admin/workspaces/${W1}/subscription/extend-trial`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ days: 7, reason: '' });
    // Zod failure → 422 per the platform's validation convention
    expect(missing.status).toBe(422);

    const ok = await request(app)
      .post(`/api/v1/admin/workspaces/${W1}/subscription/extend-trial`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ days: 7, reason: 'customer requested more evaluation time' });
    expect(ok.status).toBe(200);
    const audits = testDb.__all('audit_logs') as any[];
    expect(audits.some((a) => a.action === 'platform.trial_extended')).toBe(true);
  });

  it('subscription diagnostics explain the effective decision (§73)', async () => {
    upsertSubscription(testDb, W1, PLAN_IDS.starter, 'active');
    const res = await request(app)
      .get(`/api/v1/admin/workspaces/${W1}/diagnostics`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.access.effective_access).toBe('allowed');
    expect(res.body.data.plan.name).toBe('starter');
  });

  it('global admin search finds coupons and workspaces (§42)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/search?q=alpha')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.workspaces.some((w: any) => w.name === 'Alpha Traders')).toBe(true);
  });
});

describe('Admin coupon redemptions & lifecycle (§55, §75)', () => {
  it('computes coupon status (expired/scheduled/disabled) at read time', async () => {
    const res = await request(app).get('/api/v1/admin/coupons').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const old = res.body.coupons.find((c: any) => c.code === 'OLD10');
    expect(old.status).toBe('expired');
    const off = res.body.coupons.find((c: any) => c.code === 'OFFCAT');
    expect(off.status).toBe('disabled');
  });

  it('lists redemption history per coupon', async () => {
    testDb.__insert('coupon_redemptions', [
      {
        id: 'red_list', coupon_id: 'cpn_1', user_id: ALICE, workspace_id: W1,
        subscription_id: null, plan_id: PLAN_IDS.starter, operation: 'upgrade',
        original_amount: 29, discount_amount: 5.8, final_amount: 23.2, currency: 'USD',
        status: 'applied', metadata: {}, redeemed_at: new Date().toISOString(),
      },
    ]);
    const res = await request(app)
      .get('/api/v1/admin/coupons/cpn_1/redemptions')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.redemptions).toHaveLength(1);
  });
});
