/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  BEWEGUNG — die Haussprache der Animation, an EINER Stelle
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 19.08.2026 ──────────────────────────────────────────────
 *
 * Basel: „die Flaeche hat keine Seele, keine Lebendigkeit." Gemessen: NULL
 * Bewegungsbibliothek im ganzen Baum, und `DESIGN-SYSTEM.md` §5 beschrieb
 * die Bewegungssprache seit jeher in der Vokabel von Motion — beschrieben,
 * nie gebaut.
 *
 * ── ⚠️ DIE ZUGAENGLICHKEITS-LUECKE, DIE JEDE JS-BIBLIOTHEK REISST ─────────
 *
 * `tokens.css` traegt eine globale Regel gegen `prefers-reduced-motion`, aber
 * sie nullt NUR `animation-duration` und `transition-duration` — beides CSS.
 * Eine Bewegung, die JavaScript rechnet, laeuft daran vorbei: wer im
 * Betriebssystem „weniger Bewegung" gewaehlt hat, bekaeme sie trotzdem.
 * Genau dafuer steht `reducedMotion="user"` hier, und zwar AUSDRUECKLICH —
 * die Vorgabe der Bibliothek ist `"never"`, also aus. Mit `"user"` fallen
 * Transformationen und Layoutspruenge weg, das Ein- und Ausblenden bleibt:
 * exakt die Regel des Hauses („nur transform und opacity").
 *
 * ── DIE ZAHLEN KOMMEN AUS DEN MARKEN, NICHT AUS DEM KOPF ──────────────────
 *
 * 250 ms und die Kuratoren-Kurve stehen seit jeher in `tokens.css`
 * (`--w14-dur-base`, `--w14-ease-curator`). Sie hier zu wiederholen waere
 * eine zweite Wahrheit; sie werden deshalb aus dem Stilblatt GELESEN, mit
 * den Werten des Stilblatts als Rueckfall (ohne DOM, etwa im Pruefsatz).
 */

import { MotionConfig } from 'motion/react';
import type { ReactNode } from 'react';

/** Die Kuratoren-Kurve als Zahlenreihe, wie Motion sie erwartet. */
const KURATOR: [number, number, number, number] = [0.16, 1, 0.3, 1];

/** Liest eine Dauer-Marke in Sekunden; ohne DOM gilt der Rueckfall. */
function dauerAus(marke: string, rueckfall: number): number {
  if (typeof document === 'undefined') return rueckfall;
  const roh = getComputedStyle(document.documentElement).getPropertyValue(marke).trim();
  if (roh.endsWith('ms')) {
    const n = Number.parseFloat(roh);
    return Number.isFinite(n) ? n / 1000 : rueckfall;
  }
  if (roh.endsWith('s')) {
    const n = Number.parseFloat(roh);
    return Number.isFinite(n) ? n : rueckfall;
  }
  return rueckfall;
}

/**
 * Die Hülle um die ganze Kasse. Sie setzt die Haussprache EINMAL; jede
 * Bewegung darunter erbt Dauer, Kurve und die Rücksicht auf den Menschen.
 */
export function Bewegung({ children }: { children: ReactNode }): JSX.Element {
  return (
    <MotionConfig
      reducedMotion="user"
      transition={{ duration: dauerAus('--w14-dur-base', 0.25), ease: KURATOR }}
    >
      {children}
    </MotionConfig>
  );
}

/**
 * Die vier Bewegungen, die dieses Haus kennt. Mehr braucht eine Kasse nicht,
 * und jede weitere waere eine Erfindung am Tresen.
 *
 * ⚠️ Alle vier ruehren NUR `opacity` und `transform` an. Eine Bewegung auf
 * `height` oder `top` zwingt den Browser in ein neues Layout, und das sieht
 * man auf einem Tresenrechner sofort.
 */
export const BEWEGUNG = {
  /** Eine Fläche tritt auf: von unten heran, ganz knapp. */
  auftritt: {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 4 },
  },
  /** Ein Dialog: aus der Tiefe, mit einem Hauch Grösse. */
  dialog: {
    initial: { opacity: 0, scale: 0.97 },
    animate: { opacity: 1, scale: 1 },
    exit: { opacity: 0, scale: 0.98 },
  },
  /** Ein Schleier hinter dem Dialog: nur Deckkraft, nie Bewegung. */
  schleier: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
  },
  /** Eine Zeile in einer Liste, gestaffelt über den Index. */
  zeile: (i: number) => ({
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    // 70 ms Staffel, dieselbe Marke wie im Stilblatt (--w14-stagger).
    transition: { delay: Math.min(i, 8) * 0.07 },
  }),
} as const;
