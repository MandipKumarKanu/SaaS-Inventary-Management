import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, userId, World } from '../helpers/world';
import { issueToken, testDb } from '../setup';

const app = buildTestApp();

let world: World;
let aliceToken: string; // regular member (not a platform admin)
let daveToken: string; // authenticated, no workspace membership
let adminToken: string; // in PLATFORM_ADMIN_EMAILS fallback list

beforeEach(() => {
  world = seedWorld(testDb);
  const [alice, , , dave] = world.users;
  aliceToken = issueToken(alice.id, alice.email);
  daveToken = issueToken(dave.id, dave.email);

  // Seed a platform admin in the authoritative table
  const admin = { id: userId(9), email: 'root@example.com', name: 'Root Admin', status: 'active' };
  testDb.__insert('users', [admin]);
  testDb.__insert('platform_admins', [{ id: '99999999-9999-4999-8999-000000000001', user_id: admin.id }]);
  adminToken = issueToken(admin.id, admin.email);
});

describe('SaaS Admin authorization (Phase 0, PRD §14)', () => {
  it('rejects anonymous access with 401', async () => {
    const res = await request(app).get('/api/v1/admin/overview');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
    expect(res.body.data).toBeUndefined();
  });

  it('rejects regular authenticated users with 403', async () => {
    const res = await request(app)
      .get('/api/v1/admin/overview')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PLATFORM_ADMIN_REQUIRED');
  });

  it('rejects authenticated users with no workspace membership', async () => {
    const res = await request(app)
      .get('/api/v1/admin/overview')
      .set('Authorization', `Bearer ${daveToken}`);
    expect(res.status).toBe(403);
  });

  it('allows a user with a platform_admins row', async () => {
    const res = await request(app)
      .get('/api/v1/admin/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.totalWorkspaces).toBe('number');
    // Never exposes sensitive fields to the admin surface
    expect(res.body.data.workspaces[0]).not.toHaveProperty('created_by');
  });

  it('allows the env-listed bootstrap admin (PLATFORM_ADMIN_EMAILS)', async () => {
    const envAdmin = { id: userId(8), email: 'admin@example.com', name: 'Env Admin', status: 'active' };
    testDb.__insert('users', [envAdmin]);
    const token = issueToken(envAdmin.id, envAdmin.email);

    const res = await request(app)
      .get('/api/v1/admin/overview')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('platform admin grant is not inherited from workspace ownership', async () => {
    // alice owns two workspaces but has no platform_admins row and is not env-listed
    const res = await request(app)
      .get('/api/v1/admin/overview')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(403);
  });
});

describe('Monitoring authorization (Phase 0)', () => {
  it('rejects anonymous access to system health', async () => {
    const res = await request(app).get('/api/v1/monitoring/health');
    expect(res.status).toBe(401);
  });

  it('rejects non-platform-admins from metrics', async () => {
    const res = await request(app)
      .get('/api/v1/monitoring/metrics')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(res.status).toBe(403);
  });

  it('allows platform admins to read metrics', async () => {
    const res = await request(app)
      .get('/api/v1/monitoring/metrics')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('requests_total');
  });
});
