-- Dynamically apply FOR ALL (SELECT, INSERT, UPDATE, DELETE) RLS policies
-- on all tables in the public schema so that backend API operations succeed cleanly.

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I_allow_all ON public.%I', r.tablename, r.tablename);
        EXECUTE format('CREATE POLICY %I_allow_all ON public.%I FOR ALL USING (true) WITH CHECK (true)', r.tablename, r.tablename);
    END LOOP;
END $$;
