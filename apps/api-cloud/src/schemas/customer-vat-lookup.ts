/**
 * Schema for GET /api/customers/by-vat-id — a single bounded VAT-id lookup.
 *
 * Replaces the POS B2B checkout N+1 (a customer LIST then a serial GET per row
 * to match the VAT id, ON THE CHECKOUT PATH). Returns at most one customer.
 */

import { type Static, Type } from '@sinclair/typebox';

export const CustomerVatLookupQuery = Type.Object({
  vatId: Type.String({ minLength: 4, maxLength: 32 }),
});
export type CustomerVatLookupQuery = Static<typeof CustomerVatLookupQuery>;

const MatchedCustomer = Type.Object({
  id: Type.String({ format: 'uuid' }),
  customerNumber: Type.String(),
  fullName: Type.String(),
  vatId: Type.Union([Type.String(), Type.Null()]),
});

export const CustomerVatLookupResponse = Type.Object({
  customer: Type.Union([Type.Null(), MatchedCustomer]),
});
export type CustomerVatLookupResponse = Static<typeof CustomerVatLookupResponse>;
