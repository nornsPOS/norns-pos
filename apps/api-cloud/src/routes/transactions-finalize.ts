/**
 * POST /api/transactions/finalize — the first vital artery (ADR-0021 §1).
 *
 * The 12 days of foundation work converge here. One DB transaction. All-or-
 * nothing. The DB triggers do the policing; this handler orchestrates.
 *
 * Sequence (everything inside `db.transaction(...)`):
 *
 *   1. inventory-lock finalize() for each line — RESERVED → SOLD.
 *      Throws ReservationOwnershipError on mismatch.
 *   2. INSERT into transactions — the BEFORE INSERT triggers fire:
 *        • transactions_validate_storno          (sign + amounts + direction)
 *        • transactions_validate_sanctions       (C-2, hard-block)
 *        • transactions_validate_closing_day     (C-3, FINALIZED-day guard)
 *        • transactions_ankauf_requires_customer (C-1)
 *        • transactions_balance_equation         (subtotal+vat=total)
 *        • transactions_sign_discipline          (sign vs storno_of)
 *   3. INSERT into transaction_items (one or many).
 *   4. INSERT into transaction_payments (one or many).
 *   5. AFTER INSERT on transactions fires `on_transaction_finalized`:
 *        • UPDATE customers.cumulative_*_eur     (Great Connection)
 *        • INSERT ledger_events (extends the hash chain + pg_notify SSE)
 *
 * Any thrown error inside the block ⇒ ROLLBACK ⇒ no partial state. The DB
 * is either back to "before" or fully forward to "after".
 *
 * Gatekeepers (in order):
 *   • requireAuth         — must have a valid session
 *   • requireRole         — ADMIN or CASHIER
 *   • mTLS device         — populated by mtlsPlugin; the route checks it
 *     for the POS surface (CASHIER role MUST have a device id; ADMIN may
 *     not — e.g. Bridge UX issuing a back-office adjustment)
 *   • kein Gerätecode     — ein Verkauf ist über Storno umkehrbar (05.08.2026)
 *
 * Money discipline (Decimal.js):
 *   • Σ items.lineTotalEur          === totalEur
 *   • Σ items.lineSubtotalEur       === subtotalEur
 *   • Σ items.lineVatEur            === vatEur
 *   • Σ payments.amountEur          === totalEur
 *   • subtotalEur + vatEur          === totalEur
 *   • sign discipline mirrors storno_of_transaction_id presence
 */

import { Type } from '@sinclair/typebox';
import { sql as drizzleSql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import {
  ledgerEvents,
  transactionItems,
  transactionPayments,
  transactions,
} from '@norns/db/schema';
import {
  ReservationOwnershipError,
  finalizeViele as finalizeReservationen,
} from '@norns/inventory-lock';

import { emit } from '@norns/audit';
import type { Env } from '../config/env.js';
import { requireAuth, requireRole } from '../lib/auth-policy.js';
import {
  istSicherungseinrichtungEingerichtet,
  satzOhneSicherungseinrichtung,
} from '../lib/kassenpflicht.js';
import { LIZENZ_FEHLT_SATZ, verkaufIstFreigegeben } from '../lib/lizenz-riegel.js';

import { pruefeErfassungszeit } from '../lib/erfassungszeit.js';
import { pruefeMargen } from '../lib/marge-nachrechnen.js';
import { toCents } from '../lib/money-cents.js';
import { type VatPruefergebnis, darfReverseCharge } from '../lib/reverse-charge.js';
import { runSmurfingDetection } from '../lib/smurfing.js';
import { leseSteuerstand, pruefeSteuermodus } from '../lib/steuermodus.js';
import { buchungszeitpunkt, nimmTagessperre } from '../lib/tagessperre.js';
import { totalExceedsStepUpThreshold, validateTransactionMath } from '../lib/transaction-math.js';
import {
  type ApiErrorCode,
  DomainError,
  KycRequiredError,
  VatCheckRequiredError,
} from '../plugins/error-handler.js';
import {
  FinalizeBody,
  FinalizeOrDryRunResponse,
  type FinalizeBody as TFinalizeBody,
} from '../schemas/transaction.js';

// ────────────────────────────────────────────────────────────────────────
// Local errors → ApiErrorCode mapping
// ────────────────────────────────────────────────────────────────────────

class ProductNotReservableError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'PRODUCT_NOT_RESERVABLE';
}

/** Eine Web-Bestellung ist nicht (mehr) zur Abholung offen: schon übergeben,
 *  storniert oder verfallen. 409, damit der Tresen neu laden kann. */
class NotCollectableError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

class ValidationError extends DomainError {
  public readonly httpStatus = 400;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: unknown;
  public constructor(message: string, details: unknown) {
    super(message);
    this.details = details;
  }
}

class DeviceRequiredError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}

/**
 * Die Kasse ist nicht freigeschaltet. 402, weil es genau das heisst:
 * bezahlen und weitermachen. Kein 403 — der Kassierer hat nichts falsch
 * gemacht und soll nicht nach seinen Rechten suchen.
 */
class LizenzFehltError extends DomainError {
  public readonly httpStatus = 402;
  public readonly code: ApiErrorCode = 'LIZENZ_FEHLT';
}

/**
 * ── KEINE SICHERUNGSEINRICHTUNG EINGERICHTET (01.08.2026) ──────────────────
 *
 * Diese Kasse hat noch nie eine TSE gesehen. Das ist KEIN Ausfall, sondern
 * eine Kasse, die § 146a AO nicht erfüllt und nach § 146a Abs. 1 Satz 2 nicht
 * betrieben werden darf.
 *
 * ⚠️ DIE UNTERSCHEIDUNG, AN DER ALLES HÄNGT.
 *
 * Bis heute war `transactions-finalize.ts` in dieser Sache STUMM: null
 * Erwähnungen der TSE. Eine ausgelieferte Kasse konnte einen ganzen
 * Handelstag lang unsignierte Belege erzeugen, drucken und abschliessen, ohne
 * dass irgendwo etwas rot wurde. Auf dem Beleg stand an allen vier
 * Signaturstellen „TSE Ausfall", und niemand hielt an.
 *
 * Der Riegel hier trifft AUSDRÜCKLICH NUR den Fall „gar keine eingerichtet".
 * Der ANDERE Fall — eingerichtet, aber gerade nicht erreichbar — bleibt
 * durchlässig, und das ist kein Nachlassen, sondern der Kern der Sache:
 *
 *   • Norns POS ist eine Kasse für den Tresen, die OHNE Netz arbeitet.
 *   • Der einzige gebaute TSE-Weg ist ein WOLKEN-Weg (fiskaly).
 *   • Damit ist der Ausfall der REGELFALL, nicht die Ausnahme.
 *
 * Ein Riegel, der auch den Ausfall sperrt, hielte den Laden an, sobald das
 * Netz wackelt. Genau dafür kennt § 6 KassenSichV den dokumentierten Ausfall:
 * der Beleg wird gekennzeichnet, die Signatur wird nachgeholt, und beides ist
 * nachweisbar. Die Warteschlange auf Platte
 * (`src-tauri/migrations/0003_tse_queue.sql`) und ihr Abbau sind dafür schon
 * gebaut und tragen.
 *
 * Was NICHT tragbar ist, ist Schweigen. Deshalb: wer nie eine TSE eingerichtet
 * hat, verkauft nicht.
 *
 * 409, nicht 403: es ist kein Rechteproblem, sondern ein Zustand, den der
 * Inhaber in den Einstellungen auflösen kann und dann erneut versucht.
 */
