/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EIN TAG ALS DSFinV-K-PAKET — der eine Erzeuger fuer zwei Rufer
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 18.08.2026: herausgeloest aus `routes/closing-export.ts` (dort seit dem
 * 28.07. gewachsen), WORTGLEICH, weil ein zweiter Rufer entstand: das
 * Prueferpaket der Kassennachschau (§ 146b AO) buendelt VIELE Tage in eine
 * Datei, und ein kopierter Erzeuger waere nach der ersten Aenderung ein
 * zweiter Erzeuger. Die Route ruft weiter hierher; jede fachliche
 * Begruendung im Rumpf stammt aus der Routen-Geschichte und gilt unveraendert.
 */

import { sql } from 'drizzle-orm';
import type { AppDb } from '@norns/db/client';

import { ERZEUGNIS_MARKE, ERZEUGNIS_MODELL } from './erzeugnis.js';
import {
  type DsfinvkBundleInput,
  type DsfinvkReceiptInput,
  zipDsfinvkBundle,
} from './dsfinvk-export.js';
import {
  amtlicheBeschreibung,
  amtlicheTaxonomie,
  DSFINVK_FASSUNG,
} from './dsfinvk-amtlich.js';
import { formeDaten, kassensoftwareFassung } from './dsfinvk-daten.js';
import { baueAlleDateien } from './dsfinvk-dateien.js';
import { kuerzeAufZeichen } from './dsfinvk-bauplan.js';
import { leseTaxonomie } from './dsfinvk-taxonomie.js';
import {
  leseStammdaten,
  StammdatenUnvollstaendigError,
} from './haendler-stammdaten.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

export class ClosingNotFoundError extends DomainError {
  public readonly httpStatus = 404;
  public readonly code: ApiErrorCode = 'NOT_FOUND';
}

export class ClosingNotFinalizedError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

// ── DSFinV-K export row shapes (READ-ONLY; mapped to the pure generator) ──
//   `type` (not `interface`) to satisfy the `Record<string, unknown>` bound on
//   `db.execute<T>`.
type ClosingDsfinvkRow = {
  business_day: string;
  finalized_at: Date | null;
  gross_verkauf_eur: string;
  storno_verkauf_eur: string;
  storno_ankauf_eur: string;
  gross_ankauf_eur: string;
  net_verkauf_eur: string;
  net_ankauf_eur: string;
  vat_by_treatment: Record<string, string> | null;
  umsatz_by_treatment: Record<string, { brutto: string; netto: string }> | null;
  payments_by_method: Record<string, string> | null;
  cash_counted_eur: string | null;
  /** DSFinV-K Z_NR (Wanderung 0124). `null` bei einem nicht festgeschriebenen Satz. */
  z_nr: string | null;
};

type DsfinvkTxRow = {
  id: string;
  receipt_locator: string;
  direction: string;
  finalized_at: Date;
  /** 0147 — Beginn des Vorgangs (erstes Stueck im Korb). NULL = unbekannt. */
  vorgang_begonnen_at: Date | null;
  tax_treatment_code: string;
  subtotal_eur: string;
  vat_eur: string;
  total_eur: string;
  cashier_user_id: string;
  customer_id: string | null;
  is_storno: boolean;
  storno_von_beleg: string | null;
  storno_von_z_nr: string | null;
  storno_von_erstellung: Date | string | null;
};

type DsfinvkItemRow = {
  transaction_id: string;
  display_order: number;
  product_name: string;
  /** 0143: Seriennummer der lebenden Produktzeile. */
  seriennummer: string | null;
  applied_tax_treatment_code: string;
  applied_vat_rate: string | null;
  line_subtotal_eur: string;
  line_vat_eur: string;
  line_total_eur: string;
  line_discount_eur: string;
  line_discount_reason: string | null;
  acquisition_cost_eur_snapshot: string | null;
  margin_eur: string | null;
};

