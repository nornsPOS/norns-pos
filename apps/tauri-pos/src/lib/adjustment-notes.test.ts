import { describe, expect, it } from 'vitest';

import {
  MIN_ADJUSTMENT_NOTE_LEN,
  adjustmentNoteShortfall,
  isAdjustmentNoteValid,
} from './adjustment-notes.js';

describe('inventory-adjustment note validity (the audit reason — ≥8 trimmed chars)', () => {
  it('rejects empty / whitespace-only', () => {
    expect(isAdjustmentNoteValid('')).toBe(false);
    expect(isAdjustmentNoteValid('       ')).toBe(false);
  });

  it('rejects fewer than the minimum (trimmed)', () => {
    expect(isAdjustmentNoteValid('kaputt')).toBe(false); // 6 chars
    expect(isAdjustmentNoteValid('  abcdefg  ')).toBe(false); // trims to 7
  });

  it('accepts exactly the minimum (8 trimmed chars)', () => {
    expect(isAdjustmentNoteValid('Bruchgut')).toBe(true); // 8
    expect(isAdjustmentNoteValid('  Bruchgut  ')).toBe(true);
  });

  it('accepts a real audit reason', () => {
    expect(isAdjustmentNoteValid('Bei der Inventur als beschädigt erfasst')).toBe(true);
  });

  it('shortfall counts the characters still needed (0 once valid)', () => {
    expect(adjustmentNoteShortfall('')).toBe(8);
    expect(adjustmentNoteShortfall('kaputt')).toBe(2);
    expect(adjustmentNoteShortfall(' abcdefg ')).toBe(1);
    expect(adjustmentNoteShortfall('Bruchgut')).toBe(0);
    expect(adjustmentNoteShortfall('Bruchgut hier')).toBe(0);
  });

  it('exposes the minimum as a constant (8)', () => {
    expect(MIN_ADJUSTMENT_NOTE_LEN).toBe(8);
  });
});
