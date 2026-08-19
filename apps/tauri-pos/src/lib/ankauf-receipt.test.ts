import { describe, expect, it } from 'vitest';

import { type AnkaufReceiptInput, buildAnkaufReceipt, zeilennameMitKennzeichen } from './ankauf-receipt.js';

const base: AnkaufReceiptInput = {
  shop: {
    name: 'Warehouse 14',
    tagline: 'Antiquitäten',
    address: ['Musterstraße 1', '79576 Weil am Rhein'],
    vatId: 'DE123456789',
    taxNumber: '',
    phone: '+49 7621 000',
  },
  receiptLocator: 'A-2026-000042',
  finalizedAtIso: '2026-07-12T14:30:00Z',
  cashierName: 'Inhaber',
  sellerName: 'Hans Mustermann',
  payoutMethod: 'CASH',
  items: [
    { name: 'Goldkette 585', negotiatedPriceEur: '120.00', seriennummer: null, gravur: null },
    { name: 'Silbermünze', negotiatedPriceEur: '30.50', seriennummer: null, gravur: null },
  ],
  totalEur: '150.50',
  tse: {
    signatureValue: 'sig-abc',
    signatureCounter: 77,
    transactionNumber: 1234,
    qrPayload: 'qr-xyz',
  },
};

describe('buildAnkaufReceipt', () => {
  it('marks the document as ANKAUF and names the seller', () => {
    const r = buildAnkaufReceipt(base);
    expect(r.documentKind).toBe('ANKAUF');
    expect(r.counterpartyLabel).toBe('Verkäufer: Hans Mustermann');
    expect(r.footerLines).toContain('Verkäufer: Hans Mustermann');
  });

  it('shows NO output VAT — the buy-in is not a taxable supply (§25a on resale)', () => {
    const r = buildAnkaufReceipt(base);
    expect(r.vatEur).toBe('0,00');
    // Net equals gross equals the payout; nothing is split off.
    expect(r.subtotalEur).toBe('150,50');
    expect(r.totalEur).toBe('150,50');
    expect(r.footerLines.some((l) => l.includes('§25a'))).toBe(true);
    for (const item of r.items) expect(item.vatLabel).toBe('');
  });

  it('is a payout, never a customer payment with change', () => {
    expect(buildAnkaufReceipt(base).paymentMethodLabel).toBe('Auszahlung bar');
    expect(buildAnkaufReceipt({ ...base, payoutMethod: 'BANK_TRANSFER' }).paymentMethodLabel).toBe(
      'Auszahlung per Überweisung',
    );
    const r = buildAnkaufReceipt(base);
    expect(r.cashReceivedEur).toBeNull();
    expect(r.changeEur).toBeNull();
  });

  it('carries the client TSE signature onto the receipt', () => {
    const r = buildAnkaufReceipt(base);
    expect(r.tseSignatureValue).toBe('sig-abc');
    expect(r.tseSignatureCounter).toBe('77');
    expect(r.tseTransactionNumber).toBe('1234');
    expect(r.tseQrPayload).toBe('qr-xyz');
  });

  it('prints honest TSE-Ausfall markers when the signature is missing (never blank)', () => {
    const r = buildAnkaufReceipt({ ...base, tse: null });
    expect(r.tseSignatureValue).toBe('TSE Ausfall');
    expect(r.tseSignatureCounter).toBe('TSE Ausfall');
    expect(r.tseTransactionNumber).toBe('TSE Ausfall');
    expect(r.tseQrPayload).toBe('TSE Ausfall');
  });

  it('formats item + total money in German and keeps the shop identity', () => {
    const r = buildAnkaufReceipt(base);
    expect(r.items[0]!.lineTotalEur).toBe('120,00');
    expect(r.shopVatId).toBe('DE123456789');
    expect(r.shopAddress).toEqual(['Antiquitäten', 'Musterstraße 1', '79576 Weil am Rhein']);
  });

  it('appends curated Steuerberater declaration lines when supplied', () => {
    const r = buildAnkaufReceipt({ ...base, declarationLines: ['Ware frei von Rechten Dritter.'] });
    expect(r.footerLines).toContain('Ware frei von Rechten Dritter.');
  });

  it('omits the seller line when the seller name is unknown', () => {
    const r = buildAnkaufReceipt({ ...base, sellerName: null });
    expect(r.counterpartyLabel).toBeNull();
    expect(r.footerLines.some((l) => l.startsWith('Verkäufer:'))).toBe(false);
  });
});

describe('0143: die Zeile traegt Nummer und Gravur', () => {
  it('Name, dann Ser.-Nr., dann Gravur in Anfuehrung, nur wenn vorhanden', () => {
    expect(
      zeilennameMitKennzeichen({
        name: 'Rolex Datejust',
        negotiatedPriceEur: '3200.00',
        seriennummer: 'R-88231-X',
        gravur: 'Für Opa Heinz',
      }),
    ).toBe('Rolex Datejust · Ser.-Nr. R-88231-X · Gravur: »Für Opa Heinz«');
  });

  it('ohne Kennzeichen bleibt der Name unangetastet', () => {
    expect(
      zeilennameMitKennzeichen({
        name: 'Altgold 585',
        negotiatedPriceEur: '100.00',
        seriennummer: null,
        gravur: null,
      }),
    ).toBe('Altgold 585');
  });

  it('leere Zeichenketten zaehlen wie NULL, Raender werden getrimmt', () => {
    expect(
      zeilennameMitKennzeichen({
        name: 'Uhr',
        negotiatedPriceEur: '1.00',
        seriennummer: '  ',
        gravur: ' M.K. ',
      }),
    ).toBe('Uhr · Gravur: »M.K.«');
  });
});