type DsfinvkPaymentRow = {
  transaction_id: string;
  payment_method: string;
  amount_eur: string;
};

type DsfinvkTseRow = {
  transaction_id: string;
  fiskaly_tss_id: string;
  fiskaly_transaction_number: string;
  signature_counter: string;
  signature_value: string;
  signature_algorithm: string | null;
  /** `TSE_SERIAL` der `tse.csv`. NULL bei Belegen von vor Wanderung 0141. */
  tss_serial_number: string | null;
  /** `TSE_PUBLIC_KEY` der `tse.csv`. Ohne ihn ist keine Signatur prüfbar. */
  signature_public_key: string | null;
  process_type: string;
  tse_start_time: Date | null;
  tse_end_time: Date | null;
};

/** "123.45" → 12345n. Throws on a malformed decimal (defensive; DB-sourced). */
function eurToCents(eur: string): bigint {
  if (!/^-?\d+(\.\d{1,2})?$/.test(eur.trim())) {
    // DB-sourced NUMERIC(18,2) — a non-decimal here is a server invariant break.
    throw new Error(`closing-export: invalid line total "${eur}"`);
  }
  const v = eur.trim();
  const sign = v.startsWith('-') ? -1n : 1n;
  const abs = v.startsWith('-') ? v.slice(1) : v;
  const [whole = '0', frac = ''] = abs.split('.');
  const fracPadded = frac.padEnd(2, '0').slice(0, 2);
  return sign * (BigInt(whole) * 100n + BigInt(fracPadded || '0'));
}

