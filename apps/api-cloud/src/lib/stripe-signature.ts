/**
 * Stripe-Signature verification (memory.md #65).
 *
 * Implements Stripe's documented HMAC scheme:
 *   1. The webhook delivery carries a `Stripe-Signature` header with the
 *      form `t=<unix-ts>,v1=<hex-hmac>[,v1=<more>]`. Multiple `v1=`
 *      signatures occur during key rotation.
 *   2. The expected HMAC is SHA-256 of the bytes `<ts>.<rawBody>` using the
 *      webhook signing secret (STRIPE_WEBHOOK_SECRET).
 *   3. The timestamp must be within `toleranceSeconds` of now() — older
 *      signatures are refused (replay defense).
 *
 * Constant-time comparison is used so the verifier does NOT leak timing
 * about how many leading hex chars matched.
 *
 * Refs:
 *   • https://docs.stripe.com/webhooks/signatures
 *   • Stripe's stripe-node `Webhook.constructEvent` source — this
 *     re-implements that logic explicitly so we know the bytes signed are
 *     EXACTLY the bytes we read off the wire.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export type StripeSignatureFailure =
  | { code: 'MALFORMED_HEADER'; detail: string }
  | { code: 'NO_TIMESTAMP' }
  | { code: 'NO_V1_SIGNATURES' }
  | {
      code: 'TIMESTAMP_OUTSIDE_TOLERANCE';
      receivedTs: number;
      nowTs: number;
      toleranceSeconds: number;
    }
  | { code: 'NO_MATCHING_SIGNATURE' };

export interface StripeSignatureOk {
  ok: true;
  /** The verified timestamp (seconds since epoch) Stripe attached. */
  timestamp: number;
}

export interface StripeSignatureErr {
  ok: false;
  failure: StripeSignatureFailure;
}

export type StripeSignatureResult = StripeSignatureOk | StripeSignatureErr;

interface ParsedHeader {
  t: number;
  v1: string[];
}

function parseHeader(header: string): ParsedHeader | StripeSignatureFailure {
  if (header.length === 0 || header.length > 4096) {
    return { code: 'MALFORMED_HEADER', detail: 'empty or oversized header' };
  }
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx <= 0) return { code: 'MALFORMED_HEADER', detail: `invalid pair '${part}'` };
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key === 't') {
      const n = Number(value);
      if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) {
        return { code: 'MALFORMED_HEADER', detail: `bad timestamp '${value}'` };
      }
      t = n;
    } else if (key === 'v1') {
      if (!/^[0-9a-f]+$/i.test(value)) {
        return { code: 'MALFORMED_HEADER', detail: 'v1 signature is not hex' };
      }
      v1.push(value);
    }
    // Stripe also emits `v0=`; we ignore it (deprecated test-mode scheme).
  }
  if (t === null) return { code: 'NO_TIMESTAMP' };
  if (v1.length === 0) return { code: 'NO_V1_SIGNATURES' };
  return { t, v1 };
}

export interface VerifyStripeSignatureOpts {
  /** Raw request body bytes, EXACTLY as received on the wire. */
  rawBody: string;
  /** Value of the `Stripe-Signature` header. */
  header: string;
  /** STRIPE_WEBHOOK_SECRET — `whsec_…`. */
  secret: string;
  /** Max delta between Stripe's `t=` and now() before we refuse. */
  toleranceSeconds: number;
  /** Inject a clock for testability. Defaults to Date.now()/1000. */
  nowSeconds?: () => number;
}

/**
 * Verify the Stripe-Signature header against the raw body + secret.
 * Returns `{ ok: true, timestamp }` on success or `{ ok: false, failure }`
 * with a tagged reason. Never throws on signature mismatch — only on
 * impossible state (e.g. crypto unavailable, which Node always has).
 */
export function verifyStripeSignature(opts: VerifyStripeSignatureOpts): StripeSignatureResult {
  const parsed = parseHeader(opts.header);
  if ('code' in parsed) return { ok: false, failure: parsed };

  const now = opts.nowSeconds ? opts.nowSeconds() : Math.floor(Date.now() / 1000);
  const delta = Math.abs(now - parsed.t);
  if (delta > opts.toleranceSeconds) {
    return {
      ok: false,
      failure: {
        code: 'TIMESTAMP_OUTSIDE_TOLERANCE',
        receivedTs: parsed.t,
        nowTs: now,
        toleranceSeconds: opts.toleranceSeconds,
      },
    };
  }

  // Compute the expected HMAC over `<ts>.<rawBody>`.
  const signedPayload = `${parsed.t}.${opts.rawBody}`;
  const expectedHex = createHmac('sha256', opts.secret).update(signedPayload, 'utf8').digest('hex');
  const expectedBuf = Buffer.from(expectedHex, 'hex');

  // Compare against EACH v1 candidate constant-time. Stripe rotates keys
  // by emitting both old + new during the transition; either match is OK.
  for (const candidate of parsed.v1) {
    const candidateBuf = Buffer.from(candidate, 'hex');
    if (candidateBuf.length !== expectedBuf.length) continue;
    if (timingSafeEqual(candidateBuf, expectedBuf)) {
      return { ok: true, timestamp: parsed.t };
    }
  }
  return { ok: false, failure: { code: 'NO_MATCHING_SIGNATURE' } };
}
