/**
 * Die Kursquellen, wie der Inhaber sie liest.
 *
 * ⚠️ DIESE LISTE IST DIE DRITTE KOPIE. Die kanonische steht im Motor
 * (`api-cloud/src/lib/kursquellen.ts`), die zweite im Kursdienst des Beipacks
 * (`norns-sidecar.mjs`). Der Kasse fehlt der Weg zu beiden: sie ist ein
 * eigenes Bündel und darf den Serverquelltext nicht einziehen.
 *
 * Deshalb hält ein Wächter (`kursquelle-wirkt-wirklich`) alle DREI Dateien
 * nebeneinander und vergleicht die Kennungen. Ohne ihn wäre das die Klasse
 * „Listen driften": die Kasse böte eine Quelle an, die der Dienst nicht kennt,
 * der Kurs bliebe stumm auf dem Stand von vorgestern stehen, und der Händler
 * kaufte Gold zum Kurs von vorgestern, ohne dass irgendwo etwas rot würde.
 *
 * Der Wortlaut hier ist ABSICHTLICH für einen gewöhnlichen Benutzer
 * geschrieben, nicht für einen Entwickler. Basels Anweisung: einfach vorn,
 * gewaltig dahinter.
 */

export const SCHLUESSEL_METALLQUELLE = 'kurs.metall_quelle';
export const SCHLUESSEL_FXQUELLE = 'kurs.fx_quelle';

export interface QuellenEintrag {
  kennung: string;
  /** Die Überschrift der Karte. */
  name: string;
  /** Ein Satz: was diese Wahl bedeutet. */
  was: string;
  /** Die Zeile darunter, kleiner. Leer, wenn es nichts zu sagen gibt. */
  fussnote: string;
}

export const METALLQUELLEN: readonly QuellenEintrag[] = [
  {
    kennung: 'GOLDPREIS_DE',
    name: 'Deutscher Goldpreis',
    was: 'Der Kurs, an dem sich der deutsche Edelmetallhandel ausrichtet.',
    fussnote:
      'Alle vier Metalle kommen direkt in Euro, es wird nichts umgerechnet. ' +
      'Bereitgestellt vom selben Haus, ohne Anmeldung und ohne Schlüssel.',
  },
  {
    kennung: 'GOLD_API',
    name: 'Freier Kursdienst',
    was: 'Alle vier Metalle, laufend. Ohne Anmeldung und ohne Schlüssel.',
    fussnote:
      'Liefert in Dollar und wird mit dem Dollarkurs unten in Euro umgerechnet.',
  },
  {
    kennung: 'SWISSQUOTE',
    name: 'Swissquote',
    was: 'Der öffentliche Kursstrom einer Schweizer Bank. Ohne Anmeldung und ohne Schlüssel.',
    fussnote:
      'Gold und Silber kommen direkt in Euro, ganz ohne Umrechnung. Nur Platin und ' +
      'Palladium werden umgerechnet.',
  },
];

export const FXQUELLEN: readonly QuellenEintrag[] = [
  {
    kennung: 'EZB',
    name: 'Europäische Zentralbank',
    was: 'Der amtliche Referenzkurs, einmal an jedem Bankarbeitstag.',
    fussnote: 'Empfohlen: derselbe Kurs, den auch das Finanzamt ansetzt.',
  },
  {
    kennung: 'ANBIETER',
    name: 'Kursanbieter',
    was: 'Der Kurs des Kursdienstes selbst, dafür minütlich frisch.',
    fussnote:
      'Er wich gemessen um 253,50 Euro je Kilogramm Feingold vom amtlichen Kurs ab, ' +
      'immer in dieselbe Richtung.',
  },
];

/** Was ohne jede Einstellung gilt. Wörtlich wie im Motor und im Dienst. */
// Seit 13.08.2026 goldpreis.de, auf Basels ausdrueckliche Anweisung: der
// deutsche Handel richtet sich nach dieser Seite, und dort kommen ALLE VIER
// Metalle direkt in Euro, die Dollarumrechnung entfaellt ganz. Messung und
// Begruendung: api-cloud, src/lib/kursquellen.ts, METALLQUELLE_VORGABE.
export const METALLQUELLE_VORGABE = 'GOLDPREIS_DE';
export const FXQUELLE_VORGABE = 'EZB';

/**
 * Spielt der Dollarkurs für diese Wahl überhaupt eine Rolle?
 *
 * Bei „Nur von Hand" fragt niemand einen Kurs ab, also wäre die Frage nach der
 * Herkunft des Dollarkurses eine Frage ohne Gegenstand. Sie zu stellen hiesse,
 * dem Inhaber eine Entscheidung abzuverlangen, die nichts bewirkt.
 *
 * ⚠️ Bei `goldpreis.de` gilt genau dasselbe, nur aus einem anderen Grund: dort
 * kommen ALLE VIER Metalle direkt in Euro, und der Kursdienst holt den
 * Dollarkurs deshalb gar nicht erst (er wird seit dem 13.08.2026 nur noch
 * geholt, wenn ihn ein Metall wirklich braucht). Diese Auswahl hier
 * anzubieten wäre ein Schalter ohne Wirkung: der Inhaber träfe eine
 * Entscheidung, sähe sie bestätigt, und es änderte sich nichts.
 */
export function dollarkursSpieltEineRolle(metallquelle: string): boolean {
  return metallquelle !== 'GOLDPREIS_DE';
}
