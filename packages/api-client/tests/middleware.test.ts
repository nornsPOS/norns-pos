import { describe, expect, it, vi } from 'vitest';

import { ApiCircuitOpenError, ApiError, ApiNetworkError } from '../src/errors.js';
import type { MiddlewareRequest, MiddlewareResponse, Next } from '../src/middleware.js';
import { compose } from '../src/middleware.js';
import { circuitBreakerMiddleware } from '../src/middleware/circuit.js';
import { inflightDedupMiddleware } from '../src/middleware/dedup.js';
import { retryMiddleware } from '../src/middleware/retry.js';
import type { StepUpToken } from '../src/middleware/step-up.js';
import { stepUpMiddleware } from '../src/middleware/step-up.js';
import type { TelemetrySink } from '../src/middleware/telemetry.js';
import { telemetryMiddleware } from '../src/middleware/telemetry.js';

// Helper to create a base mock request
function createMockRequest(overrides: Partial<MiddlewareRequest> = {}): MiddlewareRequest {
  const controller = new AbortController();
  return {
    method: 'GET',
    url: 'http://localhost/api/test',
    path: '/api/test',
    headers: {},
    body: undefined,
    signal: controller.signal,
    meta: {
      attempt: 1,
      startedAt: Date.now(),
      custom: {},
    },
    ...overrides,
  };
}

// Helper to create a basic mock response
function createMockResponse(overrides: Partial<MiddlewareResponse> = {}): MiddlewareResponse {
  return {
    data: { ok: true },
    status: 200,
    headers: new Headers(),
    requestId: 'req_123',
    traceId: 'trace_123',
    ...overrides,
  };
}

describe('stepUpMiddleware', () => {
  it('passes normal responses through untouched', async () => {
    const requestStepUp = vi.fn().mockResolvedValue({ value: 'token123' });
    const mw = stepUpMiddleware({ requestStepUp });
    const req = createMockRequest();
    const res = createMockResponse();
    const next: Next = vi.fn().mockResolvedValue(res);

    const actual = await mw(req, next);
    expect(actual).toBe(res);
    expect(requestStepUp).not.toHaveBeenCalled();
  });

  it('prompts for step-up and replays once on STEP_UP_REQUIRED', async () => {
    const requestStepUp = vi.fn().mockResolvedValue({ value: 'token123' } as StepUpToken);
    const mw = stepUpMiddleware({ requestStepUp });
    const req = createMockRequest();
    const res = createMockResponse();

    let attempts = 0;
    const next: Next = vi.fn().mockImplementation(async (_r) => {
      attempts++;
      if (attempts === 1) {
        throw new ApiError({
          code: 'STEP_UP_REQUIRED',
          message: 'Step up needed',
          httpStatus: 403,
          requestId: 'req_err',
        });
      }
      return res;
    });

    const actual = await mw(req, next);
    expect(actual).toBe(res);
    expect(requestStepUp).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(2);

    // Verify replay request has token header and custom replay flag
    const replayReq = next.mock.calls[1][0] as MiddlewareRequest;
    expect(replayReq.headers['x-step-up-token']).toBe('token123');
    expect(replayReq.meta.custom?.stepUpReplay).toBe(true);
  });

  it('does not replay and throws if stepUpReplay is already true', async () => {
    const requestStepUp = vi.fn().mockResolvedValue({ value: 'token123' });
    const mw = stepUpMiddleware({ requestStepUp });
    const req = createMockRequest({
      meta: {
        attempt: 1,
        startedAt: Date.now(),
        custom: { stepUpReplay: true },
      },
    });

    const next: Next = vi.fn().mockRejectedValue(
      new ApiError({
        code: 'STEP_UP_REQUIRED',
        message: 'Step up still needed',
        httpStatus: 403,
        requestId: 'req_err',
      }),
    );

    await expect(mw(req, next)).rejects.toThrow(ApiError);
    expect(requestStepUp).not.toHaveBeenCalled();
  });
});

describe('retryMiddleware', () => {
  it('retries on retryable errors and backs off', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const mw = retryMiddleware({
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 100,
      sleep,
    });
    const req = createMockRequest();
    const res = createMockResponse();

    let calls = 0;
    const next: Next = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) {
        throw new ApiNetworkError('Network lost');
      }
      return res;
    });

    const actual = await mw(req, next);
    expect(actual).toBe(res);
    expect(calls).toBe(3);
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('fails immediately on non-retryable errors like validation', async () => {
    const sleep = vi.fn();
    const mw = retryMiddleware({ sleep });
    const req = createMockRequest();
    const next: Next = vi.fn().mockRejectedValue(
      new ApiError({
        code: 'VALIDATION_ERROR',
        message: 'Bad input',
        httpStatus: 400,
        requestId: 'req_1',
      }),
    );

    await expect(mw(req, next)).rejects.toThrow(ApiError);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('does not retry mutations unless explicitly marked idempotent', async () => {
    const sleep = vi.fn();
    const mw = retryMiddleware({ sleep });
    const req = createMockRequest({ method: 'POST' });
    const next: Next = vi.fn().mockRejectedValue(new ApiNetworkError('Failed'));

    await expect(mw(req, next)).rejects.toThrow(ApiNetworkError);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('retries POST if custom.idempotent is true', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const mw = retryMiddleware({ sleep });
    const req = createMockRequest({
      method: 'POST',
      meta: {
        attempt: 1,
        startedAt: Date.now(),
        custom: { idempotent: true },
      },
    });
    const res = createMockResponse();

    let calls = 0;
    const next: Next = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls === 1) throw new ApiNetworkError('Failed');
      return res;
    });

    const actual = await mw(req, next);
    expect(actual).toBe(res);
    expect(sleep).toHaveBeenCalledTimes(1);
  });
});

