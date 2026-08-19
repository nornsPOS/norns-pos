/**
 * Sample fiscal-export generator (for the Steuerberater's real review).
 *
 * Roman signed off on the PARAMETERS; the accountant still needs to see actual
 * OUTPUT. This regenerates one DATEV EXTF Buchungsstapel + one Kassenbericht CSV
 * from representative fixture data into `docs/samples/`, using the REAL builders
 * (no hand-faked output). It doubles as a smoke test of the two exporters.
 *
 * DSFinV-K is intentionally NOT sampled here: there is no local file generator —
 * the worker pushes each finalized closing to Fiskaly's cloud
 * (`apps/worker/src/jobs/dsfinvk-daily-export.ts` → fiskaly-dsfinvk.ts), and
 * Fiskaly returns the DSFinV-K bundle. See docs/samples/README.md.
 *
 * KNOWN CAVEAT surfaced in the DATEV sample: every VERKAUF posts to the single
 * revenue account 8400 (KONTO_ERLOESE) regardless of tax_treatment_code — see
 * the TODO in routes/closing-export.ts and the question in docs/samples/README.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import type { DATEVRow } from '../../src/lib/datev-export.js';
import { baueBuchungsstapel, datevDateiname, kodiereAnsi } from '../../src/lib/datev-format.js';
import { zuDatevZeile } from '../../src/routes/closing-export.js';
import {
  type KassenberichtInput,
  buildKassenberichtCsv,
} from '../../src/lib/kassenbericht-export.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = resolve(__dirname, '..', '..', '..', '..', 'docs', 'samples');

// SKR03 accounts as the live exporter uses them (closing-export.ts).
const KONTO_KASSE = '1000';
const KONTO_ERLOESE = '8400';
const KONTO_WARENEINGANG = '3200';

/**
 * Representative one-day booking set. NOTE: all three VERKAUF lines — a 19% sale,
 * a §25a margin sale, and a §25c investment-gold sale — map to the SAME contra
 * account 8400, which is the caveat the accountant must rule on.
 */
const SAMPLE_DATEV_ROWS: DATEVRow[] = [
  {
    amountEur: '1190.00',
    debitCredit: 'S',
    account: KONTO_KASSE,
    contraAccount: KONTO_ERLOESE,
    date: '2026-06-06',
    reference: 'VK-2026-000123',
    bookingText: 'VERKAUF VK-2026-000123 (STANDARD_19)',
  },
  {
    amountEur: '850.00',
    debitCredit: 'S',
    account: KONTO_KASSE,
    contraAccount: KONTO_ERLOESE,
    date: '2026-06-06',
    reference: 'VK-2026-000124',
    bookingText: 'VERKAUF VK-2026-000124 (MARGIN_25A)',
  },
  {
    amountEur: '2200.00',
    debitCredit: 'S',
    account: KONTO_KASSE,
    contraAccount: KONTO_ERLOESE,
    date: '2026-06-06',
    reference: 'VK-2026-000125',
    bookingText: 'VERKAUF VK-2026-000125 (INVESTMENT_GOLD_25C)',
  },
  {
    amountEur: '600.00',
    debitCredit: 'S',
    account: KONTO_WARENEINGANG,
    contraAccount: KONTO_KASSE,
    date: '2026-06-06',
    reference: 'AK-2026-000045',
    bookingText: 'ANKAUF AK-2026-000045 (MARGIN_25A)',
  },
];

