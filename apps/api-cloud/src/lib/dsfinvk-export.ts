/**
 * ════════════════════════════════════════════════════════════════════════════
 *  DSFinV-K export — LOCAL DFKA-Taxonomie Kassendaten bundle generator
 * ════════════════════════════════════════════════════════════════════════════
 *
 * Produces, from the REAL fiscal data of one Berlin business day, the core
 * DSFinV-K (Digitale Schnittstelle der Finanzverwaltung für Kassensysteme,
 * DFKA-Taxonomie Kassendaten) CSV files + the `index.xml` that ties them
 * together — the artefact a German tax inspector requests in a §146b
 * Kassen-Nachschau as a Z3 Datenträgerüberlassung.
 *
 * This MIRRORS the existing export pattern (datev-export.ts / kassenbericht-
 * export.ts): a PURE function over already-fetched rows, never a DB caller,
 * never a recompute, never a fabrication. Money stays a NUMERIC(18,2) string
 * straight from Postgres; we only normalise the decimal separator to the
 * DSFinV-K dot. NO float arithmetic. Semicolon-delimited, CRLF line endings.
 *
 * ───────────────────────────────────────────────────────────────────────────
 *  HONESTY — coverage of the DSFinV-K v2.x taxonomy (read before relying on it)
 * ───────────────────────────────────────────────────────────────────────────
 *  This is a FAITHFUL CORE implementation, NOT a certified one. Before it is
 *  used in a real Betriebsprüfung / Kassen-Nachschau it MUST be validated
 *  against the official DSFinV-K Prüftool of the Finanzverwaltung AND signed
 *  off by the Steuerberater. Do NOT claim certification.
 *
 *  COVERED (core files, with real data):
 *    • cashpointclosing.csv   — Kassenabschluss header (Z-Nr, day, finalize ts,
 *                               cash-register id/serial, gross/net day totals).
 *    • bon_kopf.csv           — receipt headers (BON_ID, BON_NR, BON_TYP,
 *                               timestamp, gross/net totals, cashier, customer).
 *    • bon_pos.csv            — receipt lines (article text, MENGE, GV_TYP).
 *                               MENGE is ALWAYS 1.000: each line is ONE unique
 *                               inventory item (4-state product machine, atomic
 *                               single-item reservation) — no stock-count column
 *                               exists and no path multiplies a quantity into a
 *                               line total, so qty>1 per line is unreachable.
 *    • bon_pos_preise.csv     — per-line PRICE/quantity breakdown: ANZAHL,
 *                               EINZEL_BRUTTO, position BRUTTO/NETTO/USt. NO
 *                               USt-Schlüssel (distinct from bon_pos_ust).
 *    • bon_pos_ust.csv        — per-line VAT breakdown (USt-Schlüssel, brutto,
 *                               netto, ust).
 *    • bon_ust.csv            — per-receipt VAT totals by USt-Schlüssel.
 *    • datapayment.csv        — Zahlungsarten per receipt (Zahlungsart + amount).
 *                               BETRAG carries the DIRECTION: an ANKAUF is an
 *                               Auszahlung and stands NEGATIVE, so summing the
 *                               column per Zahlart yields the real drawer
 *                               movement (see buildDataPayment).
 *    • tse.csv                — TSE evidence per receipt: Transaktionsnummer,
 *                               Signaturzähler, Signatur, Algorithmus, TSS-ID
 *                               (Seriennummer ref), Start/End time, ProcessType.
 *    • index.xml              — ties the CSV files together (DSFinV-K Media set).
 *
 *  DEFERRED / EMITTED AS SPEC-CORRECT EMPTY (documented, NOT invented):
 *    • Stammdaten set (cashregister.csv, slaves.csv, pa.csv, vat.csv,
 *      tse.csv-as-master, businesscases master, etc.) — only the per-closing
 *      transactional core is generated here; the static master-data files are
 *      deferred until the Steuerberater confirms the firm's master records.
 *    • allocation_groups, references (bon_referenzen.csv), subitems
 *      (bon_pos_zusatzinfo) — not modelled in our data yet → omitted, NOT faked.
 *    • Geldtransit / Cash-in/out (Bargeldbewegungen beyond the closing's cash
 *      count), Trinkgeld, Gutschein issue/redeem detail — partially modelled;
 *      surfaced only where a real row exists.
 *    • The Z3 export's GoBD `gdpdu-01-09-2004.dtd` + `INDEX.XML` description
 *      schema is approximated by a minimal index.xml — it lists the files but is
 *      NOT the full GDPdU description; the Prüftool may want the full descriptor.
 *    • Process-data / signature payload reconstruction (the exact byte string
 *      the TSE signed) is NOT re-derived; we record the stored signature value
 *      and counters verbatim from tse_signatures.
 *
 *  Where a required field cannot be sourced from current data we emit the
 *  spec's EMPTY/default (empty string, or '0.00' only where the spec defines a
 *  mandatory numeric default) — see the inline notes — and never a guess.
 * ───────────────────────────────────────────────────────────────────────────
 */

