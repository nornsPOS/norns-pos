/**
 * Field — proves the real form-accessibility contract: the inline error is
 * shown, linked to the control via aria-describedby, and the control is
 * marked aria-invalid. Hints are linked too. No snapshots.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Field } from './Field.js';
import { Input } from './Input.js';

describe('Field', () => {
  it('links a visible error to the control via aria-describedby and sets aria-invalid', () => {
    render(
      <Field label="Grund" error="Mindestens 3 Zeichen">
        <Input defaultValue="ab" />
      </Field>,
    );

    const input = screen.getByLabelText('Grund');
    expect(input).toHaveAttribute('aria-invalid', 'true');

    const describedby = input.getAttribute('aria-describedby');
    expect(describedby).toBeTruthy();
    // the error text must be findable AND be the element referenced by id.
    const errorEl = screen.getByText('Mindestens 3 Zeichen');
    expect(describedby?.split(' ')).toContain(errorEl.id);
    expect(errorEl).toHaveAttribute('role', 'alert');
  });

  it('links a hint via aria-describedby and does NOT set aria-invalid when there is no error', () => {
    render(
      <Field label="Betrag" hint="In Euro, z. B. 12,50">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Betrag');
    expect(input).not.toHaveAttribute('aria-invalid', 'true');

    const describedby = input.getAttribute('aria-describedby');
    const hintEl = screen.getByText('In Euro, z. B. 12,50');
    expect(describedby?.split(' ')).toContain(hintEl.id);
  });

  it('associates the label with the control (clicking the label focuses it)', () => {
    render(
      <Field label="Notiz">
        <Input />
      </Field>,
    );
    const input = screen.getByLabelText('Notiz');
    // getByLabelText only resolves when the <label for> / id wiring is correct.
    expect(input.tagName).toBe('INPUT');
  });
});
