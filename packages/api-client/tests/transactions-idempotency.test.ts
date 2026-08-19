/**
 * Phase 1.4 Step 0 — `finalize` and `ankauf` seal the SAME idempotency key.
 *
 * Fiscal ownership (ADR-0044 §4): a fiscal write supplies its own idempotency
 * key. Both domain methods must forward it via `meta.custom.idempotencyKey` so
 * the offline-queue seals the outbox row + the `Idempotency-Key` header with the
 * caller's key. `finalize` used to omit this, so on a direct offline enqueue the
 * middleware auto-generated a DIFFERENT key and a replayed finalize could not
 * dedup against the body's key. This locks the symmetry with `ankauf`.
 */
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../src/client.js';
import {
  type AnkaufBody,
  type FinalizeBody,
  transactionsApi,
} from '../src/domains/transactions.js';

function fakeClient(): { client: ApiClient; request: ReturnType<typeof vi.fn> } {
  const request = vi.fn(async () => ({}));
  return { client: { baseUrl: '', request } as unknown as ApiClient, request };
}

const finalizeBody: FinalizeBody = {
  direction: 'VERKAUF',
  customerId: null,
  subtotalEur: '16.72',
  vatEur: '3.18',
  totalEur: '19.90',
  taxTreatmentCode: 'STANDARD_19',
  items: [],
  payments: [{ paymentMethod: 'CASH', amountEur: '19.90' }],
  idempotencyKey: 'idem-finalize-1',
};

describe('transactionsApi.finalize — idempotency-key forwarding', () => {
  it('forwards the caller key via meta.custom (gobdRelevant), matching ankauf', async () => {
    const { client, request } = fakeClient();
    await transactionsApi.finalize(client, finalizeBody);

    expect(request).toHaveBeenCalledTimes(1);
    const [method, path, body, opts] = request.mock.calls[0] as [
      string,
      string,
      unknown,
      { custom?: { idempotencyKey?: string; gobdRelevant?: boolean } } | undefined,
    ];
    expect(method).toBe('POST');
    expect(path).toBe('/api/transactions/finalize');
    expect(body).toBe(finalizeBody);
    expect(opts?.custom).toEqual({ idempotencyKey: 'idem-finalize-1', gobdRelevant: true });
  });

  it('is symmetric with ankauf (same custom shape)', async () => {
    const { client, request } = fakeClient();
    const ankaufBody = {
      customerId: 'c-1',
      payoutMethod: 'CASH',
      items: [],
      idempotencyKey: 'idem-ankauf-1',
    } as unknown as AnkaufBody;

    await transactionsApi.ankauf(client, ankaufBody);
    const opts = request.mock.calls[0]?.[3] as
      | { custom?: { idempotencyKey?: string; gobdRelevant?: boolean } }
      | undefined;
    expect(opts?.custom).toEqual({ idempotencyKey: 'idem-ankauf-1', gobdRelevant: true });
  });
});
