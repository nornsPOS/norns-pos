/**
 * Regression: the KYC ID-document image route MUST NEVER be public. Unlike the
 * product-photo raw/thumb renditions (public-by-UUID), the KYC image is served
 * only via the ADMIN + step-up route. This pins isPublicRoute against the KYC
 * path (and with a querystring, since the matcher strips it).
 */
import { describe, expect, it } from 'vitest';

import { isPublicRoute } from '../../src/lib/public-routes.js';

describe('KYC image route is never public', () => {
  it('the KYC image path is NOT public (with and without a querystring)', () => {
    expect(isPublicRoute('/api/customers/abc/kyc-documents/def/image')).toBe(false);
    expect(isPublicRoute('/api/customers/abc/kyc-documents/def/image?download=1')).toBe(false);
    // The collection + capture routes are gated too.
    expect(isPublicRoute('/api/customers/abc/kyc-documents')).toBe(false);
  });

  it('control: product-photo raw/thumb stay public-by-UUID', () => {
    expect(isPublicRoute('/api/photos/abc/raw')).toBe(true);
    expect(isPublicRoute('/api/photos/abc/thumb')).toBe(true);
  });
});