import { deflateRawSync } from 'node:zlib';

import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

// ── DSFinV-K USt-Schlüssel (fixed taxonomy ids) ────────────────────────────
//
// DSFinV-K defines a fixed set of USt-Schlüssel (ID_UST). Our four
// tax_treatment_codes map as follows (documented for the Steuerberater):
//   1 → 19,00 % Regelsteuersatz           ← STANDARD_19
//   2 →  7,00 % ermäßigter Steuersatz     ← REDUCED_7
//   3 → 10,70 % §24 UStG Durchschnittsatz (unused)
//   4 →  5,50 % §24 UStG (unused)
//   5 →  0,00 % nicht steuerbar / steuerfrei ← INVESTMENT_GOLD_25C (§25c, exempt)
//   6 →  0,00 % Umsatzsteuer (Sonderfall, unused)
//   7 → Differenzbesteuerung §25a UStG     ← MARGIN_25A
//        (NOTE: §25a is taxed at 19 % ON THE MARGIN, not on the full price.
//         DSFinV-K represents the margin scheme distinctly; key 7 marks it so
//         the Prüfung does NOT read it as a normal 0 %/exempt line. The margin
//         VAT itself is carried in bon_ust from the closing's vatByTreatment.)
export const UST_SCHLUESSEL: Record<string, string> = {
  STANDARD_19: '1',
  REDUCED_7: '2',
  INVESTMENT_GOLD_25C: '5',
  MARGIN_25A: '7',
};

/** Fallback USt-Schlüssel for an unknown code: 7 (Sonstige / nicht zuordenbar). */
export interface DsfinvkLineInput {
  lineNumber: number;
  productName: string;
  /** NUMERIC string, e.g. "1.000". */
  quantity: string;
  appliedTaxTreatmentCode: string;
  /** NUMERIC(5,4) string or null (null = §25a margin). */
  appliedVatRate: string | null;
  lineSubtotalEur: string;
  lineVatEur: string;
  lineTotalEur: string;
  /** Gewährter Rabatt auf diese Zeile, als positiver Betrag. */
  lineDiscountEur?: string | null;
  /** Der Grund, den die Kasse beim Rabatt verlangt. */
  lineDiscountReason?: string | null;
  /** Der Einkaufspreis der Position; bei § 25a die Bemessungsgrundlage. */
  acquisitionCostEurSnapshot?: string | null;
  /** Die Marge dieser Zeile, bei Verlust auf 0 gesetzt. */
  marginEur?: string | null;
}

export interface DsfinvkPaymentInput {
  paymentMethod: string;
  amountEur: string;
}

