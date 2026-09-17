import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  PORT: z.string().default('3000').transform(Number),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  // Phase 0 hardening: platform admin gate (emails also seeded via migration 011)
  PLATFORM_ADMIN_EMAILS: z.string().default(''),
  // Phase 0 hardening: Stripe webhook signature verification
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_SECRET_KEY: z.string().default(''),
  // Phase 3 Step 4: plan tier → Stripe Price ID map (JSON), plus app origin
  // for checkout/portal redirects. Example:
  //   STRIPE_PRICE_MAP={"starter":"price_123","business":"price_456"}
  STRIPE_PRICE_MAP: z.string().default(''),
  APP_URL: z.string().url().default('http://localhost:5173'),
  // Bing Webmaster Guidelines §4 (IndexNow): key used to notify Bing instantly
  // when public URLs are added/updated/removed. Empty = endpoint reports
  // NOT_CONFIGURED. Generate with `openssl rand -hex 16`.
  INDEXNOW_KEY: z.string().default(''),
  // Phase 2: direct Postgres connection for transactional inventory operations.
  // Falls back to building the URL from SUPABASE_DB_HOST + SUPABASE_DB_PASSWORD
  // (same convention as run-migrations.ts).
  SUPABASE_DB_URL: z.string().optional(),
  SUPABASE_DB_HOST: z.string().optional(),
  SUPABASE_DB_PASSWORD: z.string().optional(),
  SUPABASE_DB_USER: z.string().optional(),
  SUPABASE_DB_PORT: z.string().optional(),

  // ── Phase 7b: DB-driven configuration (no hardcoded business data) ──
  // JSON array of plan rows seeded into subscription_plans by run-migrations.
  // Example: [{"name":"free","display_name":"Free","price_monthly":0,...}]
  PLAN_SEED: z.string().default(''),
  // JSON array of role templates: [{"name":"Owner","is_owner":true,"permissions":[...]}]
  ROLE_TEMPLATE_SEED: z.string().default(''),
  // Default plan tier assigned to new workspaces (must exist in PLAN_SEED)
  DEFAULT_PLAN_TIER: z.string().default('free'),
  // Trial length for new workspaces (days)
  TRIAL_DAYS: z.string().default('14').transform(Number),
  // Default variance threshold above which a count needs a second approver (0-100)
  COUNT_APPROVAL_THRESHOLD_PCT: z.string().default('100').transform(Number),
  // Batch expiry alert thresholds in days (JSON array)
  EXPIRY_ALERT_DAYS: z.string().default('[30,14,7,1]'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('❌ Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
