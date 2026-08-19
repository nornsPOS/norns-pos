/**
 * Der VERKAUFSaufschlag je Metall, aus `system_settings`.
 *
 * ── WARUM ES IHN BRAUCHT ───────────────────────────────────────────────────
 *
 * Das Haus führte seit jeher nur eine Marge: `pricing.ankauf_safety_margin_pct`
 * — den Sicherheitsabschlag beim ANKAUF. Für den Verkauf gab es nichts, weil
 * es gar keine Verkaufsrechnung gab: jeder Preis wurde von Hand eingetippt
 * und blieb für immer stehen (Basels Befund vom 05.08.2026).
 *
 * Mit `kurspreisFuerStueck` rechnet die Kasse den Verkaufspreis jetzt aus dem
 * Tageskurs. Dazu gehört ein Aufschlag, und der gehört dem Händler, nicht dem
 * Quelltext.
 *
 * ── ⚠️ ANTEIL, NICHT PROZENT ───────────────────────────────────────────────
 *
 * `0.10` heisst zehn Prozent, exakt wie die Ankaufmarge daneben. Zwei
 * Einheiten im selben System wären ein Preisfehler um den Faktor hundert, und
 * zwar still. `kurspreisFuerStueck` weist deshalb jeden Wert über 1 ab,
 * statt ihn zu rechnen.
 *
 * Die Vorgabe ist NULL, nicht irgendein erfundener Händleraufschlag. Ein zu
 * niedriger Preis fällt dem Händler beim ersten Blick auf, ein erfundener
 * nicht.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import type { AppDb } from '@norns/db/client';
import { systemSettings } from '@norns/db/schema';

/** Der Schlüsselstamm in `system_settings`. */
export const VERKAUFSAUFSCHLAG_KEY = 'pricing.verkauf_aufschlag_pct';

/** Die vier Metalle mit Tageskurs. */
export const METALLE = ['gold', 'silver', 'platinum', 'palladium'] as const;
export type MetallName = (typeof METALLE)[number];

/**
 * Obergrenze für einen plausiblen Aufschlag. Mehr als hundert Prozent ist
 * fast immer die Einheitenverwechslung („10" statt „0.10"), nicht der Wille
 * des Händlers.
 */
const MAX_ANTEIL = 1;
const MIN_ANTEIL = 0;

/** Vorgabe, wenn nichts hinterlegt ist: kein Aufschlag. Siehe Kopf. */
const VORGABE = '0';

/**
 * Prüft einen hinterlegten Wert und gibt ihn UNVERÄNDERT zurück, wenn er
 * gültig ist.
 *
 * ⚠️ Er reist als ZEICHENKETTE weiter, nicht als Zahl. Ein Umweg über
 * `Number` machte aus dem eingetragenen „0.10" ein „0.1": numerisch dasselbe,
 * aber der Händler bekäme in den Einstellungen etwas anderes zu sehen, als er
 * geschrieben hat. In einem Haus, in dem Geld als Zeichenkette reist, wird
 * auch der Anteil nicht durch eine Gleitkommazahl geschleust.
 */
function anteilOderNull(roh: string | null | undefined): string | null {
  if (roh === null || roh === undefined) return null;
  const s = String(roh).trim().replace(/^"|"$/g, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < MIN_ANTEIL || n > MAX_ANTEIL) return null;
  return s;
}

/** Der Schlüssel für ein einzelnes Metall. */
export function aufschlagKeyFuer(metall: MetallName): string {
  return `${VERKAUFSAUFSCHLAG_KEY}.${metall}`;
}

/**
 * Liest den globalen Aufschlag plus die Ausnahmen je Metall in EINEM Zug.
 * Ein Metall ohne eigenen gültigen Wert erbt den globalen; fehlt auch der,
 * gilt die Vorgabe.
 *
 * Der Rückgabewert ist eine Karte von Zeichenketten, weil
 * `kurspreisFuerStueck` Dezimalzeichenketten führt und nicht `number` —
 * Geld und Anteile reisen in diesem Haus als Zeichenkette.
 */
export async function leseVerkaufsaufschlag(db: AppDb): Promise<Map<string, string>> {
  const zeilen = await db
    .select({ key: systemSettings.key, value: systemSettings.value })
    .from(systemSettings)
    .where(drizzleSql`${systemSettings.key} LIKE ${`${VERKAUFSAUFSCHLAG_KEY}%`}`);

  const nachSchluessel = new Map(zeilen.map((z) => [z.key, z.value as string | null]));
  const global = anteilOderNull(nachSchluessel.get(VERKAUFSAUFSCHLAG_KEY)) ?? VORGABE;

  const karte = new Map<string, string>();
  for (const m of METALLE) {
    const eigen = anteilOderNull(nachSchluessel.get(aufschlagKeyFuer(m)));
    karte.set(m, eigen ?? global);
  }
  return karte;
}
