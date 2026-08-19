/**
 * useMetalRates — the SINGLE source for live metal rates across the app.
 *
 * Uses the exact same TanStack queryKey (`['metal-prices','rates']`), queryFn
 * and 20s poll that the Kurse screen uses, so the always-mounted ticker shares
 * the cache — no second fetch. Returns each metal's current €/g + the 10-day
 * average (the ticker's Δ reference) + the Ankauf rate.
 */
import { type UseQueryResult, useQuery } from '@tanstack/react-query';

import { type MetalRatesResponse, metalPricesApi } from '@norns/api-client';

import { useApiClient } from '../lib/api-context.js';

export function useMetalRates(): UseQueryResult<MetalRatesResponse> {
  const api = useApiClient();
  return useQuery({
    queryKey: ['metal-prices', 'rates'],
    queryFn: () => metalPricesApi.rates(api),
    staleTime: 20_000,
    refetchInterval: 20_000,
  });
}
