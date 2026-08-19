/**
 * Der Zeichen-Speicher meldet JEDE Aenderung an seine Zuhoerer, also auch eine
 * ERNEUERUNG mitten in der Schicht und nicht nur Anmeldung und Abmeldung.
 *
 * Der Fehler, den das absichert: ein Verbraucher, der nur bei Anmeldung und
 * Abmeldung nachgezogen wird, haelt nach einer Erneuerung ein totes Zeichen und
 * scheitert ab da bei jedem Aufruf. Weil `setSessionToken` die EINZIGE Stelle
 * ist, an der sich der Wert aendert, ist jeder kuenftige Erneuerungsweg von
 * selbst mitgedeckt.
 *
 * Zur Herkunft, damit niemand einem Namen nachjagt, den es nicht gibt: dieser
 * Test entstand fuer `companion_set_auth`, einen Tauri-Befehl des
 * Begleiter-Knotens. Der ist seit dem 22.06.2026 GELOESCHT (Einchecken
 * `c6bd85f`), siehe `docs/companion-architecture.md`. Der Test bleibt richtig
 * und noetig, denn die Zuhoerer-Zusage traegt weiter: an HEAD lesen das Zeichen
 * `apps/tauri-pos/src/lib/api-context.tsx`, `apps/tauri-pos/src/hooks/useLedgerStream.ts`
 * und `apps/tauri-pos/src/screens/verkauf/Verkauf.tsx`, geschrieben wird es aus
 * dem Anmeldeweg um den Befehl `commands::system::start_google_login`.
 *
 * ⚠️ Befund vom 26.07.2026: `onSessionTokenChange` hat an HEAD AUSSER diesem
 * Test KEINEN Aufrufer. Die Zuhoerer-Zusage steht also unbenutzt da, seit der
 * Begleiter-Knoten weg ist. Nicht entfernt, weil sie die richtige Naht fuer den
 * naechsten Verbraucher ist, aber sie ist derzeit ungenutzt.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { onSessionTokenChange, setSessionToken } from './session-token.js';

afterEach(() => {
  // Reset the module-level cache between tests (null is a no-op if already null).
  setSessionToken(null);
});

describe('onSessionTokenChange', () => {
  it('fires on each real change (login → renewal → sign-out) with the new value', () => {
    const seen: (string | null)[] = [];
    const off = onSessionTokenChange((t) => seen.push(t));

    setSessionToken('tok-1'); // login
    setSessionToken('tok-2'); // mid-shift renewal — the path that used to be missed
    setSessionToken(null); // sign-out

    off();
    expect(seen).toEqual(['tok-1', 'tok-2', null]);
  });

  it('does NOT fire when the token is set to the same value (no spurious re-push)', () => {
    setSessionToken('tok-x');
    const fn = vi.fn();
    const off = onSessionTokenChange(fn);
    setSessionToken('tok-x'); // unchanged
    off();
    expect(fn).not.toHaveBeenCalled();
  });

  it('unsubscribe stops delivery', () => {
    const fn = vi.fn();
    const off = onSessionTokenChange(fn);
    off();
    setSessionToken('tok-y');
    expect(fn).not.toHaveBeenCalled();
  });

  it('a throwing listener never breaks the token write or other listeners', () => {
    const good = vi.fn();
    const offBad = onSessionTokenChange(() => {
      throw new Error('listener blew up');
    });
    const offGood = onSessionTokenChange(good);

    expect(() => setSessionToken('tok-z')).not.toThrow();
    expect(good).toHaveBeenCalledWith('tok-z');

    offBad();
    offGood();
  });
});
