/**
 * Step-up auth — formerly the external `wrapWithStepUp` decorator
 * (memory.md #76 in the legacy salon project; ADR-0022 in Warehouse14 for
 * the PIN step-up policy). Now lives inside the middleware chain as the
 * OUTERMOST layer in production.
 *
 * Contract:
 *   1. Reacts only to ApiError with code === 'STEP_UP_REQUIRED'. Every
 *      other error passes through untouched.
 *   2. Calls deps.requestStepUp(reason) which is expected to resolve with a
 *      step-up token (after PIN modal completion) or reject if the user
 *      cancels. A rejection is propagated to the caller AS-IS — the UI
 *      knows best how to phrase "you cancelled".
 *   3. Replays the original request EXACTLY ONCE with the token header set.
 *      If the replay also returns STEP_UP_REQUIRED, we do NOT re-prompt —
 *      we throw. The UX must explicitly retry by re-issuing the action.
 *   4. Honors `meta.custom.skipStepUp === true` for callers like the
 *      session probe that must distinguish "no session" from "session
 *      needs PIN" (and for the Phase 3 offline-queue replay loop, which
 *      runs in the background where no modal can open).
 */

import { ApiError } from '../errors.js';
import type {
  HttpMethod,
  Middleware,
  MiddlewareRequest,
  MiddlewareResponse,
} from '../middleware.js';

export interface StepUpReason {
  readonly traceId: string;
  readonly method: HttpMethod;
  readonly path: string;
  readonly details: unknown;
}

export interface StepUpToken {
  readonly value: string;
  /** Defaults to `x-step-up-token`. */
  readonly headerName?: string;
}

export interface StepUpDependencies {
  requestStepUp(reason: StepUpReason): Promise<StepUpToken>;
}

const DEFAULT_HEADER = 'x-step-up-token';

function isStepUpRequired(err: unknown): err is ApiError {
  return err instanceof ApiError && err.code === 'STEP_UP_REQUIRED';
}

export function stepUpMiddleware(deps: StepUpDependencies): Middleware {
  return async (req, next): Promise<MiddlewareResponse> => {
    try {
      return await next(req);
    } catch (err) {
      if (!isStepUpRequired(err)) throw err;
      if (req.meta.custom?.skipStepUp === true) throw err;
      if (req.meta.custom?.stepUpReplay === true) throw err;

      const token = await deps.requestStepUp({
        traceId: req.meta.traceId ?? '',
        method: req.method,
        path: req.path,
        details: err.details,
      });

      const headerName = (token.headerName ?? DEFAULT_HEADER).toLowerCase();
      const replay: MiddlewareRequest = {
        ...req,
        headers: { ...req.headers, [headerName]: token.value },
        meta: {
          ...req.meta,
          attempt: 1,
          custom: { ...(req.meta.custom ?? {}), stepUpReplay: true },
        },
      };
      return next(replay);
    }
  };
}
