/**
 * DSFinV-K export generator — local DFKA-Taxonomie Kassendaten bundle.
 *
 * Pure + read-only: `buildDsfinvkBundle` RE-EXPRESSES already-fetched real
 * fiscal rows (transactions, items, payments, TSE signatures, the daily
 * closing) as the DSFinV-K core CSV files + index.xml. It never recomputes a
 * fiscal figure, never invents one, and never touches the DB. Money stays an
 * integer-cents / NUMERIC(18,2) string; only the decimal separator is the
 * DSFinV-K dot. `zipDsfinvkBundle` packs the files into a deterministic ZIP.
 *
 * These tests pin: the taxonomy filenames + column headers, the VAT-treatment
 * → USt-Schlüssel mapping, decimal formatting, TSE field mapping, totals
 * reconciliation with the daily_closing, and a multi-receipt day.
 */
import { describe, expect, it } from 'vitest';

import {
  type DsfinvkBundleInput,
  UST_SCHLUESSEL,
  buildDsfinvkBundle,
  fileByName,
  zipDsfinvkBundle,
} from '../../src/lib/dsfinvk-export.js';

/** A realistic single-day bundle: 2 sales (19% + §25a), 1 ankauf, 1 storno. */
function sample(overrides: Partial<DsfinvkBundleInput> = {}): DsfinvkBundleInput {
  return {
    businessDay: '2026-06-06',
    closing: {
      finalizedAt: '2026-06-06T20:05:00.000Z',
      grossVerkaufEur: '595.00',
      grossAnkaufEur: '300.00',
      netVerkaufEur: '512.61',
      netAnkaufEur: '300.00',
      vatByTreatment: { STANDARD_19: '95.00', MARGIN_25A: '0.00' },
      paymentsByMethod: { CASH: '595.00' },
      cashCountedEur: '595.00',
      // 0124: Z_NR ist eine FOLGE. Ohne sie wird kein Paket gebaut.
      zNr: '1',
    },
    cashRegister: {
      id: 'POS-1',
      serialNumber: 'TSE-SERIAL-AAA',
      brand: 'Warehouse14',
      model: 'tauri-pos',
    },
    receipts: [
      {
        transactionId: 't-1',
        receiptLocator: 'RCP-2026-000101',
        direction: 'VERKAUF',
        finalizedAt: '2026-06-06T10:00:00.000Z',
        taxTreatmentCode: 'STANDARD_19',
        subtotalEur: '500.00',
        vatEur: '95.00',
        totalEur: '595.00',
        cashierUserId: 'u-1',
        customerId: null,
        isStorno: false,
        lines: [
          {
            lineNumber: 1,
            productName: 'Goldmünze Krügerrand',
            quantity: '1.000',
            appliedTaxTreatmentCode: 'STANDARD_19',
            appliedVatRate: '0.1900',
            lineSubtotalEur: '500.00',
            lineVatEur: '95.00',
            lineTotalEur: '595.00',
          },
        ],
        payments: [{ paymentMethod: 'CASH', amountEur: '595.00' }],
        tse: {
          fiskalyTransactionNumber: '4001',
          signatureCounter: '9001',
          signatureValue: 'BASE64SIG==',
          signatureAlgorithm: 'ecdsa-plain-SHA256',
          fiskalyTssId: '11111111-1111-1111-1111-111111111111',
          processType: 'Kassenbeleg-V1',
          tseStartTime: '2026-06-06T09:59:58.000Z',
          tseEndTime: '2026-06-06T10:00:00.000Z',
        },
      },
    ],
    ...overrides,
  };
}

describe('buildDsfinvkBundle — taxonomy files present', () => {
  it('emits the DSFinV-K core CSV files + index.xml', () => {
    const files = buildDsfinvkBundle(sample());
    const names = files.map((f) => f.name).sort();
    for (const required of [
      'cashpointclosing.csv',
      'bon_kopf.csv',
      'bon_pos.csv',
      'bon_pos_preise.csv',
      'bon_pos_ust.csv',
      'datapayment.csv',
      'bon_ust.csv',
      'tse.csv',
      'index.xml',
    ]) {
      expect(names).toContain(required);
    }
  });
});

