/**
 * Eine Ablehnung, die niemand sieht, ist keine Ablehnung.
 */
import { describe, expect, it, vi } from 'vitest';

import { GRUND_MINDESTLAENGE, grundAbfragen } from './grund-abfragen.js';

describe('grundAbfragen', () => {
  it('nimmt einen tragfaehigen Grund und trimmt ihn', () => {
    const melden = vi.fn();
    const grund = grundAbfragen({ frage: '?', melden, fragen: () => '  Kunde abgesprungen  ' });
    expect(grund).toBe('Kunde abgesprungen');
    expect(melden).not.toHaveBeenCalled();
  });

  it('SAGT es, wenn der Grund zu kurz ist, und fragt erneut', () => {
    // Genau der Fall vom 25.07.2026: „kk" plus OK — und die Kasse schwieg.
    const melden = vi.fn();
    const antworten = ['kk', 'Termin doppelt gebucht'];
    let i = 0;
    const grund = grundAbfragen({ frage: '?', melden, fragen: () => antworten[i++] ?? null });
    expect(grund).toBe('Termin doppelt gebucht');
    expect(melden).toHaveBeenCalledTimes(1);
    expect(melden.mock.calls[0]?.[0]).toContain(String(GRUND_MINDESTLAENGE));
  });

  it('unterscheidet den leeren Grund vom zu kurzen', () => {
    const melden = vi.fn();
    const antworten = ['   ', 'Kunde abgesprungen'];
    let i = 0;
    grundAbfragen({ frage: '?', melden, fragen: () => antworten[i++] ?? null });
    expect(melden.mock.calls[0]?.[0]).toContain('Ohne Grund');
  });

  it('Abbrechen ist eine gueltige Antwort und braucht keinen Hinweis', () => {
    const melden = vi.fn();
    expect(grundAbfragen({ frage: '?', melden, fragen: () => null })).toBeNull();
    expect(melden).not.toHaveBeenCalled();
  });

  it('haengt nicht, wenn der Mensch nach einem Fehlversuch abbricht', () => {
    const melden = vi.fn();
    const antworten: (string | null)[] = ['ab', null];
    let i = 0;
    expect(grundAbfragen({ frage: '?', melden, fragen: () => antworten[i++] ?? null })).toBeNull();
    expect(melden).toHaveBeenCalledTimes(1);
  });
});
