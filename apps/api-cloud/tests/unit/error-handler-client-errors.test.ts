/**
 * A caller's bad payload must never be reported as OUR server error.
 *
 * Regression: Cloudflare's edge analytics showed 5xx on the public zone. One of
 * them was a bot POSTing malformed JSON to `/api/auth/duress-pin/set`. Fastify
 * raises `FST_ERR_CTP_INVALID_JSON` with `statusCode: 400` and NO `validation`
 * field, so it slipped past the validation branch, past the 401/403/429 shapes,
 * and landed in the catch-all → answered 500 and logged `unhandled error`.
 *
 * That both lied to the caller and inflated the server-error rate: every bot
 * posting garbage looked like an outage on the Schaufenster health card.
 */

import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import errorHandlerPlugin, { DomainError, type ApiErrorCode } from '../../src/plugins/error-handler.js';

/** Stand-in for R2NotConfiguredError / StripeNotConfiguredError. */
class NotConfigured extends DomainError {
  public readonly httpStatus = 503;
  public readonly code: ApiErrorCode = 'SERVICE_UNAVAILABLE';
}

async function buildProbe() {
  const app = Fastify();
  await app.register(errorHandlerPlugin);
  app.post('/echo', async () => ({ ok: true }));
  return app;
}

describe('error handler: client-side (4xx) errors', () => {
  it('answers 400 VALIDATION_ERROR for a malformed JSON body (not 500)', async () => {
    const app = await buildProbe();
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/json' },
      payload: '{"',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_ERROR');
    await app.close();
  });

  it('answers 415 as a client error, not INTERNAL_ERROR', async () => {
    const app = await buildProbe();
    const res = await app.inject({
      method: 'POST',
      url: '/echo',
      headers: { 'content-type': 'application/vnd.made-up' },
      payload: 'x',
    });
    expect(res.statusCode).toBeLessThan(500);
    expect(res.json().error.code).not.toBe('INTERNAL_ERROR');
    await app.close();
  });

  it('still answers 500 INTERNAL_ERROR when the fault really is ours', async () => {
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    app.post('/boom', async () => {
      throw new Error('database on fire');
    });
    const res = await app.inject({ method: 'POST', url: '/boom', payload: {} });
    expect(res.statusCode).toBe(500);
    expect(res.json().error.code).toBe('INTERNAL_ERROR');
    // The underlying message must not leak to a hostile client.
    expect(res.payload).not.toContain('database on fire');
    await app.close();
  });

  it('answers 503 SERVICE_UNAVAILABLE for a deliberately-unconfigured capability (not 500)', async () => {
    // Stripe/R2/AI keys unset must NOT read as a server crash: 503, not 500, so
    // it stays out of the on-call "unexpected error" bucket and the storefront
    // health card. Regression: these used to throw INTERNAL_ERROR → 500.
    const app = Fastify();
    await app.register(errorHandlerPlugin);
    app.post('/checkout', async () => {
      throw new NotConfigured('Stripe is not configured for this environment.');
    });
    const res = await app.inject({ method: 'POST', url: '/checkout', payload: {} });
    expect(res.statusCode).toBe(503);
    expect(res.json().error.code).toBe('SERVICE_UNAVAILABLE');
    await app.close();
  });
});
