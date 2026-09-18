import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { BillingService } from './billing.service.js';
import { SubscriptionService } from './subscription.service.js';
import { CouponService } from './coupon.service.js';
import { PlanCatalogService } from '../../services/plan-catalog.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { isStripeConfigured, getStripe, getPriceIdForPlan } from '../../config/stripe.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { z } from 'zod';
import { parsePagination } from '../../shared/http.js';

// §31: coupon validation/redemption are abusable surfaces — throttle harder
// than the global API limiter (guessing codes, repeated validation).
const couponLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: { code: 'RATE_LIMIT', message: 'Too many coupon attempts. Please try again later.' } },
  skip: (req) => {
    if (process.env.NODE_ENV === 'development') return true;
    const ip = req.ip || req.socket.remoteAddress || '';
    const host = req.headers.host || req.hostname || '';
    return (
      ip === '127.0.0.1' ||
      ip === '::1' ||
      ip === '::ffff:127.0.0.1' ||
      host.includes('localhost') ||
      host.includes('127.0.0.1')
    );
  },
});

const router = Router({ mergeParams: true });

// Accept the DB tier keys (free/starter/business/enterprise); the service
// resolves them case-insensitively through PlanCatalogService.
const changePlanSchema = z.object({
  planName: z.string().min(1).max(50),
});

const checkoutSchema = z.object({
  planName: z.string().min(1).max(50),
  billingInterval: z.enum(['monthly', 'annual']).default('monthly'),
  // Stripe-mode coupon passthrough: validated by Stripe (promotion code).
  // Dev-mode redemption uses POST /coupons/redeem instead.
  couponCode: z.string().min(3).max(40).optional(),
});

async function handle(fn: (req: Request, res: Response) => Promise<void>, req: Request, res: Response, next: NextFunction) {
  try {
    await fn(req, res);
  } catch (err) {
    next(err);
  }
}

router.get(
  '/',
  requirePermission(PERMISSIONS.BILLING_VIEW) as any,
  (req, res, next) => handle(async (req, res) => {
    const summary = await BillingService.getBillingSummary(req.workspace!.id);
    res.json({ success: true, data: summary });
  }, req, res, next)
);

router.post(
  '/plan',
  requirePermission(PERMISSIONS.BILLING_MANAGE) as any,
  (req, res, next) => handle(async (req, res) => {
    const { planName } = changePlanSchema.parse(req.body);
    // Routes through SubscriptionService so every plan change is recorded in
    // subscription_events (§50 lifecycle history).
    const updated = await SubscriptionService.changePlan(req.workspace!.id, planName, req.user!.id);
    res.json({ success: true, data: updated });
  }, req, res, next)
);

// ============================================
// SaaS Business Layer: subscription lifecycle + coupons
// (§19 cancel/resume/reactivate, §24 coupon preview,
//  §26 coupon-based upgrade — pricing is server-side only)
// ============================================

const couponPreviewSchema = z.object({
  code: z.string().min(3).max(40),
  planName: z.string().min(1).max(50),
});

const couponRedeemSchema = z.object({
  code: z.string().min(3).max(40),
  planName: z.string().min(1).max(50),
});

router.post(
  '/coupons/preview',
  couponLimiter as any,
  requirePermission(PERMISSIONS.BILLING_MANAGE) as any,
  (req, res, next) => handle(async (req, res) => {
    const { code, planName } = couponPreviewSchema.parse(req.body);
    const preview = await CouponService.preview(
      code,
      req.workspace!.id,
      req.user!.id,
      planName,
      'upgrade'
    );
    res.json({ success: true, data: preview });
  }, req, res, next)
);

router.post(
  '/coupons/redeem',
  couponLimiter as any,
  requirePermission(PERMISSIONS.BILLING_MANAGE) as any,
  (req, res, next) => handle(async (req, res) => {
    const { code, planName } = couponRedeemSchema.parse(req.body);
    // §26: client supplies plan name + code only — price/discount/final
    // amount are computed server-side from the plan catalog + coupon row.
    const result = await SubscriptionService.upgradeWithCoupon(
      req.workspace!.id,
      req.user!.id,
      planName,
      code
    );
    res.json({ success: true, data: result });
  }, req, res, next)
);

router.post(
  '/cancel-at-period-end',
  requirePermission(PERMISSIONS.BILLING_MANAGE) as any,
  (req, res, next) => handle(async (req, res) => {
    const updated = await SubscriptionService.cancelAtPeriodEnd(req.workspace!.id, req.user!.id);
    res.json({ success: true, data: { status: updated.status, cancel_at_period_end: updated.cancel_at_period_end, current_period_end: updated.current_period_end } });
  }, req, res, next)
);

