/**
 * adjustment-notes — the inventory-adjustment note validity rule, extracted from
 * InventoryAdjustmentDialog so it is unit-testable and stays in lock-step with
 * the live inline feedback.
 *
 * The note is the AUDIT reason for the adjustment (every adjustment writes
 * audit_log). This client check is a UX gate only — the server re-enforces; we
 * do NOT weaken the audit requirement. No money-math here.
 */

/** Minimum trimmed length for a valid adjustment note. */
export const MIN_ADJUSTMENT_NOTE_LEN = 8;

/** True when the note meets the minimum trimmed length. */
export function isAdjustmentNoteValid(notes: string): boolean {
  return notes.trim().length >= MIN_ADJUSTMENT_NOTE_LEN;
}

/** Characters still required before the note becomes valid (0 once valid). */
export function adjustmentNoteShortfall(notes: string): number {
  return Math.max(0, MIN_ADJUSTMENT_NOTE_LEN - notes.trim().length);
}
