/**
 * ankauf-receipt — der Ankaufbeleg als druckbarer `ThermalReceiptData`.
 *
 * Der Ankauf ist am Server BEREITS ein vollwertiger fiskalischer Vorgang: die
 * Transaktion wird TSE-signiert (KassenSichV §146a, wie ein Verkauf) und fließt
 * als „Einkauf" in DSFinV-K und DATEV (`GESAMT_BRUTTO_ANKAUF`). Dieser Beleg
 * ERFINDET also keine Steuerbehandlung — er DRUCKT nur den schon gebuchten,
 * schon signierten Vorgang. Das ist der Grund, warum er sicher zu bauen ist.
 *
 * Fiskalische Form des Ankaufbelegs:
 *   • Keine ausgewiesene USt. Der Ankauf von einer Privatperson ist für den Laden
 *     kein steuerbarer Umsatz; die Umsatzsteuer entsteht erst beim Wiederverkauf
 *     unter der Differenzbesteuerung (§25a UStG). `vatEur` = „0,00".
 *   • Der Betrag ist eine AUSZAHLUNG an den Verkäufer, keine Kundenzahlung —
 *     also kein „Gegeben/Rückgeld", sondern „Auszahlung bar/Überweisung".
 *   • Der Verkäufer wird namentlich genannt (GoBD + §25a-Nachweis; der Verkäufer
 *     erhält eine Kopie).
 *
 * Reines Modul: keine React-Importe, direkt testbar. Die TSE-Felder kommen vom
 * Client-Signaturergebnis; fehlt es (TSE-Ausfall), stehen dort dieselben
 * ehrlichen „TSE Ausfall"-Marker wie beim Verkaufsbeleg.
 */
import type { ThermalReceiptData } from './hardware-client.js';
import type { Fiskalzustand } from './fiskalzustand-satz.js';

export interface AnkaufReceiptShop {
  name: string;
  /** Zeilen unter dem Namen (Tagline zuerst, dann Anschrift). Leere fallen weg. */
  tagline: string;
  address: readonly string[];
  vatId: string;
  /** Alternative zur USt-IdNr. nach § 14 Abs. 4 Nr. 2 UStG. */
  taxNumber: string;
  phone: string | null;
}

/** Zeilenname plus Seriennummer plus Gravur, rein und direkt testbar (0143). */
export function zeilennameMitKennzeichen(it: AnkaufReceiptItem): string {
  let name = it.name;
  if (it.seriennummer !== null && it.seriennummer.trim() !== '') {
    name += ` · Ser.-Nr. ${it.seriennummer.trim()}`;
  }
  if (it.gravur !== null && it.gravur.trim() !== '') {
    name += ` · Gravur: »${it.gravur.trim()}«`;
  }
  return name;
}

export interface AnkaufReceiptItem {
  name: string;
  negotiatedPriceEur: string;
  /** 0143: Seriennummer aufs Papier — der GwG-Beleg traegt die Zuordnung. */
  seriennummer: string | null;
  /** 0143: Gravur woertlich, in Anfuehrung. */
  gravur: string | null;
}

/** Das Client-Signaturergebnis, so wie es der TSE-Dienst liefert. */
export interface AnkaufReceiptTse {
  signatureValue: string;
  signatureCounter: number | string;
  transactionNumber: number | string;
  qrPayload: string;
}

