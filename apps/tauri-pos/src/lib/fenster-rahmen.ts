/**
 * fenster-rahmen — der Rahmen, den jedes handgebaute Fenster der Kasse braucht.
 *
 * DER FUND
 * Die Kasse hat neben dem sehr guten `Dialog` aus dem Baukasten noch gut zwei
 * Dutzend handgebaute Fenster nach immer demselben Muster: ein festes Feld über
 * dem ganzen Schirm, darin eine mittig gesetzte `ParchmentCard`. Gezählt am
 * Quelltext hatten acht davon WEDER eine Höhenbegrenzung NOCH einen Rollbereich.
 *
 * Warum das am Tresen weh tut: der Wurzelkasten der Anwendung steht auf
 * `height: 100dvh` und `overflow: hidden` (siehe AppShell). Nichts an dieser
 * Anwendung rollt ausser dem Inhaltsbereich. Wird eine Karte höher als der
 * Schirm, wächst sie wegen `placeItems: center` nach OBEN und nach UNTEN aus
 * dem Bild heraus, und es gibt keine Rolle, die sie zurückholt. Die Kassiererin
 * sieht dann die Mitte eines Fensters, dessen Überschrift und erste Felder
 * oberhalb der Bildkante liegen und schlicht unerreichbar sind. Auf einem
 * kleinen Tresenschirm oder bei aufgeklappter Bildschirmtastatur ist das kein
 * Randfall, sondern der Normalfall.
 *
 * Zweiter Fund: acht Fenster setzten keinen Anfangsfokus. Der Fokus blieb also
 * auf der Schaltfläche dahinter, und der erste Tabulatordruck lief nicht durch
 * das Fenster, sondern durch die Fläche darunter, die niemand sieht.
 *
 * WARUM NACHRÜSTEN UND NICHT UMBAUEN
 * Der Baukasten-`Dialog` bringt all das mit. Ihn hier einzusetzen hiesse aber,
 * Kopfzeile, Innenabstände und Untergrund jedes dieser acht Fenster neu zu
 * setzen — also acht im Einsatz stehende Bildschirme sichtbar zu verschieben,
 * um einen Fehler zu beheben, den man auch unsichtbar beheben kann. Diese Datei
 * rüstet daher genau das Fehlende nach und lässt jedes Pixel, das heute richtig
 * aussieht, an seinem Platz. Der Umbau auf den Baukasten bleibt der richtige
 * nächste Schritt, nur eben einzeln und mit Blick auf den Schirm.
 */

import { type CSSProperties, type RefObject, useEffect, useRef } from 'react';

/**
 * Die Höhe, die einer Karte im Wurzelkasten höchstens bleibt.
 *
 * Die 48 Pixel sind kein runder Wunschwert, sondern die Summe der Randabstände,
 * die diese Fenster ohnehin schon setzen: `padding: 24` oben plus 24 unten.
 * Damit steht die Karte bei kleinem Schirm exakt in ihrem eigenen Rand statt
 * darüber hinaus. Derselbe Wert wie im Baukasten-`Dialog`, damit sich beide
 * Bauarten am Tresen gleich anfühlen.
 */
export const FENSTER_MAX_HOEHE = 'calc(100dvh - 48px)';

/**
 * Auf die Karte legen, nicht auf das Feld dahinter. Rollt der Inhalt, bleibt
 * die Karte stehen und ihr Inneres bewegt sich — die Überschrift bleibt also
 * erreichbar, statt aus dem Bild zu wandern.
 *
 * Wichtig: das verschiebt bei genug Platz GAR NICHTS. `maxHeight` greift erst,
 * wenn die Karte sonst über den Schirm hinausliefe, und genau dann ist der
 * heutige Zustand ohnehin kaputt.
 */
export const FENSTER_ROLLRAHMEN: CSSProperties = {
  maxHeight: FENSTER_MAX_HOEHE,
  overflowY: 'auto',
};

/** Was in einem Fenster den Fokus annehmen kann. */
const FOKUSSIERBAR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export interface FensterRahmenOptionen {
  /** Steht das Fenster gerade offen. Fenster ohne eigenen Schalter geben `true`. */
  offen: boolean;
  /** Was beim Abbrechen geschehen soll. */
  aufSchliessen: () => void;
  /**
   * Wahr, solange das Fenster nichts annehmen darf — in aller Regel „ein
   * Auftrag ist unterwegs". Dann schliesst auch Escape nicht, sonst risse man
   * dem laufenden Vorgang das Fenster unter den Händen weg.
   */
  gesperrt?: boolean;
}