export interface DsfinvkTseInput {
  fiskalyTransactionNumber: string;
  signatureCounter: string;
  signatureValue: string;
  signatureAlgorithm: string | null;
  fiskalyTssId: string;
  processType: string;
  tseStartTime: string | null;
  tseEndTime: string | null;
  /**
   * ═════════════════════════════════════════════════════════════════════════
   *  ⛔ DIESE BEIDEN FELDER FÜLLT HEUTE KEINE PRODUKTIONSSTELLE
   * ═════════════════════════════════════════════════════════════════════════
   *
   * Die Sicherungseinrichtung legt jeder fertigen Signatur ihre Seriennummer
   * UND ihren öffentlichen Schlüssel bei. Die Brücke der Kasse liest beide
   * ausdrücklich aus der Antwort heraus
   * (`apps/tauri-pos/src-tauri/src/commands/tse.rs:338` und `:339`, Felder
   * `signature.public_key` und `tss_serial_number`) und reicht sie als
   * `signaturePublicKey` und `tssSerialNumber` an die Oberfläche weiter
   * (`apps/tauri-pos/src/lib/hardware-client.ts:212` und `:214`).
   *
   * ⛔ DORT ENDET DER WEG BIS HEUTE, 13.08.2026 über den ganzen Baum
   * gemessen. Diese Schnittstelle KENNT die beiden Werte seit dem 12.08.2026,
   * und `dsfinvk-daten.ts` trägt sie sauber nach `TSE_SERIAL` und
   * `TSE_PUBLIC_KEY` — aber die einzigen Zuweisungen im ganzen Baum stehen in
   * Prüfungen. Der lebende Weg setzt sie nirgends.
   *
   * Die Kette ist an VIER Stellen offen, in der Reihenfolge, in der ein Wert
   * sie durchlaufen müsste:
   *
   *   1. `packages/api-client/src/domains/transactions.ts:248` — der Rumpf
   *      `TseSignatureBody` kennt beide Felder nicht, die Kasse kann sie also
   *      gar nicht erst mitschicken.
   *   2. `apps/api-cloud/src/schemas/tse-signature.ts:56` — dasselbe auf der
   *      Serverseite. Fastify ENTFERNT still, was das Schema nicht kennt;
   *      auch ein mitgeschickter Wert käme in der Route nicht an.
   *   3. `apps/api-cloud/src/routes/transactions-tse-signature.ts:158` — das
   *      INSERT schreibt beide nicht, und
   *      `packages/db/src/schema/tse/tseSignatures.ts` hat gar keine Spalte
   *      dafür. Ohne Wanderung gibt es keinen Ort, an dem der Wert bliebe.
   *   4. `apps/api-cloud/src/routes/closing-export.ts:1595` (die Abfrage) und
   *      `:1682` (die Zuordnung auf dieses Feld) — beide holen und übergeben
   *      sie nicht.
   *
   * Solange auch nur EINE dieser vier Stellen offen ist, bleiben `TSE_SERIAL`
   * und `TSE_PUBLIC_KEY` in JEDEM gezogenen Prüferpaket leer. (⚠️ VERALTET
   * seit 19.08.2026: beide Kassenwege senden die Felder inzwischen mit; leer
   * bleiben nur Belege von vor Wanderung 0141.) Was der Händler
   * dann erlebt: ein Prüfer bekommt Signaturen, deren `TSE_ID` auf einen
   * Stammsatz ohne Seriennummer und ohne Schlüssel zeigt. Er kann keine
   * einzige Signatur einer Sicherungseinrichtung zuordnen und keine einzige
   * nachrechnen — und der Händler kann es nirgends nachtragen, weil nur das
   * Gerät diese Angaben kennt.
   *
   * ⚠️ Gemessen wird das NICHT an dieser Schnittstelle, sondern am lebenden
   * Weg. Beide Wächter sind heute ROT, und zwar zu Recht:
   *   `apps/api-cloud/tests/unit/tse-stammdaten-lebender-weg.test.ts`
   *   `apps/api-cloud/tests/integration/tse-seriennummer-erreicht-das-pruefpaket.test.ts`
   *
   * Optional bleiben die Felder auch nach der Berichtigung, und zwar
   * wahrheitsgemäss: eine Aufzeichnung aus der Zeit davor trägt die Werte
   * nicht. Fehlen sie, bleibt die Spalte LEER statt erfunden.
   */
  tssSerialNumber?: string | null;
  /** Der öffentliche Schlüssel der Sicherungseinrichtung, base64. */
  signaturePublicKey?: string | null;
}

