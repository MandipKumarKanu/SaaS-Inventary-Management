-- Disable Row Level Security (RLS) across all public schema tables.
-- Security, authorization, and tenant isolation are handled at the application layer by Express middleware.

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
    END LOOP;
END $$;
