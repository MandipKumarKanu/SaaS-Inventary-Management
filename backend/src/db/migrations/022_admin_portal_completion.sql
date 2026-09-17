-- ============================================
-- 022: Admin Portal Completion (§56 payments, §63 notifications, §64 settings,
--      §71 exports, Stripe coupon sync §21/§28/§32)
-- Additive only — no existing columns or tables are modified or dropped.
-- ============================================

-- --------------------------------------------
-- 1. COUPON STRIPE SYNC (§21/§28/§32)
--    When Stripe billing is configured, creating a local coupon mirrors it
--    as a Stripe Coupon + Promotion Code so checkout discount passthrough
--    (discounts[].promotion_code) works with the same code. Nullable —
--    dev-mode (native DB billing) coupons have no provider identity.
-- --------------------------------------------
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS stripe_coupon_id TEXT;
ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS stripe_promotion_code_id TEXT;
CREATE INDEX IF NOT EXISTS idx_coupons_stripe_promo ON public.coupons(stripe_promotion_code_id) WHERE stripe_promotion_code_id IS NOT NULL;

-- --------------------------------------------
-- 2. grace_period_days config default (§15/§16)
--    Read by the subscription worker (period end → grace → expired) but
--    never seeded — the settings UI (§64) must show and manage every key
--    the platform reads. 7 matches the SubscriptionService code default.
-- --------------------------------------------
INSERT INTO public.config_defaults (key, value, description)
VALUES ('grace_period_days', '7'::jsonb, 'Days of restricted access after a subscription lapses before it is expired')
ON CONFLICT (key) DO NOTHING;
