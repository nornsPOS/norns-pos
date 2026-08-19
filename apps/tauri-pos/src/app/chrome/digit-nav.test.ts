/**
 * digit-nav — the pure decision behind number-key navigation.
 *
 * The rail shows 1–8 but the keys were never bound (UX-REDESIGN §1 gap 2).
 * This resolver decides whether a keypress should jump to a primary surface,
 * and — critically — when it MUST NOT (so typing "3" into a price field or
 * while a dialog is open never navigates).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ZIFFERN_WARTEZEIT_MS,
  type DigitNavSurface,
  erstelleZifferSchleuse,
  resolveDigitNavPath,
} from './digit-nav.js';

const SURFACES: readonly DigitNavSurface[] = [
  { digit: 1, path: '/verkauf' },
  { digit: 2, path: '/ankauf' },
  { digit: 3, path: '/kasse' },
  { digit: 4, path: '/lager' },
  { digit: 8, path: '/schreiben' },
];

const NEUTRAL = { hasModifier: false, isTextEntry: false, isDialogOpen: false } as const;

describe('resolveDigitNavPath', () => {
  it('jumps to the surface whose digit matches, from neutral focus', () => {
    expect(resolveDigitNavPath({ key: '3', ...NEUTRAL }, SURFACES)).toBe('/kasse');
    expect(resolveDigitNavPath({ key: '1', ...NEUTRAL }, SURFACES)).toBe('/verkauf');
    expect(resolveDigitNavPath({ key: '8', ...NEUTRAL }, SURFACES)).toBe('/schreiben');
  });

  it('is suppressed while a text-entry element is focused (typing a number into a field)', () => {
    expect(
      resolveDigitNavPath(
        { key: '3', hasModifier: false, isTextEntry: true, isDialogOpen: false },
        SURFACES,
      ),
    ).toBeNull();
  });

  it('is suppressed while a dialog / Spotlight is open', () => {
    expect(
      resolveDigitNavPath(
        { key: '3', hasModifier: false, isTextEntry: false, isDialogOpen: true },
        SURFACES,
      ),
    ).toBeNull();
  });

  it('does not hijack modifier combos (Cmd/Ctrl/Alt + digit)', () => {
    expect(
      resolveDigitNavPath(
        { key: '3', hasModifier: true, isTextEntry: false, isDialogOpen: false },
        SURFACES,
      ),
    ).toBeNull();
  });

  it('returns null for non-digit keys, 0, and digits without a surface', () => {
    expect(resolveDigitNavPath({ key: 'a', ...NEUTRAL }, SURFACES)).toBeNull();
    expect(resolveDigitNavPath({ key: '0', ...NEUTRAL }, SURFACES)).toBeNull();
    expect(resolveDigitNavPath({ key: '9', ...NEUTRAL }, SURFACES)).toBeNull(); // no surface at 9
    expect(resolveDigitNavPath({ key: 'Enter', ...NEUTRAL }, SURFACES)).toBeNull();
  });
});

describe('die Schleuse vor dem Flächenwechsel', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function schleuseMitProtokoll(): { gesprungen: string[]; schleuse: ReturnType<typeof erstelleZifferSchleuse> } {
    const gesprungen: string[] = [];
    const schleuse = erstelleZifferSchleuse({
      primarySurfaces: SURFACES,
      navigate: (p) => gesprungen.push(p),
    });
    return { gesprungen, schleuse };
  }

  it('springt fuer die einzelne Taste eines Menschen', () => {
    const { gesprungen, schleuse } = schleuseMitProtokoll();
    expect(schleuse.taste({ key: '3', ...NEUTRAL })).toBe(true);
    // Noch nicht: die Frist laeuft.
    expect(gesprungen).toEqual([]);
    vi.advanceTimersByTime(ZIFFERN_WARTEZEIT_MS);
    expect(gesprungen).toEqual(['/kasse']);
  });

  it('BLEIBT STEHEN, wenn der Handscanner eine EAN tippt', () => {
    // Genau der Fall vom 25.07.2026: der Inhaber steht auf /lager, kein Feld
    // im Fokus, und scannt. Vorher wechselte die Kasse hier neunmal die
    // Flaeche und verlor den Scan.
    const { gesprungen, schleuse } = schleuseMitProtokoll();
    for (const zeichen of '4001234567890') {
      schleuse.taste({ key: zeichen, ...NEUTRAL });
      // Der Scanner tippt ein Zeichen je ~16 ms.
      vi.advanceTimersByTime(16);
    }
    schleuse.taste({ key: 'Enter', ...NEUTRAL });
    vi.advanceTimersByTime(1000);
    expect(gesprungen).toEqual([]);
  });

  it('verwirft den anstehenden Sprung auch bei einer Nicht-Ziffer', () => {
    // Ein Scan kann mit einem Buchstaben weitergehen („MZ-0042"). Auch dann
    // darf die vorangegangene Ziffer nicht doch noch springen.
    const { gesprungen, schleuse } = schleuseMitProtokoll();
    schleuse.taste({ key: '4', ...NEUTRAL });
    vi.advanceTimersByTime(16);
    expect(schleuse.taste({ key: 'M', ...NEUTRAL })).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(gesprungen).toEqual([]);
  });

  it('zwei bewusste Tastendruecke eines Menschen springen beide', () => {
    const { gesprungen, schleuse } = schleuseMitProtokoll();
    schleuse.taste({ key: '1', ...NEUTRAL });
    vi.advanceTimersByTime(400); // Mensch: 100 bis 300 ms je Anschlag
    schleuse.taste({ key: '4', ...NEUTRAL });
    vi.advanceTimersByTime(400);
    expect(gesprungen).toEqual(['/verkauf', '/lager']);
  });

  it('abbrechen() laesst nichts nachtraeglich springen', () => {
    const { gesprungen, schleuse } = schleuseMitProtokoll();
    schleuse.taste({ key: '3', ...NEUTRAL });
    schleuse.abbrechen();
    vi.advanceTimersByTime(1000);
    expect(gesprungen).toEqual([]);
  });
});
