/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Der Kursverlauf — ein Zeitfenster, serverseitig verdichtet
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 21.08.2026 (Basel: „تاريخ أكبر … العمق التاريخي") ───────
 *
 * Das Terminal bot Zeitfenster bis zu EINEM JAHR. Geholt wurden aber 200
 * Zeilen, und der Server deckelte ebenfalls bei 200. Gemessen am Beiläufer:
 * die Kurse werden **alle fünf Minuten** geschrieben.
 *
 *     200 Zeilen × 5 Minuten = 1000 Minuten = 16,7 Stunden
 *
 * Der „1 Jahr"-Knopf zeigte also nicht einmal einen ganzen Tag, und der
 * „1 Woche"-Knopf war schon unmöglich. Die Kurve war nicht ungenau — sie war
 * eine andere Kurve als die beschriftete.
 *
 * ── WARUM NICHT EINFACH DEN DECKEL HEBEN ───────────────────────────────────
 *
 * Ein Jahr bei fünf Minuten sind rund 105.000 Zeilen JE METALL. Die über das
 * Netz zu schieben und im Browser zu Kerzen zu falten, würde die Kasse auf
 * einem Tresengerät zum Stehen bringen — und 105.000 Punkte auf 900 Pixel
 * sind ohnehin nicht mehr Information, sondern nur mehr Arbeit.
 *
 * Deshalb verdichtet die DATENBANK, die dafür gebaut ist: sie faltet die
 * Zeilen in Körner (Kerzen) und gibt je Korn Eröffnung, Hoch, Tief, Schluss
 * und die Zahl der Messpunkte zurück. Ein Jahr in Tageskörnern sind 365
 * Zeilen statt 105.000.
 *
 * ⚠️ ECHTE Kerzen, keine geschätzten: Hoch und Tief kommen aus `min`/`max`
 * über ALLE Messpunkte des Korns, nicht aus den Randwerten. Wer aus zwei
 * Randpunkten eine Kerze baut, malt eine Kursspitze weg, die es gab.
 *
 * ── DIE KÖRNER ─────────────────────────────────────────────────────────────
 *
 * Sie sind eine GESCHLOSSENE Liste, kein freier Text: ein durchgereichtes
 * Intervall wäre eine Einladung, dem Zeitzonen-Rechner der Datenbank etwas
 * unterzuschieben.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import type { AppDb } from '@norns/db/client';

/** Die erlaubten Körner und ihr Postgres-Intervall. */
export const KOERNER = {
  '5min': '5 minutes',
  stunde: '1 hour',
  tag: '1 day',
  woche: '1 week',
} as const;

export type Korn = keyof typeof KOERNER;

export function istKorn(wert: string): wert is Korn {
  return Object.hasOwn(KOERNER, wert);
}

/** Eine Kerze, wie die Fläche sie zeichnet. */
export interface Kerze {
  /** Beginn des Korns, ISO. */
  t: string;
  /** Eröffnung, Hoch, Tief, Schluss — als Zeichenketten, nie als Gleitkomma. */
  o: string;
  h: string;
  l: string;
  c: string;
  /** Wie viele Messpunkte in diesem Korn lagen. Ehrlichkeit über die Dichte. */
  n: number;
}

/**
 * Obergrenze der zurückgegebenen Körner.
 *
 * ⚠️ Sie ist ein Riegel gegen die Kombination „ein Jahr in Fünfminutenkörnern"
 * (rund 105.000 Zeilen). Die Fläche wählt das Korn passend zum Fenster; wer
 * es von Hand überreizt, bekommt einen ehrlichen Fehler statt einer Kasse,
 * die minutenlang steht.
 */
export const MAX_KOERNER = 2000;

export class ZuVieleKoernerError extends Error {
  public constructor(
    public readonly gefordert: number,
    public readonly korn: Korn,
  ) {
    super(
      `Dieses Fenster ergäbe ${gefordert} Körner in „${korn}" (Höchstzahl ${MAX_KOERNER}). ` +
        `Ein gröberes Korn wählen.`,
    );
  }
}

/** Wie viele Körner das Fenster ergäbe — VOR der Abfrage, damit sie gar nicht läuft. */
export function koernerImFenster(vonMs: number, bisMs: number, korn: Korn): number {
  const breite = { '5min': 300_000, stunde: 3_600_000, tag: 86_400_000, woche: 604_800_000 }[korn];
  return Math.max(1, Math.ceil((bisMs - vonMs) / breite));
}

/**
 * Den Verlauf eines Metalls als Kerzen lesen.
 *
 * ⚠️ `date_bin` (Postgres 14+) statt `date_trunc`: es faltet auf ein BELIEBIGES
 * Raster ab einem Ursprung, `date_trunc` nur auf Kalendereinheiten. Für das
 * Fünfminutenkorn gibt es keine Kalendereinheit.
 *
 * ⚠️ Eröffnung und Schluss über Fensterfunktionen, NICHT über `min(validFrom)`
 * mit einem zweiten Zug: zwei Züge über dieselben Zeilen können bei laufendem
 * Schreiben verschiedene Mengen sehen.
 */
export async function leseKerzen(
  db: AppDb,
  metall: string,
  vonMs: number,
  bisMs: number,
  korn: Korn,
): Promise<Kerze[]> {
  const anzahl = koernerImFenster(vonMs, bisMs, korn);
  if (anzahl > MAX_KOERNER) throw new ZuVieleKoernerError(anzahl, korn);

  const intervall = KOERNER[korn];
  const von = new Date(vonMs).toISOString();
  const bis = new Date(bisMs).toISOString();

  const zeilen = await db.execute<{
    t: string;
    o: string;
    h: string;
    l: string;
    c: string;
    n: string;
  }>(drizzleSql`
    WITH gefaltet AS (
      SELECT
        date_bin(${intervall}::interval, valid_from, TIMESTAMPTZ '2000-01-01') AS korn,
        price_per_gram_eur AS preis,
        valid_from,
        first_value(price_per_gram_eur) OVER w AS eroeffnung,
        last_value(price_per_gram_eur)  OVER w AS schluss
      FROM metal_prices
      WHERE metal = ${metall}
        AND price_per_gram_eur IS NOT NULL
        AND valid_from >= ${von}::timestamptz
        AND valid_from <  ${bis}::timestamptz
      WINDOW w AS (
        PARTITION BY date_bin(${intervall}::interval, valid_from, TIMESTAMPTZ '2000-01-01')
        ORDER BY valid_from, id
        ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
      )
    )
    SELECT
      korn::text                AS t,
      min(eroeffnung)::text     AS o,
      max(preis)::text          AS h,
      min(preis)::text          AS l,
      min(schluss)::text        AS c,
      count(*)::text            AS n
    FROM gefaltet
    GROUP BY korn
    ORDER BY korn ASC
  `);

  const roh = Array.isArray(zeilen) ? zeilen : ((zeilen as { rows?: unknown[] }).rows ?? []);
  return (roh as { t: string; o: string; h: string; l: string; c: string; n: string }[]).map((z) => ({
    t: new Date(z.t).toISOString(),
    o: z.o,
    h: z.h,
    l: z.l,
    c: z.c,
    n: Number(z.n),
  }));
}
