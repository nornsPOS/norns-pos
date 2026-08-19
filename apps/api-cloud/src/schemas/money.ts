/**
 * TypeBox schemas for money on the API surface.
 *
 * Money on the wire is ALWAYS a JSON string — never a number. This is the
 * single most important contract in the whole API. JavaScript / JSON
 * `number` cannot represent `0.1 + 0.2` exactly; the Finanzamt does not
 * accept "we rounded to the nearest float". Decimal.js + NUMERIC(18,2) +
 * banker's rounding (per ADR-0008 §6) is the only correct end-to-end path.
 *
 * The schemas here:
 *   • DecimalString    — non-negative or zero, up to NUMERIC(18,2).
 *   • SignedDecimalString — same shape, allows leading `-` for storno rows.
 *
 * Format: `^\d{1,16}(\.\d{1,2})?$` — up to 16 digits before decimal +
 *         optional `.ddNN` (1 or 2 fractional). Matches NUMERIC(18,2).
 *
 * The leading `0` rules: we DO accept `'0'`, `'0.00'`, `'0.10'`, `'10.00'`.
 * We REJECT `'01.00'` (leading zero on integer part >= 2 chars) is permitted
 * by the regex but Decimal.js normalizes it — refuse-defensively at the
 * helper layer if needed.
 */

import { Type } from '@sinclair/typebox';

/** Non-negative money string. NUMERIC(18,2)-compatible. */
export const DecimalString = Type.String({
  pattern: '^\\d{1,16}(\\.\\d{1,2})?$',
  examples: ['0.00', '7.98', '142.02', '1999.99'],
  description: 'Non-negative amount in EUR as a decimal string (NUMERIC(18,2)).',
});

/** Signed money string — allows leading `-` for storno rows. */
export const SignedDecimalString = Type.String({
  pattern: '^-?\\d{1,16}(\\.\\d{1,2})?$',
  examples: ['0.00', '142.02', '-142.02'],
  description: 'Signed amount in EUR as a decimal string (NUMERIC(18,2)).',
});

/**
 * Weight in grams as a decimal string. Mirrors `NUMERIC(10,4)` EXACTLY:
 * 10 total digits with 4 after the point leaves **6** before it.
 *
 * ⚠️ EIN GEWICHT IST KEIN GELDBETRAG. Basels Befund vom 05.08.2026: kein
 * einziges Stück liess sich ins Lager aufnehmen. Die Kasse schickte das
 * Gewicht mit drei Nachkommastellen — eine Feinunze wiegt 31,103 g, und jede
 * Juwelierwaage zeigt Milligramm —, die Anlegeprüfung sass aber auf der
 * GELDregel mit zwei Stellen. Der Händler las „Gewicht ungültig bitte prüfen"
 * und sah ein völlig richtiges Gewicht vor sich.
 *
 * Diese Regel gab es zu dem Zeitpunkt schon. Sie war nur nirgends im
 * SCHREIBweg angeschlossen: das Lesen eines Produkts erlaubte vier Stellen,
 * das Anlegen zwei. Zwei Listen, die auseinandergelaufen sind.
 *
 * Die Ziffern vor dem Komma standen früher auf 10 und damit über der Spalte:
 * ein elfstelliges Gewicht kam durch die Prüfung und starb erst unten in der
 * Datenbank an einem Überlauf. Sechs ist die Zahl, die die Spalte wirklich
 * trägt (999999,9999 g, knapp eine Tonne).
 *
 * `dezimalstellen-treffen-die-spalte.guard.test.ts` liest beide Seiten und
 * wird rot, sobald sie wieder auseinanderlaufen.
 */
export const WeightString = Type.String({
  pattern: '^\\d{1,6}(\\.\\d{1,4})?$',
  examples: ['31.1030', '7.9650', '50.0000', '480.0000'],
  description: 'Weight in grams as a decimal string (NUMERIC(10,4)).',
});

/**
 * Outer packing dimension in cm. Mirrors `NUMERIC(7,1)` EXACTLY: 7 total
 * digits with 1 after the point leaves 6 before it.
 *
 * ⚠️ Auch das ist kein Geldbetrag. Auf der Geldregel kam „12.55" durch die
 * Prüfung, und Postgres rundete es beim Schreiben still auf 12,6. Der Wert im
 * Formular und der Wert in der Datenbank waren danach verschieden, ohne dass
 * irgendwo etwas rot wurde. In einem Haus, das Aufzeichnungen führen muss,
 * ist eine stille Rundung schlimmer als eine Abweisung.
 */
export const DimensionString = Type.String({
  pattern: '^\\d{1,6}(\\.\\d)?$',
  examples: ['12.5', '30', '4.0'],
  description: 'Outer packing dimension in cm as a decimal string (NUMERIC(7,1)).',
});

/**
 * Fineness as a decimal string. NUMERIC(5,4)-compatible (up to 4 dp).
 * A purity ratio (e.g. '0.9999' = 999.9/1000), NOT money — it carries up to 4
 * fractional digits, so it must NOT reuse the 2-dp money DecimalString
 * (Postgres returns '0.9000', which the money pattern rejects → 500).
 */
export const FinenessString = Type.String({
  pattern: '^\\d(\\.\\d{1,4})?$',
  examples: ['0.9999', '0.9000', '0.5850', '1.0000'],
  description: 'Metal fineness ratio as a decimal string (NUMERIC(5,4)).',
});

/** VAT rate — 0–1 inclusive, up to 4 fractional digits (e.g. `'0.1900'`). */
export const VatRateString = Type.String({
  pattern: '^(0(\\.\\d{1,4})?|1(\\.0{1,4})?)$',
  examples: ['0.0700', '0.1900', '0.0000', '1.0000'],
  description: 'VAT rate as a decimal between 0 and 1 (e.g. 0.1900 = 19%).',
});
