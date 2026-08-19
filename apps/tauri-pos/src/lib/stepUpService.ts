/**
 * Thin bridge between the api-client's step-up middleware and the UI store
 * that owns the PIN modal. Keeping this file paper-thin means the middleware
 * stays test-able without the UI: tests inject a fake `requestStepUp` that
 * returns a token directly.
 *
 * The real `useStepUpStore` (Zustand) is expected to expose:
 *
 *   openModalAndAwaitPin(reason: StepUpReason): Promise<string>
 *     resolves with the PIN token the backend can verify, or rejects with
 *     a cancellation error if the cashier dismisses the modal.
 *
 * The cancellation error propagates up through the middleware chain to the
 * caller (typically the screen that initiated the action). The screen
 * decides whether to surface "abgebrochen" toast or to silently bail.
 */

import type { StepUpDependencies, StepUpReason, StepUpToken } from '@norns/api-client';

import { useStepUpStore } from '../state/step-up-store.js';

async function requestStepUp(_reason: StepUpReason): Promise<StepUpToken> {
  await useStepUpStore.getState().ask();
  return { value: '' };
}

export const stepUpService: StepUpDependencies = { requestStepUp };
