/**
 * Schnell getippte Ziffern duerfen nicht verlorengehen.
 *
 * ── DER FUND VOM 04.08.2026 ────────────────────────────────────────────────
 *
 * Beim Anmelden am Pruefstand fielen von sechs Tastendruecken FUENF unter den
 * Tisch. Am Ende stand ein Punkt im Feld, und „OK" blieb grau.
 *
 * ⚠️ Die Ursache ist keine Eigenheit des Pruefstands:
 *
 *     const onDigit = (d) => { if (value.length < pinLength) onChange(value + d); };
 *
 * `value` kommt von aussen und ist der Stand des LETZTEN Zeichnens. Kommen
 * zwei Druecke im selben Takt an, rechnen beide mit demselben alten Wert, und
 * der zweite ueberschreibt den ersten. React fasst Zustandsaenderungen
 * innerhalb eines Takts zusammen; wer schnell tippt, verliert Ziffern.
 *
 * Am Tresen ist das kein Randfall. Der Kassencode hat sechs bis zwoelf
 * Ziffern, der Kassierer tippt ihn jeden Morgen und nach jeder Sperre, und er
 * tippt ihn schnell, weil er ihn auswendig kann. Ein verschluckter Anschlag
 * heisst: der Code ist falsch, der Fehlversuchszaehler steigt, und nach fuenf
 * davon steht der Laden.
 *
 * Derselbe Block traegt vier Flaechen: Anmeldung, Geraetesperre, Stufenabfrage
 * und die Sperre der Inhaber-App.
 *
 * ── WAS DIESER WAECHTER FESTHAELT ──────────────────────────────────────────
 *
 * Mehrere Druecke im SELBEN Takt kommen alle an, in der richtigen Reihenfolge.
 * Und die Laengengrenze haelt trotzdem.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';

import { PinPad } from './PinPad.js';

/** Ein Feld, das seinen Wert genau so haelt wie die Anmeldung es tut. */
function Pruefstand({ pinLength = 12 }: { pinLength?: number }): JSX.Element {
  const [wert, setWert] = useState('');
  return (
    <div>
      <output data-testid="wert">{wert}</output>
      <PinPad value={wert} onChange={setWert} onSubmit={() => {}} pinLength={pinLength} />
    </div>
  );
}

/** Alle Druecke OHNE Takt dazwischen, so wie eine schnelle Hand sie abgibt. */
function tippeSchnell(ziffern: string): void {
  for (const z of ziffern) fireEvent.click(screen.getByRole('button', { name: z }));
}

describe('Die Zifferntafel unter schnellen Fingern', () => {
  it('⛔ sechs Druecke im selben Takt ergeben sechs Ziffern', () => {
    render(<Pruefstand />);
    tippeSchnell('481596');
    expect(screen.getByTestId('wert').textContent).toBe('481596');
  });

  it('⛔ die Reihenfolge bleibt, sonst ist der Code ein anderer', () => {
    render(<Pruefstand />);
    tippeSchnell('900731');
    expect(screen.getByTestId('wert').textContent).toBe('900731');
  });

  it('die Laengengrenze haelt auch bei schnellen Fingern', () => {
    // Sonst waere die Heilung schlimmer als der Fehler: ein Code, der ueber
    // die Grenze waechst, wird vom Server abgewiesen, und der Kassierer sieht
    // nur „falsch".
    render(<Pruefstand pinLength={6} />);
    tippeSchnell('1234567890');
    expect(screen.getByTestId('wert').textContent).toBe('123456');
  });

  it('⛔ SECHS Druecke in EINEM Buendel ergeben sechs Ziffern', () => {
    // ── DER EIGENTLICHE SATZ ───────────────────────────────────────────────
    //
    // Die Saetze darueber waren schon GRUEN, bevor irgendetwas geaendert
    // wurde: `fireEvent.click` leert den Zustand nach JEDEM Druck, also sieht
    // jeder Druck den neuen Wert. Sie messen die Buchhaltung, nicht das
    // Buendel.
    //
    // Hier landen alle sechs Druecke in EINEM `act`, also in EINEM Takt. Ohne
    // den Zeiger in `PinPad` rechnen alle sechs mit dem leeren Anfangswert,
    // und uebrig bleibt die letzte Ziffer: „6". Genau so gemessen.
    render(<Pruefstand />);
    act(() => {
      for (const z of '481596') {
        screen
          .getByRole('button', { name: z })
          .dispatchEvent(new MouseEvent('click', { bubbles: true }));
      }
    });
    expect(screen.getByTestId('wert').textContent).toBe('481596');
  });

  it('das Loeschen zaehlt im selben Takt genauso', () => {
    render(<Pruefstand />);
    tippeSchnell('4815');
    const zurueck = screen.getByRole('button', { name: 'Zurück' });
    fireEvent.click(zurueck);
    fireEvent.click(zurueck);
    expect(screen.getByTestId('wert').textContent).toBe('48');
  });
});
