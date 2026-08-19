/**
 * mTLS plugin — extract the client cert identity and bind `req.deviceId`.
 *
 * Two environments, one contract:
 *
 *   • production (NODE_ENV=production) — Cloudflare Access enforces mTLS
 *     at the edge and forwards `Cf-Client-Cert-Sha256` (the SHA-256 hex of
 *     the verified leaf cert) + `Cf-Access-Jwt-Assertion` (a JWT we could
 *     additionally verify against the team's JWKS — V1.5 hardening).
 *
 *   • development (NODE_ENV=development) — there is no Cloudflare. The
 *     plugin reads `X-Dev-Device-Fingerprint` (sent by the local Tauri /
 *     curl client) and looks it up the same way. The dev-bootstrap script
 *     seeds a `devices` row matching the self-signed cert it generated.
 *
 *   • test (NODE_ENV=test) — header optional. Tests that want mTLS gating
 *     send the header explicitly; otherwise `req.deviceId` stays null.
 *
 * In all environments the lookup is the same: `devices.cert_serial = ?`
 * AND `status = 'ACTIVE'` AND `cert_expires_at > now()`. Refuse otherwise.
 *
 * Public routes (`/health`, `/metrics`, `/docs/*`, `/openapi.json`,
 * `/api/auth/*`) skip the check entirely.
 */

import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import fastifyPlugin from 'fastify-plugin';

import { devices } from '@norns/db/schema';
import { and, sql as dsql, eq, gt } from 'drizzle-orm';
import type { Env } from '../config/env.js';

import { isPublicRoute } from '../lib/public-routes.js';
import { type ApiErrorCode, DomainError } from './error-handler.js';

export interface MtlsPluginOpts {
  env: Env;
}

class DeviceNotAuthorizedError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}

/** Picks the cert-identifying header for the current environment. */
function extractCertFingerprint(req: FastifyRequest, env: Env): string | null {
  const headers = req.headers as Record<string, string | undefined>;
  if (env.NODE_ENV === 'production') {
    const cf = headers['cf-client-cert-sha256'];
    if (cf) return cf;
    // TEST-ONLY pre-mTLS fallback. Until Cloudflare Access mTLS is enabled at
    // go-live, there is no client cert, so every device-gated request would be
    // hard-refused. When (and ONLY when) TEST_DEVICE_FINGERPRINT is set, treat
    // an uncerted request as coming from that single seeded test device. Unset
    // this env the moment real mTLS is turned on. Empty default = off.
    if (env.TEST_DEVICE_FINGERPRINT) return env.TEST_DEVICE_FINGERPRINT;
    return null;
  }
  return headers['x-dev-device-fingerprint'] ?? null;
}

const mtlsPlugin: FastifyPluginAsync<MtlsPluginOpts> = async (app, opts) => {
  app.addHook('preHandler', async (req: FastifyRequest) => {
    if (isPublicRoute(req.url)) return;

    const fingerprint = extractCertFingerprint(req, opts.env);

    // In test mode, missing fingerprint is acceptable — leaves req.deviceId null.
    // In dev mode, missing fingerprint is acceptable — Tauri may not be the client.
    // In production mode, missing fingerprint is a hard refuse.
    if (!fingerprint) {
      if (opts.env.NODE_ENV === 'production') {
        throw new DeviceNotAuthorizedError('mTLS client cert missing (Cf-Client-Cert-Sha256)');
      }
      return;
    }

    // Look up the device. Refuse if absent, revoked, or cert expired.
    const rows = await app.db
      .select({ id: devices.id, status: devices.status, expiresAt: devices.certExpiresAt })
      .from(devices)
      .where(
        and(
          eq(devices.certSerial, fingerprint),
          eq(devices.status, dsql`'active'::device_status`),
          gt(devices.certExpiresAt, dsql`now()`),
        ),
      )
      .limit(1);

    const dev = rows[0];
    if (!dev) {
      throw new DeviceNotAuthorizedError(
        `Device fingerprint ${fingerprint.slice(0, 16)}… is not authorized`,
      );
    }
    req.deviceId = dev.id;
  });
};

export default fastifyPlugin(mtlsPlugin, {
  name: 'warehouse14-mtls',
  fastify: '4.x',
  dependencies: ['warehouse14-db'],
});
