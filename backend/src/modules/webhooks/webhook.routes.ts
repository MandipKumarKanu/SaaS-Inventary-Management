import { Router, Request, Response, NextFunction } from 'express';
import { WebhookService } from './webhook.service.js';
import { requirePermission } from '../../middleware/permission.middleware.js';
import { PERMISSIONS } from '../../shared/permissions.js';
import { verifyStripeSignature } from '../../shared/stripe-signature.js';
import { parsePagination } from '../../shared/http.js';
import { StripeWebhookService } from './stripe-webhook.service.js';
import { env } from '../../config/env.js';
import { logger } from '../../config/logger.js';
import { z } from 'zod';

const router = Router({ mergeParams: true });

const createSubSchema = z.object({
  url: z.string().url(),
  events: z.array(z.string()).min(1),
});

router.get(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_VIEW) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { page, pageSize } = parsePagination(req.query);
      const result = await WebhookService.listSubscriptions(req.workspace!.id, { page, pageSize });
      res.json({ success: true, ...result });
    } catch (err) {
      next(err);
    }
  }
);

router.post(
  '/',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { url, events } = createSubSchema.parse(req.body);
      const sub = await WebhookService.createSubscription(req.workspace!.id, url, events);
      res.status(201).json({ success: true, data: sub });
    } catch (err) {
      next(err);
    }
  }
);

router.delete(
  '/:id',
  requirePermission(PERMISSIONS.SETTINGS_MANAGE) as any,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await WebhookService.deleteSubscription(req.params.id as string, req.workspace!.id);
      res.json({ success: true, data: { message: 'Webhook subscription deleted' } });
    } catch (err) {
      next(err);
    }
  }
);

// ============================================
// Public Stripe Webhook Endpoint (Phase 0 hardening)
// ============================================
// Previous implementation accepted any unsigned JSON body and only logged the
// event id — effectively an unauthenticated write-ish endpoint. Now:
//   1. Verifies the `Stripe-Signature` HMAC over the RAW body (timing-safe).
//   2. Rejects timestamps outside a tolerance window (replay protection).
//   3. Fails CLOSED: if STRIPE_WEBHOOK_SECRET is not configured, every request
//      is rejected (no shadow accept path).
export const stripeWebhookRouter = Router();

stripeWebhookRouter.post('/stripe', (req: Request, res: Response) => {
  const rawBody = (req as any).rawBody as Buffer | undefined;

  const result = verifyStripeSignature(
    rawBody,
    req.headers['stripe-signature'] as string | undefined,
    env.STRIPE_WEBHOOK_SECRET
  );

  if (!result.ok) {
    logger.warn('Stripe webhook rejected', { reason: result.error });
    return res.status(400).json({
      success: false,
      error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'Webhook signature verification failed' },
    });
  }

  const event = result.event;
  const deliveryAttempt = Number(req.headers['stripe-delivery-attempt'] ?? 1) || 1;

  // Phase 3: full processing — idempotency + subscription state machine +
  // result recording. Response contract from Phase 0/1 is preserved.
  StripeWebhookService.processEvent(event, { deliveryAttempt, rawPayload: req.body })
    .then(({ status }) => {
      if (status === 'failed') {
        // 500 makes Stripe retry the delivery — correct for transient errors.
        res.status(500).json({
          success: false,
          error: { code: 'WEBHOOK_PROCESSING_FAILED', message: 'Failed to process webhook event' },
        });
        return;
      }
      res.json({ success: true, data: { received: true, status } });
    })
    .catch((err) => {
      logger.error('Stripe webhook processing failed', { error: err.message, eventId: event.id });
      // 500 makes Stripe retry the delivery — correct behavior for transient DB issues
      res.status(500).json({
        success: false,
        error: { code: 'WEBHOOK_PROCESSING_FAILED', message: 'Failed to process webhook event' },
      });
    });
});

export const webhookRoutes = router;