/**
 * Rüstet einem handgebauten Fenster Escape, Anfangsfokus, Fokusfang und die
 * Rückgabe des Fokus nach. Der zurückgegebene Verweis gehört auf das ÄUSSERE
 * feste Feld; alles darin gilt als Inhalt des Fensters.
 */
export function useFensterRahmen({
  offen,
  aufSchliessen,
  gesperrt = false,
}: FensterRahmenOptionen): RefObject<HTMLDivElement> {
  // Bewusst die Schreibweise `useRef<T>(null)`: nur sie liefert das
  // schreibgeschützte `RefObject<T>`, das React als `ref` an ein Element
  // annimmt. Mit `useRef<T | null>` entstünde ein veränderliches Objekt, das
  // die Typprüfung an dieser Stelle ablehnt.
  const rahmenRef = useRef<HTMLDivElement>(null);
  const zurueckRef = useRef<HTMLElement | null>(null);

  // Escape.
  //
  // Der Vergleich auf `defaultPrevented` ist der eigentliche Fund hier: liegt
  // ein zweites Fenster obenauf — etwa die Nachfrage nach dem Gerätecode aus
  // dem Baukasten-`Dialog` —, so hat DIESES den Tastendruck bereits behandelt
  // und als erledigt gekennzeichnet. Ohne die Prüfung schlösse ein einziger
  // Escape beide Fenster auf einmal, und die Kassiererin verlöre mit der
  // Nachfrage auch gleich das ausgefüllte Formular darunter.
  useEffect(() => {
    if (!offen) return;
    const beiTaste = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Escape') return;
      if (ev.defaultPrevented) return;
      if (gesperrt) return;
      ev.preventDefault();
      aufSchliessen();
    };
    window.addEventListener('keydown', beiTaste);
    return () => window.removeEventListener('keydown', beiTaste);
  }, [offen, aufSchliessen, gesperrt]);

  // Anfangsfokus und Rückgabe des Fokus.
  useEffect(() => {
    if (!offen) return;
    zurueckRef.current = (document.activeElement as HTMLElement) ?? null;

    const rahmen = rahmenRef.current;
    if (rahmen && !rahmen.contains(document.activeElement)) {
      // Hat ein Kind bereits `autoFocus` gesetzt, ist der Fokus schon drin und
      // wir fassen ihn nicht an — sonst überstimmten wir eine bewusste
      // Entscheidung des Fensters, etwa den Ruhepunkt auf „Abbrechen".
      const ziel = rahmen.querySelector<HTMLElement>(FOKUSSIERBAR) ?? rahmen;
      ziel.focus();
    }

    return () => {
      const zurueck = zurueckRef.current;
      if (zurueck && typeof zurueck.focus === 'function' && document.contains(zurueck)) {
        zurueck.focus();
      }
    };
  }, [offen]);

  // Fokusfang.
  //
  // Bewusst NUR wirksam, solange der Fokus schon im Fenster steht. Liegt ein
  // zweites Fenster obenauf und hat den Fokus zu sich geholt, hält dieser Fang
  // still, statt ihn zurückzureissen. Zwei Fänge, die sich um denselben
  // Tabulator streiten, sperren die Tastatur vollständig.
  useEffect(() => {
    if (!offen) return;
    const beiTabulator = (ev: KeyboardEvent): void => {
      if (ev.key !== 'Tab') return;
      const rahmen = rahmenRef.current;
      if (!rahmen) return;
      const aktiv = document.activeElement;
      if (!rahmen.contains(aktiv)) return;

      const stationen = Array.from(rahmen.querySelectorAll<HTMLElement>(FOKUSSIERBAR));
      const erste = stationen[0];
      const letzte = stationen[stationen.length - 1];
      if (!erste || !letzte) return;

      if (ev.shiftKey && aktiv === erste) {
        ev.preventDefault();
        letzte.focus();
      } else if (!ev.shiftKey && aktiv === letzte) {
        ev.preventDefault();
        erste.focus();
      }
    };
    window.addEventListener('keydown', beiTabulator);
    return () => window.removeEventListener('keydown', beiTabulator);
  }, [offen]);

  return rahmenRef;
}
