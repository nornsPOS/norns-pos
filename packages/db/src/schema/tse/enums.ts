/**
 * TSE state machine enum.
 *
 * Created in migration 0010_tse.sql. Terminal states: FINISHED, CANCELLED, FAILED.
 *
 * Transitions (enforced by trigger):
 *   QUEUED_OFFLINE → ACTIVE | FINISHED | FAILED
 *   ACTIVE         → FINISHED | CANCELLED | FAILED
 *   (terminal)     → (same state only)
 */

import { pgEnum } from 'drizzle-orm/pg-core';

export const tseState = pgEnum('tse_state', [
  'QUEUED_OFFLINE',
  'ACTIVE',
  'FINISHED',
  'CANCELLED',
  'FAILED',
]);
