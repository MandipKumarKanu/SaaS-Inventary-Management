import { vi, beforeEach } from 'vitest';
import { makeDb, makeSupabaseAdminMock, TestDb } from './helpers/supabase-mock';

// ============================================
// Deterministic environment BEFORE any app import
// ============================================
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://test.supabase.co';
process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'test-anon-key';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-service-role-key';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';
process.env.PLATFORM_ADMIN_EMAILS = 'admin@example.com';

// ============================================
// Shared test database + auth registry
// ============================================
export const testDb: TestDb = makeDb();

/**
 * token -> supabase auth user. Tests register tokens here via
 * `issueToken(user)` to simulate verified Supabase JWTs.
 */
export const authUsers = new Map<string, { id: string; email: string }>();

export function issueToken(userId: string, email: string): string {
  const token = `tok_${userId}_${Math.random().toString(36).slice(2, 10)}`;
  authUsers.set(token, { id: userId, email });
  return token;
}

const supabaseMock = makeSupabaseAdminMock(testDb, authUsers);

// Replace the real client inside config/supabase before modules import it.
vi.mock('../src/config/supabase.js', () => ({
  supabaseAdmin: supabaseMock,
  createUserClient: () => supabaseMock,
}));

// ============================================
// Fresh database + auth registry per test
// ============================================
beforeEach(() => {
  testDb.__reset();
  authUsers.clear();
});

/**
 * §66 re-auth: deterministic admin password accepted by the Supabase auth
 * mock (see makeSupabaseAdminMock). Dangerous-op tests send this in the
 * x-admin-password header.
 */
export const ADMIN_TEST_PASSWORD = 'test-admin-password';
