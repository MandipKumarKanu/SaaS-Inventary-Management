import 'dotenv/config';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';
const { Client } = pkg;

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Phase 7b: FULL DATABASE RESET.
 *
 * ⚠️  DESTRUCTIVE: drops the entire public schema (all tables, RLS policies,
 * functions, triggers) and rebuilds from migrations 001–019 plus the
 * env-driven seeds (PLAN_SEED, ROLE_TEMPLATE_SEED, config defaults,
 * PLATFORM_ADMIN_EMAILS). Run only on dev/staging or with explicit approval.
 *
 * Usage: npm run db:reset
 */

function getDbConnectionString(): string {
  if (process.env.SUPABASE_DB_URL) return process.env.SUPABASE_DB_URL;
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    throw new Error('DB credentials missing. Set SUPABASE_DB_URL or SUPABASE_DB_PASSWORD.');
  }
  const host = process.env.SUPABASE_DB_HOST || 'aws-0-ap-south-1.pooler.supabase.com';
  const port = process.env.SUPABASE_DB_PORT || '6543';
  let user = process.env.SUPABASE_DB_USER;
  const supabaseUrl = process.env.SUPABASE_URL || '';
  const match = supabaseUrl.match(/https?:\/\/([^.]+)\.supabase/);
  user = user || (match ? `postgres.${match[1]}` : 'postgres');
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/postgres`;
}

const client = new Client({
  connectionString: getDbConnectionString(),
  ssl: { rejectUnauthorized: false },
});

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
];

async function reset(): Promise<void> {
  await client.connect();
  console.log('✅ Connected to Supabase PostgreSQL');

  // ── 1. DROP EVERYTHING in public ──
  console.log('\n💥 Dropping public schema (tables, views, functions, triggers)...');
  await client.query('DROP SCHEMA public CASCADE;');
  await client.query('CREATE SCHEMA public;');
  await client.query('GRANT ALL ON SCHEMA public TO postgres;');
  await client.query('GRANT ALL ON SCHEMA public TO public;');
  console.log('✅ public schema dropped and recreated');

  // Revoke default RLS-ish leftovers: none needed, fresh schema.

  // ── 2. Re-run ALL migrations ──
  for (const file of migrationFiles) {
    const sql = readFileSync(join(__dirname, 'migrations', file), 'utf-8');
    process.stdout.write(`🔄 ${file} ... `);
    try {
      await client.query(sql);
      console.log('OK');
    } catch (err: any) {
      if (err.message?.includes('already exists') || err.code === '42710' || err.code === '42P07') {
        console.log(`notice: ${err.message}`);
      } else {
        console.error('FAILED');
        throw new Error(`${file}: ${err.message}`);
      }
    }
  }

  // ── 3. Env-driven seeds (plans, role templates, config defaults) ──
  const { seedPlansFromEnv, seedRoleTemplatesFromEnv, seedConfigDefaults } = await import('./seed-helpers.js');
  await seedPlansFromEnv(client);
  await seedRoleTemplatesFromEnv(client);
  await seedConfigDefaults(client);

  // ── 4. Platform admins from env ──
  const adminEmails = (process.env.PLATFORM_ADMIN_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  for (const email of adminEmails) {
    const { rows } = await client.query(
      `INSERT INTO public.platform_admins (user_id)
       SELECT id FROM public.users WHERE lower(email) = $1
       ON CONFLICT (user_id) DO NOTHING
       RETURNING id`,
      [email]
    );
    if (rows.length > 0) console.log(`👑 Platform admin seeded: ${email}`);
    else console.log(`ℹ️  Platform admin skipped (no user yet): ${email}`);
  }

  // ── 5. Verification summary ──
  const verify = await client.query(`
    SELECT
      (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public') AS tables,
      (SELECT count(*) FROM public.permissions) AS permissions,
      (SELECT count(*) FROM public.subscription_plans) AS plans,
      (SELECT count(*) FROM public.role_templates) AS role_templates,
      (SELECT count(*) FROM public.config_defaults) AS config_defaults
  `);
  const v = verify.rows[0];
  console.log('\n📊 Database rebuilt:');
  console.log(`   tables:          ${v.tables}`);
  console.log(`   permissions:     ${v.permissions}`);
  console.log(`   plans:           ${v.plans}`);
  console.log(`   role templates:  ${v.role_templates}`);
  console.log(`   config defaults: ${v.config_defaults}`);

  if (Number(v.plans) === 0) console.log('⚠️  No plans — set PLAN_SEED and re-run.');
  if (Number(v.role_templates) === 0) console.log('⚠️  No role templates — set ROLE_TEMPLATE_SEED and re-run (new workspaces would have no default roles).');

  console.log('\n✅ Database reset complete.');
}

reset()
  .catch((err) => {
    console.error('\n❌ Reset failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => client.end());
