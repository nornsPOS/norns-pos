/**
 * scan-resolve — pure logic for the cashier barcode scan→cart loop.
 *
 * One physical label serves storage AND sale: it carries a Code128 barcode of
 * the product's SKU (see src-tauri/commands/label.rs) AND a QR code holding the
 * shop's own reference to the same product. A USB-HID scanner emits either of
 * them as keystrokes (captured by useBarcodeScanner). This module turns the raw
 * scan into a precise verdict against the catalog rows the lookup returned, so
 * Verkauf can give the operator exact feedback instead of a silent miss.
 *
 * Kept pure (no network, no React) so the whole decision is unit-testable; the
 * physical print + real-scanner round-trip is the hardware-in-the-loop gate
 * (see docs/BACKLOG.md).
 */

import { ETIKETT_SCHEMA } from './marke.js';
import type { ProductListRow } from '@norns/api-client';

export type ScanMatch =
  | { kind: 'found'; product: ProductListRow }
  | { kind: 'sold'; product: ProductListRow }
  | { kind: 'reserved'; product: ProductListRow }
  | { kind: 'draft'; product: ProductListRow }
  | { kind: 'not-found' };

/*
 * ── DER FUND VOM 26.07.2026: die Kasse konnte ihren EIGENEN QR nicht lesen ───
 *
 * Auf jedes Etikett wird seit jeher ein QR-Code gedruckt, und sein Inhalt ist
 * ein Verweis auf den Artikel (`qrVerweis` in `etikett-layout.ts` liefert
 * `w14://p/<Artikelnummer>`). Wer diesen QR mit dem Handlesegerät am Tresen
 * las, bekam genau diesen Text als Tastenanschläge — und `normalizeScan` machte
 * daraus nur `W14://P/MZ-0042` und schickte das als Suchbegriff an den Katalog.
 * Keine Artikelnummer der Welt heisst so. Ergebnis am Tresen: „nicht gefunden",
 * bei einem Stück, das der Verkäufer in der Hand hielt. Der QR auf jedem bisher
 * gedruckten Etikett war reine Zierde.
 *
 * Das wiegt ab sofort schwerer, weil auf dem kleinen Etikett (Kapselfähnchen)
 * der QR ein TRAGENDER Code ist und nicht mehr nur Beiwerk.
 *
 * Deshalb packt der Normalisierer jetzt die eigene Kennzeichnung des Hauses
 * aus — und NUR die. Ein fremder Strichcode, der zufällig einen Schrägstrich
 * trägt, bleibt Zeichen für Zeichen, wie er ist.
 */

/**
 * Die eigenen Schemata, die auf den Etiketten stehen können.
 *
 * ⚠️ 01.08.2026: ZWEI, nicht eines. Gedruckt wird ab jetzt `norns://`
 * (`ETIKETT_SCHEMA` in `marke.ts`), gelesen wird auch das alte `w14://` —
 * dauerhaft. Jedes Etikett, das vor diesem Tag geklebt wurde, trägt das alte
 * Schema. Es aus dem Leser zu streichen, hiesse: am Tag der Auslieferung
 * findet die Kasse ihre eigene Ware nicht mehr, Regal für Regal. Genau dieser
 * Fehler ist am 26.07.2026 schon einmal passiert (oben beschrieben), damals
 * aus einem anderen Grund; er kostete jeden gedruckten QR seine Wirkung.
 *
 * Die Reihenfolge ist ohne Bedeutung, geprüft wird auf Übereinstimmung.
 */
const HAUS_SCHEMATA = [ETIKETT_SCHEMA, 'w14://'] as const;

/**
 * Die Rechnernamen, unter denen das Haus selbst Artikel zeigt.
 *
 * ⚠️ 01.08.2026 LEER, und das ist der richtige Zustand. Hier standen
 * `warehouse14.de` und `www.warehouse14.de` — der Webshop einer fremden
 * Firma. Norns POS ist die Kasse am Tresen und hat keinen Webshop (in dieser
 * Kopie liegt auch keiner: `apps/` trägt api-cloud, mobile, tauri-pos,
 * worker). Ein QR von jenem Rechner kann auf dieser Kasse also gar nicht
 * entstehen, und ein Händler, der Norns kauft, betreibt jenen Shop nicht.
 *
 * Bekommt die Kasse eines Tages eine eingestellte eigene Shop-Adresse, gehört
 * sie HIER hinein, aus den Einstellungen gelesen statt eingetippt. Bis dahin
 * ist die leere Liste die ehrliche Antwort: die Kasse packt nur ihr eigenes
 * Schema aus.
 */
const HAUS_RECHNER: readonly string[] = [];

/** Der einzige Pfad, hinter dem eine Artikelnummer steht. */
const ARTIKEL_PFAD = 'p/';

