import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, wsId, userId } from '../helpers/world';
import { seedPlans, upsertSubscription, PLAN_IDS } from '../helpers/billing-world';
import { issueToken, testDb } from '../setup';

/**
 * Admin workspace detail suite (PRD §47/§48/§56/§65):
 *   - GET /admin/workspaces/:id returns overview + members + subscription +
 *     usage + redemptions + activity — platform.workspaces.view gated
 *   - GET /admin/workspaces/:id/payments — platform.billing.view gated
 *   - 404 for unknown workspaces; 403 for non-admins
 */
const app = buildTestApp();
const W1 = wsId(1);
const W2 = wsId(2);
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

describe('GET /admin/workspaces/:id (§47)', () => {
  it('returns the full detail payload for a platform admin', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/workspaces/${W1}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.workspace.id).toBe(W1);
    expect(res.body.data.workspace.name).toBe('Alpha Traders');
    expect(res.body.data.subscription.plan.name).toBe('starter');
    // Members resolved with role names
    const emails = res.body.data.members.map((m: any) => m.email);
    expect(emails).toContain('alice@example.com');
    expect(emails).toContain('bob@example.com');
    // Usage counts are workspace-scoped
    expect(res.body.data.usage.products).toBeGreaterThanOrEqual(1);
    expect(res.body.data.usage.members).toBeGreaterThanOrEqual(2);
  });

  it('never exposes sensitive fields', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/workspaces/${W1}`)
      .set('Authorization', `Bearer ${adminToken}`);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('password');
    expect(body).not.toContain('stripe_customer');
    expect(body).not.toContain('stripe_subscription');
  });

  it('scopes usage to the workspace (no cross-tenant bleed)', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/workspaces/${W2}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    // W2 has carol+alice as members, bob is W1-only
    const emails = res.body.data.members.map((m: any) => m.email);
    expect(emails).not.toContain('bob@example.com');
  });

  it('404s for an unknown workspace', async () => {
    const res = await request(app)
      .get('/api/v1/admin/workspaces/11111111-1111-4111-8111-999999999999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('rejects non-platform-admins with 403', async () => {
    const token = issueToken(ALICE, 'alice@example.com');
    const res = await request(app)
      .get(`/api/v1/admin/workspaces/${W1}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});

describe('GET /admin/workspaces/:id/payments (§56/§57)', () => {
  it('lists persisted payments without provider secrets', async () => {
    testDb.__insert('payments', [
      {
        id: 'pay_1', workspace_id: W1, subscription_id: null, provider: 'stripe',
        provider_reference: 'in_123', amount: 29, currency: 'USD', status: 'successful',
        invoice_id: 'in_123', discount_amount: 0, failure_reason: null,
        metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
      {
        id: 'pay_2', workspace_id: W1, subscription_id: null, provider: 'stripe',
        provider_reference: 'in_456', amount: 29, currency: 'USD', status: 'failed',
        invoice_id: 'in_456', discount_amount: 0, failure_reason: 'card_declined',
        metadata: {}, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      },
    ]);
    const res = await request(app)
      .get(`/api/v1/admin/workspaces/${W1}/payments`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    const body = JSON.stringify(res.body);
    // Never expose payment credentials
    expect(body).not.toContain('client_secret');
    // No metadata leak (contains event ids)
    expect(res.body.data[0]).not.toHaveProperty('metadata');
  });

  it('returns an empty list (not an error) when no payments exist', async () => {
    const res = await request(app)
      .get(`/api/v1/admin/workspaces/${W1}/payments`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
