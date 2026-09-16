-- ============================================
-- 015: Audit Log Write Access (auth robustness)
--   - audit_logs previously had a SELECT-only policy, so any write executed
--     as a non-service role failed with:
--       "new row violates row-level security policy for table audit_logs"
--   - The backend writes via supabaseAdmin (service_role, bypasses RLS),
--     but this explicit INSERT policy guarantees audit writes also succeed
--     for user-scoped clients and documents the intent.
--   - Users may only insert rows attributed to themselves
--     (auth.uid() = user_id); Login/signup rows satisfy this because
--     user_id is the acting user's own id. Service role bypasses RLS
--     entirely and is unaffected.
--   - No UPDATE/DELETE policy is added on purpose: the audit trail stays
--     append-only (enforced additionally by the trigger in 012).
-- ============================================

DROP POLICY IF EXISTS audit_logs_insert_own ON public.audit_logs;
CREATE POLICY audit_logs_insert_own ON public.audit_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