/**
 * Aus der eigenen Kennzeichnung die reine Artikelnummer holen.
 *
 * Erkannt werden, jeweils gleichgültig ob gross oder klein geschrieben:
 *   `w14://p/MZ-0042` · `https://warehouse14.de/p/MZ-0042` ·
 *   `http://www.warehouse14.de/p/MZ-0042` · `warehouse14.de/p/MZ-0042`
 * jeweils auch mit einem abschliessenden Schrägstrich und mit angehängter
 * Abfrage (`?…`) oder Sprungmarke (`#…`), die manche Kameras mitliefern.
 *
 * ⚠ ALLES ANDERE BLEIBT UNANGETASTET. Ein Lesegerät im Tastaturbetrieb tippt
 * ab, was im Code steht, und in fremden Strichcodes stehen durchaus
 * Schrägstriche (Chargen, Verfallsdaten, GS1-Elemente). Würde hier blind am
 * letzten Schrägstrich abgeschnitten, verstümmelte die Kasse fremde Codes und
 * fände plötzlich den falschen Artikel — schlimmer als gar nichts zu finden.
 * Deshalb: kein Treffer, keine Änderung.
 */
export function entpackeHausverweis(roh: string): string {
  const text = roh.trim();
  if (text === '') return text;

  let rest: string | null = null;

  const klein_ = text.toLowerCase();
  const eigenes = HAUS_SCHEMATA.find((sch) => klein_.startsWith(sch));
  if (eigenes !== undefined) {
    rest = text.slice(eigenes.length);
  } else {
    // Ein etwaiges Netzschema abstreifen, dann auf den eigenen Rechnernamen
    // prüfen. Ohne Schema (blosses „laden.de/p/…") gilt dasselbe. Solange
    // HAUS_RECHNER leer ist, läuft diese Schleife nie an — der Text bleibt,
    // wie er ist, was für einen fremden Strichcode genau richtig ist.
    let ohneSchema = text;
    for (const schema of ['https://', 'http://']) {
      if (ohneSchema.toLowerCase().startsWith(schema)) {
        ohneSchema = ohneSchema.slice(schema.length);
        break;
      }
    }
    const klein = ohneSchema.toLowerCase();
    for (const rechner of HAUS_RECHNER) {
      if (klein.startsWith(`${rechner}/`)) {
        rest = ohneSchema.slice(rechner.length + 1);
        break;
      }
    }
  }

  if (rest === null) return text;
  if (!rest.toLowerCase().startsWith(ARTIKEL_PFAD)) return text;

  let code = rest.slice(ARTIKEL_PFAD.length);
  const schnitt = code.search(/[?#]/);
  if (schnitt >= 0) code = code.slice(0, schnitt);
  if (code.endsWith('/')) code = code.slice(0, -1);

  // Leer oder noch ein Schrägstrich darin: das ist keine schlichte
  // Artikelnummer. Dann lieber den ganzen Text stehen lassen, damit der
  // Verkäufer in der Rückmeldung sieht, was das Lesegerät wirklich gelesen hat.
  if (code === '' || code.includes('/')) return text;

  return code;
}

/**
 * Normalise a raw scanner buffer: unwrap the shop's own label reference, strip
 * surrounding whitespace / stray CR and uppercase so case-variant scans still
 * match. SKUs are uppercase, hyphenated, space-free — we only trim the ends,
 * never touch the interior.
 */
export function normalizeScan(raw: string): string {
  return entpackeHausverweis(raw).toUpperCase();
}

/**
 * Einen GESPEICHERTEN Wert (Artikelnummer, Strichcodespalte) vergleichbar
 * machen: nur Ränder und Gross-/Kleinschreibung.
 *
 * ⚠ Bewusst NICHT `normalizeScan`. Was in der Datenbank steht, ist keine
 * Kennzeichnung, die ausgepackt werden dürfte. Trüge eine Zeile jemals eine
 * Artikelnummer, die wie ein Verweis aussieht, würde sie sonst beim Vergleich
 * verkürzt und plötzlich auf einen ganz anderen Scan passen.
 */
function vergleichbar(wert: string): string {
  return wert.trim().toUpperCase();
}

/**
 * Classify a scanned code against the rows a catalog lookup returned. Matches
 * the SKU first (the barcode IS the SKU), then falls back to the legacy
 * `barcode` column for pre-printed EAN/UPC tags. The matched row's status
 * decides the verdict; an empty/absent match is `not-found`.
 */
export function classifyScanMatch(code: string, rows: readonly ProductListRow[]): ScanMatch {
  const norm = normalizeScan(code);
  if (norm === '') return { kind: 'not-found' };

  const product = rows.find(
    (r) => vergleichbar(r.sku) === norm || (r.barcode != null && vergleichbar(r.barcode) === norm),
  );
  if (!product) return { kind: 'not-found' };

  switch (product.status) {
    case 'AVAILABLE':
      return { kind: 'found', product };
    case 'SOLD':
      return { kind: 'sold', product };
    case 'RESERVED':
      return { kind: 'reserved', product };
    case 'DRAFT':
      return { kind: 'draft', product };
  }
}