export interface AnkaufReceiptInput {
  shop: AnkaufReceiptShop;
  receiptLocator: string;
  /** ISO-Zeitstempel des Abschlusses; wird auf Berliner Zeit formatiert. */
  finalizedAtIso: string;
  cashierName: string;
  /** Klarname des Verkäufers (GwG/§25a). Null, wenn nicht auflösbar. */
  sellerName: string | null;
  payoutMethod: 'CASH' | 'BANK_TRANSFER';
  items: AnkaufReceiptItem[];
  /** Gesamt-Auszahlung als Dezimalzeichenkette. */
  totalEur: string;
  /** Client-TSE-Ergebnis, oder null bei TSE-Ausfall. */
  tse: AnkaufReceiptTse | null;
  /**
   * Der fiskalische Zustand dieses Ankaufbelegs, aus `fiskalzustand-satz.ts`.
   * Ohne ihn müsste die Vorschau aus einer LEEREN Signatur raten, warum sie
   * fehlt — und sie riet bis zum 13.08.2026 immer auf „wird nachgereicht".
   */
  fiskalzustand?: Fiskalzustand;
  /**
   * Optionale Erklärungszeilen aus dem Belegtext `ANKAUFBELEG_DECLARATION`
   * (vom Steuerberater kuratiert). Werden unten angehängt.
   */
  declarationLines?: string[];
}

const TSE_FALLBACK = 'TSE Ausfall';

/** Ein Dezimalbetrag als deutsche Anzeige („1234.50" → „1.234,50"). */
function formatEuro(decimal: string): string {
  const n = Number.parseFloat(decimal);
  if (!Number.isFinite(n)) return decimal;
  return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function buildAnkaufReceipt(input: AnkaufReceiptInput): ThermalReceiptData {
  const payoutLabel =
    input.payoutMethod === 'CASH' ? 'Auszahlung bar' : 'Auszahlung per Überweisung';

  const sellerLine = input.sellerName ? `Verkäufer: ${input.sellerName}` : null;

  return {
    shopName: input.shop.name,
    shopAddress: [input.shop.tagline, ...input.shop.address].filter((l) => l.trim().length > 0),
    shopVatId: input.shop.vatId,
    shopTaxNumber: input.shop.taxNumber,
    shopPhone: input.shop.phone,
    receiptLocator: input.receiptLocator,
    printedAt: (() => {
      const d = new Date(input.finalizedAtIso);
      return Number.isNaN(d.getTime())
        ? input.finalizedAtIso
        : d.toLocaleString('de-DE', { timeZone: 'Europe/Berlin' });
    })(),
    cashierName: input.cashierName,
    shiftId: null,
    items: input.items.map((it) => ({
      // 0143: Nummer und Gravur gehoeren in den Zeilennamen — der Drucker
      // kennt je Zeile nur EIN Textfeld, und die Verkaeuferkopie ist der
      // GwG-Beleg beider Seiten. Komponiert an genau dieser einen Stelle.
      name: zeilennameMitKennzeichen(it),
      quantity: 1,
      unitPriceEur: formatEuro(it.negotiatedPriceEur),
      lineTotalEur: formatEuro(it.negotiatedPriceEur),
      // Kein USt-Satz je Zeile: die Ausweisung erfolgt erst beim Wiederverkauf.
      vatLabel: '',
    })),
    // Kein Umsatzsteuer-Split auf dem Ankauf. Netto = Brutto = Auszahlung.
    subtotalEur: formatEuro(input.totalEur),
    vatEur: '0,00',
    totalEur: formatEuro(input.totalEur),
    paymentMethodLabel: payoutLabel,
    // Der Laden ZAHLT AUS — kein „Gegeben", kein „Rückgeld".
    cashReceivedEur: null,
    changeEur: null,
    tseSignatureValue: input.tse?.signatureValue ?? TSE_FALLBACK,
    tseSignatureCounter: input.tse ? String(input.tse.signatureCounter) : TSE_FALLBACK,
    tseTransactionNumber: input.tse ? String(input.tse.transactionNumber) : TSE_FALLBACK,
    tseQrPayload: input.tse?.qrPayload ?? TSE_FALLBACK,
    ...(input.fiskalzustand ? { fiskalzustand: input.fiskalzustand } : {}),
    footerLines: [
      ...(sellerLine ? [sellerLine] : []),
      'Ankauf gemäß §25a UStG, Differenzbesteuerung beim Wiederverkauf.',
      ...(input.declarationLines ?? []),
    ],
    documentKind: 'ANKAUF',
    counterpartyLabel: sellerLine,
  };
}
