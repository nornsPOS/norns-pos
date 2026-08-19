/**
 * Icon + IconButton — the generic-action icon foundation (lucide-react).
 * a11y-level: the icon is decorative; the IconButton carries the accessible
 * name + the ≥44px touch target + the click. No snapshots.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { Trash2 } from 'lucide-react';
import { describe, expect, it, vi } from 'vitest';

import { Icon } from './Icon.js';
import { IconButton } from './IconButton.js';

describe('Icon', () => {
  it('renders the svg at the given size + stroke, decorative (aria-hidden)', () => {
    const { container } = render(<Icon icon={Trash2} size={24} strokeWidth={2} />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('width')).toBe('24');
    expect(svg?.getAttribute('stroke-width')).toBe('2');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('defaults to a 20px, refined-stroke icon', () => {
    const { container } = render(<Icon icon={Trash2} />);
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('width')).toBe('20');
    expect(svg?.getAttribute('stroke-width')).toBe('1.75');
  });
});

describe('IconButton', () => {
  it('is an accessible button: aria-label on the button + fires onClick', () => {
    const onClick = vi.fn();
    render(<IconButton icon={Trash2} label="Position entfernen" onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'Position entfernen' });
    expect(btn).toHaveAttribute('aria-label', 'Position entfernen');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('has a ≥44px touch target', () => {
    render(<IconButton icon={Trash2} label="Schließen" onClick={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Schließen' });
    expect(btn.style.minWidth).toBe('44px');
    expect(btn.style.minHeight).toBe('44px');
  });

  it('does not fire onClick when disabled', () => {
    const onClick = vi.fn();
    render(<IconButton icon={Trash2} label="X" onClick={onClick} disabled />);
    fireEvent.click(screen.getByRole('button', { name: 'X' }));
    expect(onClick).not.toHaveBeenCalled();
  });
});
