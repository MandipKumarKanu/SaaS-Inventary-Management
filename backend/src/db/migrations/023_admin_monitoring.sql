-- ============================================
-- 023: Admin Monitoring Depth (§58 webhook monitoring, §62 job monitoring)
-- Additive only — no existing columns or tables are modified or dropped.
-- ============================================

-- --------------------------------------------
-- 1. WEBHOOK EVENT OBSERVABILITY (§58)
--    Processing duration (ms) and delivery retry count give ops the §58
--    columns; the payload snapshot enables admin-safe retry (re-dispatch
--    through the same idempotent handler). Nullable — legacy rows and
--    ignored events have no duration; raw payloads are retained 30 days
--    by the retention job (§79: preserve data, bounded growth).
-- --------------------------------------------
ALTER TABLE public.stripe_webhook_events ADD COLUMN IF NOT EXISTS processing_duration_ms INTEGER;
ALTER TABLE public.stripe_webhook_events ADD COLUMN IF NOT EXISTS delivery_attempt INTEGER;
ALTER TABLE public.stripe_webhook_events ADD COLUMN IF NOT EXISTS payload JSONB;

CREATE INDEX IF NOT EXISTS idx_webhook_events_status_time
  ON public.stripe_webhook_events(processing_status, created_at);

-- --------------------------------------------
-- 2. JOB LOG DURATION (§62)
--    Duration is derivable from job log rows written by the worker; add an
--    explicit started_at/finished_at pair for accurate per-run durations.
-- --------------------------------------------
ALTER TABLE public.background_job_logs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ;
ALTER TABLE public.background_job_logs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;
ALTER TABLE public.background_job_logs ADD COLUMN IF NOT EXISTS error TEXT;

CREATE INDEX IF NOT EXISTS idx_job_logs_status ON public.background_job_logs(status, executed_at);
