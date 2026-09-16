import { describe, it, expect, beforeEach } from 'vitest';
import crypto from 'crypto';
import { buildTestApp, request } from '../helpers/test-app';
import { testDb } from '../setup';

const app = buildTestApp();
const SECRET = 'whsec_test_secret'; // matches tests/setup.ts

function sign(payload: string, timestamp = String(Math.floor(Date.now() / 1000))) {
  const sig = crypto.createHmac('sha256', SECRET).update(`${timestamp}.${payload}`).digest('hex');
  return `t=${timestamp},v1=${sig}`;
}

function makeEvent(overrides: Partial<Record<string, any>> = {}) {
  return {
    id: `evt_${Math.random().toString(36).slice(2, 10)}`,
    type: 'checkout.session.completed',
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: { id: 'cs_test_123', status: 'complete' } },
    ...overrides,
  };
}

beforeEach(() => {
  testDb.__reset();
});

describe('Stripe webhook security (Phase 0, PRD §73)', () => {
  it('accepts a properly signed event and records it for idempotency', async () => {
    const event = makeEvent();
    const payload = JSON.stringify(event);

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', sign(payload))
      .send(payload);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.received).toBe(true);
    expect(testDb.__all('stripe_webhook_events')).toHaveLength(1);
  });

  it('rejects an unsigned request with 400', async () => {
    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .send(makeEvent());

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_WEBHOOK_SIGNATURE');
    expect(testDb.__all('stripe_webhook_events')).toHaveLength(0);
  });

  it('rejects a tampered payload (signature no longer matches)', async () => {
    const event = makeEvent();
    const payload = JSON.stringify(event);
    // Sign, then mutate the amount Stripe "sent"
    const tampered = payload.replace('cs_test_123', 'cs_attacker');

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', sign(payload))
      .send(tampered);

    expect(res.status).toBe(400);
    expect(testDb.__all('stripe_webhook_events')).toHaveLength(0);
  });

  it('rejects a signature made with the wrong secret', async () => {
    const payload = JSON.stringify(makeEvent());
    const evilSig = crypto
      .createHmac('sha256', 'whsec_attacker_known')
      .update(`${Math.floor(Date.now() / 1000)}.${payload}`)
      .digest('hex');
    const header = `t=${Math.floor(Date.now() / 1000)},v1=${evilSig}`;

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(payload);

    expect(res.status).toBe(400);
  });

  it('rejects replayed events (stale timestamp outside tolerance)', async () => {
    const payload = JSON.stringify(makeEvent());
    const staleTs = String(Math.floor(Date.now() / 1000) - 3600); // 1h old

    const res = await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', sign(payload, staleTs))
      .send(payload);

    expect(res.status).toBe(400);
    expect(testDb.__all('stripe_webhook_events')).toHaveLength(0);
  });

  it('is idempotent: the same verified event delivered twice is recorded once', async () => {
    const event = makeEvent();
    const payload = JSON.stringify(event);
    const header = sign(payload);

    await request(app)
      .post('/api/v1/webhooks/stripe')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', header)
      .send(payload);

    // Simulate duplicate handling: second delivery of the same event id
    const { WebhookService } = await import('../../src/modules/webhooks/webhook.service');
    const second = await WebhookService.handleStripeWebhookEvent(event.id, event.type);

    expect(second.status).toBe('already_processed');
    expect(testDb.__all('stripe_webhook_events')).toHaveLength(1);
  });

  it('fails closed when the signing secret is not configured', async () => {
    const { verifyStripeSignature } = await import('../../src/shared/stripe-signature');
    const payload = JSON.stringify(makeEvent());
    const result = verifyStripeSignature(Buffer.from(payload), sign(payload), '');
    expect(result.ok).toBe(false);
  });
});