export interface DsfinvkReceiptInput {
  transactionId: string;
  receiptLocator: string;
  direction: 'VERKAUF' | 'ANKAUF';
  finalizedAt: string; // ISO
  /** 0147 — Beginn des Vorgangs (erstes Stueck im Korb, ISO). NULL = unbekannt. */
  vorgangBegonnenAt?: string | null;
  taxTreatmentCode: string;
  subtotalEur: string;
  vatEur: string;
  totalEur: string;
  cashierUserId: string;
  customerId: string | null;
  isStorno: boolean;
  /**
   * Der Urbeleg, auf den ein Storno verweist. `null` bei jedem anderen Beleg.
   *
   * Die Norm verlangt den Verweis zwingend (Tz. 4.2.2) und braucht dafür DREI
   * Angaben vom Urbeleg: seine BON_ID sowie Kasse und Nummer SEINES
   * Kassenabschlusses — der kann ein früherer sein.
   */
  stornoVon?: { bonId: string; zNr: string | null; erstellung: string | null } | null;
  lines: DsfinvkLineInput[];
  payments: DsfinvkPaymentInput[];
  /** May be null if no TSE signature was recorded for this receipt. */
  tse: DsfinvkTseInput | null;
}

export interface DsfinvkClosingInput {
  finalizedAt: string | null; // ISO
  grossVerkaufEur: string;
  grossAnkaufEur: string;
  netVerkaufEur: string;
  netAnkaufEur: string;
  /** `{ tax_treatment_code: vat-amount-string }`. */
  vatByTreatment: Record<string, string>;
  /**
   * `{ tax_treatment_code: { brutto, netto } }` — der UMSATZ je Behandlung.
   *
   * ⚠️ Aufgezeichnet beim Festschreiben (Wanderung 0127), nicht aus der
   * Steuer zurückgerechnet: bei § 25a ist die Bemessungsgrundlage die Marge,
   * bei steuerfreien Umsätzen führt der Rückweg ins Leere.
   */
  umsatzByTreatment?: Record<string, { brutto: string; netto: string }>;
  /** `{ payment_method: amount-string }`. */
  paymentsByMethod: Record<string, string>;
  cashCountedEur: string | null;
  /**
   * DSFinV-K Z_NR — die FORTLAUFENDE Nummer des Abschlusses je Kasse.
   *
   * ⚠️ `null` heisst: dieser Abschluss trägt keine. Dann wird KEIN Paket
   * gebaut, statt ersatzweise das Datum einzusetzen — siehe `zNr`.
   */
  zNr: string | null;
}

export interface DsfinvkCashRegisterInput {
  id: string;
  serialNumber: string;
  brand: string;
  model: string;
}

export interface DsfinvkBundleInput {
  businessDay: string; // YYYY-MM-DD
  closing: DsfinvkClosingInput;
  cashRegister: DsfinvkCashRegisterInput;
  receipts: DsfinvkReceiptInput[];
}

/** One file of the bundle. */
export interface DsfinvkFile {
  name: string;
  /**
   * Text (utf8) ODER rohe Bytes. 18.08.2026: das Prueferpaket der
   * Kassennachschau packt PDF und innere Tages-ZIPs in DENSELBEN Schreiber;
   * ein `Buffer.from(content, 'utf8')` auf Binaerdaten zerstoerte jede
   * Signatur im Paket, still.
   */
  content: string | Buffer;
}

// ── Formatting helpers (NO float; only separator + safe defaults) ──────────

/** "1234.5" → "1234.50"; null/empty → "0.00" only where the spec mandates a
 *  numeric (callers pass real strings — this is the last-resort default). */
export class ZNummerFehltError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
  public readonly details: { geschaeftstag: string };

  public constructor(businessDay: string) {
    super(
      `Der Abschluss vom ${businessDay} trägt keine Z-Nummer. Ein DSFinV-K-Paket ` +
        `ohne fortlaufende Z_NR wäre nicht auswertbar, und ein ersatzweise ` +
        `eingesetztes Datum wäre eine erfundene Nummer. Es wurde KEIN Paket erzeugt.`,
    );
    this.details = { geschaeftstag: businessDay };
  }
}

