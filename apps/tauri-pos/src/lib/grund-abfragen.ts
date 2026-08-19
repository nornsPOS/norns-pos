/**
 * Nach einem Grund fragen — und die Ablehnung nicht verschlucken.
 *
 * ── DER FUND (25.07.2026) ──────────────────────────────────────────────────
 * An zwei Stellen stand dieselbe Zeile:
 *
 *     const input = window.prompt('Storno-Grund (mindestens 4 Zeichen):');
 *     if (!input || input.trim().length < 4) return;
 *
 * Wer „kk" eintippte und auf OK drückte, sah NICHTS. Kein Hinweis, kein
 * zweiter Versuch, keine Meldung. Der Termin blieb gebucht, und niemand sagte
 * warum. Eine stille Ablehnung ist die unfreundlichste Antwort, die eine
 * Oberfläche geben kann: sie sieht aus wie ein Fehler des Programms.
 *
 * Diese Funktion fragt so lange, bis der Grund trägt oder der Mensch abbricht,
 * und sagt beim zu kurzen Grund, WAS fehlt.
 */

/** Die Mindestlänge, die der Server für einen Storno-Grund verlangt. */
export const GRUND_MINDESTLAENGE = 4;

export interface GrundAbfrageOptionen {
  frage: string;
  /** Wie der Hinweis beim Menschen ankommt (in der Kasse: ein Zettel). */
  melden: (text: string) => void;
  /** Nur für die Prüfung austauschbar. */
  fragen?: (text: string) => string | null;
}

/**
 * @returns den getrimmten Grund, oder `null` wenn der Mensch abgebrochen hat.
 */
export function grundAbfragen(opts: GrundAbfrageOptionen): string | null {
  const { frage, melden } = opts;
  const fragen = opts.fragen ?? ((t: string) => window.prompt(t));

  for (;;) {
    const eingabe = fragen(frage);
    // Abbrechen ist eine gültige Antwort — sie braucht keinen Hinweis.
    if (eingabe === null) return null;
    const grund = eingabe.trim();
    if (grund.length >= GRUND_MINDESTLAENGE) return grund;
    melden(
      grund.length === 0
        ? 'Ohne Grund geht es nicht, der Vorgang wird im Tagebuch festgehalten.'
        : `„${grund}" ist zu kurz. Mindestens ${GRUND_MINDESTLAENGE} Zeichen, damit später jemand versteht, warum.`,
    );
  }
}