describe('buildDsfinvkBundle — column headers (DFKA taxonomy)', () => {
  it('bon_kopf.csv header carries the canonical receipt-header columns', () => {
    const csv = fileByName(buildDsfinvkBundle(sample()), 'bon_kopf.csv');
    const header = csv.split('\r\n')[0] ?? '';
    expect(header).toContain('Z_KASSE_ID');
    expect(header).toContain('BON_ID');
    expect(header).toContain('BON_NR');
    expect(header).toContain('BON_TYP');
  });

  it('bon_pos.csv header carries the line columns', () => {
    const csv = fileByName(buildDsfinvkBundle(sample()), 'bon_pos.csv');
    const header = csv.split('\r\n')[0] ?? '';
    expect(header).toContain('BON_ID');
    expect(header).toContain('POS_ZEILE');
    expect(header).toContain('ARTIKELTEXT');
    expect(header).toContain('MENGE');
  });

  it('bon_pos_ust.csv header carries the per-line VAT columns', () => {
    const csv = fileByName(buildDsfinvkBundle(sample()), 'bon_pos_ust.csv');
    const header = csv.split('\r\n')[0] ?? '';
    expect(header).toContain('UST_SCHLUESSEL');
    expect(header).toContain('POS_BRUTTO');
    expect(header).toContain('POS_NETTO');
    expect(header).toContain('POS_UST');
  });

  it('bon_pos_preise.csv carries the price/quantity breakdown (NOT the VAT-key file)', () => {
    const csv = fileByName(buildDsfinvkBundle(sample()), 'bon_pos_preise.csv');
    const header = csv.split('\r\n')[0] ?? '';
    // Per the DFKA taxonomy bonpos_preise is the per-position PRICE detail:
    // gross/net/tax of the position + quantity. It does NOT carry UST_SCHLUESSEL
    // (that lives in bon_pos_ust).
    expect(header).toContain('ANZAHL'); // quantity of the position
    expect(header).toContain('BRUTTO'); // position gross
    expect(header).toContain('NETTO'); // position net
    expect(header).not.toContain('UST_SCHLUESSEL');
  });
});

describe('buildDsfinvkBundle — bon_pos_preise ≠ bon_pos_ust (DFKA differentiation)', () => {
  it('the two files have DIFFERENT headers (not byte-identical duplicates)', () => {
    const files = buildDsfinvkBundle(sample());
    const preise = fileByName(files, 'bon_pos_preise.csv').split('\r\n')[0] ?? '';
    const ust = fileByName(files, 'bon_pos_ust.csv').split('\r\n')[0] ?? '';
    expect(preise).not.toBe(ust);
  });

  it('bon_pos_ust still carries the USt-Schlüssel; bon_pos_preise does not', () => {
    const files = buildDsfinvkBundle(sample());
    const preiseHeader = fileByName(files, 'bon_pos_preise.csv').split('\r\n')[0] ?? '';
    const ustHeader = fileByName(files, 'bon_pos_ust.csv').split('\r\n')[0] ?? '';
    expect(ustHeader).toContain('UST_SCHLUESSEL');
    expect(preiseHeader).not.toContain('UST_SCHLUESSEL');
  });

  it('bon_pos_preise carries the quantity (ANZAHL) column the VAT file omits', () => {
    const files = buildDsfinvkBundle(sample());
    const preiseHeader = fileByName(files, 'bon_pos_preise.csv').split('\r\n')[0] ?? '';
    const ustHeader = fileByName(files, 'bon_pos_ust.csv').split('\r\n')[0] ?? '';
    expect(preiseHeader).toContain('ANZAHL');
    expect(ustHeader).not.toContain('ANZAHL');
  });

  it('the 19% sale position appears with its gross/net/tax in bon_pos_preise', () => {
    const csv = fileByName(buildDsfinvkBundle(sample()), 'bon_pos_preise.csv');
    expect(csv).toContain('RCP-2026-000101'); // BON_ID
    expect(csv).toContain('595.00'); // position gross
    expect(csv).toContain('500.00'); // position net
    expect(csv).toContain('95.00'); // position tax
  });
});

describe('buildDsfinvkBundle — VAT treatment → USt-Schlüssel mapping', () => {
  it('STANDARD_19 → key 1, REDUCED_7 → key 2, INVESTMENT_GOLD_25C → key 5, MARGIN_25A → key 7', () => {
    expect(UST_SCHLUESSEL.STANDARD_19).toBe('1');
    expect(UST_SCHLUESSEL.REDUCED_7).toBe('2');
    expect(UST_SCHLUESSEL.INVESTMENT_GOLD_25C).toBe('5');
    expect(UST_SCHLUESSEL.MARGIN_25A).toBe('7');
  });

  it('the 19% sale line carries USt-Schlüssel 1 in bon_pos_ust.csv', () => {
    const csv = fileByName(buildDsfinvkBundle(sample()), 'bon_pos_ust.csv');
    // BON_ID = receiptLocator, POS_ZEILE = 1, UST_SCHLUESSEL = 1
    expect(csv).toContain('RCP-2026-000101;1;1;');
  });
});

