/**
 * Sheet — proves the right slide-over inherits the SAME a11y core as Dialog:
 * aria-modal, focus moves in + restores to the trigger, ESC closes.
 */
import { useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DialogBody } from './Dialog.js';
import { Sheet } from './Sheet.js';

function Harness(): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button type="button" onClick={() => setOpen(true)}>
        open-sheet
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Produkt">
        <DialogBody>
          <button type="button">inside</button>
        </DialogBody>
      </Sheet>
    </div>
  );
}

describe('Sheet shares the modal a11y core', () => {
  it('is an aria-modal dialog, traps then restores focus, and ESC closes', () => {
    render(<Harness />);
    const trigger = screen.getByText('open-sheet');
    trigger.focus();
    fireEvent.click(trigger);

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});
