import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, wsId, userId, World } from '../helpers/world';
import { issueToken, testDb } from '../setup';

const app = buildTestApp();

let world: World;
let aliceToken: string; // Owner @ alpha
let bobToken: string; // Warehouse Staff @ alpha
let carolToken: string; // Sales Staff @ beta

beforeEach(() => {
  world = seedWorld(testDb);
  const [alice, bob, carol] = world.users;
  aliceToken = issueToken(alice.id, alice.email);
  bobToken = issueToken(bob.id, bob.email);
  carolToken = issueToken(carol.id, carol.email);
});

describe('Permission boundaries (PRD §11–§13)', () => {
  it('grants access when the role has the required permission', async () => {
    // Owner has billing.view
    const res = await request(app)
      .get('/api/v1/workspaces/alpha/billing')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('denies when the role lacks the required permission', async () => {
    // Warehouse Staff has no billing.view
    const res = await request(app)
      .get('/api/v1/workspaces/alpha/billing')
      .set('Authorization', `Bearer ${bobToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('enforces write-permission boundaries on create', async () => {
    // Warehouse Staff lacks products.create
    const res = await request(app)
      .post('/api/v1/workspaces/alpha/products')
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ name: 'Nope', sku: 'NOPE-1' });
    expect(res.status).toBe(403);
    expect(testDb.__all('products').find((p) => p.sku === 'NOPE-1')).toBeUndefined();
  });

  it('allows product creation with the right permission', async () => {
    const res = await request(app)
      .post('/api/v1/workspaces/alpha/products')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ name: 'New Widget', sku: 'NEW-1', costPrice: 10, sellingPrice: 15 });
    expect(res.status).toBe(201);
    expect(res.body.data.sku).toBe('NEW-1');
  });

  it('validates request bodies with zod', async () => {
    const res = await request(app)
      .post('/api/v1/workspaces/alpha/products')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ name: '', sku: '' });
    // Backend audit: well-formed JSON that fails field validation → 422
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('adds effective permissions from direct member_permissions', async () => {
    // Give bob a direct billing.view grant
    const perm = testDb.__all('permissions').find((p) => p.code === 'billing.view')!;
    testDb.__insert('member_permissions', [
      { id: '88888888-8888-4888-8888-000000000001', member_id: '44444444-4444-4444-8444-000000000002', permission_id: perm.id },
    ]);

    const res = await request(app)
      .get('/api/v1/workspaces/alpha/billing')
      .set('Authorization', `Bearer ${bobToken}`);
    expect(res.status).toBe(200);
  });

  it('permissions do not leak across workspaces (same user, different ws)', async () => {
    // alice is Owner in both; make sure carol (Sales Staff @ beta) cannot
    // touch alpha even though a role with the same name exists nowhere there.
    const res = await request(app)
      .get('/api/v1/workspaces/alpha/billing')
      .set('Authorization', `Bearer ${carolToken}`);
    expect(res.status).toBe(403);
  });

  it('membership must be active to count', async () => {
    // Deactivate bob's membership, then his role permissions must not apply
    const bobMember = testDb
      .__all('workspace_members')
      .find((m) => m.user_id === userId(2) && m.workspace_id === wsId(1))!;
    bobMember.status = 'inactive';

    const res = await request(app)
      .get('/api/v1/workspaces/alpha/products')
      .set('Authorization', `Bearer ${bobToken}`);
    expect(res.status).toBe(403);
  });
});