describe('buildDsfinvkBundle — decimal formatting (no float, DSFinV-K dot)', () => {
  it('emits a 2-decimal dot string for money amounts', () => {
    const csv = fileByName(buildDsfinvkBundle(sample()), 'bon_pos_ust.csv');
    expect(csv).toContain('595.00'); // POS_BRUTTO
    expect(csv).toContain('500.00'); // POS_NETTO
    expect(csv).toContain('95.00'); // POS_UST
  });
});

describe('buildDsfinvkBundle — TSE fields mapped from tse_signatures', () => {
  it('tse.csv carries Transaktionsnummer, Signaturzähler, Seriennummer, Signatur', () => {
    const csv = fileByName(buildDsfinvkBundle(sample()), 'tse.csv');
    expect(csv).toContain('4001'); // TSE_TA_NUMMER (Transaktionsnummer)
    expect(csv).toContain('9001'); // TSE_TA_SIGZ (Signaturzähler)
    expect(csv).toContain('BASE64SIG=='); // TSE_TA_SIG
    expect(csv).toContain('11111111-1111-1111-1111-111111111111'); // TSE_ID / Seriennummer ref
  });
});

describe('buildDsfinvkBundle — cashpointclosing header + totals reconcile', () => {
  it('cashpointclosing.csv reflects the closing business day + finalize time', () => {
    const csv = fileByName(buildDsfinvkBundle(sample()), 'cashpointclosing.csv');
    expect(csv).toContain('2026-06-06'); // Z_BUCHUNGSTAG / business day
  });

  it('the bon_ust.csv VAT total reconciles with the daily_closing vatByTreatment', () => {
    const csv = fileByName(buildDsfinvkBundle(sample()), 'bon_ust.csv');
    // STANDARD_19 day-total VAT = 95.00 from the closing's vatByTreatment
    expect(csv).toContain('95.00');
  });
});

describe('buildDsfinvkBundle — mixed-treatment receipt splits bon_ust per USt-Schlüssel', () => {
  it('emits one Bonkopf-USt row per rate, never collapsing an exempt line onto 19 %', () => {
    const input = sample({
      receipts: [
        {
          transactionId: 't-mix',
          receiptLocator: 'RCP-2026-000199',
          direction: 'VERKAUF',
          finalizedAt: '2026-06-06T12:00:00.000Z',
          // Receipt-level code is STANDARD_19 — the OLD buildBonUst keyed the
          // whole Bon on this, collapsing the exempt gold line onto 19 %.
          taxTreatmentCode: 'STANDARD_19',
          subtotalEur: '600.00',
          vatEur: '19.00',
          totalEur: '619.00',
          cashierUserId: 'u-1',
          customerId: null,
          isStorno: false,
          lines: [
            {
              lineNumber: 1,
              productName: 'Standard-Artikel 19 %',
              quantity: '1.000',
              appliedTaxTreatmentCode: 'STANDARD_19',
              appliedVatRate: '0.1900',
              lineSubtotalEur: '100.00',
              lineVatEur: '19.00',
              lineTotalEur: '119.00',
            },
            {
              lineNumber: 2,
              productName: 'Anlagegold (§ 25c steuerfrei)',
              quantity: '1.000',
              appliedTaxTreatmentCode: 'INVESTMENT_GOLD_25C',
              appliedVatRate: '0.0000',
              lineSubtotalEur: '500.00',
              lineVatEur: '0.00',
              lineTotalEur: '500.00',
            },
          ],
          payments: [{ paymentMethod: 'CASH', amountEur: '619.00' }],
          tse: {
            fiskalyTransactionNumber: '4003',
            signatureCounter: '9003',
            signatureValue: 'BASE64SIG3==',
            signatureAlgorithm: 'ecdsa-plain-SHA256',
            fiskalyTssId: '11111111-1111-1111-1111-111111111111',
            processType: 'Kassenbeleg-V1',
            tseStartTime: null,
            tseEndTime: null,
          },
        },
      ],
    });
    const csv = fileByName(buildDsfinvkBundle(input), 'bon_ust.csv');
    const dataRows = csv
      .split('\r\n')
      .slice(1)
      .filter((r) => r.includes('RCP-2026-000199'));
    // One row per USt-Schlüssel present in the receipt's LINES.
    expect(dataRows).toHaveLength(2);
    // 19 % (key 1): brutto 119.00 / netto 100.00 / USt 19.00 — the line total, not 619.00.
    expect(csv).toContain(';1;119.00;100.00;19.00');
    // §25c investment gold (key 5): booked exempt (USt 0.00), not folded into 19 %.
    expect(csv).toContain(';5;500.00;500.00;0.00');
    // The old collapse (the whole 619.00 booked under 19 %) must be gone.
    expect(csv).not.toContain(';1;619.00;600.00;19.00');
  });
});