describe('circuitBreakerMiddleware', () => {
  it('passes requests in closed state, opens on failures, and raises CircuitOpen', async () => {
    const nowMock = vi.fn().mockReturnValue(1000);
    const mw = circuitBreakerMiddleware({
      threshold: 2,
      cooldownMs: 5000,
      now: nowMock,
    });
    const req = createMockRequest();
    const nextSuccess: Next = vi.fn().mockResolvedValue(createMockResponse());
    const nextFailure: Next = vi.fn().mockRejectedValue(new ApiNetworkError('Fail'));

    // First failure
    await expect(mw(req, nextFailure)).rejects.toThrow(ApiNetworkError);
    // Second failure - triggers open
    await expect(mw(req, nextFailure)).rejects.toThrow(ApiNetworkError);

    // Third request - immediately rejected with ApiCircuitOpenError
    await expect(mw(req, nextSuccess)).rejects.toThrow(ApiCircuitOpenError);

    // Advance time past cooldown
    nowMock.mockReturnValue(7000); // 1000 + 6000
    // Successful probe request - closes breaker
    const res = await mw(req, nextSuccess);
    expect(res.status).toBe(200);

    // Subsequent request succeeds normally
    await expect(mw(req, nextSuccess)).resolves.toBe(res);
  });
});

describe('inflightDedupMiddleware', () => {
  it('coalesces concurrent GET requests and resolves them with the same promise', async () => {
    const mw = inflightDedupMiddleware();
    const req1 = createMockRequest({ path: '/api/resource' });
    const req2 = createMockRequest({ path: '/api/resource' });

    let calls = 0;
    const next: Next = vi.fn().mockImplementation(async () => {
      calls++;
      // Simulate delay
      await new Promise((r) => setTimeout(r, 20));
      return createMockResponse({ data: { calls } });
    });

    const [res1, res2] = await Promise.all([mw(req1, next), mw(req2, next)]);

    expect(calls).toBe(1);
    expect((res1.data as { calls: number }).calls).toBe(1);
    expect((res2.data as { calls: number }).calls).toBe(1);
  });

  it('does not coalesce POST requests', async () => {
    const mw = inflightDedupMiddleware();
    const req1 = createMockRequest({ method: 'POST', path: '/api/resource' });
    const req2 = createMockRequest({ method: 'POST', path: '/api/resource' });

    let calls = 0;
    const next: Next = vi.fn().mockImplementation(async () => {
      calls++;
      return createMockResponse({ data: { calls } });
    });

    const res1 = await mw(req1, next);
    const res2 = await mw(req2, next);

    expect(calls).toBe(2);
    expect((res1.data as { calls: number }).calls).toBe(1);
    expect((res2.data as { calls: number }).calls).toBe(2);
  });
});

describe('telemetryMiddleware', () => {
  it('fires events to telemetry sink', async () => {
    const sink: TelemetrySink = {
      onStart: vi.fn(),
      onSuccess: vi.fn(),
      onError: vi.fn(),
    };
    const mw = telemetryMiddleware({ sink });
    const req = createMockRequest({ meta: { attempt: 1, startedAt: Date.now() } });
    const res = createMockResponse();
    const next: Next = vi.fn().mockResolvedValue(res);

    await mw(req, next);

    expect(sink.onStart).toHaveBeenCalledTimes(1);
    expect(sink.onSuccess).toHaveBeenCalledTimes(1);
    expect(sink.onError).not.toHaveBeenCalled();

    // Verify trace ID generated and attached
    const startEvent = (sink.onStart as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[0] as { traceId: string };
    expect(startEvent.traceId).toBeTypeOf('string');
    expect(req.headers['x-client-trace-id']).toBe(startEvent.traceId);
  });

  it('fires error events on failure', async () => {
    const sink: TelemetrySink = {
      onStart: vi.fn(),
      onSuccess: vi.fn(),
      onError: vi.fn(),
    };
    const mw = telemetryMiddleware({ sink });
    const req = createMockRequest();
    const next: Next = vi.fn().mockRejectedValue(new ApiNetworkError('DNS fail'));

    await expect(mw(req, next)).rejects.toThrow(ApiNetworkError);

    expect(sink.onStart).toHaveBeenCalledTimes(1);
    expect(sink.onSuccess).not.toHaveBeenCalled();
    expect(sink.onError).toHaveBeenCalledTimes(1);

    const errEvent = (sink.onError as unknown as { mock: { calls: unknown[][] } }).mock
      .calls[0]?.[0] as { kind: string; errorMessage: string };
    expect(errEvent.kind).toBe('network');
    expect(errEvent.errorMessage).toBe('DNS fail');
  });
});

describe('onion composition (compose)', () => {
  it('executes middlewares in order of entry', async () => {
    const log: string[] = [];
    const mw1 = async (req: MiddlewareRequest, next: Next) => {
      log.push('1-in');
      const res = await next(req);
      log.push('1-out');
      return res;
    };
    const mw2 = async (req: MiddlewareRequest, next: Next) => {
      log.push('2-in');
      const res = await next(req);
      log.push('2-out');
      return res;
    };

    const terminal: Next = async () => {
      log.push('term');
      return createMockResponse();
    };

    const req = createMockRequest();
    const chain = compose([mw1, mw2], terminal);
    await chain(req);

    expect(log).toEqual(['1-in', '2-in', 'term', '2-out', '1-out']);
  });
});