class KeineTseEingerichtetError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/**
 * Ein Storno gehört auf den Storno-Weg, nicht hierher.
 *
 * ── DER FUND VOM 02.08.2026 ─────────────────────────────────────────────────
 *
 * `POST /api/transactions/finalize` nahm einen Storno entgegen, sobald
 * `stornoOfTransactionId` im Rumpf stand. Damit gab es ZWEI Türen für dieselbe
 * fiskalische Handlung, und sie waren verschieden verriegelt:
 *
 *   `transactions-storno.ts`        dieser Weg (finalize)
 *   ───────────────────────────     ─────────────────────────────────────────
 *   Gerätecode IMMER                kein Gerätecode
 *   Pflichtgrund, mind. 8 Zeichen   kein Grund
 *   Tagebuchzeile mit dem Grund     keine
 *   ein Storno je Urbeleg           ungeprüft
 *
 * Und schwerer: der GESAMTE Riegelblock hängt in
 * `if (body.stornoOfTransactionId == null)` und wurde damit übersprungen. Also
 * auch der Riegel nach § 146a AO. Eine Kasse ohne eingerichtete
 * Sicherungseinrichtung konnte KEINEN Verkauf abschliessen, aber sehr wohl
 * einen Storno buchen. Ein Storno ist nach der Norm ein aufzeichnungs- und
 * signaturpflichtiger Vorgang wie jeder andere; die DSFinV-K führt ihn
 * ausdrücklich (BON_STORNO). Genau dieser Defekt stand schon einmal im
 * Monatslauf: „jeder Storno ohne TSE-Signatur".
 *
 * ── WARUM SPERREN UND NICHT DIE REGELN VERDOPPELN ──────────────────────────
 *
 * Zwei Wege mit denselben Regeln bleiben nur so lange gleich, bis jemand einen
 * davon ändert. Gemessen: KEIN Klient schickt `stornoOfTransactionId` an
 * `finalize`, weder die Kasse noch die Inhaber-App noch der Kundenshop, und
 * auch keine Integrationsprobe. Die Tür war offen und unbenutzt.
 *
 * 409 mit einem Satz, der den richtigen Weg NENNT: eine Absage ohne Weg wäre
 * ein Vorwurf.
 */
class StornoGehoertAufDenStornowegError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/**
 * 0118 — der Klient hat eine Schicht geschickt, die nicht zu SEINEM Geraet
 * gehoert (oder gar nicht existiert).
 *
 * ⚠️ Ein Klient darf sich keine fremde Schicht aussuchen. Ohne diese Pruefung
 * koennte eine Kasse ihre Umsaetze in den Kassensturz einer anderen Kasse
 * schieben — der Blindsturz beider Schichten waere dann falsch, und zwar
 * still. 403, weil es eine Rechtefrage ist und keine Formfrage.
 */
class FremdeSchichtError extends DomainError {
  public readonly httpStatus = 403;
  public readonly code: ApiErrorCode = 'DEVICE_NOT_AUTHORIZED';
}

/**
 * ⛔ BARGELD OHNE SCHICHT ERSCHEINT IN KEINEM KASSENSTURZ
 *
 * ── DER BEFUND VOM 08.08.2026 ────────────────────────────────────────────
 *
 * `transactions.shift_id` darf NULL sein, und keine Prüfbedingung verlangte,
 * dass ein Beleg mit einer Barzahlung an einer Schicht hängt. Sendete der
 * Klient keine Schicht und war am Gerät gerade keine offen, setzte der
 * Rückfallweg still `resolvedShiftId = null` — ohne Fehler, ohne Hinweis.
 *
 * Der Sollbestand beim Schichtschluss zählt aber ausschliesslich
 * `WHERE t.shift_id = <Schicht>` (`shifts.ts`, Zeilen 374 bis 389). Das
 * Bargeld dieses Belegs fehlt damit im erwarteten Ladenbestand, der
 * Blindsturz zeigt einen ÜBERSCHUSS, und `cash_drawer_variance_eur` schreibt
 * diese erfundene Differenz unveränderlich fest.
 *
 * Am Prüfstand gemessen: 7 Belege, 833,00 EUR, in KEINEM Kassensturz.
 *
 * Der Tagesriegel greift nicht: er verlangt nur, dass IRGENDEINE geschlossene
 * Schicht den Tag abdeckt, nicht dass jeder Beleg an einer hängt.
 *
 * ⚠️ Der Code kannte die Folge und benannte sie an Ort und Stelle
 * („Without shift_id the shift-close expected balance was always wrong"),
 * verhinderte sie aber nicht. Ein Kommentar ist kein Riegel.
 *
 * Nur BAR. Eine Kartenzahlung liegt nicht in der Lade und verfälscht keinen
 * Kassensturz; sie zu sperren wäre ein Riegel ohne Schaden dahinter.
 */
class BargeldOhneSchichtError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

// ────────────────────────────────────────────────────────────────────────
// 0118 — die Grenzen der vom Geraet gelieferten Erfassungszeit
// ────────────────────────────────────────────────────────────────────────

/**
 * Wie weit die Erfassungszeit VOR der Serverzeit liegen darf.
 *
 * Begruendung der Grenze: eine Zeit in der Zukunft ist nie ein echter
 * Vorgang, sie ist ein Weg, Umsatz aus einem gepruefen Tag herauszuschieben.
 * Zwei Minuten decken den Gangunterschied einer Kasse ohne Zeitabgleich ab
 * (NTP-gefuehrte Geraete liegen im Sekundenbereich); alles darueber ist
 * entweder eine kaputte Uhr oder ein Versuch. Beides gehoert abgewiesen,
 * nicht stillschweigend hingenommen.
 */

/**
 * Wie ALT die Erfassungszeit hoechstens sein darf.
 *
 * Begruendung der Grenze: § 146 Abs. 1 Satz 2 AO verlangt, Kasseneinnahmen
 * TAEGLICH festzuhalten. Ein Geraet, das seine Vorgaenge nachspielt, holt
 * das binnen Stunden nach, im schlimmsten Fall ueber ein langes Wochenende.
 * Sieben Tage sind dafuer grosszuegig bemessen.
 *
 * Was jenseits davon liegt, ist kein Nachspielen mehr: das ist die Kasse,
 * deren Uhr beim Batteriewechsel auf das Jahr 2010 zurueckgesprungen ist.
 * Wuerde der Server sie annehmen, staende diese Zeit fuer immer in einer
 * fortschreibungsgeschuetzten Aufzeichnung. Deshalb Ablehnung mit klarer
 * Meldung statt stiller Annahme — ein Mensch muss den Fall ansehen.
 */

// Error response schema — referenced for OpenAPI completeness.
const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

export interface TransactionsFinalizeOpts {
  env: Env;
}

// ────────────────────────────────────────────────────────────────────────
// Plugin / route
// ────────────────────────────────────────────────────────────────────────