router.post(
  '/cancel-now',
  requirePermission(PERMISSIONS.BILLING_MANAGE) as any,
  (req, res, next) => handle(async (req, res) => {
    const body = z.object({ reason: z.string().max(500).optional() }).safeParse(req.body);
    const updated = await SubscriptionService.cancelNow(req.workspace!.id, req.user!.id, body.success ? body.data.reason : undefined);
    res.json({ success: true, data: { status: updated.status, cancelled_at: updated.cancelled_at } });
  }, req, res, next)
);

router.post(
  '/resume',
  requirePermission(PERMISSIONS.BILLING_MANAGE) as any,
  (req, res, next) => handle(async (req, res) => {
    const updated = await SubscriptionService.resume(req.workspace!.id, req.user!.id);
    res.json({ success: true, data: { status: updated.status, cancel_at_period_end: updated.cancel_at_period_end } });
  }, req, res, next)
);

router.post(
  '/reactivate',
  requirePermission(PERMISSIONS.BILLING_MANAGE) as any,
  (req, res, next) => handle(async (req, res) => {
    const updated = await SubscriptionService.reactivate(req.workspace!.id, req.user!.id);
    res.json({ success: true, data: { status: updated.status } });
  }, req, res, next)
);

router.get(
  '/events',
  requirePermission(PERMISSIONS.BILLING_VIEW) as any,
  (req, res, next) => handle(async (req, res) => {
    const { page, pageSize } = parsePagination(req.query);
    const { events, total } = await SubscriptionService.listEvents(req.workspace!.id, page, pageSize);
    res.json({ success: true, data: events, meta: { page, pageSize, total } });
  }, req, res, next)
);

// ============================================
// Phase 3 Step 4: Stripe Checkout & Customer Portal
// ============================================

router.post(
  '/checkout-session',
  requirePermission(PERMISSIONS.BILLING_MANAGE) as any,
  (req, res, next) => handle(async (req, res) => {
    if (!isStripeConfigured()) {
      throw AppError.badRequest(
        'Stripe is not configured on this deployment. Use the dev plan-change endpoint instead.',
        'STRIPE_NOT_CONFIGURED'
      );
    }

    const checkoutBody = checkoutSchema.parse(req.body);
    const { planName, billingInterval } = checkoutBody;
    const plan = await PlanCatalogService.getPlanByName(planName);
    if (!plan) throw AppError.notFound(`Unknown plan: ${planName}`, 'PLAN_NOT_FOUND');
    // Zero-price plans (usually the default tier) don't need Stripe checkout.
    // Phase 7b: determined by the plan's PRICE, not a hardcoded tier name.
    if (Number(plan.priceMonthly) === 0 && Number(plan.priceAnnual) === 0) {
      throw AppError.badRequest(`The ${plan.displayName} plan does not require checkout.`, 'FREE_PLAN_NO_CHECKOUT');
    }

    const priceId = getPriceIdForPlan(plan.name);
    if (!priceId) {
      throw AppError.internal(
        `No Stripe price configured for plan "${plan.name}". Set STRIPE_PRICE_MAP.`
      );
    }

    const stripe = getStripe();
    const workspaceId = req.workspace!.id;

    // Reuse the Stripe customer if the workspace already has one
    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    let customerId = sub?.stripe_customer_id ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        metadata: { workspace_id: workspaceId },
      });
      customerId = customer.id;
      await supabaseAdmin
        .from('subscriptions')
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      ...(checkoutBody.couponCode
        ? { discounts: [{ promotion_code: checkoutBody.couponCode.trim().toUpperCase() }] }
        : {}),
      client_reference_id: workspaceId,
      metadata: { workspace_id: workspaceId, plan_name: plan.name, billing_interval: billingInterval },
      subscription_data: {
        metadata: { workspace_id: workspaceId, plan_name: plan.name },
      },
      success_url: `${process.env.APP_URL}/settings/billing?checkout=success`,
      cancel_url: `${process.env.APP_URL}/settings/billing?checkout=cancelled`,
    });

    res.json({ success: true, data: { checkoutUrl: session.url } });
  }, req, res, next)
);

router.post(
  '/portal-session',
  requirePermission(PERMISSIONS.BILLING_MANAGE) as any,
  (req, res, next) => handle(async (req, res) => {
    if (!isStripeConfigured()) {
      throw AppError.badRequest('Stripe is not configured on this deployment.', 'STRIPE_NOT_CONFIGURED');
    }

    const { data: sub } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('workspace_id', req.workspace!.id)
      .maybeSingle();

    if (!sub?.stripe_customer_id) {
      throw AppError.notFound(
        'No Stripe customer yet — checkout first to create one.',
        'NO_STRIPE_CUSTOMER'
      );
    }

    const stripe = getStripe();
    const portal = await stripe.billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${process.env.APP_URL}/settings/billing`,
    });

    res.json({ success: true, data: { portalUrl: portal.url } });
  }, req, res, next)
);

export const billingRoutes = router;
