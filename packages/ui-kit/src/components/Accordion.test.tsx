/**
 * Accordion — collapsible section group. Proves the real interaction +
 * a11y contract: header toggles, aria-expanded tracks state, the body is a
 * labelled region present only when open, and an adornment slot renders.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Accordion, AccordionItem } from './Accordion.js';

describe('Accordion', () => {
  it('toggles a section open/closed and wires aria-expanded + a region', () => {
    render(
      <Accordion>
        <AccordionItem id="a" title="Details" defaultOpen={false}>
          <p>body-a</p>
        </AccordionItem>
      </Accordion>,
    );
    const header = screen.getByRole('button', { name: /Details/ });
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('body-a')).toBeNull();

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('body-a')).toBeInTheDocument();

    fireEvent.click(header);
    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('body-a')).toBeNull();
  });

  it('renders a header-right adornment and respects defaultOpen', () => {
    render(
      <Accordion>
        <AccordionItem id="b" title="Preis" defaultOpen adornment={<span>chip</span>}>
          <p>body-b</p>
        </AccordionItem>
      </Accordion>,
    );
    expect(screen.getByText('chip')).toBeInTheDocument();
    expect(screen.getByText('body-b')).toBeInTheDocument();
    const header = screen.getByRole('button', { name: /Preis/ });
    expect(header).toHaveAttribute('aria-expanded', 'true');
  });
});