const transactionsFinalize: FastifyPluginAsync<TransactionsFinalizeOpts> = async (app) => {
  app.post(
    '/api/transactions/finalize',
    {
      schema: {
        tags: ['transactions'],
        summary: 'Finalize a fiscal transaction (the vital artery, ADR-0021)',
        description:
          'All-or-nothing finalize: moves each reserved product to SOLD, inserts the transaction + items + payments, ' +
          'and (via DB triggers) updates the customer cumulative spend and emits a hash-chained ledger event. ' +
          'Kein Gerätecode: ein Verkauf ist über Storno umkehrbar, und der Storno verlangt ihn.',
        body: FinalizeBody,
        response: {
          200: FinalizeOrDryRunResponse,
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
          423: ErrorResponse,
        },
      },
    },
    async (req, _reply) => {
      // ──────────────────────────────────────────────────────────────────
      // 1. Gatekeepers.
      // ──────────────────────────────────────────────────────────────────
      requireAuth(req);
      requireRole(req, 'ADMIN', 'CASHIER');

      // ⚠️ Der Lizenzriegel steht VOR dem Schreiben und NUR hier am Verkauf.
      // Tagesabschluss, Ausfuhren, Storno und die Bücher bleiben offen; die
      // Begründung steht in `lib/lizenz-riegel.ts` und ist keine Feinheit,
      // sondern § 146a AO.
      if (!verkaufIstFreigegeben()) {
        throw new LizenzFehltError(LIZENZ_FEHLT_SATZ);
      }

      // Every finalized transaction must originate from an mTLS-paired device.
      // The mtlsPlugin populates req.deviceId from Cf-Client-Cert-Sha256 (prod)
      // or X-Dev-Device-Fingerprint (dev). Tests must send this header too.
      const deviceId = req.deviceId;
      if (!deviceId) {
        throw new DeviceRequiredError('Finalize requires an mTLS-paired device');
      }

      const body = req.body as TFinalizeBody;

      // ⚠️ EIN Storno, EIN Weg. Siehe `StornoGehoertAufDenStornowegError`:
      // hier war jede fiskalische Prüfung übersprungen, auch der Riegel nach
      // § 146a AO, und die Zweitbestätigung galt nur oberhalb der
      // Betragsschwelle. Diese Absage steht GANZ vorn, vor jeder anderen
      // Prüfung, damit sie nicht irgendwann wieder hinter einen Zweig rutscht.
      if (body.stornoOfTransactionId != null) {
        throw new StornoGehoertAufDenStornowegError(
          'Eine Stornierung wird nicht über den Abschluss gebucht. Bitte den Storno-Weg ' +
            'benutzen: er verlangt die Zweitbestätigung unabhängig vom Betrag, einen ' +
            'Grund im Klartext und schreibt beides ins Tagebuch. Für eine Rückgabe mit ' +
            'Ware gibt es den Rückgabe-Weg.',
        );
      }

      // ── GwG KYC gate (friendly pre-check; the BEFORE INSERT trigger
      //    transactions_validate_kyc is the authoritative, un-bypassable gate).
      //    Skip stornos — a reversal must never be re-blocked. ──
      // ⚠️ Hier stand `if (body.stornoOfTransactionId == null) {`, und dieser
      // eine Zweig übersprang den GANZEN Riegelblock darunter: § 146a AO,
      // den Umsatzsteuer-Status nach § 19, § 13b, § 10 GwG und § 259 StGB.
      // Ein Storno kam damit an jeder fiskalischen Prüfung vorbei.
      //
      // Die Bedingung ist ersatzlos entfallen, weil ein Storno diese Route
      // gar nicht mehr erreicht: sie wird ganz oben abgewiesen und auf den
      // Storno-Weg verwiesen. Sie STEHEN ZU LASSEN wäre die gefährlichere
      // Fassung: eine Bedingung, die heute nie greift, sieht morgen wie eine
      // gewollte Ausnahme aus, und der nächste Mensch baut darauf.
      const buyerVerified = async (id: string): Promise<boolean> => {
        const rows = await app.db.execute<{ kyc_verified_at: Date | null }>(drizzleSql`
          SELECT kyc_verified_at FROM customers WHERE id = ${id}::uuid LIMIT 1`);
        return rows[0] != null && rows[0].kyc_verified_at !== null;
      };

      if (body.direction === 'ANKAUF' && body.customerId != null) {
        // ANKAUF: seller ID required for EVERY buy from €0,01 (§ 259 StGB).
        if (!(await buyerVerified(body.customerId))) {
          throw new KycRequiredError(
            'Identifizierung erforderlich (§ 259 StGB): Jeder Ankauf verlangt eine geprüfte ' +
              'Ausweis-Identifikation des Verkäufers.',
          );
        }
      } else if (body.direction === 'VERKAUF') {
        // VERKAUF: buyer ID required at/above the GwG §10 threshold (€2.000).
        const thRows = await app.db.execute<{ th: string }>(drizzleSql`
          SELECT COALESCE((value #>> '{}')::numeric, 2000.00)::text AS th
            FROM system_settings WHERE key = 'gwg.verkauf_identity_threshold_eur'`);
        const thresholdEur = thRows[0]?.th ?? '2000.00';
        if (
          totalExceedsStepUpThreshold(body.totalEur, thresholdEur) &&
          !(body.customerId != null && (await buyerVerified(body.customerId)))
        ) {
          throw new KycRequiredError(
            `Identifizierung erforderlich (§ 10 GwG): Ab ${thresholdEur} € verlangt der Verkauf eine geprüfte Ausweis-Identifikation des Käufers.`,
          );
        }
      }
      // ⚠️ 02.08.2026 BERICHTIGT. Hier stand `count(*) FROM tse_clients`.
      // Das war doppelt falsch, und der Riegel dadurch auf einer
      // ausgelieferten Kasse UNAUFHEBBAR:
      //
      //   • Diese Tabelle hat genau einen Schreiber, den Arbeiter-Auftrag
      //     `tse-cert-checker`. Der Arbeiter reist mit Norns POS nicht mit.
      //   • Ihre Spalten heissen `cert_valid_to`, `alert_sent_at`,
      //     `last_alert_tier` — ein Wachbuch über ablaufende Zertifikate,
      //     kein Verzeichnis eingerichteter Kassen.
      //
      // Gelesen wird jetzt der Schlüssel, den `tse-einrichtung.ts` setzt.
      // Er ist das Einzige, was die Kasse selbst schreiben kann.
      // ⚠️ 02.08.2026, ZWEITE Berichtigung am selben Tag: die Abfrage stand
      // hier WÖRTLICH und war damit nur der Riegel DIESES Weges. Fünf
      // andere Wege in dieselbe Tabelle hatten sie nicht. Sie wohnt jetzt
      // in `lib/kassenpflicht.ts`, und ein Wächter zwingt jeden Schreiber,
      // sie zu rufen oder sich namentlich auszunehmen.
      //
      // Derselbe Satz, den `lib/fiscal-health.ts` der Ampel gibt: EIN
      // Wortlaut für denselben Zustand, damit Kassierer und Inhaber nicht
      // zwei verschiedene Erklärungen für dasselbe lesen.
      // ── ⚠️ 15.08.2026: DER VORRAT VON ZEHN IST ERSATZLOS GESTRICHEN ────
      //
      // Am 13.08. gab es hier eine Gnadenfrist: die ersten zehn Belege
      // durften ohne Sicherungseinrichtung gebucht werden, gezaehlt und mit
      // schaerfer werdender Warnung. Basel hat sie am 15.08. nach der
      // Rechtspruefung gestrichen, und die Begruendung gehoert hierher,
      // damit sie niemand aus Bequemlichkeit wieder einbaut:
      //
      //   § 146a Abs. 1 Satz 5 AO verbietet, kassenfaehige Software ohne
      //   Erfuellung der Anforderungen gewerbsmaessig zu BEWERBEN oder IN
      //   VERKEHR ZU BRINGEN. § 379 Abs. 1 Satz 1 Nr. 6 AO macht daraus eine
      //   Ordnungswidrigkeit mit bis zu 25.000 Euro (Abs. 6) — ohne dass ein
      //   Steuerschaden noetig waere. Das Risiko trifft nicht den Haendler,
      //   sondern NORNS.
      //
      //   Der amtliche Trainingsmodus (DSFinV-K 2.4 Tz. 4.2.6, BON_TYP
      //   AVTraining) laeuft ausdruecklich DURCH die TSE. Einen legalen
      //   unsignierten Betriebsmodus gibt es nicht.
      //
      // Das Geschaeftsmodell traegt das: die Kasse wird nur noch mit fertig
      // provisionierter Sicherungseinrichtung ausgeliefert. Wer sie
      // herunterlaedt, hat bezahlt und bekommt eine TSE.
      //
      // ⚠️ NICHT ZU VERWECHSELN mit dem AUSFALL einer eingerichteten TSE.
      // Der bleibt erlaubt und unangetastet (AEAO 1.14.3): der Beleg traegt
      // dann „TSE-Ausfall", der Vorgang wandert in die Warteschlange, und
      // der Verkauf laeuft weiter. Dieser Riegel hier prueft NUR, ob je eine
      // eingerichtet wurde.
      if (!(await istSicherungseinrichtungEingerichtet(app.db))) {
        throw new KeineTseEingerichtetError(satzOhneSicherungseinrichtung('Verkauf'));
      }

      // ── 1a. REGELBESTEUERUNG ODER § 19? Das darf nie geraten werden.
      //
      // ⚠️ Beim ersten Haendler stellte sich heraus: sein Impressum nennt
      // § 19 UStG („keine Umsatzsteuer"), waehrend dieses System ihm 5.982,63
      // EUR Umsatzsteuer berechnet hatte. Ein Kleinunternehmer, der Steuer
      // AUSWEIST, schuldet sie nach § 14c Abs. 1 UStG — ohne sie je
      // (seit 01.01.2025 Abs. 1 statt Abs. 2: der Umsatz ist jetzt steuerfrei,
      // BMF-Schreiben vom 18.03.2025, Rn. 5) —
      // eingenommen zu haben.
      //
      // Ist der Modus nicht hinterlegt, haelt der Verkauf AN. Ein System,
      // das dann „19 % ist schon ueblich" annimmt, erfindet eine Angabe.
      // Siehe lib/steuermodus.ts.
      {
        const mRows = await app.db.execute<{ k: string; v: string | null }>(drizzleSql`
          SELECT key AS k, value #>> '{}' AS v FROM system_settings
           WHERE key IN ('steuer.modus', 'steuer.modus_gilt_ab')`);
        const werte = new Map(mRows.map((r) => [r.k, r.v]));
        const stand = leseSteuerstand(
          werte.get('steuer.modus') ?? null,
          werte.get('steuer.modus_gilt_ab') ?? null,
        );

        // Jede Zeile einzeln — ein gemischter Rumpf darf sich nicht durch
        // einen harmlosen Kopf schmuggeln.
        for (const it of body.items) {
          const u = pruefeSteuermodus({
            stand,
            taxTreatmentCode: it.appliedTaxTreatmentCode ?? body.taxTreatmentCode ?? 'KEIN',
            // ⚠️ toCents statt Number()*100: genau diese Float-Abkürzung hat
            // schon einmal 0,29 EUR zu 28 Cent gemacht (StornoDialog.tsx).
            // Diese zwei Riegel entscheiden über Ablehnung eines Verkaufs —
            // die letzten Orte für Gleitkomma.
            vatCents: toCents(it.lineVatEur),
          });
          if (!u.erlaubt) throw new VatCheckRequiredError(u.grund ?? 'Steuermodus unklar.');
        }

        /*
         * ── DER HINWEIS MUSS AUF DEM BELEG STEHEN (20.08.2026) ───────────
         *
         * ⚠️ EIN ECHTER FUND, und er lag seit jeher hier: `pruefeSteuermodus`
         * stellt für den Kleinunternehmer den fertigen Pflichtsatz her
         * (`belegzusatz`), und diese Route hat ihn WEGGEWORFEN. Die Kasse
         * fragte den Status nie ab, also stand er auf keinem Bon. Ein Beleg
         * eines Kleinunternehmers ohne den Hinweis nach § 19 UStG ist
         * unvollständig — und die Kasse hat ihn in jeder Fassung so gedruckt.
         *
         * Ab jetzt gilt dieselbe Härte wie bei § 13b (Block 1b darunter): der
         * Beleg TRÄGT den Satz, oder es gibt keinen Beleg. Die Kasse setzt
         * ihn (`beleg-steuerausweis.ts`), hier wird nachgesehen — zwei Wege
         * zu derselben Wahrheit, und der Server hat das letzte Wort.
         */
        if (stand.modus === 'KLEINUNTERNEHMER_19') {
          const notizen = body.specialSchemeNotices ?? [];
          if (!notizen.some((n) => n.includes('§ 19 UStG'))) {
            throw new VatCheckRequiredError(
              'Dieser Betrieb ist Kleinunternehmer nach § 19 UStG. Der Beleg muss den ' +
                'Hinweis darauf tragen; er fehlt. Bitte die Kasse aktualisieren, damit ' +
                'sie den Hinweis mitdruckt.',
            );
          }
        }
      }

      // ── 1b. § 13b: die Steuerfreiheit muss BELEGT sein ──────────────
      //
      // Bis zum 26.07.2026 stand hier nichts. `taxTreatmentCode` kam aus
      // dem Rumpf und wurde durchgeschrieben, bis in den Hauptbuch-Eintrag.
      // Wer `REVERSE_CHARGE_13B` schickte, verkaufte ohne Umsatzsteuer —
      // Kassiererrecht genügte, an 19 Prozent jedes Verkaufs.
      //
      // § 6a Abs. 4 UStG schützt den guten Glauben nur bei BELEGTER
      // Sorgfalt. Ohne dokumentierte Abfrage nach § 18e UStG schuldet das
      // Haus die Steuer selbst, aus einem Verkauf, bei dem es sie nie
      // eingenommen hat.
      //
      // Die Prüfung deckt auch die Zeilen ab, nicht nur den Kopf: eine
      // einzelne Zeile mit `appliedTaxTreatmentCode` genügt, um sie
      // auszulösen. Sonst bliebe die Lücke eine Feldebene tiefer offen.
      const will13b =
        body.taxTreatmentCode === 'REVERSE_CHARGE_13B' ||
        body.items.some((i) => i.appliedTaxTreatmentCode === 'REVERSE_CHARGE_13B');

      if (will13b) {
        const kundenzeile =
          body.customerId == null
            ? null
            : ((
                await app.db.execute<{
                  vat_id: string | null;
                  vat_id_checked_value: string | null;
                  vat_id_checked_at: Date | null;
                  vat_id_check_result: VatPruefergebnis | null;
                }>(drizzleSql`
                  SELECT vat_id, vat_id_checked_value, vat_id_checked_at, vat_id_check_result
                    FROM customers WHERE id = ${body.customerId}::uuid LIMIT 1`)
              )[0] ?? null);

        const altRows = await app.db.execute<{ t: string }>(drizzleSql`
          SELECT (value #>> '{}')::text AS t
            FROM system_settings WHERE key = 'vat.pruefung_hoechstalter_tage'`);

        const urteil = darfReverseCharge({
          kunde:
            kundenzeile == null
              ? null
              : {
                  vatId: kundenzeile.vat_id,
                  geprueftesVatId: kundenzeile.vat_id_checked_value,
                  geprueftAm: kundenzeile.vat_id_checked_at,
                  ergebnis: kundenzeile.vat_id_check_result,
                },
          jetzt: new Date(),
          // `exactOptionalPropertyTypes`: das Feld ganz weglassen, nicht auf
          // undefined setzen. Sonst ist „keine Einstellung" ein anderer Fall
          // als „Feld fehlt", und die Vorgabe greift nicht.
          ...(Number(altRows[0]?.t) > 0 ? { hoechstalterTage: Number(altRows[0]?.t) } : {}),
        });

        if (!urteil.erlaubt) {
          throw new VatCheckRequiredError(urteil.grund ?? 'Reverse-Charge (§ 13b) nicht belegt.');
        }
      }

      // ──────────────────────────────────────────────────────────────────
      // 2. Decimal.js validation — fail fast with field paths.
      // ──────────────────────────────────────────────────────────────────
      const mathErr = validateTransactionMath(body);
      if (mathErr) {
        throw new ValidationError(mathErr.message, mathErr);
      }

      // Rabatt discipline (migration 0019 CHECK): a non-zero line discount
      // requires a reason. We surface a clean field-pathed VALIDATION_ERROR
      // before the DB CHECK fires so the POS can point at the offending line.
      for (const [idx, item] of body.items.entries()) {
        const discount = item.lineDiscountEur ? Number(item.lineDiscountEur) : 0;
        if (discount > 0 && !item.lineDiscountReason?.trim()) {
          throw new ValidationError('Ein Rabatt erfordert eine Begründung.', {
            field: `items[${idx}].lineDiscountReason`,
            message: 'line_discount_eur > 0 requires line_discount_reason',
          });
        }
      }

      // ──────────────────────────────────────────────────────────────────
      // 2c. 0118 — die Erfassungszeit des Geraets, und ihre Grenzen.
      //
      // Nach § 146a AO und der DSFinV-K ist die KASSE die Quelle fuer
      // Vorgangsbeginn und Vorgangsende. Ein vom Klienten gelieferter
      // Zeitstempel ist aber zugleich ein Angriffsweg, also traegt der
      // Entwurf beides: die Geraetezeit ALS Vorgangszeit (`finalized_at`)
      // und die Eingangszeit des Servers getrennt daneben
      // (`transactions.eingegangen_am`, DEFAULT now()).
      //
      // Bewusst VOR dem Trockenlauf: sonst antwortete der Trockenlauf
      // „ginge durch" auf einen Rumpf, den der echte Aufruf danach ablehnt —
      // und genau dafuer gibt es den Trockenlauf nicht.
      // ──────────────────────────────────────────────────────────────────
      const jetzt = new Date();
      // 0118, seit 28.07.2026 in `lib/erfassungszeit.ts` — dieselbe Regel gilt
      // für den Storno. Zwei Kopien einer Fiskalregel laufen auseinander.
      const zeitbefund = pruefeErfassungszeit(body.erfasstAm, jetzt);
      if (zeitbefund.fehler) {
        throw new ValidationError(zeitbefund.fehler.nachricht, zeitbefund.fehler.einzelheiten);
      }
      const erfasstAm = zeitbefund.erfasstAm;

      // 0118 — die Schicht, auf der WIRKLICH kassiert wurde. Der Klient sendet
      // sie; der Server prueft, dass sie zu DIESEM Geraet gehoert. Auch das
      // gehoert vor den Trockenlauf, damit eine fremde Schicht auffliegt,
      // BEVOR die Karte belastet wird.
      if (body.shiftId != null) {
        const eigene = await app.db.execute<{ id: string }>(drizzleSql`
          SELECT id::text AS id FROM shifts
           WHERE id = ${body.shiftId}::uuid AND device_id = ${deviceId}::uuid LIMIT 1`);
        if (!eigene[0]) {
          throw new FremdeSchichtError(
            'Diese Schicht gehört nicht zu diesem Gerät. Ein Vorgang kann nur auf eine eigene Schicht gebucht werden.',
          );
        }
      }

      // ──────────────────────────────────────────────────────────────────
      // 2a. § 25a: DIE MARGE WIRD NACHGERECHNET, nicht geglaubt
      // ──────────────────────────────────────────────────────────────────
      //
      // ⚠️ Bis zum 26.07.2026 prueft `validateTransactionMath` bei § 25a genau
      // EINE Sache: dass `marginEur` und `acquisitionCostEurSnapshot` gemeinsam
      // gesetzt sind. Ob die Zahlen STIMMEN, prueft niemand.
      //
      // Ein Aufrufer konnte also einen erfundenen Einkaufspreis schicken und
      // damit jede beliebige Steuer — in eine hashverkettete, nicht mehr
      // aenderbare Aufzeichnung. Kassiererrecht genuegte, und es fiel nirgends
      // auf: die Bilanzgleichung ging auf, die Summen stimmten.
      //
      // Der echte Einkaufspreis steht in `products` und wird jetzt gelesen.
      // Siehe lib/marge-nachrechnen.ts.
      {
        const margenZeilen = body.items
          .map((it, i) => ({ it, i }))
          .filter(({ it }) => it.appliedTaxTreatmentCode === 'MARGIN_25A');

        if (margenZeilen.length > 0) {
          // ⚠️ Als Postgres-Arrayliteral binden, NICHT als JS-Array. Eine
          // blosse Interpolation ist fuer TypeScript unsichtbar und wirft zur
          // Laufzeit — beim ERSTEN echten Verkauf. Der Waechter
          // `no-array-spread.test.ts` hat genau diese Zeile gefangen, kurz
          // nachdem ich sie geschrieben hatte.
          const ids = `{${margenZeilen.map(({ it }) => it.productId).join(',')}}`;
          // `item_type` kommt aus derselben Zeile mit — die Tarifprüfung nach
          // § 25a Abs. 1 Nr. 3 UStG kostet dadurch keine zweite Abfrage.
          const kosten = await app.db.execute<{ id: string; k: string | null; a: string | null }>(
            drizzleSql`
            SELECT id::text AS id, acquisition_cost_eur::text AS k, item_type::text AS a
              FROM products WHERE id = ANY(${ids}::uuid[])`,
          );
          const jeId = new Map(kosten.map((r) => [r.id, r.k]));
          const artJeId = new Map(kosten.map((r) => [r.id, r.a]));

          // Exakt, nicht über Gleitkomma — siehe den Riegel oben (1a).
          const zuCent = (v: string | null | undefined): bigint | null =>
            v == null || v === '' ? null : toCents(v);

          const befunde = pruefeMargen(
            margenZeilen.map(({ it, i }) => ({
              index: i,
              appliedTaxTreatmentCode: it.appliedTaxTreatmentCode,
              lineTotalCent: zuCent(it.lineTotalEur) ?? 0n,
              behaupteterEinkaufCent: zuCent(it.acquisitionCostEurSnapshot),
              behaupteteMargeCent: zuCent(it.marginEur),
              behaupteteSteuerCent: zuCent(it.lineVatEur) ?? 0n,
              echterEinkaufCent: zuCent(jeId.get(it.productId)),
              warenart: artJeId.get(it.productId) ?? null,
            })),
          );

          if (befunde[0]) {
            // ⚠️ NICHT still korrigieren. Ein Server, der die Zahl des Klienten
            // stillschweigend richtigstellt, verdeckt einen Fehler in der Kasse
            // — und genau so ein Fehler stand heute frueh noch drin.
            throw new ValidationError(befunde[0].message, befunde[0]);
          }
        }
      }

      // ──────────────────────────────────────────────────────────────────
      // 2b. DER TROCKENLAUF: alles pruefen, nichts schreiben.
      // ──────────────────────────────────────────────────────────────────
      //
      // ⚠️ Am 26.07.2026 gemessen: beim Kartenweg liegt die Autorisierung VOR
      // dem finalize (`BezahlenDialog.tsx`, `pendingAuthRef`). Wird der Vorgang
      // hier abgelehnt — wegen § 13b, wegen § 10 GwG, wegen § 259 StGB oder
      // wegen eines Rechenfehlers — ist die Karte bereits belastet, und jeder
      // Wiederholversuch scheitert identisch. Geld gezogen, kein Vorgang
      // gebucht, Kassiererin ohne Ausweg.
      //
      // Der Trockenlauf loest das an der Wurzel statt je Grund: die Kasse fragt
      // VOR der Autorisierung, ob dieser Vorgang durchginge. Alles oberhalb
      // dieser Zeile ist bereits gelaufen — die Identitaetsriegel, der
      // § 13b-Riegel, die Rechenpruefung und die Rabattdisziplin. Unterhalb
      // beginnt das Schreiben.
      //
      // Bewusst KEINE eigene Route: eine zweite Route waere eine zweite
      // Wahrheit, die beim naechsten neuen Riegel auseinanderliefe. Hier ist es
      // per Bauart derselbe Weg.
      if (body.dryRun === true) {
        return _reply.status(200).send({ dryRun: true, wouldSucceed: true } as const);
      }

      // ──────────────────────────────────────────────────────────────────
      // 3-PRE. §19.2 C-4 idempotency dedup.
      //
      // Cheap pre-check OUTSIDE the transaction — if a row already exists
      // for this idempotency key, return the original result without
      // re-running finalize. This is the "lost response, operator retry"
      // path: the original transaction committed, the response never
      // reached the client, the operator retried with the SAME key.
      //
      // The pre-check is not the security boundary — the DB's partial
      // UNIQUE INDEX (transactions_idempotency_key_uniq, migration 0028)
      // is. The check below is the happy-path fast lane; on a true race
      // (two concurrent retries) one INSERT wins, the other catches the
      // unique-violation below and falls back to the same dedup SELECT.
      // ──────────────────────────────────────────────────────────────────
      const existingByKey = (
        await app.db
          .select({
            id: transactions.id,
            receiptLocator: transactions.receiptLocator,
            finalizedAt: transactions.finalizedAt,
            erfasstAm: transactions.erfasstAm,
            nachtragBezugstag: transactions.nachtragBezugstag,
            direction: transactions.direction,
            totalEur: transactions.totalEur,
            stornoOfTransactionId: transactions.stornoOfTransactionId,
          })
          .from(transactions)
          .where(drizzleSql`${transactions.idempotencyKey} = ${body.idempotencyKey}::uuid`)
          .limit(1)
      )[0];

      if (existingByKey) {
        const ledgerRow = (
          await app.db
            .select({ id: ledgerEvents.id })
            .from(ledgerEvents)
            .where(
              drizzleSql`${ledgerEvents.entityTable} = 'transactions' AND ${ledgerEvents.entityId} = ${existingByKey.id}`,
            )
            .limit(1)
        )[0];

        return {
          id: existingByKey.id,
          receiptLocator: existingByKey.receiptLocator,
          finalizedAt: existingByKey.finalizedAt.toISOString(),
          // 0118: auch der Wiederholungsweg sagt den Nachtrag an. Sonst saehe
          // die Kassiererin den Hinweis genau dann nicht, wenn die erste
          // Antwort verloren ging — also im Netzstoerungsfall, in dem der
          // Nachtrag am wahrscheinlichsten ist.
          erfasstAm: existingByKey.erfasstAm?.toISOString() ?? null,
          nachtragBezugstag: existingByKey.nachtragBezugstag ?? null,
          ledgerEventId: ledgerRow ? Number(ledgerRow.id) : 0,
          direction: existingByKey.direction,
          totalEur: existingByKey.totalEur,
          storno: existingByKey.stornoOfTransactionId != null,
        };
      }

      // ──────────────────────────────────────────────────────────────────
      // 3. ONE database transaction — the all-or-nothing contract.
      //
      // Drizzle's `db.transaction` wraps BEGIN…COMMIT/ROLLBACK. Any throw
      // inside rolls back; we then re-throw so the error-handler plugin
      // maps the error to HTTP.
      // ──────────────────────────────────────────────────────────────────
      const outcome = await app.db
        .transaction(async (tx) => {
          // Die GETEILTE Sperre auf den Geschäftstag dieses Verkaufs. Der
          // Tagesabschluss nimmt die AUSSCHLIESSLICHE auf denselben Schlüssel
          // und kann den Tag deshalb nicht abrechnen, während dieser Verkauf
          // mitten im Festschreiben ist. Geteilte Sperren behindern einander
          // nicht, gleichzeitige Verkäufe laufen also ungebremst.
          //
          // ⚠️ 08.08.2026: die Ableitung des Schlüssels stand HIER und musste an
          // sechs Stellen stehen — die anderen fünf Schreibwege nahmen die
          // Sperre gar nicht. Sie wohnt jetzt in `tagessperre.ts`, und ein
          // Wächter zählt die Schreibwege aus dem Quelltext.
          //
          // ⚠️ 0118: der Schluessel ist der Tag der ERFASSUNG, nicht der Tag des
          // Eingangs. Sonst haette ein nachgespielter Verkauf den Riegel des
          // heutigen Tages genommen, waehrend er in den Z-Bon von GESTERN
          // gehoert — und der Abschluss von gestern haette genau daneben laufen
          // koennen. Ohne Erfassungszeit bleibt es beim Eingangstag.
          // ⛔ 08.08.2026 — HIER STAND `nimmTagessperre(tx, erfasstAm ?? null)`.
          //
          // Gesperrt wurde der ERFASSUNGSTAG, gebucht aber der LAUFENDE Tag,
          // sobald der Erfassungstag schon abgeschlossen war. Für den Tag, in
          // den der Beleg wirklich fällt, hielt der Vorgang dann KEINE Sperre,
          // und ein gleichzeitig laufender Abschluss dieses Tages schrieb den
          // Z-Bon ohne ihn fest. Die Begründung steht in `tagessperre.ts`.
          //
          // Deshalb wird der Buchungstag jetzt VOR der Sperre bestimmt.
          let nachtragBezugstag: string | null = null;
          let erfassungstagAbgeschlossen = false;
          if (erfasstAm !== null) {
            const tagRows = await tx.execute<{ tag: string; abgeschlossen: boolean }>(drizzleSql`
              SELECT berlin_business_day(${erfasstAm.toISOString()}::timestamptz)::text AS tag,
                     EXISTS (
                       SELECT 1 FROM daily_closings dc
                        WHERE dc.business_day = berlin_business_day(${erfasstAm.toISOString()}::timestamptz)
                          AND dc.shop_id IS NULL
                          AND dc.state = 'FINALIZED'
                     ) AS abgeschlossen`);
            const tag = tagRows[0];
            if (tag?.abgeschlossen) {
              nachtragBezugstag = tag.tag;
              erfassungstagAbgeschlossen = true;
            }
          }
          const finalizedAtWert = buchungszeitpunkt(erfasstAm ?? null, erfassungstagAbgeschlossen);

          // Die Sperre auf den Tag, in den der Beleg WIRKLICH fällt.
          await nimmTagessperre(tx, finalizedAtWert);

          // 3a. Move each reserved product to SOLD. The ownership guard
          // checks BOTH `(sessionId, userId)` — closes memory.md §19.2 C-1
          // (cross-cashier stale-cart finalize). A reservation created by
          // Cashier A cannot be finalized by Cashier B even if B has the
          // same sessionId in their localStorage.
          const actorUserId = req.actor.id; // requireAuth narrowed actor → non-null

          // Abholung einer Web-Reservierung: die Stücke gehören keinem
          // Kassierer (reserved_by_user_id ist NULL), also finalisieren wir sie
          // mit userId NULL. Der Eigentumsschutz bleibt: der reserved_by_session_id
          // muss weiterhin stimmen, und den kennt nur, wer die Bestellung über
          // die rollen-geschützte Abfrage nachgeschlagen hat. Ein POS-Verkauf
          // (kein webOrderNumber) finalisiert unverändert mit der Kassierer-Id.
          const finalizeUserId = body.webOrderNumber ? null : actorUserId;
          // 19.08.2026: EIN Satz statt N Rundreisen — gemessen wurde hier je
          // Stueck eine eigene UPDATE-Rundreise gefahren, unter gehaltener
          // Tagessperre. Die Eigentumspruefung ist unveraendert paarweise;
          // siehe finalizeViele in @norns/inventory-lock.
          try {
            await finalizeReservationen(
              tx,
              body.items.map((item) => ({
                productId: item.productId,
                sessionId: item.reservationSessionId,
                userId: finalizeUserId,
              })),
            );
          } catch (err) {
            if (err instanceof ReservationOwnershipError) {
              throw new ProductNotReservableError(err.message);
            }
            throw err;
          }

          // Attribute the sale to the shift it was actually rung on, so the
          // end-of-day cash drawer reconciliation (Blindsturz) and the Z-Bon can
          // see this sale's cash leg. Without shift_id the shift-close expected
          // balance was always wrong (it joined on t.shift_id = the shift).
          //
          // ⚠️ 0118, am 26.07.2026 gemessen: bis hierher stand nur der
          // Rueckfallweg unten — „irgendeine offene Schicht dieses Geraets",
          // gesucht ZUM ZEITPUNKT DES NACHSPIELENS. War die Schicht beim
          // Abfliessen schon geschlossen, hing der Verkauf an der NEUEN Schicht
          // oder an gar keiner, und der Kassensturz der Schicht, in der wirklich
          // kassiert wurde, stimmte nicht. Fuer ein Geraet, das nachts in der
          // Theke steht, war das der Normalfall.
          //
          // Jetzt sendet der Klient die Schicht mit, auf der WIRKLICH kassiert
          // wurde. Ob sie zu diesem Geraet gehoert, ist oben in 2c bereits
          // geprueft — ein Klient darf sich keine fremde Schicht aussuchen.
          let resolvedShiftId: string | null;
          if (body.shiftId != null) {
            resolvedShiftId = body.shiftId;
          } else {
            // Rueckfall fuer aeltere Kassen, die die Schicht noch nicht senden.
            const shiftRows = await tx.execute<{ id: string }>(drizzleSql`
              SELECT id::text AS id FROM shifts
               WHERE device_id = ${deviceId}::uuid AND status = 'OPEN' LIMIT 1`);
            resolvedShiftId = shiftRows[0]?.id ?? null;
          }

          /**
           * ⛔ 08.08.2026 — HIER ENDETE DIE ROUTE VORHER MIT EINER STILLEN NULL.
           *
           * Siehe `BargeldOhneSchichtError` oben für den ganzen Befund. Kurz:
           * ohne Schicht zählt der Kassensturz dieses Bargeld nicht, und die
           * erfundene Differenz wird im Tagesabschluss festgeschrieben.
           */
          if (resolvedShiftId === null && body.payments.some((p) => p.paymentMethod === 'CASH')) {
            throw new BargeldOhneSchichtError(
              'Für Bargeld muss eine Schicht geöffnet sein. Ohne Schicht erscheint dieses Geld ' +
                'in keinem Kassensturz, und der Tagesabschluss würde eine Differenz festschreiben, ' +
                'die es nie gab. Bitte zuerst eine Schicht öffnen.',
            );
          }

          // ── 0118: der Tag. Und was gilt, wenn er schon abgeschlossen ist ──
          //
          // Regelfall: der Kassentag der Erfassungszeit ist noch offen. Dann IST
          // die Erfassungszeit die Vorgangszeit, und der Verkauf landet im Z-Bon
          // des Tages, an dem er stattfand.
          //
          // Ausnahme, und das ist der Kern: der Tag ist bereits FINALIZED. Ein
          // abgeschlossener Kassentag ist fest — § 146 Abs. 4 AO, eine
          // Aufzeichnung darf nicht so veraendert werden, dass der
          // urspruengliche Inhalt nicht mehr feststellbar ist. Hineinschreiben
          // ist also verboten. Fallenlassen ist es aber auch: § 146 Abs. 1
          // Satz 2 AO verlangt, dass Kasseneinnahmen festgehalten werden.
          //
          // Der Ausweg, den das Rechnungswesen fuer den nachtraeglichen
          // Geschaeftsvorfall kennt: der geschlossene Zeitraum bleibt
          // unberuehrt, der Vorgang wird im laufenden gebucht — mit
          // ausdruecklichem Verweis auf sein urspruengliches Datum. Genau das
          // tun die drei Zeilen unten: `finalized_at` faellt auf den laufenden
          // Tag zurueck, `erfasst_am` haelt die echte Vorgangszeit, und
          // `nachtrag_bezugstag` traegt den Tag, zu dem der Vorgang gehoert.
          //
          // ⛔ Und er bleibt NICHT still: die Spalte ist indiziert, die
          // Hauptbuch-Nutzlast traegt sie mit, die Antwort an die Kasse traegt
          // sie, und nach dem Festschreiben geht `alert.nachtrag_eingang` an
          // den Inhaber.
          //
          // Der `shop_id`-Vergleich spiegelt den Waechter aus 0013/0118: die
          // Route setzt `shop_id` nicht, die Zeile traegt also NULL.
          // Der Buchungstag ist oben entschieden, VOR der Sperre. Hier steht
          // nur noch, was daraus folgt.

          // 15.08.2026: hier stand eine Vorratssperre (pg_advisory_xact_lock)
          // fuer die geloeschte Gnadenfrist. Ohne Vorrat gibt es nichts mehr
          // zu serialisieren.

          // 3b. INSERT the transaction header. Triggers fire here:
          //   sanctions / closing-day / storno-validation / ankauf-customer / sign-discipline.
          //   The AFTER-INSERT trigger then runs cumulative spend + ledger emit.
          const txRow = (
            await tx
              .insert(transactions)
              .values({
                direction: body.direction,
                customerId: body.customerId,
                deviceId,
                shiftId: resolvedShiftId,
                cashierUserId: req.actor.id,
                subtotalEur: body.subtotalEur,
                vatEur: body.vatEur,
                totalEur: body.totalEur,
                taxTreatmentCode: body.taxTreatmentCode,
                // §19.2 C-4 — persist the client's idempotency key. The partial
                // UNIQUE INDEX (migration 0028) raises 23505 on a concurrent
                // duplicate; we catch it outside this transaction and fall back
                // to the same SELECT-by-key dedup path as the pre-check.
                idempotencyKey: body.idempotencyKey,
                ...(body.stornoOfTransactionId
                  ? { stornoOfTransactionId: body.stornoOfTransactionId }
                  : {}),
                ...(body.notesInternal ? { notesInternal: body.notesInternal } : {}),
                // 0118 — die Vorgangszeit kommt vom GERAET, nicht vom Server.
                // Ohne diese Zeile fiel die Spalte auf `DEFAULT now()`, und ein
                // Verkauf um 17:50 Uhr ohne Netz landete im Z-Bon des naechsten
                // Tages. Fehlt `erfasstAm` (aeltere Kasse), bleibt es beim
                // alten Verhalten: die Spalte weglassen, DEFAULT now() greift.
                ...(finalizedAtWert ? { finalizedAt: finalizedAtWert } : {}),
                ...(erfasstAm ? { erfasstAm } : {}),
                // 0147 — der wahre Vorgangsbeginn aus der Vorgangs-Uhr der
                // Kasse. Der CHECK der Wanderung laesst 5 Minuten Uhrendrift
                // zu und weist alles Spaetere als Datenmuell ab.
                ...(body.vorgangBegonnenAm
                  ? { vorgangBegonnenAt: new Date(body.vorgangBegonnenAm) }
                  : {}),
                ...(nachtragBezugstag ? { nachtragBezugstag } : {}),
                // 15.08.2026: hier vergab 0142 die laufende Nummer eines
                // Belegs ohne Sicherungseinrichtung. Die Gnadenfrist ist
                // gestrichen, also entsteht diese Nummer nie wieder. Spalte
                // und Index bleiben fuer die Lesbarkeit alter Zeilen.
              })
              .returning({
                id: transactions.id,
                receiptLocator: transactions.receiptLocator,
                finalizedAt: transactions.finalizedAt,
                erfasstAm: transactions.erfasstAm,
                nachtragBezugstag: transactions.nachtragBezugstag,
              })
          )[0];
          if (!txRow) {
            throw new Error('INSERT INTO transactions returned no row (should be impossible)');
          }

          // 3c. INSERT line items.
          await tx.insert(transactionItems).values(
            body.items.map((item, idx) => ({
              transactionId: txRow.id,
              productId: item.productId,
              lineSubtotalEur: item.lineSubtotalEur,
              lineVatEur: item.lineVatEur,
              lineTotalEur: item.lineTotalEur,
              appliedTaxTreatmentCode: item.appliedTaxTreatmentCode,
              appliedVatRate: item.appliedVatRate,
              acquisitionCostEurSnapshot: item.acquisitionCostEurSnapshot,
              marginEur: item.marginEur,
              lineDiscountEur: item.lineDiscountEur ?? '0',
              lineDiscountReason: item.lineDiscountReason ?? null,
              displayOrder: item.displayOrder ?? idx,
            })),
          );

          // 3d. INSERT payment legs.
          await tx.insert(transactionPayments).values(
            body.payments.map((p) => ({
              transactionId: txRow.id,
              paymentMethod: p.paymentMethod,
              amountEur: p.amountEur,
              externalRef: p.externalRef ?? null,
              zvtTerminalId: p.zvtTerminalId ?? null,
              zvtReceiptNumber: p.zvtReceiptNumber ?? null,
              zvtCardBrand: p.zvtCardBrand ?? null,
              zvtCardPanMasked: p.zvtCardPanMasked ?? null,
              molliePaymentId: p.molliePaymentId ?? null,
            })),
          );

          // 3d-bis. Abholung binden: den Warenkorb an DIESE Transaktion knüpfen,
          // im selben BEGIN wie der Beleg, damit Reservierung und Kassenbon EIN
          // Vorgang sind und nicht zwei unverbundene Zeilen. Der geschützte
          // UPDATE (WHERE status='RESERVED') stellt sicher, dass nur eine noch
          // laufende Reservierung übergeben werden kann; hat sie ein anderer
          // Vorgang bereits übergeben oder storniert, trifft er null Zeilen und
          // wir brechen ab, statt einen Beleg auf eine tote Bestellung zu buchen.
          if (body.webOrderNumber) {
            const linked = (await tx.execute<{ id: string }>(drizzleSql`
              UPDATE carts
                 SET status                   = 'CONVERTED',
                     converted_to_transaction_id = ${txRow.id}::uuid,
                     pickup_stage             = 'ABGEHOLT',
                     collected_at             = now(),
                     collected_by_user_id     = ${actorUserId}::uuid
               WHERE order_number = ${body.webOrderNumber}
                 AND status       = 'RESERVED'
               RETURNING id::text AS id`)) as unknown as Array<{ id: string }>;
            if (linked.length === 0) {
              throw new NotCollectableError(
                `Bestellung ${body.webOrderNumber} ist nicht (mehr) zur Abholung offen.`,
              );
            }
          }

          // 3e. Look up the ledger_events row that the AFTER-INSERT trigger
          // emitted — the SSE consumers reference this id. The trigger always
          // emits exactly one row per (transactions, entity_id) by design.
          const ledgerRow = (
            await tx
              .select({ id: ledgerEvents.id })
              .from(ledgerEvents)
              .where(
                drizzleSql`${ledgerEvents.entityTable} = 'transactions' AND ${ledgerEvents.entityId} = ${txRow.id}`,
              )
              .limit(1)
          )[0];

          // 14.08.2026: hier stand die 3f-Abfrage nach offenen eBay-Angeboten
          // (in JEDEM fiskalen Commit). Der eBay-Kanal fiel mit der Trennung
          // von warehouse14; der Beleg braucht keinen Blick auf einen Kanal,
          // den es nicht gibt.

          return {
            id: txRow.id,
            receiptLocator: txRow.receiptLocator,
            finalizedAt: txRow.finalizedAt,
            // 0118: beide Zeiten wandern nach draussen — die Kasse zeigt den
            // Nachtrag an, statt ihn zu verschlucken.
            erfasstAm: txRow.erfasstAm,
            nachtragBezugstag: txRow.nachtragBezugstag,
            ledgerEventId: ledgerRow ? Number(ledgerRow.id) : 0,
          };
        })
        .catch(async (err: unknown) => {
          // §19.2 C-4 race fallback: two concurrent retries with the same
          // idempotency key. One INSERT wins, the other gets 23505. We swap
          // the error for a SELECT-by-key that returns the winning row.
          if (isUniqueViolation(err, 'transactions_idempotency_key_uniq')) {
            const winner = (
              await app.db
                .select({
                  id: transactions.id,
                  receiptLocator: transactions.receiptLocator,
                  finalizedAt: transactions.finalizedAt,
                  erfasstAm: transactions.erfasstAm,
                  nachtragBezugstag: transactions.nachtragBezugstag,
                })
                .from(transactions)
                .where(drizzleSql`${transactions.idempotencyKey} = ${body.idempotencyKey}::uuid`)
                .limit(1)
            )[0];
            if (!winner) {
              // Should be impossible — the unique violation proves a row exists.
              throw err;
            }
            const ledgerRow = (
              await app.db
                .select({ id: ledgerEvents.id })
                .from(ledgerEvents)
                .where(
                  drizzleSql`${ledgerEvents.entityTable} = 'transactions' AND ${ledgerEvents.entityId} = ${winner.id}`,
                )
                .limit(1)
            )[0];
            return {
              id: winner.id,
              receiptLocator: winner.receiptLocator,
              finalizedAt: winner.finalizedAt,
              erfasstAm: winner.erfasstAm,
              nachtragBezugstag: winner.nachtragBezugstag,
              ledgerEventId: ledgerRow ? Number(ledgerRow.id) : 0,
              // Duplicate-retry path: the ORIGINAL finalize already triggered any
              // instant delisting — nothing new to end on this idempotent replay.
            };
          }
          throw err;
        });

      // ──────────────────────────────────────────────────────────────────
      // 4. GwG smurfing detection (V1) — non-blocking AML alert (memory.md §3).
      //
      // Runs AFTER the finalize transaction commits, so a detection error can
      // NEVER roll back a valid fiscal record. On a structuring hit it emits the
      // critical `alert.smurfing_detected` ledger event (DND-bypass, memory.md
      // #45) + an audit_log entry — both through the append-only emit helpers.
      // The rolling window is anchored on the transaction's own finalized_at
      // (offline-replay safe), not now(). ANKAUF-only in V1 (the §259 risk).
      // ──────────────────────────────────────────────────────────────────
      if (body.direction === 'ANKAUF' && body.customerId) {
        try {
          await runSmurfingDetection(app.db, {
            transactionId: outcome.id,
            customerId: body.customerId,
            direction: body.direction,
            totalEur: body.totalEur,
            occurredAt: outcome.finalizedAt,
            actorUserId: req.actor.id,
            deviceId,
            ipAddress: req.ip ?? null,
          });
        } catch (err) {
          // Detection is advisory — never fail the sale on its account.
          req.log.error({ err }, 'smurfing detection failed (non-blocking)');
        }
      }

      // ──────────────────────────────────────────────────────────────────
      // 5. Instant eBay delisting (Epic D / Task 6) — DETACHED background task.
      //
      // A unique item sold at the till may still be live on eBay; ending the
      // listing immediately (rather than waiting up to 5 min for `ebay_sync`)
      // shrinks the double-sell window. This is FULLY detached: the cashier's
      // HTTP response is already on its way, so a slow/offline eBay API can
      // NEVER block or fail the sale. Anything still ONLINE after a failure is
      // reconciled by the 5-min `ebay_sync` worker — this is a best-effort
      // accelerator, not a new source of truth.
      // 14.08.2026: hier lief der abgesetzte Sofort-Delist zu eBay nach dem
      // Commit. Kanal geloescht, nichts mehr zu beenden.

      // ──────────────────────────────────────────────────────────────────
      // 6. 0118 — der nachtraegliche Eingang wird dem Inhaber GEMELDET.
      //
      // ⛔ Jede Loesung, die still bleibt, ist keine Loesung. Der Vorgang ist
      // bereits sichtbar gefuehrt (`nachtrag_bezugstag`, indiziert, und in der
      // Hauptbuch-Nutzlast des Vorgangs). Was fehlte, war die MELDUNG.
      //
      // Derselbe Weg wie beim GwG-Riegel: NACH dem Festschreiben, damit ein
      // Fehler hier NIE einen gueltigen Fiskalvorgang zurueckrollt, und ueber
      // die anhaengende `emit`-Hilfe, damit der Eintrag in der Hash-Kette steht.
      // ──────────────────────────────────────────────────────────────────
      if (outcome.nachtragBezugstag != null) {
        try {
          await emit(app.db, {
            eventType: 'alert.nachtrag_eingang',
            entityTable: 'transactions',
            entityId: outcome.id,
            actorUserId: req.actor.id,
            deviceId,
            ipAddress: req.ip ?? null,
            payload: {
              grund: 'Der Kassentag dieses Vorgangs war beim Eingang bereits abgeschlossen.',
              nachtragBezugstag: outcome.nachtragBezugstag,
              erfasstAm: outcome.erfasstAm?.toISOString() ?? null,
              gebuchtAm: outcome.finalizedAt.toISOString(),
              receiptLocator: outcome.receiptLocator,
              totalEur: body.totalEur,
              direction: body.direction,
            },
          });
        } catch (err) {
          // Die Meldung ist nachgelagert — sie darf einen gueltigen
          // Fiskalvorgang nie kippen. Der Vorgang selbst traegt die Spalte.
          req.log.error({ err }, 'Nachtrag-Meldung fehlgeschlagen (nicht blockierend)');
        }
      }

      return {
        id: outcome.id,
        receiptLocator: outcome.receiptLocator,
        finalizedAt: outcome.finalizedAt.toISOString(),
        erfasstAm: outcome.erfasstAm?.toISOString() ?? null,
        nachtragBezugstag: outcome.nachtragBezugstag ?? null,
        ledgerEventId: outcome.ledgerEventId,
        direction: body.direction,
        totalEur: body.totalEur,
        storno: body.stornoOfTransactionId != null,
        // 15.08.2026: hier reiste die Ermahnung der Gnadenfrist mit. Ohne
        // Sicherungseinrichtung entsteht jetzt gar kein Beleg mehr, also gibt
        // es auch nichts zu ermahnen.
      };
    },
  );
};

/**
 * §19.2 C-4 helper — narrow a Postgres unique-violation by constraint name.
 *
 * postgres-js raises `PostgresError` with `code = '23505'` and `constraint_name`
 * set to the violated unique index. We match on the partial UNIQUE for
 * idempotency_key only — any OTHER unique violation (e.g. receipt locator
 * collision, vanishingly unlikely) should still propagate as a 500.
 */
function isUniqueViolation(err: unknown, constraint: string): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; constraint_name?: unknown; constraint?: unknown };
  if (e.code !== '23505') return false;
  return e.constraint_name === constraint || e.constraint === constraint;
}

export default transactionsFinalize;
