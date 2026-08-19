/**
 * Sparkline — pure compact SVG line for the metal-ticker detail popover.
 * Proves it renders one point per value and degrades safely for <2 points.
 */
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Sparkline } from './Sparkline.js';

describe('Sparkline', () => {
  it('renders an svg polyline with one point per value + an aria-label', () => {
    const { container } = render(<Sparkline values={[1, 3, 2, 5]} ariaLabel="Verlauf" />);
    const poly = container.querySelector('polyline');
    expect(poly).not.toBeNull();
    const points = (poly?.getAttribute('points') ?? '').trim().split(/\s+/);
    expect(points.length).toBe(4);
    expect(container.querySelector('svg')?.getAttribute('aria-label')).toBe('Verlauf');
  });

  it('renders no polyline for fewer than 2 points (no crash)', () => {
    const { container } = render(<Sparkline values={[]} ariaLabel="leer" />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});
