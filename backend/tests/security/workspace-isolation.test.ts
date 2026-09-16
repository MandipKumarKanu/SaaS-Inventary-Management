import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, wsId, userId, World } from '../helpers/world';
import { issueToken, testDb } from '../setup';

const app = buildTestApp();

let world: World;
let aliceToken: string;
let bobToken: string;
let daveToken: string;

beforeEach(() => {
  world = seedWorld(testDb);
  const [alice, bob, , dave] = world.users;
  aliceToken = issueToken(alice.id, alice.email);
  bobToken = issueToken(bob.id, bob.email);
  daveToken = issueToken(dave.id, dave.email);
});

describe('Authentication', () => {
  it('rejects requests without a token', async () => {
    const res = await request(app).get('/api/v1/workspaces/alpha/products');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects invalid tokens', async () => {
    const res = await request(app)
      .get('/api/v1/workspaces/alpha/products')
      .set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('Workspace isolation (PRD §7)', () => {
  it('allows a member to read their own workspace data', async () => {
    const res = await request(app)
      .get('/api/v1/workspaces/alpha/products')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const skus = res.body.data.map((p: any) => p.sku);
    expect(skus).toContain('ALPHA-1');
    expect(skus).not.toContain('BETA-1'); // never another tenant's data
  });

  it('blocks a non-member with 403', async () => {
    const res = await request(app)
      .get('/api/v1/workspaces/alpha/products')
      .set('Authorization', `Bearer ${daveToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.data).toBeUndefined();
  });

  it('blocks a member of one workspace from another workspace', async () => {
    // bob is Warehouse Staff in alpha, has no membership in beta
    const res = await request(app)
      .get('/api/v1/workspaces/beta/products')
      .set('Authorization', `Bearer ${bobToken}`);
    expect(res.status).toBe(403);
  });

  it('enforces isolation when the workspace is addressed by UUID', async () => {
    const res = await request(app)
      .get(`/api/v1/workspaces/${wsId(1)}/products`)
      .set('Authorization', `Bearer ${daveToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown workspace slug', async () => {
    const res = await request(app)
      .get('/api/v1/workspaces/does-not-exist/products')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(404);
  });

  it('never leaks another workspace product by direct id access', async () => {
    // Beta's product id, requested through alpha's context
    const betaProductId = '77777777-7777-4777-8777-000000000002';
    const res = await request(app)
      .get(`/api/v1/workspaces/alpha/products/${betaProductId}`)
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(404);
  });

  it('blocks access to a suspended workspace with a distinct error code', async () => {
    testDb.__all('workspaces')[0].status = 'suspended';
    const res = await request(app)
      .get('/api/v1/workspaces/alpha/products')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('WORKSPACE_SUSPENDED');
  });

  it('does not trust workspace slugs that collide across tenants', async () => {
    // dave tries both slug and UUID forms; neither grants access
    for (const id of ['beta', wsId(2)]) {
      const res = await request(app)
        .get(`/api/v1/workspaces/${id}/products`)
        .set('Authorization', `Bearer ${daveToken}`);
      expect(res.status).toBe(403);
    }
  });
});
