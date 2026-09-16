/**
 * Phase 7b: env-driven seed helpers, shared by run-migrations.ts and
 * reset-database.ts. Plans, role templates, and operational defaults are
 * written INTO tables from environment variables — the DB is the runtime
 * source of truth; env only bootstraps it. No hardcoded business data in
 * migrations or application code.
 */

export interface SeedClient {
  query(text: string, params?: any[]): Promise<{ rows: any[]; rowCount: number }>;
}

/**
 * Seed subscription plans from PLAN_SEED (JSON array). Each row:
 * { name, display_name, price_monthly, price_annual, limits, features, sort_order }
 * Existing plans are updated (price/limit changes flow through on re-run);
 * nothing is deleted automatically (existing subscriptions must not dangle).
 */
export async function seedPlansFromEnv(client: SeedClient): Promise<void> {
  const raw = process.env.PLAN_SEED || '';
  if (!raw.trim()) {
    console.log('ℹ️  PLAN_SEED not set — subscription_plans left untouched');
    return;
  }
  let plans: any[];
  try {
    plans = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`PLAN_SEED is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(plans) || plans.length === 0) {
    throw new Error('PLAN_SEED must be a non-empty JSON array of plan rows');
  }

  for (const p of plans) {
    if (!p.name || !p.display_name) {
      throw new Error('PLAN_SEED rows require at least { name, display_name }');
    }
    await client.query(
      `INSERT INTO public.subscription_plans
         (name, display_name, price_monthly, price_annual, limits, features, is_active, sort_order)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, TRUE, $7)
       ON CONFLICT (name) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         price_monthly = EXCLUDED.price_monthly,
         price_annual = EXCLUDED.price_annual,
         limits = EXCLUDED.limits,
         features = EXCLUDED.features,
         sort_order = EXCLUDED.sort_order`,
      [
        p.name,
        p.display_name,
        p.price_monthly ?? 0,
        p.price_annual ?? 0,
        JSON.stringify(p.limits ?? {}),
        JSON.stringify(p.features ?? {}),
        p.sort_order ?? 0,
      ]
    );
  }
  console.log(`📦 Plans seeded from PLAN_SEED: ${plans.map((p) => p.name).join(', ')}`);
}

/**
 * Seed role templates from ROLE_TEMPLATE_SEED (JSON array). Each row:
 * { name, description?, is_owner?, permissions: string[], sort_order? }
 * Exactly one template must have is_owner = true. Existing templates are
 * updated on re-run (permission changes propagate to NEW workspaces;
 * existing workspace roles are intentionally left untouched).
 */
export async function seedRoleTemplatesFromEnv(client: SeedClient): Promise<void> {
  const raw = process.env.ROLE_TEMPLATE_SEED || '';
  if (!raw.trim()) {
    const { rows } = await client.query(`SELECT count(*)::int AS n FROM public.role_templates`);
    if (rows[0].n === 0) {
      console.log('⚠️  ROLE_TEMPLATE_SEED not set and role_templates is EMPTY — new workspaces will have no default roles. Configure ROLE_TEMPLATE_SEED.');
    }
    return;
  }
  let templates: any[];
  try {
    templates = JSON.parse(raw);
  } catch (err: any) {
    throw new Error(`ROLE_TEMPLATE_SEED is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(templates) || templates.length === 0) {
    throw new Error('ROLE_TEMPLATE_SEED must be a non-empty JSON array of role templates');
  }

  const ownerCount = templates.filter((t) => t.is_owner).length;
  if (ownerCount !== 1) {
    throw new Error(`ROLE_TEMPLATE_SEED must define exactly ONE template with is_owner=true (found ${ownerCount})`);
  }

  // Validate every permission code exists in the catalog (hard fail on typos)
  for (const t of templates) {
    if (!t.name || !Array.isArray(t.permissions)) {
      throw new Error(`ROLE_TEMPLATE_SEED rows require { name, permissions[] }: invalid row '${t.name ?? '?'}'`);
    }
    const { rows } = await client.query(
      `SELECT code FROM public.permissions WHERE code = ANY($1::text[])`,
      [t.permissions]
    );
    const found = new Set(rows.map((r: any) => r.code));
    const missing = t.permissions.filter((c: string) => !found.has(c));
    if (missing.length > 0) {
      throw new Error(`ROLE_TEMPLATE_SEED '${t.name}' references unknown permissions: ${missing.join(', ')}`);
    }

    await client.query(
      `INSERT INTO public.role_templates (name, description, is_owner, is_system, permissions, sort_order)
       VALUES ($1, $2, $3, TRUE, $4::text[], $5)
       ON CONFLICT (name) DO UPDATE SET
         description = EXCLUDED.description,
         is_owner = EXCLUDED.is_owner,
         permissions = EXCLUDED.permissions,
         sort_order = EXCLUDED.sort_order`,
      [t.name, t.description ?? `Default ${t.name} role`, !!t.is_owner, t.permissions, t.sort_order ?? 0]
    );
  }
  console.log(`🎭 Role templates seeded from ROLE_TEMPLATE_SEED: ${templates.map((t) => t.name).join(', ')}`);
}

/**
 * Seed operational defaults into config_defaults from env vars. These are
 * runtime-readable deployment defaults; the DB table is the source of truth
 * (first seed wins — later env changes don't clobber DB overrides).
 */
export async function seedConfigDefaults(client: SeedClient): Promise<void> {
  let expiryAlertDays: number[] = [30, 14, 7, 1];
  try {
    if (process.env.EXPIRY_ALERT_DAYS) expiryAlertDays = JSON.parse(process.env.EXPIRY_ALERT_DAYS);
  } catch {
    // keep default
  }

  const defaults: Array<{ key: string; value: any; description: string }> = [
    { key: 'default_plan_tier', value: process.env.DEFAULT_PLAN_TIER || 'free', description: 'Plan tier assigned to new workspaces' },
    { key: 'trial_days', value: Number(process.env.TRIAL_DAYS || 14), description: 'Trial length for new workspaces (days)' },
    { key: 'count_approval_threshold_pct', value: Number(process.env.COUNT_APPROVAL_THRESHOLD_PCT ?? 100), description: 'Count variance % requiring a second approver' },
    { key: 'expiry_alert_days', value: expiryAlertDays, description: 'Batch expiry alert thresholds (days before expiry)' },
  ];

  for (const d of defaults) {
    // First-seed wins: once in the DB, runtime/DB overrides take precedence
    await client.query(
      `INSERT INTO public.config_defaults (key, value, description)
       VALUES ($1, $2::jsonb, $3)
       ON CONFLICT (key) DO NOTHING`,
      [d.key, JSON.stringify(d.value), d.description]
    );
  }
  console.log(`⚙️  Config defaults ensured: ${defaults.map((d) => d.key).join(', ')}`);
}
