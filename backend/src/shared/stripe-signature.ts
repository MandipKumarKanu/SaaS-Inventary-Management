import crypto from 'crypto';

/**
 * Minimal Stripe webhook signature verification (Phase 0 hardening).
 *
 * Implements the same scheme as stripe-node's `webhooks.constructEvent`:
 *   - `Stripe-Signature` header: `t=<timestamp>,v1=<hex hmac>`
 *   - signed payload = `${timestamp}.${rawBody}`
 *   - HMAC-SHA256 with the webhook signing secret, compared timing-safe
 *
 * Why hand-rolled: the project does not (yet) depend on the `stripe` package,
 * and pulling an SDK into the webhook path is unnecessary. This follows
 * Stripe's documented algorithm exactly and adds replay protection.
 */

const DEFAULT_TOLERANCE_SECONDS = 300; // 5 minutes, same as stripe-node

export type StripeEvent = {
  id: string;
  type: string;
  created: number;
  livemode: boolean;
  data: {
    object: Record<string, unknown>;
    previous_attributes?: Record<string, unknown> | null;
  };
};

export type VerifyOptions = {
  /** Reject events older than this (replay protection). Default 300s. */
  toleranceSeconds?: number;
};

export type VerifyResult =
  | { ok: true; event: StripeEvent }
  | { ok: false; error: string };

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Still perform a comparison to keep timing roughly constant, then fail.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function parseSignatureHeader(header: string): { timestamp: string; signatures: string[] } | null {
  const parts = header.split(',');
  let timestamp: string | null = null;
  const signatures: string[] = [];

  for (const part of parts) {
    const [key, value] = part.split('=', 2);
    const k = key?.trim();
    const v = value?.trim();
    if (!k || !v) continue;
    if (k === 't') {
      timestamp = v;
    } else if (k === 'v1') {
      signatures.push(v);
    }
    // v0 (legacy) and other keys deliberately not accepted
  }

  if (!timestamp || signatures.length === 0) return null;
  return { timestamp, signatures };
}

/**
 * Verify a Stripe webhook request and parse the event payload.
 * Reads only the RAW request body (must be captured before express.json()).
 */
export function verifyStripeSignature(
  rawBody: Buffer | undefined,
  signatureHeader: string | undefined,
  secret: string,
  options: VerifyOptions = {}
): VerifyResult {
  const fail = (error: string): VerifyResult => ({ ok: false, error });

  if (!secret) {
    return fail('Webhook signing secret is not configured');
  }
  if (!rawBody || rawBody.length === 0) {
    return fail('Empty webhook payload');
  }
  if (!signatureHeader) {
    return fail('Missing Stripe-Signature header');
  }

  const parsed = parseSignatureHeader(signatureHeader);
  if (!parsed) {
    return fail('Malformed Stripe-Signature header');
  }

  const { timestamp, signatures } = parsed;

  // Replay protection: reject stale timestamps
  const tolerance = (options.toleranceSeconds ?? DEFAULT_TOLERANCE_SECONDS) * 1000;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return fail('Invalid signature timestamp');
  }
  const age = Date.now() - ts * 1000;
  if (Math.abs(age) > tolerance) {
    return fail('Signature timestamp outside tolerance window (possible replay)');
  }

  // Compute expected HMAC over `${timestamp}.${rawBody}`
  const payload = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload, 'utf8')
    .digest('hex');

  // Any provided v1 signature matching is sufficient (Stripe may rotate secrets)
  for (const sig of signatures) {
    if (timingSafeEqual(expected, sig)) {
      let event: StripeEvent;
      try {
        event = JSON.parse(rawBody.toString('utf8')) as StripeEvent;
      } catch {
        return fail('Payload is not valid JSON');
      }
      if (!event || typeof event !== 'object' || !event.id || !event.type) {
        return fail('Payload does not look like a Stripe event');
      }
      return { ok: true, event };
    }
  }

  return fail('Signature mismatch');
}
