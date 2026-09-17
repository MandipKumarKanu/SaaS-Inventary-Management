-- Ensure public.users table permits ALL operations (SELECT, INSERT, UPDATE, DELETE) for all roles
-- so that PostgREST queries (upsert/insert/select) succeed without 42501 RLS policy errors.

DROP POLICY IF EXISTS users_select_own ON public.users;
DROP POLICY IF EXISTS users_update_own ON public.users;
DROP POLICY IF EXISTS users_insert_own ON public.users;
DROP POLICY IF EXISTS users_service_role_all ON public.users;
DROP POLICY IF EXISTS users_allow_all ON public.users;

CREATE POLICY users_allow_all ON public.users
  FOR ALL
  USING (true)
  WITH CHECK (true);