/*
 * ⚰️ 21.08.2026: HIER STAND DER ABGELÖSTE DSFinV-K-BAUER (rund 390 Zeilen)
 *    UND SEINE NEUN HELFER (rund 60 weitere).
 *
 * `buildDsfinvkBundle` schrieb ACHT Dateien, und FÜNF ihrer Namen waren frei
 * erfunden: `bon_kopf.csv`, `bon_pos.csv`, `bon_pos_preise.csv`,
 * `bon_pos_ust.csv`, `bon_ust.csv`. Die amtliche Beschreibung (DSFinV-K 2.4,
 * `fiskal/dsfinvk-2.4/index.xml`) kennt keinen davon; sie verlangt ZWANZIG
 * Dateien mit anderen Namen.
 *
 * ── WARUM ES TROTZDEM KEIN RECHTLICHER SCHADEN WAR ────────────────────────
 *
 * GEMESSEN: BEIDE echten Ausfuhrwege — der Tagesexport
 * (`/api/closings/:id/export/dsfinvk`) und das Prüferpaket
 * (`/api/pruefer/paket`) — laufen längst über `lib/dsfinvk-tag.ts` und
 * erzeugen alle zwanzig amtlichen Dateien. Der alte Bauer hatte KEINEN Rufer
 * mehr ausser seiner eigenen Probe.
 *
 * ── UND WARUM ER TROTZDEM WEG MUSSTE ──────────────────────────────────────
 *
 * Seine Probe war GRÜN und bestätigte die erfundenen Namen Zeile für Zeile.
 * Ein Wächter, der das Falsche verteidigt, ist schlimmer als keiner: der
 * Nächste, der hier etwas anschliesst oder abschreibt, bekommt ein Paket, das
 * ein Prüfer zurückweist — und eine grüne Batterie dazu.
 *
 * Was in dieser Datei BLEIBT, weil es wirklich gebraucht wird:
 *   • `zipDsfinvkBundle` + `DsfinvkFile`  — das Packen (vier Rufer)
 *   • `UST_SCHLUESSEL`                    — die Steuerschlüssel (16 Rufer)
 *   • `ZNummerFehltError`                 — der Riegel ohne Z-Nummer (5)
 *   • die Eingabetypen, die `dsfinvk-tag.ts` weiterverwendet
 *
 * Rückholbefehl im Grabstein: docs/AUSGEZOGEN-NICHTS-IST-VERLOREN.md
 */

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buf) {
    // Typed-array index access is typed `number` (never undefined).
    c = (CRC32_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

interface ZipEntry {
  name: string;
  data: Buffer;
  crc: number;
  compressed: Buffer;
  method: number; // 0 = STORE, 8 = DEFLATE
  offset: number;
}

/** Pack the bundle into a deterministic ZIP Buffer. */
export function zipDsfinvkBundle(files: DsfinvkFile[]): Buffer {
  const DOS_DATE = 0x0021; // 1980-01-01
  const DOS_TIME = 0x0000; // 00:00:00

  const localChunks: Buffer[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  for (const f of files) {
    const data = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content, 'utf8');
    const crc = crc32(data);
    const deflated = deflateRawSync(data, { level: 9 });
    const useDeflate = deflated.length < data.length;
    const compressed = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;
    const nameBuf = Buffer.from(f.name, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local file header sig
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(method, 8); // compression
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len

    localChunks.push(local, nameBuf, compressed);
    entries.push({ name: f.name, data, crc, compressed, method, offset });
    offset += local.length + nameBuf.length + compressed.length;
  }

  const centralChunks: Buffer[] = [];
  let centralSize = 0;
  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central dir header sig
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(e.method, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(e.crc, 16);
    central.writeUInt32LE(e.compressed.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30); // extra len
    central.writeUInt16LE(0, 32); // comment len
    central.writeUInt16LE(0, 34); // disk number
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0, 38); // external attrs
    central.writeUInt32LE(e.offset, 42); // local header offset
    centralChunks.push(central, nameBuf);
    centralSize += central.length + nameBuf.length;
  }

  const localSize = offset;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD sig
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(entries.length, 8); // entries on disk
  eocd.writeUInt16LE(entries.length, 10); // total entries
  eocd.writeUInt32LE(centralSize, 12); // central dir size
  eocd.writeUInt32LE(localSize, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([...localChunks, ...centralChunks, eocd]);
}
