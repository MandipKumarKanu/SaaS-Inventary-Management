import 'dotenv/config';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
import { seedPlansFromEnv, seedRoleTemplatesFromEnv, seedConfigDefaults } from './seed-helpers.js';

const { Client } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));

function getDbConnectionString(): string {
  if (process.env.SUPABASE_DB_URL) {
    return process.env.SUPABASE_DB_URL;
  }
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new Error(
      'Database connection credentials missing. Set SUPABASE_DB_URL or SUPABASE_DB_PASSWORD in environment.'
    );
  }
  const host = process.env.SUPABASE_DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com';
  const port = process.env.SUPABASE_DB_PORT || '6543';

  let user = process.env.SUPABASE_DB_USER;
  if (!user) {
    const supabaseUrl = process.env.SUPABASE_URL || '';
    const match = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase/);
    const projectRef = match ? match[1] : '';
    user = projectRef ? `postgres.${projectRef}` : 'postgres';
  }

  const encodedUser = encodeURIComponent(user);
  const pwd = encodeURIComponent(password);
  return `postgresql://${encodedUser}:${pwd}@${host}:${port}/postgres`;
}

const SUPABASE_DB_URL = getDbConnectionString();

async function runMigrations() {
  const migrationFiles = [
    '001_foundation.sql',
    '002_seed_data.sql',
    '003_inventory_core.sql',
    '004_warehouse_ops.sql',
    '005_commercial_ops.sql',
    '006_integrations_billing.sql',
    '007_scale_integrations.sql',
    '008_production_hardening.sql',
    '009_branding_customization.sql',
    '010_ai_copilot_automation.sql',
    '011_platform_admins.sql',
    '012_inventory_transaction_safety.sql',
    '013_billing_hardening.sql',
    '014_data_lifecycle_integrity.sql',
    '015_audit_log_write_access.sql',
    '016_fix_workspace_members_rls_recursion.sql',
    '017_warehouse_ops_completion.sql',
    '018_reservations.sql',
    '019_db_driven_config.sql',
    '020_goods_receipts.sql',
    '021_saas_business_layer.sql',
    '022_admin_portal_completion.sql',
    '023_admin_monitoring.sql',
    '024_grant_permissions.sql',
    '025_users_rls_policy.sql',
    '026_grant_rls_all_tables.sql',
    '027_disable_rls_all_tables.sql',
  ];

  // Use the transaction mode pooler for migrations
  const client = new Client({
    connectionString: SUPABASE_DB_URL,
    ssl: { rejectUnauthorized: false },
  });

  try {
    await client.connect();
    console.log('✅ Connected to Supabase PostgreSQL');

    for (const file of migrationFiles) {
      const filePath = join(__dirname, 'migrations', file);
      const sql = readFileSync(filePath, 'utf-8');

      console.log(`\n🔄 Running migration: ${file}`);
      try {
        await client.query(sql);
        console.log(`✅ Completed: ${file}`);
      } catch (err: any) {
        if (err.message?.includes('already exists') || err.code === '42710' || err.code === '42P07') {
          console.log(`⚠️ Notice for ${file}: ${err.message} (proceeding...)`);
        } else {
          console.error(`❌ Failed: ${file}`, err.message);
          throw err;
        }
      }
    }

    // Seed platform admins from PLATFORM_ADMIN_EMAILS (comma-separated).
    // Parameterized inserts instead of SQL-file interpolation: safe under the
    // transaction-mode pooler, where session variables (SET) are not reliable.
    const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean);

    for (const email of adminEmails) {
      const { rows } = await client.query(
        `INSERT INTO public.platform_admins (user_id)
         SELECT id FROM public.users WHERE lower(email) = $1
         ON CONFLICT (user_id) DO NOTHING
         RETURNING id`,
        [email]
      );
      if (rows.length > 0) {
        console.log(`👑 Platform admin seeded: ${email}`);
      } else {
        console.log(`ℹ️  Platform admin skipped (no user yet): ${email}`);
      }
    }

    // ════════════════════════════════════════════════════════════════
    // Phase 7b: DB-driven configuration seeding (no hardcoded business data)
    // Plans, role templates, and operational defaults come from environment
    // variables and are written INTO tables — the DB is the runtime source
    // of truth; the env vars only bootstrap it.
    // ════════════════════════════════════════════════════════════════
    await seedPlansFromEnv(client);
    await seedRoleTemplatesFromEnv(client);
    await seedConfigDefaults(client);

    console.log('\n✅ All migrations completed successfully!');
  } catch (err: any) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigrations();
