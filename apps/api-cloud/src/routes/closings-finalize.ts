/**
 * POST /api/closings/finalize — write the legal Z-Bon (Tagesabschluss).
 *
 * THIS WAS THE MISSING KEYSTONE: nothing wrote `daily_closings`, so DSFinV-K,
 * DATEV, Kassenbericht and the nightly Fiskaly push all read an empty table and
 * produced nothing — a Kassen-Nachschau (§146b AO) would find no Z-Bon at all
 * (§158 AO Verwerfung der Buchführung). This route aggregates a business day's
 * finalized transactions into ONE immutable FINALIZED `daily_closings` row that
 * the whole export chain reads.
 *
 * Semantics are locked to how the Kassenbericht (`lib/kassenbericht-export.ts`)
 * presents the figures:
 *   • gross_*   = SUM(total_eur)    je Richtung, OHNE die Stornozeilen (0112)
 *   • storno_*  = die stornierten Betraege, als POSITIVE Groesse (0112)
 *   • net_*    = SUM(subtotal_eur)  per direction (netto)
 *   • vat_by_treatment   = SUM(vat_eur) grouped by tax_treatment_code (VERKAUF output VAT)
 *   • payments_by_method = SUM(amount_eur) grouped by payment_method (VERKAUF tender)
 *   • cash_*   = aggregated from the day's CLOSED shifts' Blindsturz (expected/counted/variance)
 *   • tse_*    = signature evidence counts
 *   • ledger_anchor_* = the chain head at finalize time (ADR-0008 checkpoint)
 *
 * The day must be settled first: no OPEN shift may remain for the business day,
 * and a day with sales must have at least one CLOSED shift (so the drawer is
 * counted). Once written the row is immutable (the validate-state trigger locks
 * every figure except `notes`). Re-finalizing a day is a 409.
 *
 * ADMIN + step-up — the same gate as the fiscal exports.
 *
 * ══════════════════════════════════════════════════════════════════════════
 *  11.08.2026 — ZWEI BEFUNDE AN DIESER ROUTE
 * ══════════════════════════════════════════════════════════════════════════
 *
 * WAS war der Befund:
 *   1. Schritt 3 fragte `berlin_business_day(opened_at) = <Tag>`. Eine
 *      GESTERN geoeffnete, noch laufende Kasse fiel durch: der Tag wurde
 *      versiegelt, und danach war diese Kasse fuer den REST DES TAGES tot
 *      (Verkauf, Bargeldbewegung und Kassensturz je 409), ohne Rettungsweg.
 *      Mit zwei Kassen behauptete der Z-Bon zusaetzlich „gezaehlt,
 *      Abweichung 0,00" fuer eine Lade, die niemand gezaehlt hatte.
 *   2. Schritt 6 schrieb `cash_drawer_expected_eur` mit 0,00 EUR fest, wenn
 *      an diesem Tag nicht gezaehlt wurde — eine erfundene Zahl in einer
 *      fortschreibungsgeschuetzten Aufzeichnung.
 *
 * WARUM der naheliegende Weg falsch ist: die offene Fremdschicht beim
 * Abschluss mitzuschliessen hiesse, eine Blindzaehlung zu erfinden; den
 * erwarteten Betrag als gezaehlten einzusetzen ebenso. Richtig ist: ABLEHNEN
 * und die Kasse nennen, und den SOLLbestand aus den Aufzeichnungen des Tages
 * fortschreiben, waehrend der GEZAEHLTE Bestand NULL bleibt.
 *
 * WAS DER WAECHTER MISST:
 * `tests/integration/lade-und-schicht.test.ts` faehrt beide Faelle ueber die
 * echten HTTP-Wege gegen ein echtes Postgres.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { pruefeAbschlusstag } from '../lib/abschlusstag.js';
import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import { fromCents, toCents } from '../lib/money-cents.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

class ClosingConflictError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

/**
 * Ein Abschlusstag, der nicht abgeschlossen werden darf: er liegt in der
 * Zukunft, oder es gibt ihn gar nicht. Das ist ein Eingabefehler, kein
 * Serverfehler, und der Satz muss dem Menschen an der Kasse etwas sagen.
 */
class AbschlusstagUnzulaessigError extends DomainError {
  public readonly httpStatus = 422;
  public readonly code: ApiErrorCode = 'VALIDATION_ERROR';
  public readonly details: unknown;
  public constructor(message: string, details: unknown) {
    super(message);
    this.details = details;
  }
}

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

const FinalizeBody = Type.Object({
  /** Berlin business day (YYYY-MM-DD). Omit to finalize the current business day. */
  businessDay: Type.Optional(Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' })),
  /**
   * Der Tag traegt unsignierte Belege, und der Mensch am Abschluss weiss es.
   *
   * ⚠️ 01.08.2026: Bis heute zaehlte der Abschluss die fehlenden Signaturen
   * sorgfaeltig (echter Anti-Join, siehe Schritt 7) und hielt NICHTS an. Ein
   * Tag mit null Signaturen wurde normal abgeschlossen, und die Zeile sagte
   * danach FINALIZED, als waere der Tag vollstaendig.
   *
   * Ein harter Riegel waere hier falsch: der Z-Bon ist SELBST eine fiskale
   * Aufzeichnung, und ein Tag, der nie geschlossen werden kann, reisst eine
   * groessere Luecke als einer mit nachzuholenden Signaturen. Die Wolken-TSE
   * kann stundenlang weg sein.
   *
   * Deshalb: nicht VERBOTEN, sondern nicht AUS VERSEHEN. Ohne diese
   * Bestaetigung haelt der Abschluss an und nennt die Zahl. Mit ihr laeuft er
   * und schreibt die Bestaetigung in die Notiz der Abschlusszeile, wo der
   * Pruefer sie findet.
   */
  unsignierteBelegeBestaetigt: Type.Optional(Type.Boolean()),
});

const FinalizeResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  businessDay: Type.String(),
  state: Type.Literal('FINALIZED'),
  verkaufCount: Type.Integer(),
  ankaufCount: Type.Integer(),
  stornoCount: Type.Integer(),
  grossVerkaufEur: Type.String(),
  netVerkaufEur: Type.String(),
  cashExpectedEur: Type.String(),
  /**
   * ⚠️ Seit 0125 NULLBAR, und das ist der Kern der Behebung.
   *
   * `null` heisst: an diesem Tag wurde die Kasse NICHT gezählt, weil die
   * Schicht über den Tag hinauslief. Eine Zahl stünde dort erfunden.
   *
   * ⚠️ Ohne `Type.Null()` hier entfernt Fastify das Feld STILL aus der
   * Antwort — der Server sendet, und die Kasse bekommt ein fehlendes Feld
   * ohne jeden Grund. Genau diese Falle hat in diesem Haus schon zugeschlagen.
   */
  cashCountedEur: Type.Union([Type.String(), Type.Null()]),
  cashVarianceEur: Type.Union([Type.String(), Type.Null()]),
  finalizedAt: Type.String({ format: 'date-time' }),
});

