-- ============================================
-- 011: Platform Admins
-- Supports Phase 0 security hardening:
--   - Authenticated, role-gated SaaS admin area (PRD §14)
--   - Audit groundwork for future impersonation (PRD §14, §41)
-- ============================================

-- Platform admins are platform-level, NOT workspace-scoped.
CREATE TABLE IF NOT EXISTS public.platform_admins (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL UNIQUE REFERENCES public.users(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_admins_user ON public.platform_admins(user_id);

-- RLS: platform admins are managed by the backend service role; no direct
-- client access. Keep the table locked down entirely.
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
-- No policies created on purpose: only the service-role backend can read/write.
-- (Seeding of admins from PLATFORM_ADMIN_EMAILS is done by run-migrations.ts
--  with a parameterized query, which is safe under transaction-mode pooling.)
