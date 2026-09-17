import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, request } from '../helpers/test-app';
import { seedWorld, wsId, userId } from '../helpers/world';
import { seedPlans, PLAN_IDS } from '../helpers/billing-world';
import { issueToken, testDb, ADMIN_TEST_PASSWORD } from '../setup';

/**
 * §66 Re-authentication suite:
 *   - Dangerous ops (bulk ops, refunds, settings changes) require a fresh
 *     password verification via x-admin-password
 *   - Missing/wrong password → 401 REAUTH_REQUIRED / REAUTH_FAILED
 *   - Successful verification grants a short window (subsequent call passes)
 *   - Read endpoints and non-dangerous mutations are unaffected
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

describe('Re-authentication gate (§66)', () => {
  it('rejects bulk user suspension without re-auth credentials', async () => {
    const res = await request(app)
      .post('/api/v1/admin/users/bulk-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: [userId(1)], status: 'suspended' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REAUTH_REQUIRED');
  });

  it('rejects bulk coupon operations without re-auth credentials', async () => {
    const res = await request(app)
      .post('/api/v1/admin/coupons/bulk-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: ['cpn_x'], active: false });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REAUTH_REQUIRED');
  });

  it('rejects settings changes without re-auth credentials', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/settings/trial_days')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ value: 21 });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('REAUTH_REQUIRED');
  });

  it('read endpoints remain open to admins (no re-auth burden)', async () => {
    const res = await request(app)
      .get('/api/v1/admin/jobs')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('single-user status change (single, not bulk) stays reason-gated only', async () => {
    // §45 single suspend remains a confirmed but non-reauth action — the PRD
    // reserves re-auth for the most dangerous/bulk operations.
    const res = await request(app)
      .patch(`/api/v1/admin/users/${userId(1)}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'suspended' });
    expect(res.status).toBe(200);
  });

  it('successful verification grants a short window (next call needs no header)', async () => {
    // First call verifies and opens the 5-minute re-auth window.
    const first = await request(app)
      .post('/api/v1/admin/users/bulk-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .set('x-admin-password', ADMIN_TEST_PASSWORD)
      .send({ ids: [userId(1)], status: 'suspended' });
    expect(first.status).toBe(200);

    // Second call within the window passes without the header again (§66:
    // short re-auth session, not per-request prompts).
    const second = await request(app)
      .post('/api/v1/admin/users/bulk-status')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ ids: [userId(1)], status: 'suspended' });
    expect(second.status).toBe(200);
  });
});
