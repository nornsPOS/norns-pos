/**
 * step-up-store — bridge between the API client interceptor and the
 * <StepUpModal/> component.
 *
 * When the interceptor encounters `STEP_UP_REQUIRED`, it:
 *   1. calls `request()` → returns a Promise that resolves on PIN success
 *      or rejects when the operator cancels.
 *   2. The store toggles `active = true` and remembers the resolver.
 *   3. The modal renders, the operator types PIN, the modal calls
 *      `complete()` on success or `cancel()` on Esc.
 *   4. The resolver fires; the interceptor retries the original request.
 */

import { create } from 'zustand';

/**
 * Thrown when the operator CANCELS the PIN modal (Esc / backdrop / Abbrechen).
 * It is a plain rejection, NOT an ApiError — the step-up middleware propagates
 * it to the caller AS-IS (step-up.ts only wraps `next(req)`, not requestStepUp),
 * so screens must recognise a deliberate cancel via `isStepUpCancelled(err)` and
 * report "abgebrochen", never a generic payment/network failure.
 */
export class StepUpCancelledError extends Error {
  constructor() {
    super('Step-up cancelled by operator.');
    this.name = 'StepUpCancelledError';
  }
}

/** True iff `err` is a deliberate operator cancel of the step-up PIN modal. */
export function isStepUpCancelled(err: unknown): boolean {
  return err instanceof StepUpCancelledError;
}

interface StepUpRequest {
  resolve: () => void;
  reject: (err: unknown) => void;
}

interface StepUpState {
  active: boolean;
  request: StepUpRequest | null;

  /** Called by the interceptor to ask for a PIN; returns a Promise. */
  ask: () => Promise<void>;
  /** Called by the modal on a successful POST /api/auth/step-up. */
  complete: () => void;
  /** Called by the modal on Esc or backdrop click. */
  cancel: () => void;
}

export const useStepUpStore = create<StepUpState>((set, get) => ({
  active: false,
  request: null,

  ask: () =>
    new Promise<void>((resolve, reject) => {
      // If a step-up is already pending, fail fast — the operator should
      // resolve the current modal first.
      const current = get().request;
      if (current) {
        reject(new Error('A step-up is already pending.'));
        return;
      }
      set({ active: true, request: { resolve, reject } });
    }),

  complete: () => {
    const r = get().request;
    if (r) r.resolve();
    set({ active: false, request: null });
  },

  cancel: () => {
    const r = get().request;
    if (r) r.reject(new StepUpCancelledError());
    set({ active: false, request: null });
  },
}));
