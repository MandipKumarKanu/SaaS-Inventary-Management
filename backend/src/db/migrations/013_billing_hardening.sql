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

-- 4. PLAN SEED IDEMPOTENCY (same rows as 002 — safe on restore/re-run)
INSERT INTO public.subscription_plans (name, display_name, price_monthly, price_annual, limits, features, sort_order) VALUES
  ('free', 'Free', 0, 0,
   '{"users": 2, "products": 100, "warehouses": 1, "transactions_per_month": 500, "storage_mb": 100}',
   '{"basic_reports": true, "csv_export": true, "forecasting": false, "api_access": false, "priority_support": false}',
   1),
  ('starter', 'Starter', 29, 290,
   '{"users": 5, "products": 1000, "warehouses": 2, "transactions_per_month": 5000, "storage_mb": 1000}',
   '{"basic_reports": true, "csv_export": true, "forecasting": false, "api_access": false, "priority_support": false}',
   2),
  ('business', 'Business', 79, 790,
   '{"users": 25, "products": 10000, "warehouses": 10, "transactions_per_month": 50000, "storage_mb": 10000}',
   '{"basic_reports": true, "csv_export": true, "forecasting": true, "api_access": true, "priority_support": true}',
   3),
  ('enterprise', 'Enterprise', 199, 1990,
   '{"users": -1, "products": -1, "warehouses": -1, "transactions_per_month": -1, "storage_mb": 100000}',
   '{"basic_reports": true, "csv_export": true, "forecasting": true, "api_access": true, "priority_support": true, "custom_integrations": true}',
   4)
ON CONFLICT (name) DO NOTHING;
