-- ============================================
-- 019: DB-Driven Configuration (remove hardcoded data)
--   - role_templates: role → permission bundles as DATA, not code.
--     Workspace creation reads these rows; DEFAULT_ROLE_PERMISSIONS is
--     deleted from application source.
--   - config_defaults: single-row table for operational defaults that are
--     deployment-level (not per-workspace) configuration.
--   - Plan seeding: PLAN_SEED env JSON (parsed by run-migrations.ts),
--     replacing the hardcoded SQL rows in 002/013.
-- ============================================

-- 1. ROLE TEMPLATES (is_system role blueprints)
-- On workspace creation, each template is instantiated as a workspace-scoped
-- role with the template's permission bundle. `is_owner` marks the template
-- that grants workspace ownership (exactly one must exist) — code checks the
-- FLAG, never the role NAME.
CREATE TABLE IF NOT EXISTS public.role_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT UNIQUE NOT NULL,               -- template + role name
  description TEXT NOT NULL DEFAULT '',
  is_owner BOOLEAN NOT NULL DEFAULT FALSE, -- ownership flag (code reads this)
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  permissions TEXT[] NOT NULL DEFAULT '{}', -- permission codes
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only the backend service role touches templates; clients read them for the
-- role-management UI.
ALTER TABLE public.role_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY role_templates_select ON public.role_templates
  FOR SELECT USING (TRUE);

-- 2. CONFIG DEFAULTS (deployment-level configuration storage)
-- Key/value store for operational defaults (trial_days, default_plan_tier,
-- count_approval_threshold_pct, expiry_alert_days...). Values are seeded from
-- environment variables by run-migrations.ts; the DB is the runtime source of
-- truth so deployments can override without a code change.
CREATE TABLE IF NOT EXISTS public.config_defaults (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.config_defaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY config_defaults_select ON public.config_defaults
  FOR SELECT USING (TRUE);

-- 3. Helper: instantiate default roles for a new workspace from templates.
-- Returns the owner role id (template with is_owner = TRUE).
CREATE OR REPLACE FUNCTION public.instantiate_role_templates(p_workspace_id UUID)
RETURNS UUID AS $$
DECLARE
  t RECORD;
  v_role_id UUID;
  v_owner_role_id UUID := NULL;
  v_permission_ids UUID[];
BEGIN
  FOR t IN SELECT * FROM public.role_templates ORDER BY sort_order, name LOOP
    INSERT INTO public.roles (workspace_id, name, description, is_system)
    VALUES (p_workspace_id, t.name, t.description, t.is_system)
    RETURNING id INTO v_role_id;

    IF t.is_owner THEN
      v_owner_role_id := v_role_id;
    END IF;

    -- Resolve permission codes → ids in one query
    SELECT array_agg(id) INTO v_permission_ids
    FROM public.permissions WHERE code = ANY (t.permissions);

    IF v_permission_ids IS NOT NULL THEN
      INSERT INTO public.role_permissions (role_id, permission_id)
      SELECT v_role_id, unnest(v_permission_ids)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  RETURN v_owner_role_id;
END;
$$ LANGUAGE plpgsql;

-- 4. Plan catalog seeding is done by run-migrations.ts from the PLAN_SEED
--    environment variable (JSON array of plan rows). No hardcoded plan rows
--    live in migrations anymore.
