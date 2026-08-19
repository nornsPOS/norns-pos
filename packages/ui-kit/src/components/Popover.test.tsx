/**
 * Popover — anchored, non-modal overlay for the metal-ticker detail.
 * Behaviour-level (P0 bar): opens, moves focus in, ESC closes + restores focus
 * to the trigger, and a click outside (not the anchor) closes it. Positioning
 * is visual (jsdom has no layout) so it is not asserted here.
 */
import { useRef, useState } from 'react';

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Popover } from './Popover.js';

function Harness(): JSX.Element {
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button ref={anchor} type="button" onClick={() => setOpen(true)}>
        open
      </button>
      <button type="button">outside</button>
      <Popover open={open} anchorRef={anchor} onClose={() => setOpen(false)} ariaLabel="Detail">
        <button type="button">inside</button>
      </Popover>
    </div>
  );
}

describe('Popover', () => {
  it('opens, moves focus in, ESC closes + restores focus to the trigger', () => {
    render(<Harness />);
    const trigger = screen.getByText('open');
    trigger.focus();
    fireEvent.click(trigger);

    const pop = screen.getByRole('dialog');
    expect(pop).toHaveAttribute('aria-label', 'Detail');
    expect(pop.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on a mousedown outside the popover and the anchor', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('open'));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByText('outside'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
