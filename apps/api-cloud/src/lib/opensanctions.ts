/**
 * OpenSanctions screening client (Epic J).
 *
 * German GwG (§10 Geldwäschegesetz) requires matching customers against PEP,
 * EU, and OFAC watchlists before high-value Ankauf/sale. Rather than host our
 * own watchlist DB, we query the OpenSanctions hosted match API, which covers
 * 200+ international sanctions + PEP datasets.
 *
 * Two hard rules baked in here (memory.md Decision #20 + #53):
 *
 *   1. FAIL-SAFE. An API outage / timeout / non-200 must NEVER block a
 *      transaction — we return `{ score: 0, matched: false, apiUnavailable: true }`
 *      and let the operator proceed. A sanctions HIT (matched: true) is the only
 *      thing that triggers the downstream hard-block, never an API error.
 *   2. NO PII IN LOGS. The customer name is sent only in the request body; this
 *      module never logs it, and the caller persists only `{ score, matched }`.
 *
 * Testability: `fetchImpl` is injectable (same pattern as dhl-client.ts) so unit
 * tests can simulate a 0.85 hit, a network timeout, and the empty-key skip path
 * without touching the network.
 */

export interface SanctionsQuery {
  /** Decrypted full name. Sent in the request body only — never logged. */
  name: string;
  /** Optional ISO date of birth, narrows false positives. */
  birthDate?: string;
  /** Optional ISO 3166 nationality, narrows false positives. */
  nationality?: string;
}

export interface SanctionsConfig {
  /** OpenSanctions API key. Empty → screening is skipped (see SanctionsResult). */
  apiKey: string;
  /** Match score (0.0–1.0) at/above which a customer counts as a hit. */
  scoreThreshold: number;
}

export interface SanctionsResult {
  /** Best match score in [0, 1]. 0 when skipped or unavailable. */
  score: number;
  /** True iff `score >= scoreThreshold` from a live, successful API call. */
  matched: boolean;
  /** Caption of the top matched watchlist entity, when present. */
  matchedEntity?: string;
  /** True when the API was unreachable / errored — fail-safe, not a hit. */
  apiUnavailable?: boolean;
  /** True when no API key is configured — screening was skipped entirely. */
  skipped?: boolean;
}

export type SanctionsFetch = (
  input: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    signal?: AbortSignal | undefined;
  },
) => Promise<Response>;

export interface SanctionsClientOptions {
  baseUrl?: string;
  fetchImpl?: SanctionsFetch;
  /** Hard timeout in ms (default 10_000). */
  timeoutMs?: number;
}

const DEFAULT_BASE_URL = 'https://api.opensanctions.org/match/default';
const DEFAULT_TIMEOUT_MS = 10_000;
const defaultFetch: SanctionsFetch = (input, init) => fetch(input, init as RequestInit | undefined);

/** Shape of the slice of the OpenSanctions response we consume. */
interface OpenSanctionsResponse {
  responses?: {
    q1?: {
      results?: Array<{ score?: number; caption?: string }>;
    };
  };
}

export function isSanctionsConfigured(config: SanctionsConfig): boolean {
  return config.apiKey.length > 0;
}

/**
 * Screen a person against OpenSanctions. Never throws — every failure mode maps
 * to a fail-safe, non-blocking result.
 */
export async function matchSanctions(
  config: SanctionsConfig,
  query: SanctionsQuery,
  opts: SanctionsClientOptions = {},
): Promise<SanctionsResult> {
  // No key → skip entirely. No HTTP call is made.
  if (!isSanctionsConfigured(config)) {
    return { score: 0, matched: false, skipped: true };
  }

  const url = opts.baseUrl ?? DEFAULT_BASE_URL;
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Only include optional properties when present (OpenSanctions ignores empty).
  const properties: Record<string, string[]> = { name: [query.name] };
  if (query.birthDate) properties.birthDate = [query.birthDate];
  if (query.nationality) properties.nationality = [query.nationality];

  const body = JSON.stringify({
    queries: { q1: { schema: 'Person', properties } },
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `ApiKey ${config.apiKey}`,
      },
      body,
      signal: controller.signal,
    });

    // Any non-200 is treated as "unavailable" — fail-safe, never a hit.
    if (!res.ok) {
      return { score: 0, matched: false, apiUnavailable: true };
    }

    const data = (await res.json()) as OpenSanctionsResponse;
    const top = data.responses?.q1?.results?.[0];
    const score = typeof top?.score === 'number' ? top.score : 0;
    const matched = score >= config.scoreThreshold;

    const result: SanctionsResult = { score, matched };
    if (matched && top?.caption) result.matchedEntity = top.caption;
    return result;
  } catch {
    // Timeout (abort), DNS failure, connection refused — all fail-safe.
    return { score: 0, matched: false, apiUnavailable: true };
  } finally {
    clearTimeout(timer);
  }
}
