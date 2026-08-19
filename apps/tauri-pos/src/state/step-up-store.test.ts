import { describe, expect, it } from 'vitest';

import { StepUpCancelledError, isStepUpCancelled, useStepUpStore } from './step-up-store.js';

describe('step-up-store — cancel semantics', () => {
  it('cancel() rejects the pending ask() with a StepUpCancelledError', async () => {
    const pending = useStepUpStore.getState().ask();
    useStepUpStore.getState().cancel();
    await expect(pending).rejects.toBeInstanceOf(StepUpCancelledError);
    // The store is reset so a subsequent ask() is not blocked.
    expect(useStepUpStore.getState().request).toBeNull();
    expect(useStepUpStore.getState().active).toBe(false);
  });

  it('complete() resolves the pending ask()', async () => {
    const pending = useStepUpStore.getState().ask();
    useStepUpStore.getState().complete();
    await expect(pending).resolves.toBeUndefined();
  });

  it('isStepUpCancelled recognises ONLY the cancel error', () => {
    expect(isStepUpCancelled(new StepUpCancelledError())).toBe(true);
    // A generic Error, an ApiError-shaped code string, or nullish must NOT count —
    // otherwise a real failure would be silently downgraded to "abgebrochen".
    expect(isStepUpCancelled(new Error('boom'))).toBe(false);
    expect(isStepUpCancelled('STEP_UP_REQUIRED')).toBe(false);
    expect(isStepUpCancelled(null)).toBe(false);
    expect(isStepUpCancelled(undefined)).toBe(false);
  });
});
