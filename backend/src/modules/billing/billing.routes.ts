import { Router, Request, Response, NextFunction } from 'express';
import { BillingService } from './billing.service.js';
import { PlanCatalogService } from '../../services/plan-catalog.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { isStripeConfigured, getStripe, getPriceIdForPlan } from '../../config/stripe.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { AppError } from '../../shared/errors.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

// Accept the DB tier keys (free/starter/business/enterprise); the service
// resolves them case-insensitively through PlanCatalogService.
const changePlanSchema = z.object({
  planName: z.string().min(1).max(50),
});

const checkoutSchema = z.object({
  planName: z.string().min(1).max(50),
  billingInterval: z.enum(['monthly', 'annual']).default('monthly'),
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
    const updated = await BillingService.changePlan(req.workspace!.id, planName, req.user!.id);
    res.json({ success: true, data: updated });
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

    const { planName, billingInterval } = checkoutSchema.parse(req.body);
    const plan = await PlanCatalogService.getPlanByName(planName);
    if (!plan) throw AppError.notFound(`Unknown plan: ${planName}`, 'PLAN_NOT_FOUND');
    if (plan.name === 'free') {
      throw AppError.badRequest('The Free plan does not require checkout.', 'FREE_PLAN_NO_CHECKOUT');
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
