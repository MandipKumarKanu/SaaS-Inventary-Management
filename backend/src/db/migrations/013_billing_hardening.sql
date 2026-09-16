-- ============================================
-- 013: Billing Hardening (Phase 3)
--   - Grace/dunning anchors for subscription-aware access control (PRD §17)
--   - Webhook lookup index
--   - Plan seed idempotency
-- NOTE: there is NO schema mismatch — subscriptions.plan_id (migration 001)
-- was always correct; the wrong code (plan_name/monthly_price) is being
-- removed in application code, not patched with new columns.
-- ============================================

-- 1. GRACE / DUNNING ANCHORS
-- past_due_at   : when the first payment failure was observed
-- grace_ends_at : end of the 7-day dunning grace window
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS past_due_at TIMESTAMPTZ;

ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ;

-- 2. WEBHOOK LOOKUP PERFORMANCE
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_sub
  ON public.subscriptions(stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

-- 3. STRIPE WEBHOOK EVENT RECORDING (Phase 3 Step 4)
-- Track processing result + payload timestamp for out-of-order event safety.
ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS processed_at TIMESTAMPTZ;

ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS processing_status TEXT NOT NULL DEFAULT 'received';

ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS stripe_event_created TIMESTAMPTZ;

ALTER TABLE public.stripe_webhook_events
  ADD COLUMN IF NOT EXISTS detail TEXT;

-- 4. PLAN SEEDING (Phase 7b)
-- Plan rows are NO LONGER hardcoded here. run-migrations.ts seeds
-- subscription_plans from the PLAN_SEED environment variable (JSON array),
-- keeping the DB as the single runtime source of truth.
-- (The previous hardcoded INSERT block was removed from this migration.)