const SAMPLE_CLOSING: KassenberichtInput = {
  businessDay: '2026-06-06',
  state: 'FINALIZED',
  verkaufCount: 3,
  ankaufCount: 1,
  stornoCount: 0,
  grossVerkaufEur: '4240.00',
  grossAnkaufEur: '600.00',
  netVerkaufEur: '4240.00',
  netAnkaufEur: '600.00',
  // Neu mit Wanderung 0112: der Storno mit BETRAG, nicht nur als Anzahl.
  stornoVerkaufEur: '0.00',
  rueckgabeVerkaufEur: '0.00',
  rueckgabeCount: 0,
  stornoAnkaufEur: '0.00',
  vatByTreatment: { STANDARD_19: '190.00', MARGIN_25A: '127.73', INVESTMENT_GOLD_25C: '0.00' },
  paymentsByMethod: { CASH: '3640.00', ZVT_CARD: '600.00' },
  // Anfangsbestand 200,00 + Bareinnahmen (CASH oben) 3640,00 = 3840,00 —
  // dieselbe Zahl wie `cashExpectedEur`, damit die Musterdatei ohne
  // Gegenprobe-Zeile bleibt.
  bargeldbewegungen: [{ direction: 'OPENING_FLOAT', amountEur: '200.00' }],
  ausgabenOhneZahlweg: 0,
  barausgabenEur: '0.00',
  anfangsbestandEur: '200.00',
  barauszahlungAnkaufEur: '0.00',
  cashExpectedEur: '3840.00',
  cashCountedEur: '3838.00',
  // ⚠️ Hier stand `zNr: '1'` mit dem Vermerk aus Wanderung 0124. Das Feld
  // gehört aber dem DSFinV-K-Abschluss (`DsfinvkClosingInput`) und NICHT dem
  // Kassenbericht: dieser Bericht nennt den Tag, keine Abschlussfolge. Der
  // Wert war hier wirkungslos und machte allein die Typprüfung der Tests rot.
  cashVarianceEur: '-2.00',
  tseFinishedCount: 4,
  tsePendingCount: 0,
  tseFailedCount: 0,
  finalizedAt: '2026-06-06T20:05:00.000Z',
};

describe('fiscal export samples (regenerated for the Steuerberater)', () => {
  it('writes a real DATEV EXTF Buchungsstapel sample', () => {
    // Die Musterangaben des Steuerberaters — im MUSTER erfunden, im Betrieb
    // aus `system_settings`. Ohne sie gibt es keine Datei; siehe
    // `datev-mandant.ts`.
    const mandant = {
      beraternummer: 29098,
      mandantennummer: 55003,
      wirtschaftsjahrBeginn: '2026-01-01',
      sachkontenlaenge: 4,
      festschreibung: false,
      sachkontenrahmen: '03' as const,
    };
    const zeitraum = { von: '2026-06-06', bis: '2026-06-06' };
    const csv = baueBuchungsstapel(
      mandant,
      zeitraum,
      'Kasse 2026-06-06',
      SAMPLE_DATEV_ROWS.map(zuDatevZeile),
      new Date('2026-06-06T20:05:00.000Z'),
    );

    const zeilen = csv.split('\r\n');
    expect(zeilen[0]!.startsWith('"EXTF";700;21;"Buchungsstapel";13;')).toBe(true);
    expect(zeilen[0]!.split(';').length).toBe(31);
    expect(zeilen[1]!.split(';').length).toBe(125);
    // Die drei Steuerbehandlungen stehen im Buchungstext, wie bisher.
    expect(csv).toContain('STANDARD_19');
    expect(csv).toContain('MARGIN_25A');
    expect(csv).toContain('INVESTMENT_GOLD_25C');

    mkdirSync(SAMPLES_DIR, { recursive: true });
    // Als ANSI geschrieben, wie DATEVs Formatdefinition es verlangt — das
    // Muster soll BYTEGLEICH sein mit dem, was der Berater bekommt.
    writeFileSync(resolve(SAMPLES_DIR, datevDateiname(mandant, zeitraum)), kodiereAnsi(csv));
  });

  it('writes a real Kassenbericht CSV sample', () => {
    const csv = buildKassenberichtCsv(SAMPLE_CLOSING);
    expect(csv.split('\r\n')[0]).toBe('Kassenbericht;06.06.2026');
    expect(csv).toContain('Umsatz;Verkauf netto vor Storno;4240,00 EUR');
    expect(csv).toContain('Kasse;Differenz;-2,00 EUR');
    mkdirSync(SAMPLES_DIR, { recursive: true });
    writeFileSync(resolve(SAMPLES_DIR, 'Kassenbericht_2026-06-06.csv'), csv, 'utf8');
  });
});
