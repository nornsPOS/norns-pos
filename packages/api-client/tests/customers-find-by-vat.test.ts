/**
 * Phase-2 P1.3 — `customersApi.findByVatId` makes ONE bounded request.
 *
 * The POS B2B checkout used to LIST customers then GET each one serially to
 * match the VAT id (an N+1 on the checkout path that also hit the ADMIN-only
 * by-id route → a cashier-till 403). This locks the replacement contract:
 * exactly one GET to /api/customers/by-vat-id, the vatId URL-encoded, and the
 * `{ customer }` envelope unwrapped to the customer or null.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApiClient } from '../src/client.js';
import { customersApi } from '../src/domains/customers.js';

function okJson(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json', 'x-request-id': 'rid-1' },
  });
}

describe('customersApi.findByVatId', () => {
  afterEach(() => vi.restoreAllMocks());

  it('issues exactly one GET to /api/customers/by-vat-id and unwraps the customer', async () => {
    const customer = { id: 'c-1', customerNumber: 'ku-1', fullName: 'ACME GmbH', vatId: 'DE123' };
    const fetchSpy = vi.fn(async () => okJson({ customer }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = createApiClient({ baseUrl: 'http://localhost:3001', getAuthToken: () => null });

    const result = await customersApi.findByVatId(client, 'DE 123 456 789');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = fetchSpy.mock.calls[0]?.[0] as string;
    expect(url).toContain('/api/customers/by-vat-id?vatId=');
    expect(url).toContain('DE%20123%20456%20789'); // URL-encoded
    expect(result).toEqual(customer);
  });

  it('returns null when no customer matches', async () => {
    const fetchSpy = vi.fn(async () => okJson({ customer: null }));
    vi.stubGlobal('fetch', fetchSpy);
    const client = createApiClient({ baseUrl: 'http://localhost:3001', getAuthToken: () => null });

    const result = await customersApi.findByVatId(client, 'DE999');
    expect(result).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