const closingsFinalizeRoute: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { businessDay?: string; unsignierteBelegeBestaetigt?: boolean } }>(
    '/api/closings/finalize',
    {
      schema: {
        tags: ['closings'],
        summary: 'Finalize the legal Z-Bon (Tagesabschluss) for a business day.',
        description:
          "Aggregates the day's finalized transactions + the closed shifts' cash count into one " +
          'immutable FINALIZED daily_closings row — the source the DSFinV-K / DATEV / Kassenbericht ' +
          'exports read. ADMIN + step-up. Re-finalizing a day returns 409.',
        body: FinalizeBody,
        response: {
          200: FinalizeResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          409: ErrorResponse,
          // ⚠️ Ohne diese Zeile entfernt Fastify die Begründung STILL aus der
          // Antwort, und der Mensch am Abschluss sähe eine leere 422. Genau
          // diese Falle hat in diesem Haus schon zugeschlagen.
          422: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN');
      requireStepUp(req);

      // ⚠️ VOR der Datenbank, weil ein festgeschriebener Tag unantastbar ist.
      //
      // Bis zum 08.08.2026 ging der Tag aus dem Rumpf ungeprüft durch. Ein
      // Zahlendreher (`2026-08-09` statt `2026-08-08`) versiegelte damit
      // MORGEN, und am nächsten Morgen nahm die Kasse keinen Verkauf mehr an —
      // ohne Weg zurück, denn einen festgeschriebenen Abschluss kann niemand
      // aufheben. Der Verkauf hat diesen Riegel seit langem, der Abschluss
      // hatte keinen. Siehe `abschlusstag.ts`.
      const tagBefund = pruefeAbschlusstag(req.body.businessDay, new Date());
      if (tagBefund) {
        throw new AbschlusstagUnzulaessigError(tagBefund.nachricht, {
          field: 'businessDay',
          tag: tagBefund.tag,
          heute: tagBefund.heute,
        });
      }

      const out = await app.db.transaction(async (tx) => {
        // 1. Resolve the target Berlin business day (body, else current).
        const [dayRow] = await tx.execute<{ day: string }>(sql`
          SELECT COALESCE(${req.body.businessDay ?? null}::date, berlin_business_day(now()))::text AS day`);
        const day = dayRow!.day;

        // E3: take the EXCLUSIVE advisory lock on this business day BEFORE reading
        // any aggregate. It waits for every in-flight sale-finalize (each holds
        // the SHARED lock on the same key) to commit, then blocks new ones for the
        // rest of this transaction, so the aggregates below see a consistent
        // snapshot: no sale can commit into the day while we compute and write its
        // Z-Bon. Same key derivation as transactions-finalize. Released at COMMIT.
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(1146, (${day}::date - DATE '1970-01-01')::int)`);

        // 2. Not already finalized for this day.
        //
        // ⚠️ Die Frage lautet „ist der Tag FESTGESCHRIEBEN?", nicht „gibt es
        // eine Zeile?". Bis zum 26.07.2026 fragte sie das Zweite — und das war
        // eine Sackgasse ohne Ausgang:
        //
        // Ein Abschluss beginnt im Zustand COUNTING (der Kassensturz läuft).
        // Bricht er dort ab, bleibt die Zeile stehen, `finalized_at` ist NULL —
        // und ihre blosse EXISTENZ verhindert danach jeden weiteren Versuch.
        // Der Tag lässt sich nie mehr abschliessen, und § 146 Abs. 1 Satz 2 AO
        // verlangt genau das.
        //
        // Auf der Produktion gemessen: `2026-06-08` steht seit dem 8. Juni in
        // COUNTING, `counted_at` ist NULL, `finalized_at` ist NULL. 33 Belege
        // über 12.523,32 EUR hängen daran. Es ist der einzige Abschlusssatz im
        // ganzen System, und er blockiert sich selbst.
        //
        // Nur ein FESTGESCHRIEBENER Tag ist unantastbar. Ein angefangener und
        // liegengebliebener darf fortgesetzt werden — genau dafür gibt es den
        // Zustand.
        const existing = await tx.execute<{ id: string; finalized: boolean }>(sql`
          SELECT id, (finalized_at IS NOT NULL) AS finalized
            FROM daily_closings WHERE business_day = ${day}::date LIMIT 1`);
        if (existing[0]?.finalized) {
          throw new ClosingConflictError(`Der Tagesabschluss für ${day} besteht bereits.`);
        }
        // Eine liegengebliebene Zeile wird ERSETZT, nicht ergänzt: sie trägt
        // Zwischenstände eines abgebrochenen Kassensturzes, und die dürfen
        // nicht in den festgeschriebenen Satz einfliessen.
        const liegengeblieben = existing[0];
        if (liegengeblieben) {
          req.log.warn(
            { day, id: liegengeblieben.id },
            'Abschluss: liegengebliebener COUNTING-Satz wird ersetzt',
          );
          await tx.execute(sql`
            DELETE FROM daily_closings
             WHERE business_day = ${day}::date AND finalized_at IS NULL`);
        }

        // ══════════════════════════════════════════════════════════════════
        //  3. DER TAG MUSS ABGERECHNET SEIN — und zwar JEDE Lade, die ihn
        //     ueberhaupt beruehrt
        // ══════════════════════════════════════════════════════════════════
        //
        // ── DER BEFUND VOM 11.08.2026 ─────────────────────────────────────
        //
        // Hier stand `berlin_business_day(opened_at) = <Tag>`: „wurde an
        // DIESEM Tag eine Kasse geoeffnet, die noch offen ist?". Eine Schicht,
        // die GESTERN geoeffnet wurde und noch laeuft, fiel durch das Raster.
        //
        // Gemessen ueber die echten HTTP-Wege: Schicht seit gestern 08:00
        // offen, `POST /api/closings/finalize` → 200, der Tag steht FINALIZED
        // und traegt die Notiz „Umsatzloser Tag, kein Kassensturz", waehrend
        // die Lade in Wahrheit 1.119,00 EUR haelt. Unmittelbar danach ist
        // diese Kasse fuer den REST DES TAGES tot: Verkauf, Bargeldbewegung
        // und Kassensturz antworten alle drei mit 409 CLOSING_DAY_FINALIZED,
        // und einen festgeschriebenen Abschluss kann niemand aufheben.
        //
        // Mit ZWEI Kassen ist es derselbe Weg: die zweite laeuft seit gestern
        // durch, die erste zaehlt und schliesst heute, und der Z-Bon behauptet
        // „gezaehlt, Abweichung 0,00" — 250,00 EUR davon lagen in einer nie
        // gezaehlten zweiten Lade.
        //
        // Auf Romans Produktion sind Schichten ueber 12 und ueber 33 Tage
        // gemessen (siehe Schritt 6). Das ist der Regelfall dieses Betriebs.
        //
        // ── WARUM DER BEQUEME WEG FALSCH WAERE ────────────────────────────
        //
        // Naheliegend waere, die offene Fremdschicht beim Abschluss einfach
        // MITZUSCHLIESSEN. Das hiesse, eine Blindzaehlung zu erfinden, die
        // niemand vorgenommen hat — in einer fortschreibungsgeschuetzten
        // Aufzeichnung. Der Abschluss lehnt stattdessen ab und NENNT die
        // Kasse; der Ausgang ist der Kassensturz, den es ohnehin geben muss.
        //
        // ⚠️ `<=` und nicht `=`: eine Schicht, die erst NACH dem
        // abzuschliessenden Tag geoeffnet wurde, deckt ihn nicht ab und darf
        // ihn deshalb auch nicht sperren.
        const openShift = await tx.execute<{ id: string; seit: string; geraet: string }>(sql`
          SELECT id::text AS id,
                 berlin_business_day(opened_at)::text AS seit,
                 device_id::text AS geraet
            FROM shifts
           WHERE status = 'OPEN' AND berlin_business_day(opened_at) <= ${day}::date
           ORDER BY opened_at ASC
           LIMIT 1`);
        if (openShift[0]) {
          const offen = openShift[0];
          throw new ClosingConflictError(
            `Für ${day} ist noch eine Kasse geöffnet (seit ${offen.seit}). ` +
              'Bitte zuerst die Schicht abschließen (Kassensturz). ' +
              'Ein Abschluss ohne Zählung dieser Lade wäre eine erfundene Zahl, ' +
              'und er würde diese Kasse für den Rest des Tages sperren.',
          );
        }

        // 4. Transaction aggregates for the day.
        const [agg] = await tx.execute<{
          verkauf_count: number;
          ankauf_count: number;
          storno_count: number;
          rueckgabe_count: number;
          gross_verkauf: string;
          net_verkauf: string;
          gross_ankauf: string;
          net_ankauf: string;
          storno_verkauf: string;
          storno_ankauf: string;
          rueckgabe_verkauf: string;
          tx_total: number;
        }>(sql`
          SELECT
            COUNT(*) FILTER (WHERE direction = 'VERKAUF' AND storno_of_transaction_id IS NULL
                               AND rueckgabe_zu_transaction_id IS NULL)::int AS verkauf_count,
            COUNT(*) FILTER (WHERE direction = 'ANKAUF'  AND storno_of_transaction_id IS NULL)::int AS ankauf_count,
            COUNT(*) FILTER (WHERE storno_of_transaction_id IS NOT NULL)::int                       AS storno_count,
            -- 0148: die Warenruecknahme ist der dritte Fall — kein Verkauf,
            -- kein Storno. Eigene Zahl, eigene Summe (siehe unten), aus
            -- demselben Grund wie 0112: der Brutto bleibt >= 0, und der
            -- Pruefer sieht die Minderung AUSGEWIESEN (BFH X R 23-24/21).
            COUNT(*) FILTER (WHERE rueckgabe_zu_transaction_id IS NOT NULL)::int AS rueckgabe_count,
            -- ── Der Storno gehört NICHT in den Brutto (Wanderung 0112) ──────
            -- Bis zum 26.07.2026 summierte diese Stelle die negativen
            -- Stornozeilen mit, während die Datenbank per CHECK einen
            -- negativen Brutto verbietet. Ein Storno, der einen Beleg eines
            -- FRÜHEREN Tages aufhebt, machte den Tag damit unabschliessbar —
            -- und ohne Z-Bon-Zeile liefern DATEV, Kassenbericht und DSFinV-K
            -- für diesen Tag gar nichts. Die Stückzahlen daneben schlossen den
            -- Storno von Anfang an korrekt aus; nur die Summen nicht.
            --
            -- Der Betrag verschwindet nicht, er bekommt eine eigene Spalte:
            -- BFH 29.07.2025, X R 23-24/21, Leitsatz 1, ein System, das
            -- Stornierungen zulässt und sie im Tagesabschluss nicht AUSWEIST,
            -- begründet eine Schätzungsbefugnis. Die blosse Anzahl genügt
            -- dafür nicht.
            COALESCE(SUM(total_eur)    FILTER (WHERE direction = 'VERKAUF'
                                                 AND storno_of_transaction_id IS NULL
                                                 AND rueckgabe_zu_transaction_id IS NULL), 0)::text AS gross_verkauf,
            COALESCE(SUM(subtotal_eur) FILTER (WHERE direction = 'VERKAUF'
                                                 AND storno_of_transaction_id IS NULL
                                                 AND rueckgabe_zu_transaction_id IS NULL), 0)::text AS net_verkauf,
            COALESCE(SUM(total_eur)    FILTER (WHERE direction = 'ANKAUF'
                                                 AND storno_of_transaction_id IS NULL), 0)::text AS gross_ankauf,
            COALESCE(SUM(subtotal_eur) FILTER (WHERE direction = 'ANKAUF'
                                                 AND storno_of_transaction_id IS NULL), 0)::text AS net_ankauf,
            -- Als POSITIVE Grösse, damit der Bericht sie als Abzug zeigen kann
            -- statt als Vorzeichen, das man übersieht.
            COALESCE(-SUM(total_eur)   FILTER (WHERE direction = 'VERKAUF'
                                                 AND storno_of_transaction_id IS NOT NULL), 0)::text AS storno_verkauf,
            COALESCE(-SUM(total_eur)   FILTER (WHERE direction = 'ANKAUF'
                                                 AND storno_of_transaction_id IS NOT NULL), 0)::text AS storno_ankauf,
            -- NEGATIV gespeichert (die Spalte sagt es im Kommentar): eine
            -- Ruecknahme IST eine Minderung, ihr Vorzeichen gehoert ihr.
            COALESCE(SUM(total_eur)    FILTER (WHERE rueckgabe_zu_transaction_id IS NOT NULL), 0)::text AS rueckgabe_verkauf,
            COUNT(*)::int AS tx_total
          FROM transactions
         WHERE berlin_business_day(finalized_at) = ${day}::date`);

        // 5. VAT per treatment (VERKAUF output VAT) + payments per method (VERKAUF tender).
        //
        // Grouped at ITEM level, not receipt level. A receipt whose lines span
        // several treatments carries the transaction-level code 'MIXED', and
        // grouping by that produced a bucket literally named MIXED holding VAT
        // that belongs to no tax rate. On 2026-06-08 that was 27,78 EUR sitting
        // outside every rate: unusable for a Umsatzsteuervoranmeldung, where
        // each amount has to land in a specific rate box, and irreconcilable
        // with the DATEV export, which already splits mixed receipts per
        // treatment (see toDatevRows in closing-export.ts). Same day, same
        // money, two different answers.
        //
        // The item rows carry `applied_tax_treatment_code` and `line_vat_eur`,
        // and they sum EXACTLY to the receipt VAT (verified on the live mixed
        // receipt: 16,76 + 11,02 = 27,78, difference 0,00). So this only
        // re-attributes; the day's total output VAT is unchanged to the cent.
        //
        // The LEFT JOIN plus COALESCE keeps a receipt that has no item rows at
        // all: it falls back to its own transaction-level code and vat_eur,
        // exactly like the DATEV builder does, so no VAT can silently vanish.
        //
        // ── DER STORNO BLEIBT HIER DRIN, UND ZWAR MIT ABSICHT ──────────────
        // Am 26.07.2026 wurde versucht, hier `AND t.storno_of_transaction_id
        // IS NULL` zu ergänzen — dieselbe Bedingung, die Brutto und Netto
        // oben (Wanderung 0112) tragen. Der Anlass war richtig gesehen: auf
        // dem Kassenbericht standen „Verkauf netto 100,00" und „Umsatzsteuer
        // 0,00" neben „Verkauf brutto vor Storno 119,00", und das rechnet
        // sich nicht zusammen. Die Behebung setzte aber an der FALSCHEN Seite
        // der Gleichung an. GEMESSEN am Stornotag des Szenarios (ein Beleg
        // 119,00 und sein Vollstorno, nach dem Tag ist NICHTS verkauft):
        //
        //     Umsatz;Verkauf brutto nach Storno;0,00 EUR
        //     Umsatz;Verkauf netto;100,00 EUR
        //     Umsatzsteuer;Summe;19,00 EUR      ← mit dem Filter
        //     Zahlungsart;Summe;0,00 EUR
        //
        // Der Bericht hätte 19,00 EUR Umsatzsteuer für einen Tag ausgewiesen,
        // an dem kein Umsatz und keine Zahlung übrig ist. DATEV führt denselben
        // Tag auf Erlöskonto 8400 mit Saldo 0 (11900 Haben, 11900 Soll aus der
        // Generalumkehr), und der DSFinV-K-Kopf steht auf 0/0. Am Kreuzprobetag
        // wären es 10096 statt 9564 Cent gewesen, ein Unterschied von genau
        // 532 Cent — der Steuer des einen stornierten Belegs (33,33 brutto =
        // 28,01 netto + 5,32 USt).
        //
        // WER DIESE ZAHL LIEST: der Kassenbericht ist laut seinem eigenen Kopf
        // das Blatt für „owner / Steuerberater / Finanzamt". Der einzige Grund,
        // warum dort überhaupt ein Umsatzsteuerblock steht, ist die Steuer, die
        // der Tag SCHULDET — und die ist nach § 17 UStG um die Stornierung
        // gemindert. Stünde hier die Zahl vor Storno, könnte der Leser sie auch
        // nicht selbst korrigieren: `daily_closings` hat für die Stornosteuer
        // keine Spalte, 0112 gab dem Storno nur Bruttogrössen.
        //
        // DER ECHTE DEFEKT liegt eine Zeile höher, im Bericht: „Verkauf netto"
        // ist die EINZIGE Zeile des Umsatzblocks ohne die Angabe vor/nach
        // Storno, während Brutto beide Zahlen zeigt. Richtig ist „Verkauf netto
        // vor Storno" PLUS eine Zeile „Verkauf netto nach Storno" — dann geht
        // 366260 + 9564 = 375824 auf, und zwar auf derselben Grundlage wie
        // DATEV, wie `bon_kopf.csv` und wie der Kopf des DSFinV-K-Bündels. Das
        // gehört in `lib/kassenbericht-export.ts`, nicht hierher.
        // Belegt in tests/integration/szenario-rundung.test.ts.
        const [vatRow] = await tx.execute<{ vat: Record<string, string> }>(sql`
          SELECT COALESCE(jsonb_object_agg(code, amt), '{}'::jsonb) AS vat FROM (
            SELECT code, SUM(vat)::text AS amt FROM (
              SELECT COALESCE(i.applied_tax_treatment_code::text, t.tax_treatment_code::text) AS code,
                     COALESCE(i.line_vat_eur, t.vat_eur) AS vat
                FROM transactions t
                LEFT JOIN transaction_items i ON i.transaction_id = t.id
               WHERE berlin_business_day(t.finalized_at) = ${day}::date
                 AND t.direction = 'VERKAUF'
            ) lines
             GROUP BY code
          ) q`);
        // ── 0127: der UMSATZ je Steuerbehandlung ─────────────────────
        //
        // `businesscases.csv` ist die Datei, aus der ein Prüfer den
        // Tagesumsatz je Steuersatz liest. Sie verlangt Brutto, Netto UND
        // Steuer — wir konnten bisher nur die Steuer liefern.
        //
        // ⚠️ Aufgezeichnet, nicht zurückgerechnet. Aus der Steuer liesse sich
        // der Umsatz herleiten, aber bei § 25a ist die Bemessungsgrundlage
        // die MARGE, und bei steuerfreien Umsätzen führt der Rückweg ins
        // Leere. Jede Herleitung könnte dem Beleg widersprechen.
        //
        // ⚠️ LESEWARNUNG für MARGIN_25A (19.08.2026): `netto` ist hier
        // Verkaufspreis minus MARGEN-Steuer — NICHT die Bemessungsgrundlage.
        // Beispiel EK 100 / VK 200: gespeichert wird netto 184,03; die
        // § 25a-Bemessungsgrundlage wäre 84,03 (Marge 100 × 100/119). Wer
        // aus diesem Feld eine Steuer ableitet, kommt auf das 2,2-fache der
        // erklärten. Die Gleichung brutto = netto + ust stimmt trotzdem —
        // das Feld ist eine BELEGSUMME, keine Steuerbasis. Die echte Basis
        // je Tag steht in keiner Abschluss-Spalte; sie ergibt sich aus den
        // Zeilen (marginEur je Position) oder aus der DATEV-Aufteilung.
        const [umsatzRow] = await tx.execute<{ ums: Record<string, unknown> }>(sql`
          SELECT COALESCE(jsonb_object_agg(code, jsonb_build_object(
                   'brutto', brutto, 'netto', netto)), '{}'::jsonb) AS ums FROM (
            SELECT code, SUM(brutto)::text AS brutto, SUM(netto)::text AS netto FROM (
              SELECT COALESCE(i.applied_tax_treatment_code::text, t.tax_treatment_code::text) AS code,
                     COALESCE(i.line_total_eur, t.total_eur) AS brutto,
                     COALESCE(i.line_subtotal_eur, t.subtotal_eur) AS netto
                FROM transactions t
                LEFT JOIN transaction_items i ON i.transaction_id = t.id
               WHERE berlin_business_day(t.finalized_at) = ${day}::date
                 AND t.direction = 'VERKAUF'
            ) zeilen
             GROUP BY code
          ) q`);

        const [payRow] = await tx.execute<{ pay: Record<string, string> }>(sql`
          SELECT COALESCE(jsonb_object_agg(method, amt), '{}'::jsonb) AS pay FROM (
            SELECT tp.payment_method::text AS method, SUM(tp.amount_eur)::text AS amt
              FROM transaction_payments tp
              JOIN transactions t ON t.id = tp.transaction_id
             WHERE berlin_business_day(t.finalized_at) = ${day}::date AND t.direction = 'VERKAUF'
             GROUP BY tp.payment_method
          ) q`);

        // ══════════════════════════════════════════════════════════════════
        //  6. DER KASSENSTURZ — und die Falle, die hier bis zum 28.07. sass
        // ══════════════════════════════════════════════════════════════════
        //
        // Hier stand:
        //
        //     WHERE status = 'CLOSED' AND berlin_business_day(closed_at) = <Tag>
        //
        // Also „gab es an DIESEM Tag einen Schichtschluss?". Eine Schicht, die
        // über mehrere Tage läuft, wurde damit ausschliesslich ihrem
        // SCHLIESSTAG gutgeschrieben, und jeder Tag dazwischen lief in den
        // Riegel darunter — dauerhaft unabschliessbar, ohne Rettungsweg
        // (`close` nimmt keinen rückdatierten Zeitpunkt).
        //
        // Auf Romans Produktion gemessen: Schichten über 12 und 33 Tage,
        // **8 von 10 Geschäftstagen gesperrt**, 58 von 65 Belegen,
        // 50.342,54 von 50.813,77 EUR.
        //
        // ── Was jetzt gilt ───────────────────────────────────────────────
        //
        // Ein Tag ist gedeckt, wenn eine geschlossene Schicht ihn ÜBERSPANNT.
        // Aber gezählt wurde die Kasse nur an dem Tag, an dem die Schicht
        // schloss. Deshalb ZWEI getrennte Fragen:
        //
        //   a) schloss an diesem Tag eine Schicht?  → eigener Sturz, Zahlen
        //   b) überspannt eine Schicht diesen Tag?  → gedeckt, aber KEINE Zahl
        //
        // ⚠️ Im Fall b) wird NICHTS eingesetzt. Weder der erwartete Betrag als
        // gezählter, noch der Bestand der ganzen Schicht. Beides wäre ein
        // erfundener Kassensturz in einer fortschreibungsgeschützten
        // Aufzeichnung. Die Zeile sagt stattdessen AUSDRÜCKLICH, dass an
        // diesem Tag nicht gezählt wurde, und nennt die Schicht, die den
        // Sturz trägt (Wanderung 0125). Ein Prüfer findet ihn damit.
        const [sturz] = await tx.execute<{
          expected: string | null;
          counted: string | null;
          shift_count: number;
        }>(sql`
          SELECT
            SUM(system_expected_eur)::text AS expected,
            SUM(blind_count_eur)::text     AS counted,
            COUNT(*)::int                  AS shift_count
          FROM shifts
         WHERE status = 'CLOSED' AND berlin_business_day(closed_at) = ${day}::date`);

        const [deckung] = await tx.execute<{ id: string | null; zu: string | null }>(sql`
          SELECT id::text AS id, berlin_business_day(closed_at)::text AS zu
            FROM shifts
           WHERE status = 'CLOSED'
             AND berlin_business_day(opened_at) <= ${day}::date
             AND berlin_business_day(closed_at) >= ${day}::date
           ORDER BY closed_at ASC
           LIMIT 1`);

        const txTotal = agg!.tx_total;
        const closedShifts = sturz!.shift_count;
        const deckendeSchicht = deckung?.id ?? null;

        // Ein Tag mit Belegen braucht eine Schicht, die ihn ABDECKT. Ohne die
        // ist der Kassenstand wirklich unbekannt, und dann bleibt der Riegel
        // richtig: er verhindert, dass eine erfundene Null gebucht wird.
        if (txTotal > 0 && closedShifts === 0 && deckendeSchicht === null) {
          throw new ClosingConflictError(
            `Für ${day} liegen Belege vor, aber keine geschlossene Schicht deckt ` +
              `diesen Tag ab. Bitte zuerst die Schicht abschließen.`,
          );
        }

        const eigenerSturz = closedShifts > 0;
        // ⚠️ Nicht mehr `txTotal > 0`. Ein Tag OHNE Beleg, den eine Schicht
        // aber ueberspannt, hiess bisher „KEIN_UMSATZ" und bekam die Notiz
        // „Umsatzloser Tag, kein Kassensturz" — waehrend die Lade an diesem
        // Tag Geld hielt. Umsatzlos ist er, gezaehlt wurde er trotzdem nicht,
        // und die deckende Schicht gehoert in die Zeile.
        const quelle: 'EIGENER_STURZ' | 'SCHICHT_SPANNT_TAGE' | 'KEIN_UMSATZ' = eigenerSturz
          ? 'EIGENER_STURZ'
          : deckendeSchicht !== null
            ? 'SCHICHT_SPANNT_TAGE'
            : 'KEIN_UMSATZ';

        // ══════════════════════════════════════════════════════════════════
        //  DER ERWARTETE LADENBESTAND WIRD NICHT ERFUNDEN — UND NICHT AUF
        //  NULL GESETZT
        // ══════════════════════════════════════════════════════════════════
        //
        // Hier stand `eigenerSturz ? toCents(sturz.expected) : 0n`. Beim
        // GEZAEHLTEN Bestand eine Zeile tiefer wurde es richtig gemacht
        // (`null`, mit dem ausdruecklichen Satz „Eine Null hiesse gezaehlt und
        // leer gefunden"), beim ERWARTETEN nicht.
        //
        // Gemessen: Anfangsbestand 1.000,00, zwei Barverkaeufe (119,00 und
        // 238,00), Schicht ueber Mitternacht geschlossen. Der Z-Bon des
        // Umsatztages behauptete, in der Lade sollten 0,00 EUR liegen, und der
        // Kassenbericht desselben Tages rechnete 357,00 EUR aus und wies eine
        // Abweichung von −357,00 EUR aus, die er nicht erklaeren konnte.
        //
        // ⚠️ NULL schreiben geht nicht: `daily_closings_finalized_has_evidence`
        // verlangt `cash_drawer_expected_eur IS NOT NULL`. Und es waere auch
        // falsch — der SOLLbestand ist keine Zaehlung, sondern eine RECHNUNG,
        // und die Aufzeichnungen des Tages tragen sie vollstaendig:
        //
        //     Anfangsbestand + Bareinnahmen − Barauszahlungen
        //     + Einlagen − Entnahmen, alles bis zum Ende DIESES Tages
        //
        // Das ist dieselbe fortschreitende Kassenrechnung, die der
        // Kassenbericht auf dem Blatt zeigt (AEAO zu § 146 Nr. 3.3), und
        // dieselbe, die `shifts.ts` beim Kassensturz zieht — nur am Tagesrand
        // abgeschnitten. Was NICHT erfunden wird, bleibt unveraendert: der
        // GEZAEHLTE Bestand ist und bleibt NULL, denn an diesem Tag hat
        // niemand gezaehlt.
        //
        // Der Storno-Zweig im JOIN ist derselbe wie in `shifts.ts`: eine
        // Stornozeile traegt keine Schichtkennung, das Geld verlaesst aber die
        // Lade, die zur Zeit ihrer Aufzeichnung offen war.
        let expectedCents = eigenerSturz ? toCents(sturz!.expected) : 0n;
        if (!eigenerSturz && deckendeSchicht !== null) {
          const [fortschreibung] = await tx.execute<{ erwartet: string }>(sql`
            WITH deckende AS (
              SELECT id, device_id, opening_float_eur, opened_at, closed_at
                FROM shifts
               WHERE status = 'CLOSED'
                 AND berlin_business_day(opened_at) <= ${day}::date
                 AND berlin_business_day(closed_at) >= ${day}::date
            ),
            bar AS (
              SELECT d.id AS schicht,
                     SUM(CASE WHEN t.direction = 'VERKAUF' THEN tp.amount_eur
                              ELSE -tp.amount_eur END) AS betrag
                FROM deckende d
                JOIN transactions t
                  ON (t.shift_id = d.id
                      OR (t.shift_id IS NULL
                          AND t.storno_of_transaction_id IS NOT NULL
                          AND t.device_id = d.device_id
                          AND t.created_at >= d.opened_at
                          AND t.created_at < d.closed_at))
                JOIN transaction_payments tp ON tp.transaction_id = t.id
               WHERE tp.payment_method = 'CASH'::payment_method
                 AND berlin_business_day(t.finalized_at) <= ${day}::date
               GROUP BY d.id
            ),
            bewegt AS (
              SELECT d.id AS schicht,
                     SUM(CASE
                           WHEN cm.direction = 'INJECTION'::cash_movement_direction
                             THEN cm.amount_eur
                           WHEN cm.direction IN ('BANK_DROP'::cash_movement_direction,
                                                 'SAFE_TRANSIT'::cash_movement_direction)
                             THEN -cm.amount_eur
                           ELSE 0
                         END) AS betrag
                FROM deckende d
                JOIN cash_movements cm ON cm.shift_id = d.id
               WHERE berlin_business_day(cm.created_at) <= ${day}::date
               GROUP BY d.id
            )
            SELECT COALESCE(SUM(d.opening_float_eur
                                + COALESCE(b.betrag, 0)
                                + COALESCE(m.betrag, 0)), 0)::text AS erwartet
              FROM deckende d
              LEFT JOIN bar b    ON b.schicht = d.id
              LEFT JOIN bewegt m ON m.schicht = d.id`);
          expectedCents = toCents(fortschreibung!.erwartet);
        }
        // ⚠️ `null`, nicht `0n`. Eine Null hiesse „gezählt und leer gefunden".
        const countedCents: bigint | null = eigenerSturz ? toCents(sturz!.counted) : null;
        const varianceCents: bigint | null =
          countedCents === null ? null : countedCents - expectedCents;

        const sturzHinweis =
          quelle === 'SCHICHT_SPANNT_TAGE'
            ? `An diesem Tag wurde die Kasse nicht gezählt: die Schicht lief weiter und ` +
              `wurde am ${deckung?.zu ?? '?'} geschlossen und gezählt.`
            : null;

        // 7. TSE evidence counts — keyed to the day's TRANSACTIONS (joined by
        //    transaction_id), NOT by the signature's recorded_at (which is the
        //    server record time and can fall on the next day for a sale near
        //    midnight). `finished` = this day's transactions that HAVE a signature;
        //    `pending` = a real anti-join (this day's transactions with none).
        //    tse_failed is not yet wired to a failure source — reported as 0 (the
        //    Fiskaly state machine lives in a separate tse_transactions table; a
        //    follow-up surfaces genuine FAILED here). See task 103.
        const [tse] = await tx.execute<{ finished: number; pending: number }>(sql`
          SELECT
            COUNT(*) FILTER (WHERE s.transaction_id IS NOT NULL)::int AS finished,
            COUNT(*) FILTER (WHERE s.transaction_id IS NULL)::int     AS pending
          FROM transactions t
          LEFT JOIN tse_signatures s ON s.transaction_id = t.id
         WHERE berlin_business_day(t.finalized_at) = ${day}::date`);
        const finished = tse!.finished;
        const pending = tse!.pending;

        // 7a. ── EIN TAG MIT UNSIGNIERTEN BELEGEN SCHLIESST NICHT AUS VERSEHEN
        //
        // Die Zahl oben wurde seit jeher sauber ermittelt und gespeichert, und
        // sie hat nie etwas bewirkt. Ab hier hat sie eine Folge.
        //
        // Kein Verbot, sondern eine Nachfrage: der Mensch am Abschluss muss die
        // Zahl gesehen und bestaetigt haben. Was er bestaetigt, steht danach in
        // der Notiz der Abschlusszeile, und die ist unveraenderlich.
        const bestaetigt = req.body?.unsignierteBelegeBestaetigt === true;
        if (pending > 0 && !bestaetigt) {
          throw new ClosingConflictError(
            `${pending} Beleg${pending === 1 ? '' : 'e'} dieses Tages ` +
              `${pending === 1 ? 'trägt' : 'tragen'} keine TSE-Signatur. Der Tag lässt sich ` +
              'abschliessen, aber nur ausdrücklich: die fehlenden Signaturen werden nachgeholt, ' +
              'sobald die Sicherungseinrichtung wieder erreichbar ist, und der Abschluss hält ' +
              'fest, dass sie zum Abschlusszeitpunkt fehlten.',
          );
        }

        // 8. Ledger checkpoint anchor — the chain head at finalize time. The
        //    FINALIZED CHECK requires a non-null 32-byte anchor, so a system with
        //    no ledger events cannot be finalized (never the case in production).
        const [anchor] = await tx.execute<{ id: string; row_hash: Uint8Array }>(sql`
          SELECT id::text AS id, row_hash FROM ledger_events ORDER BY id DESC LIMIT 1`);
        if (!anchor || !anchor.row_hash) {
          throw new ClosingConflictError(
            'Kein Ledger-Anker vorhanden, der Tagesabschluss kann nicht gesetzt werden.',
          );
        }

        // A truly empty day (no transactions, no closed shift) has no counted
        // drawer; the FINALIZED CHECK forbids NULL cash, so we book 0,00 but mark
        // it honestly so it is never mistaken for an actual Kassensturz of 0.
        const emptyDayNote =
          sturzHinweis ??
          (txTotal === 0 && closedShifts === 0 ? 'Umsatzloser Tag, kein Kassensturz.' : null);

        // Die Bestaetigung gehoert in die Aufzeichnung, nicht nur in den
        // Augenblick. Ein Pruefer, der diese Zeile liest, muss sehen, dass die
        // Luecke bekannt war und wer sie bestaetigt hat.
        // ⚠️ 14.08.2026: Hier stand „Nachholung ausstehend" — eine Zusage, die
        // kein Code einlöst (der Motor signiert nicht rückwirkend). Der
        // Vermerk hält nur das Gemessene fest: die Lücke und die Bestätigung.
        const tseVermerk =
          pending > 0
            ? `${pending} Beleg${pending === 1 ? '' : 'e'} ohne TSE-Signatur zum ` +
              'Abschlusszeitpunkt; Ausfall vermerkt. Ausdrücklich bestätigt.'
            : null;
        const notiz = [emptyDayNote, tseVermerk].filter((z) => z !== null).join(' ') || null;

        // 9. Write the immutable FINALIZED Z-Bon (one INSERT; the validate-state
        //    trigger is UPDATE-only, so a direct FINALIZED insert is allowed —
        //    the finalized-has-evidence CHECK is satisfied by the fields below).
        //    jsonb is bound as a parameterized text value then cast (injection-safe).
        //    NOTE (V1 single-shop): shop_id is NULL; a multi-shop future must scope
        //    every aggregate + the uniqueness by shop_id (tracked: task 103).
        //    A shift that spans midnight (opened day A, closed day B) is attributed
        //    to its closed_at day here — a documented edge for an overnight till.
        // ── 0124: die Z-Nummer, in DERSELBEN Transaktion ────────────────
        //
        // DSFinV-K Z_NR ist die fortlaufende Nummer des Abschlusses je Kasse,
        // und jede andere Datei des Pakets zeigt darauf. Bis heute stand dort
        // das DATUM (`dsfinvk-export.ts: return businessDay`) — keine Folge,
        // also für einen Prüfer ohne Aussage: eine Lücke zwischen 41 und 43
        // ist ein FEHLENDER Abschluss und muss auffallen. Bei Datumsschlüsseln
        // fällt gar nichts auf.
        //
        // ⚠️ KEINE Sequenz. Eine Postgres-Sequenz zieht auch bei einem
        // Rollback hoch und risse damit eine Lücke, die von einem fehlenden
        // Abschluss nicht mehr zu unterscheiden wäre. Hier wird aus dem
        // Höchststand gezählt, in derselben Transaktion, die `finalized_at`
        // setzt — und der eindeutige Index aus 0124 ist der Riegel, der ein
        // Doppelvergeben SCHEITERN lässt, statt es zuzulassen.
        /*
         * ── ⛔ DIE NUMMERNVERGABE BRAUCHT EINE EIGENE SPERRE ────────────────
         *
         * DER BEFUND (Tiefenjagd 11.08.2026): der Griff oben haengt am TAG
         * (`pg_advisory_xact_lock(1146, <tag>)`). Zwei Abschluesse fuer ZWEI
         * VERSCHIEDENE Tage nehmen also zwei verschiedene Schluessel und
         * laufen gleichzeitig — beide lesen `max(z_nr) + 1` und bekommen
         * dieselbe Zahl. Gemessen:
         *
         *     zwei Verbindungen, gleichzeitig gelesen: {"A":"1","B":"1"}
         *     finalize 2026-05-04 → 200
         *     finalize 2026-05-03 → 409 „Der Tagesabschluss fuer 2026-05-03
         *                                besteht bereits."
         *     daily_closings danach: nur der 04.05.
         *
         * Der Mensch am Abschluss liest, der 03.05. sei erledigt, und hakt ihn
         * ab. Tatsaechlich hat dieser Tag KEINEN Z-Bon, und damit liefern
         * DSFinV-K, DATEV und Kassenbericht fuer ihn nichts. Eine fehlende
         * Abschlussnummer ist genau das, woran ein Pruefer einen fehlenden
         * Abschluss erkennt (§ 146 Abs. 1 Satz 2 AO).
         *
         * Der Schluessel −1 kann mit keinem Tag kollidieren: der Tagesschluessel
         * ist `(tag − 1970-01-01)::int` und damit fuer jeden Tag ab 1970
         * nicht negativ. Die Reihenfolge ist fuer JEDEN Abschluss dieselbe
         * (erst Tag, dann Nummer), deshalb kann sich hier nichts verklemmen.
         */
        await tx.execute(sql`SELECT pg_advisory_xact_lock(1146, -1)`);

        const [zStand] = await tx.execute<{ naechste: string }>(sql`
          SELECT coalesce(max(z_nr), 0) + 1 AS naechste
            FROM daily_closings
           WHERE shop_id IS NOT DISTINCT FROM NULL`);
        const zNummer = BigInt(zStand?.naechste ?? '1');

        let row: { id: string; finalized_at: string } | undefined;
        try {
          [row] = await tx.execute<{ id: string; finalized_at: string }>(sql`
            INSERT INTO daily_closings (
              business_day, state,
              verkauf_count, ankauf_count, storno_count,
              rueckgabe_count, rueckgabe_verkauf_eur,
              gross_verkauf_eur, gross_ankauf_eur, net_verkauf_eur, net_ankauf_eur,
              storno_verkauf_eur, storno_ankauf_eur,
              vat_by_treatment, umsatz_by_treatment, payments_by_method,
              cash_drawer_expected_eur, cash_drawer_counted_eur, cash_drawer_variance_eur,
              tse_finished_count, tse_pending_count, tse_failed_count,
              ledger_anchor_id, ledger_anchor_hash,
              counted_by_user_id, counted_at, finalized_by_user_id, finalized_at, notes,
              z_nr, kassensturz_quelle, kassensturz_schicht_id
            ) VALUES (
              ${day}::date, 'FINALIZED'::closing_state,
              ${agg!.verkauf_count}, ${agg!.ankauf_count}, ${agg!.storno_count},
              ${agg!.rueckgabe_count}, ${agg!.rueckgabe_verkauf},
              ${agg!.gross_verkauf}, ${agg!.gross_ankauf}, ${agg!.net_verkauf}, ${agg!.net_ankauf},
              ${agg!.storno_verkauf}, ${agg!.storno_ankauf},
              ${JSON.stringify(vatRow!.vat)}::jsonb,
              ${JSON.stringify(umsatzRow!.ums)}::jsonb,
              ${JSON.stringify(payRow!.pay)}::jsonb,
              ${fromCents(expectedCents)},
              ${countedCents === null ? null : fromCents(countedCents)},
              ${varianceCents === null ? null : fromCents(varianceCents)},
              ${finished}, ${pending}, 0,
              ${anchor.id}::bigint, ${anchor.row_hash},
              ${req.actor.id}::uuid, now(), ${req.actor.id}::uuid, now(), ${notiz},
              ${zNummer.toString()}::bigint,
              ${quelle}::kassensturz_quelle,
              ${quelle === 'SCHICHT_SPANNT_TAGE' ? deckendeSchicht : null}::uuid
            )
            RETURNING id::text AS id, finalized_at::text AS finalized_at`);
        } catch (e) {
          // A concurrent finalize for the same day loses the business_day UNIQUE
          // race — surface it as a clean 409, not a raw 23505 → 500. In the V1
          // single-shop model (shop_id NULL) the winning guard is the partial
          // index daily_closings_business_day_null_shop_uq (migration 0079); the
          // shop-scoped constraint applies once shop_id is set. Either way it is
          // SQLSTATE 23505.
          const code = (e as { code?: string }).code;
          const msg = (e as Error).message ?? '';
          /*
           * ⚠️ 11.08.2026: DIE BEIDEN VERLETZUNGEN SAGEN NICHT DASSELBE.
           *
           * Vorher fielen beide auf den Satz „Der Tagesabschluss für <Tag>
           * besteht bereits." Bei einer Kollision der Z-NUMMER ist dieser Satz
           * UNWAHR: der Tag ist gerade NICHT abgeschlossen, und wer ihn liest,
           * hakt einen Tag ohne Z-Bon ab. Seit der Sperre auf der
           * Nummernvergabe (oben) sollte dieser Zweig nicht mehr erreichbar
           * sein; falls doch, sagt er jetzt die Wahrheit und nennt den
           * Ausweg — noch einmal auslösen, nicht abhaken.
           */
          const zNummerKollision =
            msg.includes('daily_closings_z_nr_null_shop_uq') ||
            msg.includes('daily_closings_z_nr_shop_uq');
          if (zNummerKollision) {
            throw new ClosingConflictError(
              `Der Tagesabschluss für ${day} wurde NICHT geschrieben: eine zweite Kasse hat ` +
                `im selben Augenblick dieselbe Abschlussnummer vergeben. Der Tag ist weiterhin ` +
                `offen. Bitte den Abschluss noch einmal auslösen.`,
            );
          }
          if (
            code === '23505' ||
            msg.includes('daily_closings_business_day_shop_uq') ||
            msg.includes('daily_closings_business_day_null_shop_uq')
          ) {
            throw new ClosingConflictError(`Der Tagesabschluss für ${day} besteht bereits.`);
          }
          throw e;
        }

        return {
          id: row!.id,
          businessDay: day,
          verkaufCount: agg!.verkauf_count,
          ankaufCount: agg!.ankauf_count,
          stornoCount: agg!.storno_count,
          grossVerkaufEur: agg!.gross_verkauf,
          netVerkaufEur: agg!.net_verkauf,
          cashExpectedEur: fromCents(expectedCents),
          cashCountedEur: countedCents === null ? null : fromCents(countedCents),
          cashVarianceEur: varianceCents === null ? null : fromCents(varianceCents),
          finalizedAt: new Date(row!.finalized_at).toISOString(),
        };
      });

      return reply.status(200).send({ state: 'FINALIZED' as const, ...out });
    },
  );
};

export default closingsFinalizeRoute;
