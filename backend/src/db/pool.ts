import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';

/**
 * Direct Postgres access for TRANSACTIONAL operations (Phase 2).
 *
 * Why this exists: Supabase's REST (PostgREST) API used by supabase-js cannot
 * run multi-statement transactions or `SELECT ... FOR UPDATE` row locks.
 * Stock mutations must be atomic (PRD §22, Rule #5/#19), so the inventory
 * engine uses this pool for its write path. All other reads/writes continue
 * through supabaseAdmin.
 *
 * Note: the service-role database user bypasses RLS — same trust level as
 * supabaseAdmin. Never expose this pool to client-facing code paths that
 * don't go through authorization middleware.
 */

function buildDbUrl(): string {
  if (env.SUPABASE_DB_URL) return env.SUPABASE_DB_URL;

  const host = env.SUPABASE_DB_HOST;
  const password = env.SUPABASE_DB_PASSWORD;
  if (!host || !password) {
    // Return null-ish config; pool creation will fail lazily with a clear error
    // only when a transaction is actually attempted (keeps dev/test lightweight).
    return '';
  }
  const user = encodeURIComponent(env.SUPABASE_DB_USER || 'postgres');
  const pwd = encodeURIComponent(password);
  return `postgresql://${user}:${pwd}@${host}:5432/postgres`;
}

const connectionString = buildDbUrl();

export const pgPool: pg.Pool = new pg.Pool({
  connectionString: connectionString || undefined,
  ssl: connectionString ? { rejectUnauthorized: false } : undefined,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pgPool.on('error', (err) => {
  logger.error('Unexpected pg pool error', { error: err.message });
});

export type TxClient = pg.PoolClient;

/**
 * Run `fn` inside a database transaction.
 * Commits on success, rolls back on any thrown error, always releases the client.
 */
export async function withTransaction<T>(fn: (client: TxClient) => Promise<T>): Promise<T> {
  if (!connectionString) {
    throw new Error(
      'Database connection not configured. Set SUPABASE_DB_URL (or SUPABASE_DB_HOST + SUPABASE_DB_PASSWORD) to enable transactional inventory operations.'
    );
  }

  const client = await pgPool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (rbErr: any) {
      logger.error('Transaction rollback failed', { error: rbErr?.message });
    }
    throw err;
  } finally {
    client.release();
  }
}

/** Graceful shutdown helper */
export async function closePgPool(): Promise<void> {
  await pgPool.end();
}
