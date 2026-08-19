/**
 * Etiketten für die Stücke aus einer Konvolut-Bewertung.
 *
 * ── DER FEHLER, DEN DIESE DATEI BEHEBT (25.07.2026) ─────────────────────────
 *
 * Beide Stellen, die nach einer Annahme Etiketten druckten, setzten
 *
 *     sku: i.productId
 *
 * — also die UUID des Produkts, nicht seine Artikelnummer. Genau dieses Feld
 * kodiert die Druckschicht als Code128 (`src-tauri/src/commands/label.rs`).
 *
 * Die Kasse löst einen Scan aber AUSSCHLIESSLICH über SKU oder Barcode auf
 * (`lib/scan-resolve.ts`), und sie schreibt den Suchbegriff vorher gross. Eine
 * kleingeschriebene UUID trifft nichts.
 *
 * Der Ablauf, der daraus folgt: Konvolut mit sechs Stücken angenommen → sechs
 * Etiketten gedruckt → Ware ins Regal → der Kunde will Stück drei kaufen →
 * die Kassiererin scannt → „nicht gefunden". Für JEDES Stück, das je über eine
 * Bewertung ins Haus kam. Der Kommentar an der alten Stelle nannte die Ursache
 * sogar („die Bewertung liefert die SKU nicht mit") und zog daraus den falschen
 * Schluss: er nahm die UUID als Ersatz, statt die SKU zu holen.
 *
 * ── DIE REGEL ───────────────────────────────────────────────────────────────
 * Lieber KEIN Etikett als eines mit einem Barcode, den das eigene Haus nicht
 * lesen kann. Ein fehlendes Etikett fällt sofort auf; ein unlesbares fällt erst
 * am Tresen auf, vor einem wartenden Menschen.
 */

import { type ApiClient, productsApi } from '@norns/api-client';

import type { LabelData } from './hardware-client.js';

/** Was aus einer Bewertung kommt: ein Stück, das ein Produkt geworden ist. */
export interface KonvolutStueck {
  productId: string | null;
  name: string;
  weightGrams?: string | null;
  karatCode?: string | null;
}

export interface EtikettenErgebnis {
  /** Die druckbaren Etiketten — jedes mit einer ECHTEN Artikelnummer. */
  etiketten: LabelData[];
  /**
   * Wie viele Stücke KEIN Etikett bekommen, weil ihre Artikelnummer nicht
   * gelesen werden konnte. Wird angezeigt, nie verschwiegen.
   */
  ohneNummer: number;
}

/**
 * Die Artikelnummern nachschlagen und daraus Etiketten bauen.
 *
 * Ein Stück, dessen Produkt sich nicht laden lässt (Netz weg, Datensatz weg),
 * wird GEZÄHLT und übersprungen. Es bekommt ausdrücklich kein Etikett mit
 * einer Ersatzkennung.
 */
export async function etikettenFuerKonvolut(
  api: ApiClient,
  stuecke: readonly KonvolutStueck[],
): Promise<EtikettenErgebnis> {
  const mitProdukt = stuecke.filter((s) => s.productId !== null);
  const etiketten: LabelData[] = [];
  let ohneNummer = 0;

  // Nacheinander statt alle auf einmal: ein Konvolut hat selten mehr als ein
  // Dutzend Stuecke, und ein Schwall paralleler Abfragen gegen den Server
  // waere hier nur Angeberei.
  for (const stueck of mitProdukt) {
    try {
      const produkt = await productsApi.get(api, stueck.productId as string);
      const sku = produkt.sku?.trim();
      if (!sku) {
        ohneNummer += 1;
        continue;
      }
      etiketten.push({
        sku,
        productName: stueck.name,
        weightGrams: stueck.weightGrams ?? null,
        karat: stueck.karatCode ?? null,
        storageLocation: null,
      });
    } catch {
      // Kein Etikett mit geratener Nummer. Der Aufrufer sagt es dem Menschen.
      ohneNummer += 1;
    }
  }

  return { etiketten, ohneNummer };
}

/**
 * Der ehrliche Satz zum Ergebnis, oder null wenn alles glattging.
 *
 * Ein stiller Teilerfolg („es kamen halt vier statt sechs Etiketten") ist
 * genau die Art Fehler, die erst am Regal auffällt.
 */
export function etikettenHinweis(ergebnis: EtikettenErgebnis): string | null {
  if (ergebnis.ohneNummer === 0) return null;
  const eines = ergebnis.ohneNummer === 1;
  return `${ergebnis.ohneNummer} ${eines ? 'Stück hat' : 'Stücke haben'} kein Etikett bekommen: die Artikelnummer war nicht abrufbar. Bitte im Lager nachdrucken.`;
}
