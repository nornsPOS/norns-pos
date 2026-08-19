/**
 * useReceiptFooterLines — the Owner-customised receipt footer (GENERIC_FOOTER),
 * edited live in Einstellungen → Beleg & Shop (Belegdesigner) and printed at
 * the bottom of every sale receipt.
 *
 * Returns `undefined` until the call resolves, then the non-empty trimmed
 * lines (an empty array when no custom footer has been published). The caller
 * falls back to the default greeting when this is empty, and always appends
 * the legally-required tax footnotes itself.
 */

import { useQuery } from '@tanstack/react-query';

import { belegtextApi } from '@norns/api-client';

import { useApiClient } from '../lib/api-context.js';

export function useReceiptFooterLines(): string[] | undefined {
  const api = useApiClient();
  const { data } = useQuery({
    queryKey: ['belegtext', 'current', 'GENERIC_FOOTER'],
    queryFn: () => belegtextApi.current(api, { kind: 'GENERIC_FOOTER' }),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
  if (data === undefined) return undefined;
  const body = data.bodyText ?? '';
  return body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}
