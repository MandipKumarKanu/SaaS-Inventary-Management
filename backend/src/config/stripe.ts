import Stripe from 'stripe';
import { env } from './env.js';

/**
 * Phase 3 Step 4: lazily-constructed Stripe client (mirrors db/pool.ts).
 *
 * The module must be importable without Stripe credentials (dev/test keep
 * working) — getStripe() throws only when a Stripe operation is attempted
 * without STRIPE_SECRET_KEY configured.
 */

let client: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error(
      'Stripe is not configured. Set STRIPE_SECRET_KEY to enable checkout, portal, and subscription webhooks.'
    );
  }
  if (!client) {
    client = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: '2025-08-27.basil' as Stripe.LatestApiVersion,
      typescript: true,
    });
  }
  return client;
}

/**
 * Resolve a Stripe Price ID for a plan tier from STRIPE_PRICE_MAP (JSON:
 * { "starter": "price_...", "business": "price_..." }).
 */
export function getPriceIdForPlan(planName: string): string | null {
  if (!env.STRIPE_PRICE_MAP) return null;
  try {
    const map = JSON.parse(env.STRIPE_PRICE_MAP) as Record<string, string>;
    return map[planName.toLowerCase()] || null;
  } catch {
    return null;
  }
}
