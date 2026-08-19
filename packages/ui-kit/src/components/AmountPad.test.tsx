/**
 * AmountPad — on-screen numeric keypad for POS amount entry. The pure input
 * reducer is TDD'd here (append/decimal/cap/backspace/clear/set); the component
 * is a thin view over it that emits a canonical dot-decimal via onChange.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { AmountPad, amountPadReduce } from './AmountPad.js';

const digit = (d: string) => ({ type: 'digit', digit: d }) as const;

describe('amountPadReduce', () => {
  it('integer entry + leading-zero replacement', () => {
    expect(amountPadReduce('', digit('1'))).toBe('1');
    expect(amountPadReduce('1', digit('2'))).toBe('12');
    expect(amountPadReduce('0', digit('5'))).toBe('5');
    expect(amountPadReduce('', digit('0'))).toBe('0');
  });

  it('single decimal; empty + decimal → "0,"', () => {
    expect(amountPadReduce('12', { type: 'decimal' })).toBe('12,');
    expect(amountPadReduce('', { type: 'decimal' })).toBe('0,');
    expect(amountPadReduce('12,', { type: 'decimal' })).toBe('12,'); // ignore 2nd
  });

  it('caps at 2 fraction digits', () => {
    expect(amountPadReduce('12,', digit('5'))).toBe('12,5');
    expect(amountPadReduce('12,5', digit('0'))).toBe('12,50');
    expect(amountPadReduce('12,50', digit('9'))).toBe('12,50'); // cap reached
  });

  it('backspace to empty + clear', () => {
    expect(amountPadReduce('12,5', { type: 'backspace' })).toBe('12,');
    expect(amountPadReduce('1', { type: 'backspace' })).toBe('');
    expect(amountPadReduce('', { type: 'backspace' })).toBe('');
    expect(amountPadReduce('12,50', { type: 'clear' })).toBe('');
  });

  it('set (Passend / note) formats to German 2dp', () => {
    expect(amountPadReduce('', { type: 'set', value: '12.50' })).toBe('12,50');
    expect(amountPadReduce('5', { type: 'set', value: '5' })).toBe('5,00');
    expect(amountPadReduce('', { type: 'set', value: '200' })).toBe('200,00');
  });
});

describe('AmountPad (view)', () => {
  it('renders digit keys 0–9 + a labelled backspace, ≥56px, and fires canonical onChange', () => {
    const onChange = vi.fn();
    render(<AmountPad value="" onChange={onChange} dueEur="12.50" />);
    for (let d = 0; d <= 9; d++) {
      expect(screen.getByRole('button', { name: String(d) })).toBeInTheDocument();
    }
    const five = screen.getByRole('button', { name: '5' });
    expect(Number.parseInt(five.style.minHeight, 10)).toBeGreaterThanOrEqual(56);
    fireEvent.click(five);
    expect(onChange).toHaveBeenCalledWith('5');
    expect(screen.getByRole('button', { name: /löschen/i })).toBeInTheDocument();
  });

  it('Passend sets the exact due total (canonical)', () => {
    const onChange = vi.fn();
    render(<AmountPad value="" onChange={onChange} dueEur="12.50" />);
    fireEvent.click(screen.getByRole('button', { name: /Passend/ }));
    expect(onChange).toHaveBeenCalledWith('12.50');
  });
});