/** 12345n → "123.45". */
function centsToEur(c: bigint): string {
  const sign = c < 0n ? '-' : '';
  const abs = c < 0n ? -c : c;
  return `${sign}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
}

export { eurToCents, centsToEur };

/**
 * Baut das vollstaendige DSFinV-K-Tagespaket eines FINALISIERTEN Abschlusses.
 *
 * Wirft `ClosingNotFoundError` / `ClosingNotFinalizedError` /
 * `StammdatenUnvollstaendigError` / `ZNummerFehltError` (aus `formeDaten`),
 * exakt wie die Route es immer tat.
 */
/** Artikeltext plus Seriennummer, an EINER Stelle komponiert und auf die
 *  DSFinV-K-Feldgrenze von 255 Zeichen gekappt (0143). */
function artikeltextMitNummer(name: string, seriennummer: string | null): string {
  const voll = seriennummer === null || seriennummer.trim() === ''
    ? name
    : `${name} · Ser.-Nr. ${seriennummer.trim()}`;
  // Am ZEICHEN kuerzen, nie mitten in ein Emoji (siehe kuerzeAufZeichen).
  return kuerzeAufZeichen(voll, 255);
}

export async function baueDsfinvkTagZip(
  db: AppDb,
  id: string,
): Promise<{ businessDay: string; zip: Buffer }> {
  const closingRows = await db.execute<ClosingDsfinvkRow & { state: string }>(sql`
    SELECT business_day::text AS business_day,
           state::text AS state,
           finalized_at,
           gross_verkauf_eur::text AS gross_verkauf_eur,
           storno_verkauf_eur::text AS storno_verkauf_eur,
           storno_ankauf_eur::text  AS storno_ankauf_eur,
           gross_ankauf_eur::text  AS gross_ankauf_eur,
           net_verkauf_eur::text   AS net_verkauf_eur,
           net_ankauf_eur::text    AS net_ankauf_eur,
           vat_by_treatment, umsatz_by_treatment, payments_by_method,
           cash_drawer_counted_eur::text AS cash_counted_eur,
           z_nr::text AS z_nr
      FROM daily_closings
     WHERE id = ${id}
     LIMIT 1`);
  const closing = closingRows[0];
  if (!closing) {
    throw new ClosingNotFoundError(`Daily closing ${id} not found.`);
  }
  if (closing.state !== 'FINALIZED') {
    throw new ClosingNotFinalizedError(
      `Der Tagesabschluss für ${closing.business_day} ist noch nicht finalisiert und kann nicht als DSFinV-K exportiert werden.`,
    );
  }
  const businessDay = closing.business_day;

  // All transactions of the Berlin business day (header columns).
  // ⚠️ Bis zum 28.07.2026 wurde nur die EXISTENZ des Storno-Verweises
  // gelesen und seine Identität weggeworfen. Damit konnte
  // `references.csv` nicht befüllt werden — und die Norm verlangt sie
  // zwingend. Tz. 4.2.2, wörtlich: „Um einen Bezug zum ursprünglichen
  // Vorgang zu ermöglichen, muss ein Datensatz in der Datei
  // Bon_Referenzen angelegt werden, der die Referenz zum stornierten
  // Vorgang enthält."
  //
  // Der Verweis braucht drei Angaben vom URBELEG: seine BON_ID, und die
  // Kasse samt Nummer SEINES Kassenabschlusses. Deshalb der zweite Join
  // auf `daily_closings` — der Urbeleg kann in einem früheren Abschluss
  // liegen.
  const txRows = await db.execute<DsfinvkTxRow>(sql`
    SELECT t.id::text AS id,
           t.receipt_locator,
           t.direction::text AS direction,
           t.finalized_at,
           t.vorgang_begonnen_at,
           t.tax_treatment_code,
           t.subtotal_eur::text AS subtotal_eur,
           t.vat_eur::text      AS vat_eur,
           t.total_eur::text    AS total_eur,
           t.cashier_user_id::text AS cashier_user_id,
           t.customer_id::text     AS customer_id,
           (t.storno_of_transaction_id IS NOT NULL) AS is_storno,
           o.receipt_locator AS storno_von_beleg,
           d.z_nr::text      AS storno_von_z_nr,
           d.finalized_at    AS storno_von_erstellung
      FROM transactions t
      -- 0148: die Rueckgabe referenziert ihr Original GENAUSO wie der Storno
      -- (Anhang B der DSFinV-K: bei der negativen Darstellung eines Belegs
      -- „muss" die Referenz auf den urspruenglichen Vorgang erfolgen; fuer
      -- die Teilruecknahme empfiehlt sie sich aus demselben Grund). Ein
      -- Beleg traegt hoechstens EINEN der beiden Verweise (DB-CHECK).
      LEFT JOIN transactions o
             ON o.id = COALESCE(t.storno_of_transaction_id, t.rueckgabe_zu_transaction_id)
      LEFT JOIN daily_closings d
             ON d.business_day = berlin_business_day(o.finalized_at)
            AND d.finalized_at IS NOT NULL
     WHERE berlin_business_day(t.finalized_at) = ${businessDay}::date
     ORDER BY t.finalized_at ASC`);

  const txIds = txRows.map((t) => t.id);
  // Bind the ids as ONE Postgres array-literal text param ('{uuid,uuid}')
  // cast to uuid[]. Interpolating a JS array into drizzle's `sql` template
  // SPREADS it into comma-separated scalar params, so `ANY(${'${txIds}'}::uuid[])`
  // casts a row/record → uuid[] and throws 42846 on any non-empty day. The
  // ids are DB-sourced UUIDs, so the literal stays one safe bound param.
  // (Same fix already applied to transactions-finalize.ts.)
  const txIdArray = `{${txIds.join(',')}}`;

  // Lines, payments, TSE signatures — empty arrays if the day is empty.
  const itemRows =
    txIds.length === 0
      ? []
      : await db.execute<DsfinvkItemRow>(sql`
          SELECT ti.transaction_id::text AS transaction_id,
                 ti.display_order,
                 COALESCE(p.name, '') AS product_name,
                 p.seriennummer AS seriennummer,
                 ti.applied_tax_treatment_code,
                 ti.applied_vat_rate::text AS applied_vat_rate,
                 ti.line_subtotal_eur::text AS line_subtotal_eur,
                 ti.line_vat_eur::text      AS line_vat_eur,
                 ti.line_total_eur::text    AS line_total_eur,
                 -- Der Rabatt wurde bis hierher NIE gelesen. itemamounts.csv
                 -- (Bonpos_Preisfindung) ging deshalb IMMER ohne eine Zeile hinaus,
                 -- waehrend auf der Produktion 8 von 92 Positionen einen Rabatt
                 -- tragen. Ein Pruefer sah einen Preis, den nichts erklaerte.
                 -- (Keine Anfuehrungszeichen mit Gravis in diesem Block: er steht
                 --  in einem TypeScript-Schablonentext, ein Gravis schliesst ihn.)
                 COALESCE(ti.line_discount_eur, 0)::text AS line_discount_eur,
                 ti.line_discount_reason,
                 -- Einkauf und Marge: OHNE sie laesst sich der Steueranteil eines
                 -- Rabatts bei Paragraph 25a nicht bestimmen. Gemessen: alle acht
                 -- rabattierten Zeilen der Produktion sind 25a, alle mit Satz NULL.
                 ti.acquisition_cost_eur_snapshot::text AS acquisition_cost_eur_snapshot,
                 ti.margin_eur::text AS margin_eur
            FROM transaction_items ti
            LEFT JOIN products p ON p.id = ti.product_id
           WHERE ti.transaction_id = ANY(${txIdArray}::uuid[])
           ORDER BY ti.transaction_id, ti.display_order ASC`);

  const paymentRows =
    txIds.length === 0
      ? []
      : await db.execute<DsfinvkPaymentRow>(sql`
          SELECT transaction_id::text AS transaction_id,
                 payment_method::text AS payment_method,
                 amount_eur::text     AS amount_eur
            FROM transaction_payments
           WHERE transaction_id = ANY(${txIdArray}::uuid[])
           ORDER BY transaction_id, created_at ASC`);

  const tseRows =
    txIds.length === 0
      ? []
      : await db.execute<DsfinvkTseRow>(sql`
          SELECT transaction_id::text AS transaction_id,
                 fiskaly_tss_id::text  AS fiskaly_tss_id,
                 fiskaly_transaction_number::text AS fiskaly_transaction_number,
                 signature_counter::text          AS signature_counter,
                 signature_value,
                 signature_algorithm,
                 tss_serial_number,
                 signature_public_key,
                 process_type,
                 tse_start_time,
                 tse_end_time
            FROM tse_signatures
           WHERE transaction_id = ANY(${txIdArray}::uuid[])`);

  // Group children by transaction.
  const itemsByTx = new Map<string, DsfinvkItemRow[]>();
  for (const it of itemRows) {
    const arr = itemsByTx.get(it.transaction_id) ?? [];
    arr.push(it);
    itemsByTx.set(it.transaction_id, arr);
  }
  const paymentsByTx = new Map<string, DsfinvkPaymentRow[]>();
  for (const p of paymentRows) {
    const arr = paymentsByTx.get(p.transaction_id) ?? [];
    arr.push(p);
    paymentsByTx.set(p.transaction_id, arr);
  }
  const tseByTx = new Map<string, DsfinvkTseRow>();
  for (const s of tseRows) tseByTx.set(s.transaction_id, s);

  // Cash-register identity: our data has no dedicated register-serial field,
  // so the most-recent TSS id of the day is used as the TSE serial surrogate
  // (documented in dsfinvk-export.ts). Brand/model are fixed product idents.
  const tssSerial = tseRows[0]?.fiskaly_tss_id ?? '';

  const receipts: DsfinvkReceiptInput[] = txRows.map((t) => {
    const lines = (itemsByTx.get(t.id) ?? []).map((it, idx) => ({
      lineNumber: idx + 1,
      // 0143: die Seriennummer gehoert in den Artikeltext des Bons —
      // ueber sie findet eine polizeiliche GwG-Anfrage (und der Pruefer)
      // die Uhr im Bon ihres Ankauftags. Die Gravur bleibt draussen:
      // Beschreibung, keine Identitaet.
      productName: artikeltextMitNummer(it.product_name, it.seriennummer),
      // MENGE/ANZAHL is ALWAYS 1.000 by the data model — not a placeholder.
      // Each transaction_items row references ONE unique inventory product_id
      // (gold/coins/antiques: 4-state DRAFT→AVAILABLE→RESERVED→SOLD machine,
      // atomic single-item reservation; a product can be sold exactly once).
      // There is no stock-count column anywhere and no code path multiplies a
      // quantity into a line total (the storefront cart's `quantity` field is
      // never folded into line_total_eur and a unique item cannot be reserved
      // twice). So qty>1 per line is unreachable → '1.000' is the correct,
      // truthful value, NOT a deferred default. (No quantity column added.)
      quantity: '1.000',
      appliedTaxTreatmentCode: it.applied_tax_treatment_code,
      appliedVatRate: it.applied_vat_rate,
      lineSubtotalEur: it.line_subtotal_eur,
      lineVatEur: it.line_vat_eur,
      lineTotalEur: it.line_total_eur,
      lineDiscountEur: it.line_discount_eur,
      lineDiscountReason: it.line_discount_reason,
      acquisitionCostEurSnapshot: it.acquisition_cost_eur_snapshot,
      marginEur: it.margin_eur,
    }));
    const payments = (paymentsByTx.get(t.id) ?? []).map((p) => ({
      paymentMethod: p.payment_method,
      amountEur: p.amount_eur,
    }));
    const s = tseByTx.get(t.id);
    return {
      transactionId: t.id,
      receiptLocator: t.receipt_locator,
      direction: t.direction === 'ANKAUF' ? 'ANKAUF' : 'VERKAUF',
      finalizedAt: new Date(t.finalized_at).toISOString(),
      vorgangBegonnenAt: t.vorgang_begonnen_at ? new Date(t.vorgang_begonnen_at).toISOString() : null,
      taxTreatmentCode: t.tax_treatment_code,
      subtotalEur: t.subtotal_eur,
      vatEur: t.vat_eur,
      totalEur: t.total_eur,
      cashierUserId: t.cashier_user_id,
      customerId: t.customer_id,
      isStorno: t.is_storno === true,
      stornoVon:
        t.storno_von_beleg == null
          ? null
          : {
              bonId: t.storno_von_beleg,
              zNr: t.storno_von_z_nr,
              erstellung: t.storno_von_erstellung
                ? new Date(t.storno_von_erstellung).toISOString()
                : null,
            },
      lines,
      payments,
      tse: s
        ? {
            fiskalyTransactionNumber: s.fiskaly_transaction_number,
            signatureCounter: s.signature_counter,
            signatureValue: s.signature_value,
            signatureAlgorithm: s.signature_algorithm,
            fiskalyTssId: s.fiskaly_tss_id,
            // TSE_SERIAL und TSE_PUBLIC_KEY der `tse.csv`. Fehlt eine
            // Angabe (Belege von vor Wanderung 0141), bleibt die Spalte
            // LEER — sie wird nie aus der heute konfigurierten
            // Sicherungseinrichtung aufgefuellt.
            tssSerialNumber: s.tss_serial_number,
            signaturePublicKey: s.signature_public_key,
            processType: s.process_type,
            tseStartTime: s.tse_start_time ? new Date(s.tse_start_time).toISOString() : null,
            tseEndTime: s.tse_end_time ? new Date(s.tse_end_time).toISOString() : null,
          }
        : null,
    };
  });

  // ── Der Kopf des Bündels rechnet auf DERSELBEN Grundlage wie die Belege ──
  //
  // GEMESSEN am 26.07.2026 (tests/integration/szenario-kreuzprobe.test.ts):
  // `cashpointclosing.csv` trug GESAMT_BRUTTO_VERKAUF = 379157 Cent, während
  // die Verkaufszeilen in `bon_kopf.csv` DESSELBEN ZIP 375824 Cent ergaben.
  // Die Differenz war genau der Storno über 3333 Cent. Ein Prüfer rechnet
  // als ERSTES die Einzelbewegungen gegen die Tagessumme — und genau diese
  // Querrechnung ging nicht auf, in EINEM Bündel.
  //
  // WARUM NACH STORNO, und nicht davor: DSFinV-K führt eine Stornierung als
  // EIGENE Bewegung mit negativem Betrag (hier BON_TYP 'Beleg-Storno',
  // BON_GESAMT_BRUTTO −33,33), nicht als Löschung. Jede Summe über die
  // Einzelaufzeichnungen trägt den Storno damit bereits mit umgekehrtem
  // Vorzeichen, und die Summendaten eines Kassenabschlusses müssen sich mit
  // den Einzelaufzeichnungen DESSELBEN Abschlusses decken. Eine Tagessumme
  // vor Storno widerspricht ihren eigenen Belegen. Die andere Richtung —
  // den Storno aus `bon_kopf.csv` zu entfernen — scheidet aus: dann wäre er
  // im Bündel gar nicht mehr ausgewiesen, was BFH 29.07.2025, X R 23-24/21,
  // Leitsatz 1 gerade verbietet.
  //
  // WOHER DIE ZAHLEN KOMMEN. Brutto steht seit Wanderung 0112 fertig in der
  // Datenbank: `gross_*` ist ausdrücklich VOR Storno, `storno_*` der
  // stornierte Betrag als positive Grösse, also ist die Differenz der
  // tatsächliche Umsatz. Für NETTO hat 0112 keine Stornospalte angelegt —
  // der Nettoanteil einer Stornierung steht ausschliesslich am Beleg. Er
  // wird deshalb aus genau den Zeilen gelesen, die auch `bon_kopf.csv`
  // füllen, und NUR dann, wenn der Abschluss selbst einen Stornobetrag
  // ausweist. So bleiben beide Seiten auf derselben Grundlage: entweder
  // beide mit Storno oder beide ohne. Sonst ergäbe GESAMT_BRUTTO minus
  // GESAMT_NETTO nicht mehr die Umsatzsteuer des Tages (gemessen: 6763
  // statt 9564 Cent).
  //
  // Gerechnet wird in ganzen Cent als bigint, nie in Fliesskomma.

  /** Nettoanteil der Stornos einer Richtung, als POSITIVE Grösse. */
  const stornoNettoCents = (richtung: 'VERKAUF' | 'ANKAUF'): bigint => {
    let cents = 0n;
    for (const r of receipts) {
      if (!r.isStorno || r.direction !== richtung) continue;
      // `subtotalEur` einer Stornozeile ist negativ → Vorzeichen umdrehen.
      cents -= eurToCents(r.subtotalEur);
    }
    return cents;
  };

  const kopfSumme = (
    bruttoVorStorno: string,
    nettoVorStorno: string,
    stornoBruttoRoh: string,
    richtung: 'VERKAUF' | 'ANKAUF',
  ): { brutto: string; netto: string } => {
    const stornoBrutto = eurToCents(stornoBruttoRoh);
    const stornoNetto = stornoBrutto === 0n ? 0n : stornoNettoCents(richtung);
    return {
      brutto: centsToEur(eurToCents(bruttoVorStorno) - stornoBrutto),
      netto: centsToEur(eurToCents(nettoVorStorno) - stornoNetto),
    };
  };

  const verkaufKopf = kopfSumme(
    closing.gross_verkauf_eur,
    closing.net_verkauf_eur,
    closing.storno_verkauf_eur,
    'VERKAUF',
  );
  const ankaufKopf = kopfSumme(
    closing.gross_ankauf_eur,
    closing.net_ankauf_eur,
    closing.storno_ankauf_eur,
    'ANKAUF',
  );

  const bundleInput: DsfinvkBundleInput = {
    businessDay,
    closing: {
      // ⚠️ Der echte Z-Schlüssel aus 0124.
      //
      // ⛔ 08.08.2026 BERICHTIGT. Hier stand „Fehlt er, wirft `zNr`". Der
      // Satz beschrieb `zNr()` aus dem ABGELÖSTEN Erzeuger; der lebende
      // Weg nahm eine fehlende Nummer stillschweigend an und schrieb
      // zwanzig Dateien mit leerem Z-Feld.
      //
      // Jetzt wirft `formeDaten` mit `ZNummerFehltError`, und zwar dort,
      // wo das Paket wirklich entsteht.
      zNr: closing.z_nr,
      finalizedAt: closing.finalized_at ? new Date(closing.finalized_at).toISOString() : null,
      grossVerkaufEur: verkaufKopf.brutto,
      grossAnkaufEur: ankaufKopf.brutto,
      netVerkaufEur: verkaufKopf.netto,
      netAnkaufEur: ankaufKopf.netto,
      vatByTreatment: (closing.vat_by_treatment ?? {}) as Record<string, string>,
      umsatzByTreatment: closing.umsatz_by_treatment ?? {},
      paymentsByMethod: (closing.payments_by_method ?? {}) as Record<string, string>,
      cashCountedEur: closing.cash_counted_eur,
    },
    cashRegister: {
      id: 'POS-1',
      serialNumber: tssSerial,
      // Die Marke der Kasse gegenueber dem Finanzamt. Stand hier als
      // 'Warehouse14' — der Haendler meldete dem Pruefer eine fremde Firma.
      // Eine Quelle, siehe lib/erzeugnis.ts.
      brand: ERZEUGNIS_MARKE,
      model: ERZEUGNIS_MODELL,
    },
    receipts,
  };

  // ══════════════════════════════════════════════════════════════════
  //  DER ERZEUGER LIEST DIE NORM — seit 28.07.2026
  // ══════════════════════════════════════════════════════════════════
  //
  // `buildDsfinvkBundle` schrieb acht Dateien mit von Hand getippten
  // Kopfzeilen, fünf davon mit Namen, die die Taxonomie nicht kennt.
  // `baueAlleDateien` leitet die zwanzig amtlichen Dateien aus
  // `index.xml` ab — die Kopfzeile kann damit nicht mehr falsch sein.
  //
  // ⚠️ Und der Weg SPERRT jetzt, wo er vorher erfand: fehlt der
  // Steuerschlüssel des Beraters, fehlen die Angaben zum
  // Steuerpflichtigen, oder trägt ein Vorgang einen Wert, den die
  // geschlossenen Listen der Norm nicht kennen, entsteht KEINE Datei.
  // Die Meldung sagt jeweils, wer entscheidet.
  const einstellungen = await db.execute<{ key: string; wert: string | null }>(sql`
    SELECT key, (value #>> '{}')::text AS wert
      FROM system_settings
     WHERE key LIKE 'shop.%' OR key LIKE 'kasse.%' OR key LIKE 'dsfinvk.%'`);
  const einst: Record<string, string | null> = {};
  for (const z of einstellungen) einst[z.key] = z.wert;

  const stammdaten = leseStammdaten(einst);
  if (!stammdaten.vollstaendig) {
    throw new StammdatenUnvollstaendigError(stammdaten.fehlt);
  }

  // Die vom Steuerberater vergebenen Umsatzsteuerschlüssel. Die Norm
  // reserviert die IDs unter 1000 für sich; welche Nummer für § 25a und
  // § 13b gilt, entscheidet er.
  // ⚠️ Die Schlüssel der Einstellungen sind KLEINGESCHRIEBEN — ein
  // CHECK erzwingt das (`system_settings_key_format`), und zu Recht: ein
  // Haus mit zwei Schreibweisen findet seine eigenen Werte nicht mehr.
  // Die Steuerarten heissen im Code aber GROSS. Hier wird zurückgewandelt.
  const eigeneUstSchluessel: Record<string, string> = {};
  for (const [k, v] of Object.entries(einst)) {
    const m = /^dsfinvk\.ust_schluessel\.(.+)$/.exec(k);
    if (m?.[1] && v) eigeneUstSchluessel[m[1].toUpperCase()] = v;
  }

  // Prozentsatz und Klartext je eigenem Schlüssel — ebenfalls vom Berater.
  // Ohne sie bliebe `vat.csv` bei diesem Schlüssel leer statt falsch.
  const eigeneUstSaetze: Record<string, string> = {};
  const eigeneUstBeschreibungen: Record<string, string> = {};
  for (const [k, v] of Object.entries(einst)) {
    const s1 = /^dsfinvk\.ust_satz\.(.+)$/.exec(k);
    if (s1?.[1] && v) eigeneUstSaetze[s1[1].toUpperCase()] = v;
    const s2 = /^dsfinvk\.ust_beschreibung\.(.+)$/.exec(k);
    if (s2?.[1] && v) eigeneUstBeschreibungen[s2[1].toUpperCase()] = v;
  }

  const dateien = baueAlleDateien(
    leseTaxonomie(amtlicheTaxonomie()),
    formeDaten(bundleInput, {
      stammdaten,
      eigeneUstSchluessel,
      eigeneUstSaetze,
      eigeneUstBeschreibungen,
      // ⚠️ Die Entscheidung des Steuerberaters zum Ankauf von Privat.
      // Fehlt sie, bricht der Export beim ersten Ankaufbeleg ab — und für
      // einen Edelmetallhändler ist das fast jeder Tag. Deshalb kommt sie
      // aus derselben Quelle wie die übrigen menschlichen Angaben.
      gvTypAnkauf: einst['dsfinvk.gv_typ.ankauf'] ?? null,
      kassenSeriennummer: einst['kasse.seriennummer'] ?? '',
      // ⚠️ Die Fassung kommt aus der MITGELIEFERTEN Norm, nicht aus einer
      // Eingabe: welche Fassung dieses Paket hat, weiss diese Kasse, nicht
      // der Berater. Der alte Schlüssel war unschreibbar und deshalb in
      // JEDEM je erzeugten Paket leer. Eine ausdrückliche Eintragung darf
      // ihn weiterhin überstimmen, falls eine Kanzlei das je verlangt.
      taxonomieVersion: (einst['dsfinvk.taxonomie_version'] ?? '').trim() || DSFINVK_FASSUNG,
      // ⚠️ Hier stand `process.env.APP_VERSION ?? '1.0.0'`. `APP_VERSION`
      // wird im ganzen Baum nirgends gesetzt, also griff IMMER die
      // '1.0.0'. Die Kasse ist 0.0.2. Jedes je gezogene Prüferpaket nannte
      // dem Finanzamt in `cashregister.csv` eine Fassung, die es nie gab.
      // Der Wert kommt jetzt gemessen aus der Umgebung, die der Sidecar
      // aus `tauri.conf.json` setzt; ist sie unbekannt, bleibt das Feld
      // LEER statt erfunden. Siehe `kassensoftwareFassung()`.
      softwareVersion: kassensoftwareFassung(),
    }),
  );

  const zip = zipDsfinvkBundle([
    ...dateien,
    // Der Datenträger nennt seinen Absender. Ohne ihn sieht der Prüfer
    // Zahlen, aber nicht, wessen Zahlen.
    ...amtlicheBeschreibung({
      name: stammdaten.daten.legalName,
      ort: stammdaten.daten.city,
    }),
  ]);
  return { businessDay, zip };
}
