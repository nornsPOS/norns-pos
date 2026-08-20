/**
 * Typen zu `baue-pakete.mjs`.
 *
 * ── WOZU (20.08.2026) ──────────────────────────────────────────────────────
 *
 * Das Baustück ist bewusst reines JavaScript: es läuft im Arbeitslauf, BEVOR
 * irgendetwas gebaut ist — ein `.ts` müsste dafür erst übersetzt werden, und
 * womit? Genau die Henne-und-Ei-Frage, die es lösen soll.
 *
 * Der Wächter `die-bauordnung-wird-abgeleitet` führt trotzdem `reihenfolge`
 * ein, um die abgeleitete Ordnung nachzurechnen. Ohne diese Erklärung wäre
 * das ein `any`, und der Typprüfer meldete es zu Recht.
 */

/** Ein Werkstück des Werks, so weit die Bauordnung es kennen muss. */
export interface Werkstueck {
  /** Die hauseigenen Pakete, die es zum BAUEN braucht. */
  abhaengig: string[];
}

/**
 * Die Abhängigkeiten der genannten Anwendungen, von unten nach oben.
 *
 * Wirft bei einer Ringabhängigkeit, statt eine willkürliche Ordnung zu wählen.
 */
export function reihenfolge(
  alle: Map<string, Werkstueck>,
  anwendungen: readonly string[],
): string[];