describe('buildDsfinvkBundle — multi-receipt day', () => {
  it('emits one bon_kopf row per receipt (header + 2 data rows)', () => {
    const input = sample();
    input.receipts.push({
      transactionId: 't-2',
      receiptLocator: 'RCP-2026-000102',
      direction: 'ANKAUF',
      finalizedAt: '2026-06-06T11:00:00.000Z',
      taxTreatmentCode: 'MARGIN_25A',
      subtotalEur: '300.00',
      vatEur: '0.00',
      totalEur: '300.00',
      cashierUserId: 'u-1',
      customerId: 'c-9',
      isStorno: false,
      lines: [
        {
          lineNumber: 1,
          productName: 'Altgold Ankauf',
          quantity: '1.000',
          appliedTaxTreatmentCode: 'MARGIN_25A',
          appliedVatRate: null,
          lineSubtotalEur: '300.00',
          lineVatEur: '0.00',
          lineTotalEur: '300.00',
        },
      ],
      payments: [{ paymentMethod: 'CASH', amountEur: '300.00' }],
      tse: {
        fiskalyTransactionNumber: '4002',
        signatureCounter: '9002',
        signatureValue: 'BASE64SIG2==',
        signatureAlgorithm: 'ecdsa-plain-SHA256',
        fiskalyTssId: '11111111-1111-1111-1111-111111111111',
        processType: 'Kassenbeleg-V1',
        tseStartTime: null,
        tseEndTime: null,
      },
    });
    const csv = fileByName(buildDsfinvkBundle(input), 'bon_kopf.csv');
    const dataRows = csv
      .split('\r\n')
      .filter((l) => l.length > 0)
      .slice(1);
    expect(dataRows).toHaveLength(2);
    expect(csv).toContain('RCP-2026-000101');
    expect(csv).toContain('RCP-2026-000102');
  });

  it('a storno receipt is typed AVTransfer/Beleg-Storno (not a normal Beleg)', () => {
    const input = sample();
    const r0 = input.receipts[0];
    if (r0) r0.isStorno = true;
    const csv = fileByName(buildDsfinvkBundle(input), 'bon_kopf.csv');
    // BON_TYP carries a storno marker, not the default 'Beleg'
    expect(csv).toMatch(/RCP-2026-000101;[^;]*;[^;]*Storno/i);
  });
});

describe('buildDsfinvkBundle — honest empty-state', () => {
  it('a day with no receipts still emits headers + index.xml (no fabricated rows)', () => {
    const input = sample({ receipts: [] });
    const files = buildDsfinvkBundle(input);
    const kopf = fileByName(files, 'bon_kopf.csv');
    const dataRows = kopf
      .split('\r\n')
      .filter((l) => l.length > 0)
      .slice(1);
    expect(dataRows).toHaveLength(0); // header only, no fabricated receipts
    expect(fileByName(files, 'index.xml')).toContain('cashpointclosing.csv');
  });
});

describe('zipDsfinvkBundle — deterministic ZIP packaging', () => {
  it('produces a Buffer beginning with the ZIP local-file signature (PK\\x03\\x04)', () => {
    const zip = zipDsfinvkBundle(buildDsfinvkBundle(sample()));
    expect(Buffer.isBuffer(zip)).toBe(true);
    expect(zip.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  });

  it('ends with the End-of-Central-Directory signature (PK\\x05\\x06)', () => {
    const zip = zipDsfinvkBundle(buildDsfinvkBundle(sample()));
    // EOCD is the last 22 bytes (no zip comment).
    const eocd = zip.subarray(zip.length - 22, zip.length - 18);
    expect(eocd).toEqual(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  });

  it('is byte-for-byte deterministic for the same input', () => {
    const a = zipDsfinvkBundle(buildDsfinvkBundle(sample()));
    const b = zipDsfinvkBundle(buildDsfinvkBundle(sample()));
    expect(a.equals(b)).toBe(true);
  });
});
