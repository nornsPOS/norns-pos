import { describe, expect, it } from 'vitest';

import {
  type SanctionsConfig,
  type SanctionsFetch,
  isSanctionsConfigured,
  matchSanctions,
} from '../../src/lib/opensanctions.js';

const CONFIGURED: SanctionsConfig = { apiKey: 'test-key', scoreThreshold: 0.7 };

/** Capturing fetch stub that returns a fixed JSON body + status. */
function jsonFetch(
  body: unknown,
  status = 200,
): {
  fetchImpl: SanctionsFetch;
  calls: Array<{ url: string; headers?: Record<string, string>; body?: string }>;
} {
  const calls: Array<{ url: string; headers?: Record<string, string>; body?: string }> = [];
  const fetchImpl: SanctionsFetch = (url, init) => {
    calls.push({
      url,
      ...(init?.headers ? { headers: init.headers } : {}),
      ...(init?.body ? { body: init.body } : {}),
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  };
  return { fetchImpl, calls };
}

describe('isSanctionsConfigured', () => {
  it('requires a non-empty api key', () => {
    expect(isSanctionsConfigured(CONFIGURED)).toBe(true);
    expect(isSanctionsConfigured({ apiKey: '', scoreThreshold: 0.7 })).toBe(false);
  });
});

describe('matchSanctions — live hit', () => {
  it('maps a score=0.85 result to matched:true with the entity caption', async () => {
    const { fetchImpl, calls } = jsonFetch({
      responses: { q1: { results: [{ score: 0.85, caption: 'John A. Doe (OFAC SDN)' }] } },
    });

    const result = await matchSanctions(
      CONFIGURED,
      { name: 'John Doe', birthDate: '1980-01-01' },
      { fetchImpl },
    );

    expect(result.matched).toBe(true);
    expect(result.score).toBe(0.85);
    expect(result.matchedEntity).toBe('John A. Doe (OFAC SDN)');
    expect(result.apiUnavailable).toBeUndefined();
    expect(result.skipped).toBeUndefined();

    // ApiKey auth header + name only in the body (never the URL).
    expect(calls[0]?.url).toContain('/match/default');
    expect(calls[0]?.headers?.Authorization).toBe('ApiKey test-key');
    expect(calls[0]?.url).not.toContain('John Doe');
    expect(calls[0]?.body).toContain('John Doe');
    expect(calls[0]?.body).toContain('1980-01-01');
  });

  it('maps a below-threshold score to matched:false', async () => {
    const { fetchImpl } = jsonFetch({
      responses: { q1: { results: [{ score: 0.42, caption: 'Weak match' }] } },
    });
    const result = await matchSanctions(CONFIGURED, { name: 'Jane Roe' }, { fetchImpl });
    expect(result.matched).toBe(false);
    expect(result.score).toBe(0.42);
    expect(result.matchedEntity).toBeUndefined();
  });

  it('handles an empty results array as score 0', async () => {
    const { fetchImpl } = jsonFetch({ responses: { q1: { results: [] } } });
    const result = await matchSanctions(CONFIGURED, { name: 'Nobody' }, { fetchImpl });
    expect(result).toEqual({ score: 0, matched: false });
  });
});

describe('matchSanctions — fail-safe', () => {
  it('returns apiUnavailable on a network timeout/abort (never throws)', async () => {
    const fetchImpl: SanctionsFetch = (_url, init) =>
      new Promise((_resolve, reject) => {
        // Reject as soon as the AbortController fires (timeoutMs below).
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      });

    const result = await matchSanctions(
      CONFIGURED,
      { name: 'Slow Server' },
      {
        fetchImpl,
        timeoutMs: 5,
      },
    );

    expect(result).toEqual({ score: 0, matched: false, apiUnavailable: true });
  });

  it('returns apiUnavailable on a non-200 response', async () => {
    const { fetchImpl } = jsonFetch({ detail: 'rate limited' }, 429);
    const result = await matchSanctions(CONFIGURED, { name: 'X' }, { fetchImpl });
    expect(result).toEqual({ score: 0, matched: false, apiUnavailable: true });
  });
});

describe('matchSanctions — skip when unconfigured', () => {
  it('returns skipped:true and makes NO HTTP call when the api key is empty', async () => {
    const { fetchImpl, calls } = jsonFetch({});
    const result = await matchSanctions(
      { apiKey: '', scoreThreshold: 0.7 },
      { name: 'John Doe' },
      { fetchImpl },
    );
    expect(result).toEqual({ score: 0, matched: false, skipped: true });
    expect(calls.length).toBe(0);
  });
});
