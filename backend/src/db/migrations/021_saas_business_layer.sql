-- ============================================
-- 021: SaaS Business Layer (coupons, subscription lifecycle, platform admin RBAC)
-- Additive only — no existing columns or tables are modified or dropped.
-- PRD refs: §6/§19/§50 (subscription lifecycle + history), §21–§34 (coupons),
--           §36 (overrides), §38/§65 (admin roles), §56 (payments)
-- ============================================

-- --------------------------------------------
-- 1. SUBSCRIPTION LIFECYCLE COLUMNS (additive)
-- --------------------------------------------
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS past_due_at TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS grace_ends_at TIMESTAMPTZ;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_subscriptions_period_end ON public.subscriptions(current_period_end);
CREATE INDEX IF NOT EXISTS idx_subscriptions_trial_end ON public.subscriptions(trial_ends_at);

-- --------------------------------------------
-- 2. COUPONS (first-class billing entities)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.coupons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE, -- unique per platform (uppercase, stored normalized)
  description TEXT,
  -- PERCENTAGE: value = 0-100 | FIXED_AMOUNT: value in minor units of currency
  -- FULL_DISCOUNT: 100% for duration | PLAN_ACCESS: grants plan for duration
  discount_type TEXT NOT NULL CHECK (discount_type IN ('PERCENTAGE', 'FIXED_AMOUNT', 'FULL_DISCOUNT', 'PLAN_ACCESS')),
  discount_value NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  target_plan_id UUID REFERENCES public.subscription_plans(id) ON DELETE RESTRICT, -- required for PLAN_ACCESS, validated app-side for others
  applicable_plan_ids UUID[] NOT NULL DEFAULT '{}', -- empty = all active plans
  applies_to TEXT NOT NULL DEFAULT 'new_subscriptions'
    CHECK (applies_to IN ('new_subscriptions', 'upgrades', 'renewals', 'reactivations', 'any')),
  duration TEXT NOT NULL DEFAULT 'ONE_TIME'
    CHECK (duration IN ('ONE_TIME', 'FIRST_PERIOD', 'MULTI_MONTH')),
  duration_in_months INT CHECK (duration_in_months IS NULL OR duration_in_months > 0),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  max_redemptions INT CHECK (max_redemptions IS NULL OR max_redemptions > 0),
  max_redemptions_per_user INT CHECK (max_redemptions_per_user IS NULL OR max_redemptions_per_user > 0),
  max_redemptions_per_workspace INT CHECK (max_redemptions_per_workspace IS NULL OR max_redemptions_per_workspace > 0),
  current_redemptions INT NOT NULL DEFAULT 0 CHECK (current_redemptions >= 0),
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- sanity: percentage cannot exceed 100, fixed must be positive
  CONSTRAINT coupon_percentage_range CHECK (discount_type <> 'PERCENTAGE' OR (discount_value >= 0 AND discount_value <= 100)),
  CONSTRAINT coupon_fixed_positive CHECK (discount_type <> 'FIXED_AMOUNT' OR discount_value > 0)
);

CREATE INDEX IF NOT EXISTS idx_coupons_code ON public.coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active_expires ON public.coupons(active, expires_at);
CREATE INDEX IF NOT EXISTS idx_coupons_created_by ON public.coupons(created_by);

-- --------------------------------------------
-- 3. COUPON REDEMPTIONS (per-redemption history — never rely on counters alone)
--    UNIQUE(coupon_id, workspace_id) enforces one redemption per workspace
--    per coupon at the DB level; per-user/per-workspace-count limits are
--    enforced by CouponService via atomic queries inside the transaction.
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.coupon_redemptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  coupon_id UUID NOT NULL REFERENCES public.coupons(id) ON DELETE RESTRICT,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  plan_id UUID REFERENCES public.subscription_plans(id) ON DELETE SET NULL,
  operation TEXT NOT NULL CHECK (operation IN ('new_subscription', 'upgrade', 'renewal', 'reactivation')),
  original_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  final_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied', 'reversed')),
  metadata JSONB NOT NULL DEFAULT '{}',
  redeemed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (coupon_id, workspace_id)
);

CREATE INDEX IF NOT EXISTS idx_redemptions_coupon ON public.coupon_redemptions(coupon_id, redeemed_at);
CREATE INDEX IF NOT EXISTS idx_redemptions_workspace ON public.coupon_redemptions(workspace_id, redeemed_at);
CREATE INDEX IF NOT EXISTS idx_redemptions_user ON public.coupon_redemptions(user_id);

-- --------------------------------------------
-- 4. SUBSCRIPTION EVENTS (full lifecycle history — append-only)
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'created', 'trial_started', 'trial_extended', 'trial_converted',
    'plan_changed', 'renewed', 'payment_failed', 'past_due', 'grace_started',
    'expired', 'cancelled', 'cancel_scheduled', 'cancel_resumed',
    'reactivated', 'coupon_applied', 'override_added', 'override_expired'
  )),
  previous_values JSONB NOT NULL DEFAULT '{}',
  new_values JSONB NOT NULL DEFAULT '{}',
  actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('system', 'user', 'admin', 'webhook')),
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_events_subscription ON public.subscription_events(subscription_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sub_events_workspace ON public.subscription_events(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sub_events_type ON public.subscription_events(event_type, created_at);

-- --------------------------------------------
-- 5. SUBSCRIPTION OVERRIDES (temporary, auto-expiring support exceptions — §36)
--    Never silently mutate the subscription; overrides are applied during
--    state/entitlement resolution and expire automatically.
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_overrides (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id UUID NOT NULL REFERENCES public.subscriptions(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  override_type TEXT NOT NULL CHECK (override_type IN (
    'trial_extension', 'subscription_extension', 'feature_grant', 'limit_increase'
  )),
  value JSONB NOT NULL DEFAULT '{}', -- {days: 14} | {feature: 'forecasting'} | {limit, metric}
  reason TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overrides_subscription ON public.subscription_overrides(subscription_id);
CREATE INDEX IF NOT EXISTS idx_overrides_expiry ON public.subscription_overrides(expires_at);

-- --------------------------------------------
-- 6. PAYMENTS (persisted from Stripe invoice/charge webhooks — §56)
--    Dev-mode (native) billing has no payment rows by design.
-- --------------------------------------------
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  subscription_id UUID REFERENCES public.subscriptions(id) ON DELETE SET NULL,
  provider TEXT NOT NULL DEFAULT 'stripe',
  provider_reference TEXT UNIQUE, -- stripe invoice/charge id (idempotency anchor)
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK (status IN ('pending', 'successful', 'failed', 'refunded')),
  invoice_id TEXT, -- stripe invoice id
  coupon_id UUID REFERENCES public.coupons(id) ON DELETE SET NULL,
  discount_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  failure_reason TEXT,
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payments_workspace ON public.payments(workspace_id, created_at);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status, created_at);

-- --------------------------------------------
-- 7. PLATFORM ADMIN ROLES (§38/§65) — additive column + default upgrade
--    Existing rows keep working: existing admins read as SUPER_ADMIN.
-- --------------------------------------------
ALTER TABLE public.platform_admins ADD COLUMN IF NOT EXISTS role TEXT
  NOT NULL DEFAULT 'SUPER_ADMIN'
  CHECK (role IN ('SUPER_ADMIN', 'PLATFORM_ADMIN', 'SUPPORT_ADMIN', 'BILLING_ADMIN'));
