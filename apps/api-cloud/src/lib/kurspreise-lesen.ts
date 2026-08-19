/**
 * Die Brücke zwischen dem Tageskurs und einem Stück im Lager.
 *
 * Sie holt die zwei Dinge, die `kurspreisFuerStueck` braucht — die aktuellen
 * Kurse und den Verkaufsaufschlag — und rechnet sie über eine Liste von
 * Stücken. Ein Zug für alles, nicht einer je Stück: bei tausend Stücken im
 * Lager wären das sonst tausend Anfragen an die Datenbank.
 *
 * ── ⚠️ NUR LAGER, NIE EIN BELEG ────────────────────────────────────────────
 *
 * Diese Datei sieht `products` und `metal_prices`. Sie fasst weder
 * `transactions` noch `transaction_items` an und darf es nie tun. Was
 * verkauft ist, trägt für immer die gebuchte Zahl; ein rückwirkend
 * veränderter Beleg wäre ein GoBD-Bruch.
 */

import { sql as drizzleSql } from 'drizzle-orm';

import type { AppDb } from '@norns/db/client';
import { metalPrices } from '@norns/db/schema';
import {
  type Kurspreis,
  type StueckFuerKurspreis,
  type Tageskurs,
  kurspreisFuerStueck,
} from '@norns/domain';

import { leseVerkaufsaufschlag } from './verkaufsaufschlag.js';

/** Die gültigen Tageskurse, nach Metall. */
export async function leseTageskurse(db: AppDb): Promise<Map<string, Tageskurs>> {
  const zeilen = await db
    .select({
      metal: metalPrices.metal,
      pricePerGramEur: metalPrices.pricePerGramEur,
      source: metalPrices.source,
      fetchedAt: metalPrices.fetchedAt,
    })
    .from(metalPrices)
    // `validTo IS NULL` ist die laufende Zeile je Metall — dieselbe Regel,
    // nach der `/api/metal-prices/current` seit jeher liest. Zwei Wege zum
    // selben Kurs würden irgendwann auseinanderlaufen.
    .where(drizzleSql`${metalPrices.validTo} IS NULL`);

  const karte = new Map<string, Tageskurs>();
  for (const z of zeilen) {
    if (z.pricePerGramEur === null) continue;
    karte.set(z.metal, {
      metal: z.metal,
      pricePerGramEur: String(z.pricePerGramEur),
      source: String(z.source),
      asOf: z.fetchedAt instanceof Date ? z.fetchedAt.toISOString() : String(z.fetchedAt ?? ''),
    });
  }
  return karte;
}

export interface StueckMitKennung extends StueckFuerKurspreis {
  readonly id: string;
}

/**
 * Rechnet den Tagespreis für viele Stücke auf einmal.
 *
 * Kurse und Aufschlag werden EINMAL geholt, dann rein gerechnet. Die
 * Rechnung selbst kennt keine Datenbank und ist einzeln geprüft
 * (`packages/domain/src/pricing/metallpreis.test.ts`).
 */
export async function kurspreiseFuerStuecke(
  db: AppDb,
  stuecke: readonly StueckMitKennung[],
): Promise<Map<string, Kurspreis>> {
  if (stuecke.length === 0) return new Map();
  const [kurse, aufschlag] = await Promise.all([
    leseTageskurse(db),
    leseVerkaufsaufschlag(db),
  ]);
  const ergebnis = new Map<string, Kurspreis>();
  for (const s of stuecke) {
    ergebnis.set(s.id, kurspreisFuerStueck(s, kurse, aufschlag));
  }
  return ergebnis;
}
