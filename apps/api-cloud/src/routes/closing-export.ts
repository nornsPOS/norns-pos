/**
 * Closings + tax-export routes (Epic K — Part 2; Steuer-Export surface).
 *
 *   GET /api/closings                              — ADMIN | READONLY
 *   GET /api/closings/:id/export/datev             — ADMIN | READONLY + step-up
 *   GET /api/closings/:id/export/kassenbericht      — ADMIN | READONLY + step-up
 *
 * The DATEV route maps the day's FINALIZED transactions to SKR03 booking lines;
 * the Kassenbericht route re-expresses the stored daily_closing as a German cash
 * report. Both return a CSV file download. READONLY = the Steuerberater (read-
 * only fiscal access). A fresh PIN step-up guards every download — a full
 * bookkeeping export is exactly the single-actor, sensitive op §requireStepUp
 * covers — and the access is audit-logged. Exports are READ-ONLY (GoBD): no
 * fiscal row is ever mutated or recomputed here.
 */

import { Type } from '@sinclair/typebox';
import { sql } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';

import { requireAuth, requireRole, requireStepUp } from '../lib/auth-policy.js';
import {
  baueAusgabenzeilen,
  baueBewegungszeilen,
} from '../lib/datev-bargeldbewegung.js';
import { type DATEVRow } from '../lib/datev-export.js';
import {
  type Behandlungsanteil,
  ZAHLART_KURZ,
  type Zahlung,
  ZahlartNichtKontiertError,
  kreuzeZahlungenMitBehandlungen,
} from '../lib/datev-kontierung.js';
import {
  type DatevZeile,
  FELD,
  baueBuchungsstapel,
  datevDateiname,
  kodiereAnsi,
  zuBelegdatum,
  zuDatevBetrag,
} from '../lib/datev-format.js';
import { ladeDatevMandant } from '../lib/datev-mandant.js';
import { erzwingeLadenname } from '../lib/laden-identitaet.js';
import {
  type Kontenplan,
  type KontoId,
  konto as kontoNummer,
  ladeKontenplan,
  normalisiereRahmen,
  vorlagenplan,
} from '../lib/kontenrahmen.js';
import { nurFehler, pruefeBuchungsstapel } from '../lib/datev-pruefer.js';
import {
  baueDsfinvkTagZip,
  ClosingNotFinalizedError,
  ClosingNotFoundError,
  centsToEur,
  eurToCents,
} from '../lib/dsfinvk-tag.js';
import { type KassenberichtInput, buildKassenberichtCsv } from '../lib/kassenbericht-export.js';
import { renderKassenberichtHtml } from '../lib/kassenbericht-print.js';
import { type ApiErrorCode, DomainError } from '../plugins/error-handler.js';

/**
 * Die erzeugte Datei hält das Format nicht ein.
 *
 * 500, nicht 409: der Bediener hat nichts falsch gemacht, und es ist auch
 * kein Zustandskonflikt — es ist ein Fehler in UNSEREM Erzeugen, den der
 * Steuerberater sonst als Erster fände.
 */
/**
 * ⛔ EIN ZEICHEN, DAS DATEV NICHT KENNT, IST KEIN SERVERFEHLER (19.08.2026).
 *
 * DATEV EXTF ist Windows-1252. Ein tuerkisches ş, ein polnisches ł, ein
 * Emoji im Lieferantennamen — alles im Alltag moeglich, und alles dort
 * heimatlos. Der Haendler hat nichts kaputt gemacht; er hat etwas getippt,
 * das er in zehn Sekunden aendern kann, sobald ihm jemand sagt WO.
 *
 * Darum 409 mit Fundstelle statt 500 mit „unerwarteter Fehler": derselbe
 * Grund, aus dem LIZENZ_FEHLT ein 402 ist und kein 403.
 */
class DatevZeichenNichtKodierbarError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
}

class DatevDateiFehlerhaftError extends DomainError {
  public readonly httpStatus = 500;
  public readonly code: ApiErrorCode = 'INTERNAL_ERROR';
}


/**
 * A legal tax export (DATEV / DSFinV-K / Kassenbericht) is only valid over a
 * FINALIZED daily closing. Exporting a COUNTING (still open) day would hand out
 * an incomplete, non-final artifact as if it were the day's books. The GET
 * /:id info route stays available for previewing an open closing's state.
 */

const ErrorResponse = Type.Object({
  error: Type.Object({
    code: Type.String(),
    message: Type.String(),
    requestId: Type.String(),
    details: Type.Optional(Type.Unknown()),
  }),
});

// ── GET /api/closings — list daily closings for the owner's Kassenabschluss ──

const ClosingListItem = Type.Object({
  id: Type.String({ format: 'uuid' }),
  businessDay: Type.String(),
  state: Type.Union([Type.Literal('COUNTING'), Type.Literal('FINALIZED')]),
  verkaufCount: Type.Integer(),
  ankaufCount: Type.Integer(),
  stornoCount: Type.Integer(),
  netVerkaufEur: Type.String(),
  netAnkaufEur: Type.String(),
  cashVarianceEur: Type.Union([Type.String(), Type.Null()]),
  tseFailedCount: Type.Integer(),
  /**
   * Belege dieses Tages, die zum Abschlusszeitpunkt NOCH KEINE Signatur
   * hatten.
   *
   * ⚠️ 08.08.2026: dieses Feld fehlte hier, und `tse_failed_count` wird in
   * `closings-finalize.ts:590` als feste NULL geschrieben — es gibt bis
   * heute keine Quelle, die „fehlgeschlagen" von „ausstehend" trennt.
   * Folge: die Steuerfläche rechnete `tseFailedCount === 0` und zeigte auf
   * JEDER Zeile, immer, ein grünes „alles signiert" — auch an einem Tag mit
   * zwölf unsignierten Belegen, deren Zahl in derselben Datenbankzeile
   * steht.
   *
   * Ohne diese Zeile entfernt Fastify das Feld stillschweigend.
   */
  tsePendingCount: Type.Integer(),
  finalizedAt: Type.Union([Type.String({ format: 'date-time' }), Type.Null()]),
});

const ClosingListResponse = Type.Object({
  items: Type.Array(ClosingListItem),
  /**
   * Wie viele Abschlüsse dem Filter insgesamt entsprechen — auch die, die auf
   * dieser Seite nicht mitkommen.
   *
   * ⚠️ Ohne diese Zahl kann ein Klient „steht nicht auf dieser Seite" nicht von
   * „gibt es nicht" unterscheiden. Genau daran scheiterte am 05.08.2026 die
   * Kassennachschau: die Kasse meldete für den März mit voller Bestimmtheit
   * „Keine abgeschlossenen Kassentage im Zeitraum", während die Tage sehr wohl
   * da waren, nur nicht in den 90 neuesten.
   */
  gesamt: Type.Integer(),
  /** Wahr, wenn hinter dieser Seite noch etwas liegt. */
  weitere: Type.Boolean(),
});

/**
 * ⚠️ DER BEFUND VOM 05.08.2026: DREIEINHALB MONATE UND DER REST WAR WEG
 *
 * Diese Liste war die EINZIGE Stelle im ganzen Haus, die eine Abschluss-`id`
 * herausgibt, und alle drei Steuer-Exporte brauchen genau die. Sie lieferte
 * fest die 90 neuesten, ohne Zeitraum und ohne Blätterung.
 *
 * Ein Laden mit täglichem Geschäft hatte damit nach rund 90 Kassentagen den
 * 91. und jeden älteren Tag über die GANZE HTTP-Fläche verloren. Steht der
 * Prüfer im August im Laden und verlangt nach § 146b AO das Paket für den
 * März, findet der Inhaber den Tag nicht — und die Kasse sagt ihm, es gebe
 * ihn nicht.
 */
const ClosingListQuery = Type.Object({
  /** Erster Berliner Geschäftstag, einschliesslich. */
  from: Type.Optional(Type.String({ format: 'date' })),
  /** Letzter Berliner Geschäftstag, einschliesslich. */
  to: Type.Optional(Type.String({ format: 'date' })),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 90 })),
  offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
});

type ClosingRow = {
  id: string;
  business_day: string;
  state: string;
  verkauf_count: number;
  ankauf_count: number;
  storno_count: number;
  net_verkauf_eur: string;
  net_ankauf_eur: string;
  cash_variance_eur: string | null;
  tse_failed_count: number;
  tse_pending_count: number;
  finalized_at: Date | null;
};

/** Full closing row for the Kassenbericht (re-expressed, never recomputed). */
type ClosingFullRow = {
  business_day: string;
  state: string;
  verkauf_count: number;
  ankauf_count: number;
  storno_count: number;
  gross_verkauf_eur: string;
  storno_verkauf_eur: string;
  /** 0148: Warenruecknahmen des Tages, als NEGATIVER Betrag gespeichert. */
  rueckgabe_verkauf_eur: string;
  rueckgabe_count: number;
  storno_ankauf_eur: string;
  gross_ankauf_eur: string;
  net_verkauf_eur: string;
  net_ankauf_eur: string;
  vat_by_treatment: Record<string, string> | null;
  umsatz_by_treatment: Record<string, { brutto: string; netto: string }> | null;
  payments_by_method: Record<string, string> | null;
  cash_expected_eur: string | null;
  cash_counted_eur: string | null;
  cash_variance_eur: string | null;
  tse_finished_count: number;
  tse_pending_count: number;
  tse_failed_count: number;
  finalized_at: Date | null;
};

/**
 * Steuerbehandlung → LOGISCHES Erlöskonto + DATEV-Buchungsschlüssel.
 *
 * Die Zuordnung nach Behandlung beendet den steuerlich blinden Einsturz, bei
 * dem jeder Verkauf auf einem einzigen Erlöskonto landete und mit 19 Prozent
 * versteuert wurde — auch steuerfreies Anlagegold (§ 25c) und
 * differenzbesteuerte Gebrauchtware (§ 25a).
 *
 *   • STANDARD_19          → Erlöse 19 Prozent   · Buchungsschlüssel 3
 *   • REDUCED_7            → Erlöse 7 Prozent    · Buchungsschlüssel 2
 *   • INVESTMENT_GOLD_25C  → Anlagegold § 25c    · kein Schlüssel (0 Prozent)
 *   • MARGIN_25A           → Differenzbesteuerung · kein Schlüssel
 *
 * ── DIE ÄNDERUNG VOM 26.07.2026 ────────────────────────────────────────────
 * Hier standen die NUMMERN 8400, 8300, 8200 und 8150, also SKR03, fest im
 * Quelltext. Jetzt steht hier der ZWECK; die Nummer kommt aus dem Kontenplan
 * (`kontenrahmen.ts`), Vorlage SKR03 oder SKR04, jedes Konto einzeln aus der
 * App überschreibbar.
 *
 * Der BUCHUNGSSCHLÜSSEL bleibt hier stehen und wandert NICHT in den
 * Kontenplan: er benennt den Steuersatz, nicht das Konto, und ist in SKR03
 * wie in SKR04 derselbe. Ihn überschreibbar zu machen hiesse, den Steuersatz
 * zur Einstellung zu erklären.
 *
 * Ein unbekannter Behandlungscode fällt auf „Erlöse 19 Prozent" zurück, und
 * der Buchungstext nennt den Code — nichts landet still im falschen Steuertopf.
 */
const ERLOES_JE_BEHANDLUNG: Record<string, { konto: KontoId; bu: string }> = {
  // ── 19.08.2026: der Schlüssel fällt weg, auf allen drei Erlöskonten ─────
  //
  // Bis heute stand hier `bu: '3'` für 19 Prozent und `bu: '2'` für 7 Prozent.
  // Das war falsch, und der Beweis lag die ganze Zeit im Haus:
  // `tests/vorlagen/EXTF_Buchungsstapel_DATEV_Muster.csv`, DATEVs eigene
  // Musterdatei. Ausgezählt über alle 54 Buchungszeilen:
  //
  //     Konto 8400, Feld 9 leer .................... 10×
  //     Konto 8400, Feld 9 = 40 (Automatik AUS) ..... 2×
  //     Konto 8400, Feld 9 = 20 (Generalumkehr) ..... 1×
  //     Konto 8400, Feld 9 = 3 ...................... 0×
  //
  // Beide BU-3-Zeilen der Musterdatei stehen auf Konto 8050, und DATEV hat
  // eine davon selbst beschriftet: „Aufteilung AR OHNE Automatikkonto".
  //
  // 8400 IST ein Automatikkonto — es rechnet die Steuer aus dem Bruttobetrag
  // selbst heraus. Genau deshalb gibt es den Schlüssel 40 („Aufhebung der
  // Automatik"): den bräuchte niemand, wenn da keine Automatik wäre. Ein
  // Steuerschlüssel obendrauf lässt die Bemessungsgrundlage ZWEIMAL bestimmen,
  // einmal vom Konto und einmal vom Feld.
  //
  // ── Warum das auch 8191 (§ 25a-Marge) mitnimmt ─────────────────────────
  //
  // Der Kommentar weiter unten nannte den Schlüssel auf 8191 „Vorschlag, nicht
  // Beleg" und begründete ihn damit, dass das Haus es bei 8400 ebenso halte.
  // Diese Begründung ist mit der Auszählung hinfällig — die Vorlage war selbst
  // falsch. 8191 heisst „Umsatzerlöse nach §§ 25 und 25a UStG 19 % USt": der
  // Satz steht im Kontonamen, das ist in SKR03 das Kennzeichen der Automatik,
  // und der Export verlässt sich längst darauf, indem er die BRUTTO-Marge
  // bucht und 19/119 vom Konto herausrechnen lässt.
  //
  // Für den Händler ist 8191 die Hauptzeile: bei Differenzbesteuerung hängt
  // die gesamte Steuerlast daran.
  //
  // Quelle: die Musterdatei im Haus, nachgezählt am 19.08.2026.
  STANDARD_19: { konto: 'erloeseStandard19', bu: '' },
  REDUCED_7: { konto: 'erloeseReduced7', bu: '' },
  MARGIN_25A: { konto: 'erloeseMargin25a', bu: '' },
  INVESTMENT_GOLD_25C: { konto: 'erloeseGold25c', bu: '' },
  // ── 26.07.2026 ergänzt. Beide fehlten. ──────────────────────────────────
  //
  // ⚠️ Der Zustand davor war nicht „unvollständig", sondern FALSCH und STILL:
  // ein Umsatz mit einem unbekannten Schlüssel fiel über einen Rückfallwert
  // auf `erloeseStandard19` — also SKR03 8400, Erlöse 19 Prozent — mit LEEREM
  // Buchungsschlüssel. Der Steuerberater sah einen 19-Prozent-Erlös, wo keiner
  // war, und nichts im Export deutete darauf hin.
  //
  // Auf der Produktion gemessen: 1 Vorgang über 464,00 EUR trug `MIXED` und
  // wurde genau so gebucht.
  REVERSE_CHARGE_13B: { konto: 'erloeseReverseCharge13b', bu: '' },
  KLEINUNTERNEHMER_19: { konto: 'erloeseKleinunternehmer19', bu: '' },

  // ── 27.07.2026: die zwei Hälften eines § 25a-Verkaufs ───────────────────
  //
  // Keine Steuerschlüssel des Kassensystems, sondern die zwei Buchungszeilen,
  // in die ein differenzbesteuerter Verkauf zerfällt. Sie entstehen erst in
  // `teileZeileAuf` und stehen nie in der Datenbank.
  //
  // Haufe Finance Office, wiedergegeben in docs/fiskal/recherche/beraterpraxis.md
  // §3.2: „beim Verkauf wird der Einkaufspreis auf das Konto ohne USt gebucht
  // und die Differenz zum Verkaufspreis auf das Konto mit 19 Prozent. Also zwei
  // Zeilen je differenzbesteuertem Verkauf, nicht eine."
  MARGIN_25A_EINKAUF: { konto: 'erloeseMargin25aEinkaufsanteil', bu: '' },
  MARGIN_25A_MARGE: { konto: 'erloeseMargin25aMarge', bu: '' },
};

/**
 * ── 19.08.2026: die offene Frage ist beantwortet ────────────────────────
 *
 * Hier stand die Bitte, den Buchungsschlüssel auf 8191 dem Steuerberater
 * vorzulegen, weil die Recherche „die KONTEN belegt, nicht den Schlüssel".
 * Sie ist erledigt, und zwar aus DATEVs eigener Hand.
 *
 * Der amtliche Kontenrahmen SKR03 (Art.-Nr. 11174, Ausgabe 2026-01-01) führt
 * auf Seite 35 eine Funktionslegende. „AM" heisst dort: automatische
 * Errechnung der Umsatzsteuer. Danach tragen
 *
 *     8400-09  Erlöse 19 % USt ................................ U AM
 *     8300-09  Erlöse 7 % USt ................................. U AM
 *     8191     Umsatzerlöse nach §§ 25 und 25a UStG 19 % USt ...  AM
 *
 * alle drei die Automatik. Ein Steuerschlüssel im Feld 9 gehört auf keines
 * von ihnen. Kein Vorschlag mehr, sondern Beleg.
 */

/**
 * Ein § 25a-Verkauf ohne hinterlegten Einkaufspreis wird NICHT gebucht.
 *
 * Der bequeme Weg wäre, den ganzen Betrag auf das Konto ohne Umsatzsteuer zu
 * legen — und genau das ist der Fehler, der hier behoben wird: dann sähe der
 * Steuerberater einen steuerfreien Erlös, wo in Wahrheit 19 Prozent auf die
 * Marge fällig sind. § 25a Abs. 6 UStG verlangt die Aufzeichnung des
 * Einkaufspreises; fehlt sie, ist die Bemessungsgrundlage nicht belegbar.
 */
export class MargeOhneEinkaufspreisError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
  /**
   * ⚠️ Die Belegnummer gehört an ein FELD, nicht nur in den Fliesstext.
   *
   * Bei einem Zeitraumexport über hunderte Belege ist sie die einzige Angabe,
   * mit der jemand die Stelle findet. Dieselbe Bauart wie `lockedUntil` bei
   * der PIN-Sperre: die Oberfläche kann sie gezielt anzeigen, statt einen
   * Satz nach einer Nummer abzusuchen.
   */
  public readonly details: { beleg: string };

  public constructor(beleg: string) {
    /**
     * ⛔ 08.08.2026 — HIER STAND „Bitte den Einkaufspreis am Stück nachtragen."
     *
     * Gemessen: `transaction_items` ist unveränderlich („NO UPDATE"), es gibt
     * kein `GRANT UPDATE`, und `acquisition_cost_eur_snapshot` hat ausserhalb
     * des Verkaufs keinen Schreiber. Der Rat zeigte in eine Wand.
     *
     * Wer einem Menschen einen Weg nennt, den es nicht gibt, kostet ihn eine
     * Stunde und danach das Vertrauen in jede weitere Meldung. Die Belegzeile
     * ist fiskal versiegelt; was bleibt, ist der Steuerberater.
     */
    super(
      `Zum Beleg ${beleg} trägt eine Position nach § 25a keinen Einkaufspreis. ` +
        `Ohne ihn ist die Marge nicht belegbar (§ 25a Abs. 6 UStG), und es wurde ` +
        `KEINE DATEV-Datei erzeugt. Die Belegzeile ist festgeschrieben und lässt ` +
        `sich nicht mehr ändern; bitte diesen Beleg dem Steuerberater vorlegen.`,
    );
    this.details = { beleg };
  }
}

/**
 * ⚠️ Ein unbekannter Steuerschlüssel wird NICHT mehr still gebucht.
 *
 * Ein Export, der lieber abbricht als falsch zu buchen, ist die einzige
 * vertretbare Richtung: eine fehlerhafte DATEV-Zeile fällt erst dem
 * Steuerberater auf, Monate später, und dann ist der Monat festgeschrieben.
 *
 * ── Warum `MIXED` hier durchgelassen wird ────────────────────────────────
 *
 * Der erste Entwurf dieses Riegels liess `MIXED` auflaufen — und machte damit
 * SIEBEN grüne Prüfungen rot. Die haben mich eines Besseren belehrt: ein
 * gemischter Beleg WIRD bereits je Zeile aufgelöst (`toDatevRows`), und dabei
 * ruft die Aufteilung `toDatevRow` als GRUNDLAGE auf — mit dem Kopf des
 * Vorgangs, und der trägt `MIXED`.
 *
 * Der Kopfwert dient dort nur als Gerüst; das Erlöskonto jeder Teilzeile wird
 * anschliessend aus der ZEILEN-Behandlung überschrieben. `MIXED` erreicht also
 * nie ein Konto.
 *
 * ⚠️ Die Lehre daraus, und sie zählt mehr als der Fix: ich hielt `MIXED` für
 * ungebaut, WEIL es in der Zuordnungstabelle fehlte. Es fehlte dort aber mit
 * gutem Grund. Ein Riegel, der auf eine Vermutung gebaut wird statt auf den
 * gelesenen Weg, blockiert das Richtige.
 */
const KOPFWERT_OHNE_KONTO = new Set(['MIXED']);
export class UnbekannteSteuerbehandlungError extends DomainError {
  public readonly httpStatus = 409;
  public readonly code: ApiErrorCode = 'CONFLICT';
  public readonly details: { steuerschluessel: string };

  public constructor(schluessel: string) {
    super(
      `Der Steuerschlüssel „${schluessel}" hat kein Erlöskonto. Der Export wurde ` +
        `abgebrochen, statt den Umsatz still auf die 19-Prozent-Erlöse zu buchen. ` +
        `Bitte das Konto in den Einstellungen hinterlegen oder den Vorgang prüfen.`,
    );
    this.details = { steuerschluessel: schluessel };
  }
}

function erloesFuer(code: string): { konto: KontoId; bu: string } {
  const m = ERLOES_JE_BEHANDLUNG[code];
  if (m) return m;
  // Ein reiner Kopfwert bekommt ein Gerüstkonto; die Aufteilung überschreibt es
  // je Zeile. Er landet nie in einer ausgegebenen Zeile.
  if (KOPFWERT_OHNE_KONTO.has(code)) return { konto: 'erloeseStandard19', bu: '' };
  throw new UnbekannteSteuerbehandlungError(code);
}

/**
 * Der Plan, der gilt, wenn keiner mitgegeben wird: die Vorlage SKR03.
 *
 * Er hält WÖRTLICH die Nummern, die bis zum 26.07.2026 fest im Quelltext
 * standen. Ein Aufrufer ohne Plan bekommt also unverändert das alte Ergebnis.
 */
const VORGABEPLAN: Kontenplan = vorlagenplan('SKR03');


// A `type` (not `interface`) so it satisfies the `Record<string, unknown>`
// constraint on `db.execute<T>` (interfaces lack an implicit index signature).
export type TxRow = {
  total_eur: string;
  direction: string;
  tax_treatment_code: string;
  receipt_locator: string;
  finalized_at: Date;
  /**
   * 0148: Warenruecknahme. Auch sie ist negativ und bucht (richtig) als
   * Generalumkehr — aber ihr Buchungstext muss RUECKGABE sagen, nicht
   * STORNO: fuer den Steuerberater sind das zwei verschiedene Vorgaenge
   * (Rechnungskorrektur vs. Minderung nach § 17 UStG).
   */
  is_rueckgabe?: boolean;
};

/**
 * The minimal per-line view the DATEV builder needs to split a MIXED receipt:
 * the line's own tax treatment and its gross line total. Reuses the same
 * columns the DSFinV-K path reads from `transaction_items`.
 */
export type DatevItemRow = {
  applied_tax_treatment_code: string;
  line_total_eur: string;
  /**
   * Der Einkaufspreis der Position, `null` wenn keiner hinterlegt ist.
   *
   * Für § 25a ist er nicht Beiwerk, sondern die Bemessungsgrundlage: ohne ihn
   * lässt sich der Verkauf nicht in seine zwei Buchungszeilen teilen.
   */
  acquisition_cost_eur_snapshot: string | null;
};

// ── Integer-cents math (no float; mirrors transactions-ankauf.ts) ───────────
//    Used only to SUM existing NUMERIC(18,2) line totals per treatment group;
//    every leg is read verbatim from the DB, summed in bigint cents, and the
//    group sum re-expressed as a "123.45" string. No rounding ever occurs.


/** "-595.00" → "595.00"; "595.00" → "595.00" (drop the sign, keep magnitude). */
function absEur(eur: string): string {
  const t = eur.trim();
  return t.startsWith('-') ? t.slice(1) : t;
}

/**
 * STORNO polarity. A storno is a NEW transaction row with a NEGATIVE total_eur
 * (DB CHECK `transactions_sign_discipline`: total_eur <= 0 on a storno). DATEV's
 * `Umsatz` field must be a POSITIVE magnitude — both DATEV specifications
 * forbid a negative amount outright. `storno_of_transaction_id` is not on the
 * lean TxRow the exporter reads, so the negative total is the storno signal
 * (set on storno rows only).
 *
 * ── 19.08.2026: wie ein Storno WIRKLICH gebucht wird ─────────────────────
 *
 * Bis heute kippte der Export die Stornozeile auf die Gegenseite (S↔H) und
 * nannte das im Kommentar „eine saubere Umkehrzeile, die ein Prüfer
 * akzeptiert". Beides war falsch, und die Quellen sind DATEVs eigene:
 *
 *   1. Die Musterdatei im Haus (`tests/vorlagen/EXTF_…_Muster.csv`) führt
 *      Feld 118 „Generalumkehr (GU)" und besetzt es auf 5 von 54 Zeilen mit
 *      `1`. Unser Export hat dieses Feld noch nie geschrieben.
 *
 *   2. Dok.-Nr. 1070379, Kap. 3.2, definiert beide Wege wörtlich: die
 *      manuelle Umbuchung läuft „auf der anderen Soll-/Haben-Seite" und
 *      FLIESST IN DIE JAHRESVERKEHRSZAHLEN; die Generalumkehr bucht „mit
 *      Minuszeichen auf der GLEICHEN Soll-/Haben-Seite", beide ergeben dort
 *      den Wert 0, „die Jahresverkehrszahlen werden nicht erhöht. Nur so wird
 *      die Nachvollziehbarkeit der Aktion gewährleistet."
 *
 * Also: GLEICHE Seite wie das Original, positiver Betrag, Feld 118 = 1. Die
 * Marke ist der einzige Träger des Vorzeichens.
 *
 * Die Kippung war nicht nur unschön, sie stand der Marke im Weg: eine
 * gekippte Zeile MIT Marke wirkt als Minus auf der Gegenseite — sie bucht
 * den stornierten Verkauf ein zweites Mal. Und ohne Marke blähte die Kippung
 * die Verkehrszahlen auf: ein Verkauf über 500,00 EUR, am selben Tag
 * storniert, liess Konto 8400 mit 1.000,00 Jahresverkehrszahl bei 0,00 echtem
 * Umsatz dastehen — genau die Zahl, die ein Prüfer bei der Kassennachschau
 * gegen das Belegjournal liest.
 */
function isStornoRow(totalEur: string): boolean {
  return totalEur.trim().startsWith('-');
}

/**
 * ── 19.08.2026: der Storno wechselt die Seite NICHT mehr ─────────────────
 *
 * Bis heute kippte diese Funktion die Stornozeile auf die Gegenseite. Das war
 * die halbe Wahrheit, und mit der Generalumkehr-Marke zusammen wäre sie zur
 * ganzen Katastrophe geworden: DATEV (Dok.-Nr. 1070379, Kap. 3.2) definiert
 * die Generalumkehr als Buchung „mit Minuszeichen auf der GLEICHEN
 * Soll-/Haben-Seite". Feld 118 = 1 heisst also: dieser Betrag wirkt negativ
 * auf der angegebenen Seite.
 *
 *     Verkauf:  500,00 S  (Kasse Soll, Erlöse Haben)
 *     Storno mit gekippter Seite UND Marke:  -500,00 auf H = +500,00 auf S
 *       → der Storno bucht den Verkauf ein ZWEITES Mal.
 *     Storno mit GLEICHER Seite und Marke:   -500,00 auf S
 *       → beide Seiten heben sich auf, die Jahresverkehrszahlen wachsen nicht.
 *
 * Da der Umsatz in Feld 1 nie negativ sein darf (beide DATEV-Spezifikationen
 * verlangen einen positiven Betrag), ist die Marke der EINZIGE Träger des
 * Vorzeichens — und die Seite muss stehen bleiben, damit sie das Richtige
 * negiert.
 */
function debitCreditFor(originalSide: 'S' | 'H', _storno: boolean): 'S' | 'H' {
  return originalSide;
}

/**
 * A tz-aware timestamp → its Europe/Berlin calendar date as `YYYY-MM-DD`.
 * Mirrors the DB `berlin_business_day()` ((ts AT TIME ZONE 'Europe/Berlin')::date,
 * DST-correct) EXACTLY, so the DATEV Belegdatum matches the Berlin business day
 * the export is scoped to (`WHERE berlin_business_day(finalized_at) = business_day`).
 * The UTC date would book a post-midnight-Berlin sale to the previous day.
 */
function berlinDate(ts: Date | string): string {
  const d = ts instanceof Date ? ts : new Date(ts);
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string): string => p.find((x) => x.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/**
 * Map one transaction to a DATEV booking line.
 * VERKAUF: Kasse (Soll) an the per-treatment Erlöskonto, with the matching
 * BU-Schlüssel. ANKAUF: Wareneingang an Kasse (no output VAT). A STORNO row
 * (negative total) reverses the original: same accounts/BU, flipped S→H, and a
 * POSITIVE Umsatz. Exported for the fiscal-mapping unit test.
 */
export function toDatevRow(
  tx: TxRow,
  geldkonto: string = kontoNummer(VORGABEPLAN, 'kasse'),
  plan: Kontenplan = VORGABEPLAN,
): DATEVRow {
  const isAnkauf = tx.direction === 'ANKAUF';
  // Sale: Geldkonto an Erlöse (debit). Purchase: Wareneingang an Geldkonto.
  //
  // `geldkonto` ist die Seite, auf der das GELD steht — bei einem Verkauf die
  // Sollseite, bei einem Ankauf die Habenseite. Der Vorgabewert Kasse gilt nur
  // für den Barfall; welches Konto es wirklich ist, entscheidet die Zahlart,
  // und das tut `toDatevRows` weiter unten. Vor dem 26.07.2026 gab es diesen
  // Parameter nicht, und deshalb wanderte auch jede Kartenzahlung in die Kasse.
  const account = isAnkauf ? kontoNummer(plan, 'wareneingang') : geldkonto;
  let contraAccount: string;
  let taxKey: string;
  if (isAnkauf) {
    contraAccount = geldkonto;
    taxKey = ''; // Ankauf from a private seller — no output VAT key.
  } else {
    const m = erloesFuer(tx.tax_treatment_code);
    contraAccount = kontoNummer(plan, m.konto);
    taxKey = m.bu;
  }
  const storno = isStornoRow(tx.total_eur);
  return {
    // DATEV Umsatz is always a positive magnitude; the storno's negativity is
    // expressed SOLELY by the Generalumkehr mark below, not by a minus sign
    // and not by a flipped side (Dok.-Nr. 1070379 — see `isStornoRow`).
    amountEur: absEur(tx.total_eur),
    // Storno wie Original auf derselben Seite — die Marke macht das Minus.
    debitCredit: debitCreditFor('S', storno),
    account,
    contraAccount,
    // Omit the optional BU-Schlüssel entirely when empty (exactOptionalPropertyTypes).
    ...(taxKey === '' ? {} : { taxKey }),
    date: berlinDate(tx.finalized_at), // Europe/Berlin business day → DDMM in exporter
    reference: tx.receipt_locator,
    bookingText: `${tx.is_rueckgabe ? 'RUECKGABE ' : storno ? 'STORNO ' : ''}${tx.direction} ${tx.receipt_locator} (${tx.tax_treatment_code})`,
    // Feld 118. Nur auf der Stornozeile — siehe `isStornoRow`.
    ...(storno ? { generalumkehr: true } : {}),
  };
}

/**
 * Map one transaction to its DATEV booking line(s).
 *
 * Single-treatment receipts (and every ANKAUF) produce EXACTLY ONE row, byte-
 * identical to `toDatevRow` — so the existing behaviour is unchanged. A MIXED
 * VERKAUF (transaction tax_treatment_code = 'MIXED', or more robustly any sale
 * whose items span >1 applied treatment) is split: the items are grouped by
 * `applied_tax_treatment_code`, each group's `line_total_eur` summed in integer
 * cents, and ONE row emitted per group on that treatment's correct SKR03
 * Gegenkonto + BU-Schlüssel. This ends the wrong collapse where a §25a portion
 * of a mixed receipt got booked to 8400 (19% bucket).
 *
 * The split rows reconcile to the receipt total by construction — they sum the
 * very same `line_total_eur` figures the receipt total is built from. The
 * Buchungstext names the treatment + leg so each portion is identifiable in
 * DATEV (e.g. `VERKAUF RCP-… (MARGIN_25A 1/2)`).
 *
 * Grouping is ORDER-STABLE: groups appear in the order their treatment is first
 * seen across the (display_order-sorted) items, so the export is deterministic.
 */
/**
 * Eine Buchungszeile unserer Bauart in DATEVs 125-Feld-Zeile übersetzen.
 *
 * Hier wird sichtbar, warum die alte zwölfspaltige Fassung nicht bloss
 * unvollständig war: der Buchungstext sass auf Position 12, wo in Wahrheit
 * „Belegfeld 2" steht, und der Betrag trug Anführungszeichen. Beides fällt
 * jetzt weg, weil die Zielposition einen NAMEN hat.
 */
/**
 * Eine Bargeldbewegung als DATEV-Zeile.
 *
 * ⚠️ Soll und Haben stehen schon fest; hier wird nichts mehr entschieden.
 * `SOLL_HABEN` ist immer `S`, weil `sollkonto` und `gegenkonto` die Richtung
 * bereits tragen — ein zweites Vorzeichen wäre dieselbe Buchung zweimal.
 * Es gibt KEINEN Buchungsschlüssel: ein Geldtransit ist nicht steuerbar.
 */
export function bewegungsZeile(
  b: { betragEur: string; sollkonto: string; gegenkonto: string; belegfeld1: string; buchungstext: string },
  tag: string,
): DatevZeile {
  const z = new Map<number, string>();
  z.set(FELD.UMSATZ, zuDatevBetrag(b.betragEur));
  z.set(FELD.SOLL_HABEN, 'S');
  z.set(FELD.WKZ_UMSATZ, 'EUR');
  z.set(FELD.KONTO, b.sollkonto);
  z.set(FELD.GEGENKONTO, b.gegenkonto);
  z.set(FELD.BELEGDATUM, zuBelegdatum(tag));
  z.set(FELD.BELEGFELD_1, b.belegfeld1);
  z.set(FELD.BUCHUNGSTEXT, b.buchungstext.slice(0, 60));
  return z;
}

export function zuDatevZeile(r: DATEVRow): DatevZeile {
  const z = new Map<number, string>();
  z.set(FELD.UMSATZ, zuDatevBetrag(r.amountEur));
  z.set(FELD.SOLL_HABEN, r.debitCredit);
  z.set(FELD.WKZ_UMSATZ, 'EUR');
  z.set(FELD.KONTO, r.account);
  z.set(FELD.GEGENKONTO, r.contraAccount);
  if (r.taxKey) z.set(FELD.BU_SCHLUESSEL, r.taxKey);
  z.set(FELD.BELEGDATUM, zuBelegdatum(r.date));
  z.set(FELD.BELEGFELD_1, r.reference);
  z.set(FELD.BUCHUNGSTEXT, r.bookingText.slice(0, 60));
  // Nur auf der Stornozeile gesetzt. Auf einer normalen Zeile bleibt das Feld
  // leer — genau wie in DATEVs Musterdatei, wo 38 von 54 Zeilen es leer lassen.
  if (r.generalumkehr) z.set(FELD.GENERALUMKEHR, '1');
  return z;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  EINE POSITION IN IHRE BUCHUNGSANTEILE ZERLEGEN
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Für jede Steuerbehandlung ausser § 25a ist das ein Anteil: der Zeilenbetrag.
 *
 * Für § 25a sind es zwei. Bis zum 27.07.2026 war es auch dort einer, und das
 * war der teuerste stille Fehler im ganzen Export: der VOLLE Verkaufspreis ging
 * auf ein Konto OHNE Umsatzsteuer und ohne Buchungsschlüssel. Auf Romans Daten
 * gemessen: 63 Positionen, 43.266,46 EUR Umsatz — und **5.393,19 EUR
 * Umsatzsteuer, die in keiner DATEV-Zeile vorkamen**. Der Steuerberater sah
 * einen durchweg steuerfreien Erlös.
 *
 * ── Warum gedeckelt wird, statt einfach EK und Marge zu nehmen ────────────
 *
 * Naheliegend wäre: Einkaufspreis auf 8193, `margin_eur` auf 8191. Bei einem
 * VERLUSTVERKAUF geht das schief. Gemessen, echte Zeile:
 *
 *     Verkaufspreis  1.200,00     Einkaufspreis 13.000,00     Marge 0,00
 *
 * Der Einkaufspreis allein wäre das Elffache des Belegbetrags. Der Beleg ginge
 * nicht mehr auf, und in DATEV stünde ein erfundener Erlös von 13.000 EUR.
 *
 * Deshalb: der Einkaufsanteil ist `min(Einkaufspreis, Zeilenbetrag)`, die Marge
 * der REST. Damit gilt zweierlei ohne Ausnahme —
 *
 *   1. beide Anteile ergeben zusammen IMMER exakt den Zeilenbetrag, und
 *   2. bei Gewinn ist der Rest genau `Verkaufspreis − Einkaufspreis`,
 *      bei Verlust genau 0.
 *
 * Auf allen 63 Positionen der Produktion nachgemessen: der Rest trifft
 * `margin_eur` auf den Cent (33.778,61 EUR), und keine einzige Zeile geht auf.
 *
 * ── Das Vorzeichen ───────────────────────────────────────────────────────
 *
 * Gerechnet wird auf Beträgen ohne Vorzeichen, damit ein Storno spiegelbildlich
 * zerfällt statt in die Deckelung zu laufen. Heute trägt keine § 25a-Position
 * ein negatives Vorzeichen; das ist ein Zustand der Daten, keine Zusage.
 */
export function teileZeileAuf(
  it: DatevItemRow,
  beleg: string,
): { code: string; cents: bigint }[] {
  const gesamt = eurToCents(it.line_total_eur);
  if (it.applied_tax_treatment_code !== 'MARGIN_25A') {
    return [{ code: it.applied_tax_treatment_code, cents: gesamt }];
  }

  // ⚠️ `== null` fängt BEIDE Fälle: die Datenbank liefert `null`, ein Aufrufer
  // mit einer alten Zeilenform liefert `undefined`. Der erste Entwurf prüfte
  // nur auf `null` — und stürzte beim zweiten Fall mit einem nichtssagenden
  // „Cannot read properties of undefined" ab, statt den Grund zu nennen.
  // Ein Absturz an dieser Stelle ist nicht schlimmer als eine falsche Buchung,
  // aber er verschweigt, WAS fehlt.
  const ekRoh = it.acquisition_cost_eur_snapshot;
  if (ekRoh === null || ekRoh === undefined) {
    throw new MargeOhneEinkaufspreisError(beleg);
  }

  const negativ = gesamt < 0n;
  const betrag = negativ ? -gesamt : gesamt;
  const roherEk = eurToCents(ekRoh);
  const ek = roherEk < 0n ? -roherEk : roherEk;

  const einkaufsanteil = ek < betrag ? ek : betrag;
  const marge = betrag - einkaufsanteil;
  const mitVorzeichen = (c: bigint): bigint => (negativ ? -c : c);

  // Ein Anteil von null Cent erzeugt keine Buchungszeile — er trüge keine
  // Aussage und stünde dem Prüfer nur im Weg.
  const anteile: { code: string; cents: bigint }[] = [];
  if (einkaufsanteil > 0n) {
    anteile.push({ code: 'MARGIN_25A_EINKAUF', cents: mitVorzeichen(einkaufsanteil) });
  }
  if (marge > 0n) {
    anteile.push({ code: 'MARGIN_25A_MARGE', cents: mitVorzeichen(marge) });
  }
  return anteile;
}

export function toDatevRows(
  tx: TxRow,
  items: DatevItemRow[],
  zahlungen: readonly Zahlung[],
  plan: Kontenplan = VORGABEPLAN,
): DATEVRow[] {
  // ── Die Steuerseite: welche Behandlungen trägt der Beleg ────────────────
  // ANKAUF kennt keine Aufteilung (kein Ausgangsumsatzsteuer-Schlüssel), und
  // ohne Positionen gibt es nichts, wonach sich teilen liesse. In beiden
  // Fällen ist es genau eine Gruppe über den ganzen Belegbetrag.
  const behandlungen: Behandlungsanteil[] = [];
  if (tx.direction === 'ANKAUF' || items.length === 0) {
    // ⚠️ 27.07.2026, im gebauten Abbild entdeckt: hier war die Aufteilung noch
    // zu umgehen. Ein VERKAUF nach § 25a OHNE Positionen hätte den vollen
    // Belegbetrag auf das alte Sammelkonto gelegt — steuerfrei, ohne
    // Buchungsschlüssel. Also genau der Befund, nur in einer Ecke.
    //
    // Gemessen sind es heute null solche Belege. Das ist ein Zustand der
    // Daten, keine Zusage: ohne Positionen gibt es keinen Einkaufspreis, und
    // ohne den ist die Marge nicht belegbar (§ 25a Abs. 6 UStG).
    if (tx.direction === 'VERKAUF' && tx.tax_treatment_code === 'MARGIN_25A') {
      throw new MargeOhneEinkaufspreisError(tx.receipt_locator);
    }
    behandlungen.push({ code: tx.tax_treatment_code, cents: eurToCents(tx.total_eur) });
  } else {
    const order: string[] = [];
    const sumByTreatment = new Map<string, bigint>();
    for (const it of items) {
      for (const teil of teileZeileAuf(it, tx.receipt_locator)) {
        if (!sumByTreatment.has(teil.code)) {
          order.push(teil.code);
          sumByTreatment.set(teil.code, 0n);
        }
        sumByTreatment.set(teil.code, (sumByTreatment.get(teil.code) ?? 0n) + teil.cents);
      }
    }
    for (const code of order) {
      behandlungen.push({ code, cents: sumByTreatment.get(code) ?? 0n });
    }
  }

  // ── Die Geldseite: welche Zahlarten haben ihn beglichen ─────────────────
  // Ohne Zahlungszeile GIBT ES KEINE ZEILE. Bar zu unterstellen wäre die
  // bequeme Antwort und genau der Fehler, der hier behoben wird: die Kasse
  // trüge dann wieder Geld, das nie in ihr lag. Das Schema erzwingt beim
  // Abschluss mindestens eine Zahlung (`minItems: 1`), dieser Fall ist also
  // kein Alltag, sondern ein Datenschaden — und der gehört gemeldet.
  if (zahlungen.length === 0) {
    throw new ZahlartNichtKontiertError(
      `Zum Beleg ${tx.receipt_locator} ist keine Zahlung gespeichert. Ohne sie ist ` +
        'nicht feststellbar, welches Konto das Geld aufgenommen hat, und es wurde ' +
        'KEINE DATEV-Datei erzeugt.',
    );
  }

  const anteile = kreuzeZahlungenMitBehandlungen(zahlungen, behandlungen, plan);
  const storno = isStornoRow(tx.total_eur);
  // Der Buchungstext bekommt nur dann Zusätze, wenn er sie BRAUCHT: bei einer
  // einzigen Zeile bleibt er Wort für Wort der alte.
  const mehrereBehandlungen = behandlungen.length > 1;
  const mehrereZahlarten = zahlungen.length > 1;

  return anteile.map((a, idx) => {
    // toDatevRow trägt Richtung, Datum, Beleg und die Storno-Polarität; das
    // Geldkonto kommt aus der Zahlart, das Erlöskonto aus der Behandlung.
    const base = toDatevRow(tx, a.sollkonto, plan);
    const m =
      tx.direction === 'ANKAUF'
        ? null
        : erloesFuer(a.behandlungscode);
    const zusatz = [
      mehrereBehandlungen ? `${a.behandlungscode} ${idx + 1}/${anteile.length}` : '',
      mehrereZahlarten ? ZAHLART_KURZ[a.zahlart] ?? a.zahlart : '',
    ]
      .filter(Boolean)
      .join(' ');
    return {
      amountEur: centsToEur(a.cents),
      debitCredit: base.debitCredit,
      account: base.account,
      contraAccount: m ? kontoNummer(plan, m.konto) : base.contraAccount,
      ...(m && m.bu !== '' ? { taxKey: m.bu } : {}),
      date: base.date,
      reference: base.reference,
      bookingText: `${tx.is_rueckgabe ? 'RUECKGABE ' : storno ? 'STORNO ' : ''}${tx.direction} ${tx.receipt_locator} (${
        zusatz === '' ? a.behandlungscode : zusatz
      })`,
      // ⚠️ Feld für Feld kopiert heisst: ein NEUES Feld auf `base` fällt hier
      // still unter den Tisch. Genau so hätte die Generalumkehr-Marke den
      // aufgeteilten Storno verpasst — die einfache Stornozeile trüge sie, die
      // gesplittete nicht.
      ...(base.generalumkehr ? { generalumkehr: true } : {}),
    };
  });
}

const closingExportRoute: FastifyPluginAsync = async (app) => {
  // ── GET /api/closings — recent daily closings (ADMIN) ────────────────────
  app.get(
    '/api/closings',
    {
      schema: {
        tags: ['closings'],
        summary: 'Kassenabschlüsse auflisten, wahlweise über einen Zeitraum (ADMIN).',
        description:
          'Neueste zuerst (nach business_day): Zählungen, Netto-Summen, Kassendifferenz, ' +
          'TSE-Stand und Abschlusszustand. Ohne Zeitraum kommen die 90 neuesten. ' +
          'Mit `from` und `to` kommt JEDER Geschäftstag des Zeitraums, auch ein Jahr ' +
          'zurück — die drei Steuer-Exporte brauchen die id von hier, und ein Prüfer ' +
          'fragt nach alten Monaten. `gesamt` nennt immer die volle Trefferzahl, damit ' +
          'ein Klient „steht nicht auf dieser Seite" nie mit „gibt es nicht" verwechselt.',
        querystring: ClosingListQuery,
        response: { 200: ClosingListResponse, 401: ErrorResponse, 403: ErrorResponse },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'READONLY');

      const q = req.query as { from?: string; to?: string; limit?: number; offset?: number };
      const limit = q.limit ?? 90;
      const offset = q.offset ?? 0;
      const von = q.from ?? null;
      const bis = q.to ?? null;

      // Ein Filter, zwei Abfragen, DIESELBE Bedingung. Zwei getippte
      // Bedingungen wären zwei Listen, die auseinanderlaufen.
      const wo = sql`
        WHERE (${von}::date IS NULL OR business_day >= ${von}::date)
          AND (${bis}::date IS NULL OR business_day <= ${bis}::date)`;

      const [gesamtZeile] = (await app.db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM daily_closings ${wo}
      `)) as unknown as { n: string }[];
      const gesamt = Number(gesamtZeile?.n ?? '0');

      const rows = (await app.db.execute<ClosingRow>(sql`
        SELECT id::text AS id,
               business_day::text AS business_day,
               state::text AS state,
               verkauf_count, ankauf_count, storno_count,
               net_verkauf_eur::text AS net_verkauf_eur,
               net_ankauf_eur::text  AS net_ankauf_eur,
               cash_drawer_variance_eur::text AS cash_variance_eur,
               tse_failed_count, tse_pending_count,
               finalized_at
          FROM daily_closings
        ${wo}
         ORDER BY business_day DESC
         LIMIT ${limit} OFFSET ${offset}
      `)) as unknown as ClosingRow[];

      const items = rows.map((r) => ({
        id: r.id,
        businessDay: r.business_day,
        state: r.state === 'FINALIZED' ? ('FINALIZED' as const) : ('COUNTING' as const),
        verkaufCount: Number(r.verkauf_count),
        ankaufCount: Number(r.ankauf_count),
        stornoCount: Number(r.storno_count),
        netVerkaufEur: r.net_verkauf_eur,
        netAnkaufEur: r.net_ankauf_eur,
        cashVarianceEur: r.cash_variance_eur,
        tseFailedCount: Number(r.tse_failed_count),
        tsePendingCount: Number(r.tse_pending_count),
        finalizedAt: r.finalized_at ? new Date(r.finalized_at).toISOString() : null,
      }));

      return reply.status(200).send({
        items,
        gesamt,
        weitere: offset + items.length < gesamt,
      });
    },
  );

  app.get<{ Params: { id: string }; Querystring: { kontenrahmen?: string } }>(
    '/api/closings/:id/export/datev',
    {
      schema: {
        tags: ['closings'],
        summary: 'Download a daily closing as a DATEV-importable CSV (ADMIN + step-up).',
        description:
          'Returns text/plain CSV (EXTF Buchungsstapel header + one booking line ' +
          'per finalized transaction of the closing business day). ' +
          '`?kontenrahmen=SKR03|SKR04` zieht denselben Tag im gewählten Kontenrahmen; ' +
          'ohne den Parameter gilt die gespeicherte Einstellung `datev.sachkontenrahmen`. ' +
          'Ein unbekannter Wert wird mit 400 und einer deutschen Meldung abgewiesen. ' +
          'Die Wahl wird NICHT gespeichert, sie gilt für diesen einen Abruf.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        // Absichtlich `Type.String()` und nicht ein Union aus zwei Literalen:
        // ein falscher Wert soll die DEUTSCHE Meldung aus `normalisiereRahmen`
        // bekommen, nicht Fastifys englischen Schemafehler.
        querystring: Type.Object({ kontenrahmen: Type.Optional(Type.String({ maxLength: 10 })) }),
        response: {
          400: ErrorResponse,
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'READONLY');
      requireStepUp(req);

      const { id } = req.params;

      const closingRows = await app.db.execute<{ business_day: string; state: string }>(sql`
        SELECT business_day::text AS business_day, state::text AS state
          FROM daily_closings
         WHERE id = ${id}
         LIMIT 1`);
      const closing = closingRows[0];
      if (!closing) {
        throw new ClosingNotFoundError(`Daily closing ${id} not found.`);
      }
      if (closing.state !== 'FINALIZED') {
        throw new ClosingNotFinalizedError(
          `Der Tagesabschluss für ${closing.business_day} ist noch nicht finalisiert und kann nicht als DATEV exportiert werden.`,
        );
      }

      // All transactions whose Berlin business day matches the closing.
      const txRows = await app.db.execute<TxRow & { id: string }>(sql`
        SELECT id::text AS id,
               total_eur, direction::text AS direction, tax_treatment_code,
               receipt_locator, finalized_at,
               (rueckgabe_zu_transaction_id IS NOT NULL) AS is_rueckgabe
          FROM transactions
         WHERE berlin_business_day(finalized_at) = ${closing.business_day}::date
         ORDER BY finalized_at ASC`);

      // Per-line treatment + total, so a MIXED receipt books per treatment.
      // (Same columns + array-literal binding the DSFinV-K path uses.)
      const txIds = txRows.map((t) => t.id);
      const txIdArray = `{${txIds.join(',')}}`;
      const itemRows =
        txIds.length === 0
          ? []
          : ((await app.db.execute<DatevItemRow & { transaction_id: string }>(sql`
              SELECT transaction_id::text AS transaction_id,
                     applied_tax_treatment_code,
                     line_total_eur::text AS line_total_eur,
                     acquisition_cost_eur_snapshot::text AS acquisition_cost_eur_snapshot
                FROM transaction_items
               WHERE transaction_id = ANY(${txIdArray}::uuid[])
               ORDER BY transaction_id, display_order ASC`)) as unknown as (DatevItemRow & {
              transaction_id: string;
            })[]);

      const itemsByTx = new Map<string, DatevItemRow[]>();
      for (const it of itemRows) {
        const arr = itemsByTx.get(it.transaction_id) ?? [];
        arr.push({
          applied_tax_treatment_code: it.applied_tax_treatment_code,
          line_total_eur: it.line_total_eur,
          acquisition_cost_eur_snapshot: it.acquisition_cost_eur_snapshot,
        });
        itemsByTx.set(it.transaction_id, arr);
      }

      // ── Die Zahlarten, ohne die das Sollkonto geraten wäre ───────────────
      // Bis zum 26.07.2026 kam `transaction_payments` in dieser ganzen Route
      // nicht ein einziges Mal vor: jeder Verkauf ging gegen Konto 1000 Kasse,
      // auch die Kartenzahlung. Reihenfolge nach `created_at`, damit derselbe
      // Beleg bei jedem Abruf dieselbe Datei ergibt.
      const zahlungsRows =
        txIds.length === 0
          ? []
          : ((await app.db.execute<{
              transaction_id: string;
              payment_method: string;
              amount_eur: string;
            }>(sql`
              SELECT transaction_id::text AS transaction_id,
                     payment_method::text AS payment_method,
                     amount_eur::text AS amount_eur
                FROM transaction_payments
               WHERE transaction_id = ANY(${txIdArray}::uuid[])
               ORDER BY transaction_id, created_at ASC, id ASC`)) as unknown as {
              transaction_id: string;
              payment_method: string;
              amount_eur: string;
            }[]);

      const zahlungenByTx = new Map<string, Zahlung[]>();
      for (const z of zahlungsRows) {
        const arr = zahlungenByTx.get(z.transaction_id) ?? [];
        arr.push({ zahlart: z.payment_method, betragEur: z.amount_eur });
        zahlungenByTx.set(z.transaction_id, arr);
      }

      // ── Die fünf Angaben des Steuerberaters ─────────────────────────────
      // Fehlt eine, gibt es KEINE Datei, und die Meldung nennt alle fehlenden
      // auf einmal. Ein Stapel mit leeren Ordnungsbegriffen sieht aus wie ein
      // Export und ist keiner.
      const mandant = await ladeDatevMandant(app.db, req.query.kontenrahmen);

      // ── Der Kontenplan, den DIESER Abruf benutzt ────────────────────────
      // Er entsteht aus der Vorlage des gewählten Rahmens, überschrieben von
      // dem, was der Inhaber gespeichert hat. Kopf-Feld 27 nennt denselben
      // Rahmen (`mandant.sachkontenrahmen`), und Kopf-Feld 14 die
      // Sachkontenlänge — beide wandern in `baueKopfzeile` mit, sodass Datei
      // und Buchungszeilen nicht auseinanderfallen können.
      const plan = await ladeKontenplan(
        app.db,
        normalisiereRahmen(`SKR${mandant.sachkontenrahmen}`),
      );

      const datevRows = txRows.flatMap((tx) =>
        toDatevRows(tx, itemsByTx.get(tx.id) ?? [], zahlungenByTx.get(tx.id) ?? [], plan),
      );

      /**
       * ⚠️ DIE BEWEGUNGEN DER LADE, DIE BIS HEUTE GAR KEINE ZEILE BEKAMEN
       *
       * Gemessen am 05.08.2026: eine Bankabschöpfung über 300,00 und eine
       * Barausgabe über 50,00 erzeugten NULL Buchungszeilen. Konto 1000 bewegte
       * sich um −100,00, die Schublade um −150,00, und die Lücke von 50,00 EUR
       * konnte ein Prüfer mit nichts erklären.
       *
       * ── ⛔ 08.08.2026: SIE GEHOEREN IHREM EIGENEN TAG ──────────────────
       *
       * Hier stand:
       *
       *     JOIN shifts s ON s.id = cm.shift_id
       *    WHERE s.status = 'CLOSED'
       *      AND berlin_business_day(s.closed_at) = <tag>
       *
       * Also: die Bewegung gehoerte dem Tag, an dem ihre SCHICHT geschlossen
       * wurde. Gemessen sind Schichten ueber mehrere Tage der Normalfall (das
       * Geraet steht nachts in der Theke, eine Schicht lief 33 Tage). Eine
       * Bankabschoepfung vom Ersten erschien dann im Auszug des Dreiunddreissig-
       * sten -- und im Auszug ihres EIGENEN Tages in KEINER Zeile.
       *
       * § 146 Abs. 1 Satz 2 AO verlangt die taegliche Aufzeichnung. Ein Blatt,
       * auf dem eine Barbewegung ein Datum traegt, das ihrem eigenen
       * Zeitstempel widerspricht, verletzt das direkt vor den Augen des
       * Pruefers.
       *
       * Zwei Punkte, die den JOIN ueberfluessig machen:
       *   · `cash_movements.shift_id` ist NOT NULL, der JOIN filtert also
       *     nichts weg, was es zu behalten gaebe.
       *   · `s.status = 'CLOSED'` liess eine Bewegung aus einer noch OFFENEN
       *     Schicht ganz aus dem Auszug fallen. Der Tag ist aber
       *     abgeschlossen; die Bewegung gehoert hinein.
       *
       * ⚠️ Nur DATEV. Der Kassenbericht bleibt vorerst unberuehrt: dort haengt
       * der Anfangsbestand an derselben Schichtzuordnung, und eine halbe
       * Umstellung druckt einen erwarteten Endbestand von minus 300,00 EUR.
       * Eine ausgerechnete FALSCHE Zahl ist schlimmer als eine fehlende. Ein
       * DATEV-Satz ist dagegen Kasse gegen Geldtransit und traegt sich selbst.
       */
      const bewegungsRowsDatev = await app.db.execute<{
        direction: string;
        amount_eur: string;
        reason: string;
        id: string;
      }>(sql`
        SELECT cm.direction::text AS direction,
               cm.amount_eur::text AS amount_eur,
               cm.reason,
               cm.id::text AS id
          FROM cash_movements cm
         WHERE berlin_business_day(cm.created_at) = ${closing.business_day}::date
         ORDER BY cm.created_at ASC`);

      const bewegungsZeilen = baueBewegungszeilen(
        bewegungsRowsDatev.map((b) => ({
          direction: b.direction,
          amountEur: b.amount_eur,
          reason: b.reason,
          // Der Berater muss die Zeile wiederfinden. Die Kennung der Bewegung
          // ist der einzige Ordnungsbegriff, den es dafür gibt.
          belegfeld: `KB-${b.id.slice(0, 8)}`,
        })),
        plan,
      );

      /**
       * ⚠️ UND DIE BARAUSGABEN WERDEN ABGEWIESEN, NICHT GERATEN
       *
       * Seit Wanderung 0133 weiss eine Ausgabe, womit sie bezahlt wurde. Welches
       * AUFWANDSKONTO zu „Miete" oder „Versand" gehört, ist aber eine
       * Entscheidung des Steuerberaters, und für `SONSTIGES` gibt es überhaupt
       * keine richtige Vorgabe.
       *
       * Solange kein Konto je Art hinterlegt ist, bricht der Export ab und sagt
       * WELCHE Art fehlt. Das ist dieselbe Regel, nach der `datev-kontierung.ts`
       * seit jeher eine unbekannte Zahlart abweist: lieber keine Datei als eine
       * Zeile auf einem falschen Konto.
       */
      const barausgabeZeilen = await app.db.execute<{
        kategorie: string;
        cent: number;
        note: string | null;
        id: string;
      }>(sql`
        SELECT category::text AS kategorie,
               amount_cents AS cent,
               note,
               id::text AS id
          FROM operating_expenses
         WHERE business_day = ${closing.business_day}::date
           AND zahlweg = 'BAR'
         ORDER BY created_at ASC`);

      const ausgabenZeilen = baueAusgabenzeilen(
        barausgabeZeilen.map((a) => ({
          kategorie: a.kategorie,
          betragCent: Number(a.cent),
          notiz: a.note,
          belegfeld: `BA-${a.id.slice(0, 8)}`,
        })),
        plan,
      );

      const zeitraum = { von: closing.business_day, bis: closing.business_day };

      // ── KEIN ENTWURFSVERMERK MEHR (26.07.2026, Wanderung 0117) ──────────
      // Hier stand bis heute ein „ENTWURF" vor der Bezeichnung, solange
      // Beraternummer und Mandantennummer nur die Platzhalter aus Wanderung
      // 0115 waren. Der Vermerk war ein Pflaster auf der falschen Wunde: er
      // liess eine Datei ohne echte Anschrift HINAUS und schrieb „Entwurf"
      // darauf. Seit 0117 gibt es die Platzhalter nicht mehr, `ladeDatevMandant`
      // oben verweigert ohne die echten Zahlen — die Datei geht gar nicht erst
      // hinaus, und der Vermerk hatte keinen erreichbaren Fall mehr.
      const csv = baueBuchungsstapel(
        mandant,
        zeitraum,
        `Kasse ${closing.business_day}`,
        [
          ...datevRows.map(zuDatevZeile),
          ...bewegungsZeilen.map((b) => bewegungsZeile(b, closing.business_day)),
          ...ausgabenZeilen.map((b) => bewegungsZeile(b, closing.business_day)),
        ],
        new Date(),
      );

      // ── Die eigene Datei prüfen, BEVOR sie das Haus verlässt ────────────
      // Der Prüfer ist an DATEVs eigener Musterdatei geeicht: er lässt sie
      // fehlerfrei durch. Meldet er über UNSERE Datei etwas, ist es ein
      // echter Mangel, und der Berater soll ihn nicht als Erster finden.
      //
      // Der Aufwand ist zu rechtfertigen: die zwölfspaltige Fassung, die es
      // bis zum 26.07.2026 gab, hätte hier sofort angeschlagen und wäre nie
      // ein Jahr lang unentdeckt geblieben.
      const befunde = nurFehler(pruefeBuchungsstapel(csv));
      if (befunde.length > 0) {
        const liste = befunde
          .slice(0, 5)
          .map((f) => `• Zeile ${f.zeile}, Feld ${f.feld}: ${f.text}`)
          .join('\n');
        const rest = befunde.length > 5 ? `\n… und ${befunde.length - 5} weitere.` : '';
        throw new DatevDateiFehlerhaftError(
          `Die erzeugte DATEV-Datei entspricht nicht dem Format und wurde NICHT ` +
            `ausgeliefert. Ein Import beim Steuerberater wäre gescheitert.\n${liste}${rest}`,
        );
      }

      // ── Name und Zeichensatz sind Teil des Vertrags ─────────────────────
      // Der Name muss mit `EXTF_` beginnen, sonst erscheint die Datei in
      // DATEVs Stapelverarbeitung überhaupt nicht (Meldung REW04506) und
      // wirkt, als wäre sie nie angekommen. Er kommt AUS DIESER EINEN
      // STELLE; die Oberflächen erfanden ihn bis zum 26.07.2026 dreimal
      // parallel.
      const filename = datevDateiname(mandant, zeitraum);
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.type('text/csv; charset=windows-1252');
      /*
       * ⛔ DAS KODIEREN GEHOERT IN DEN FEHLERPFAD (19.08.2026, Fund der
       * boeswilligen Pruefung).
       *
       * DATEV EXTF ist Windows-1252. Ein tuerkisches ş, ein polnisches ł oder
       * ein Emoji im Namen eines Lieferanten hat dort keinen Platz —
       * `kodiereAnsi` wirft dann, und zwar MIT der Fundstelle („Zeichen X an
       * Stelle Y"). Diese Zeile stand ausserhalb jeder Behandlung: der Wurf
       * wurde zu einem nackten 500, die Fundstelle war weg, und der Haendler
       * las „unerwarteter Fehler" ueber ein Zeichen, das er selbst getippt
       * hat und sofort haette aendern koennen.
       */
      let bytes: Buffer;
      try {
        bytes = kodiereAnsi(csv);
      } catch (fehler) {
        throw new DatevZeichenNichtKodierbarError(
          fehler instanceof Error
            ? `Die DATEV-Datei enthaelt ein Zeichen, das DATEV nicht kennt (Windows-1252). ${fehler.message} Bitte die genannte Stelle aendern.`
            : 'Die DATEV-Datei enthaelt ein Zeichen, das DATEV nicht kennt (Windows-1252).',
        );
      }
      return reply.status(200).send(bytes);
    },
  );

  // ── GET /api/closings/:id/export/kassenbericht — daily cash report CSV ────
  //    The real `daily_closings` row re-expressed as a German Kassenbericht.
  //    NO recompute / NO fabrication; READ-ONLY. ADMIN + READONLY + step-up.
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/api/closings/:id/export/kassenbericht',
    {
      schema: {
        tags: ['closings'],
        summary:
          'Download a daily closing as a German Kassenbericht, CSV or printable A4 (ADMIN/READONLY + step-up).',
        description:
          'Returns text/plain CSV — the KassenSichV daily cash report built verbatim from ' +
          'the stored daily_closing (counts, net totals, VAT + payment breakdown, cash ' +
          'count/variance, TSE health). No fiscal figure is recomputed. ' +
          '`?format=html` returns the SAME report as a self-contained A4 page with the ' +
          'shop letterhead, for a §146b Kassen-Nachschau where the Prüfer wants paper ' +
          'rather than a spreadsheet. Both renderings read one row builder, so the ' +
          'printed sheet and the imported file cannot disagree.',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        querystring: Type.Object({
          format: Type.Optional(Type.Union([Type.Literal('csv'), Type.Literal('html')])),
        }),
        response: {
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'READONLY');
      requireStepUp(req);

      const { id } = req.params;

      const rows = await app.db.execute<ClosingFullRow>(sql`
        SELECT business_day::text AS business_day,
               state::text AS state,
               verkauf_count, ankauf_count, storno_count,
               gross_verkauf_eur::text AS gross_verkauf_eur,
               storno_verkauf_eur::text AS storno_verkauf_eur,
               rueckgabe_verkauf_eur::text AS rueckgabe_verkauf_eur,
               rueckgabe_count,
               storno_ankauf_eur::text  AS storno_ankauf_eur,
               gross_ankauf_eur::text  AS gross_ankauf_eur,
               net_verkauf_eur::text   AS net_verkauf_eur,
               net_ankauf_eur::text    AS net_ankauf_eur,
               vat_by_treatment, payments_by_method,
               cash_drawer_expected_eur::text AS cash_expected_eur,
               cash_drawer_counted_eur::text  AS cash_counted_eur,
               cash_drawer_variance_eur::text AS cash_variance_eur,
               tse_finished_count, tse_pending_count, tse_failed_count,
               finalized_at
          FROM daily_closings
         WHERE id = ${id}
         LIMIT 1`);
      const r = rows[0];
      if (!r) {
        throw new ClosingNotFoundError(`Daily closing ${id} not found.`);
      }
      if (r.state !== 'FINALIZED') {
        throw new ClosingNotFinalizedError(
          `Der Tagesabschluss für ${r.business_day} ist noch nicht finalisiert und kann nicht als Kassenbericht exportiert werden.`,
        );
      }

      // ── Die fertige, geprüfte Rechnung anschliessen (07.08.2026) ─────────
      // `baueKassenrechnung` (`lib/kassenrechnung.ts`) stand fertig und
      // getestet da, aber nichts fütterte sie mit echten Daten. Die zwei
      // Grössen, die dafür fehlten:
      //
      // `bargeldbewegungen`: alle `cash_movements` der Schichten, die an
      // DIESEM Geschäftstag geschlossen wurden — dieselbe Zuordnung Schicht →
      // Tag, mit der `closings-finalize.ts` `cash_drawer_expected_eur` selbst
      // aufsummiert (`berlin_business_day(closed_at) = business_day`). Eine
      // Schicht, die über Mitternacht läuft, zählt beim Tag ihres
      // Schichtschlusses, nicht bei dem ihrer einzelnen Bewegungen.
      const bewegungsRows = await app.db.execute<{ direction: string; amount_eur: string }>(sql`
        SELECT cm.direction::text AS direction, cm.amount_eur::text AS amount_eur
          FROM cash_movements cm
          JOIN shifts s ON s.id = cm.shift_id
         WHERE s.status = 'CLOSED'
           AND berlin_business_day(s.closed_at) = ${r.business_day}::date
         ORDER BY cm.created_at ASC`);

      // `barauszahlungAnkaufEur`: die BAREN Zahlungen von ANKAUF-Belegen
      // dieses Tages, als positive Grösse — derselbe Zugriff wie
      // `cash_payouts` in `shifts.ts` (ab Zeile 385), hier nach Geschäftstag
      // statt nach einzelner Schicht gefiltert.
      /**
       * ⚠️ DER ANFANGSBESTAND STEHT NICHT IN `cash_movements`
       *
       * Gemessen am 06.08.2026: die Art `OPENING_FLOAT` existiert im
       * Datenbanktyp, aber KEIN Schreibweg im ganzen Haus legt je eine solche
       * Zeile an. `POST /api/shifts/open` schreibt den Betrag allein auf die
       * Schicht.
       *
       * Der erste Anschluss dieser Rechnung las nur `cash_movements` und wies
       * deshalb einen Anfangsbestand von 0,00 aus, dazu eine Abweichung von
       * 1.000,00 EUR, die es gar nicht gab. Ein Blatt, das eine erfundene
       * Lücke zeigt, ist schlimmer als eines ohne: der Händler sucht dann
       * Geld, das nie gefehlt hat.
       *
       * Also von dort, wo die Zahl WIRKLICH steht. Dieselbe Zuordnung Schicht
       * zu Tag wie bei den Bewegungen darüber.
       */
      const [anfangZeile] = await app.db.execute<{ anfang: string }>(sql`
        SELECT COALESCE(SUM(s.opening_float_eur), 0)::text AS anfang
          FROM shifts s
         WHERE s.status = 'CLOSED'
           AND berlin_business_day(s.closed_at) = ${r.business_day}::date`);

      /**
       * Die BAR bezahlten Betriebsausgaben des Tages.
       *
       * ⚠️ NUR `zahlweg = 'BAR'`. Bis zum 06.08.2026 hatte
       * `operating_expenses` gar keine Zahlungsart; alle Zeilen aus dieser
       * Zeit tragen `UNBEKANNT` und werden hier AUSDRÜCKLICH nicht mitgezählt.
       * Sie nachträglich als bar zu buchen hiesse, festgeschriebene
       * Kassenberichte um Beträge zu ändern, die niemand so gemeint hat.
       */
      const [barausgabeZeile] = await app.db.execute<{ bar: string }>(sql`
        SELECT COALESCE(SUM(amount_cents), 0)::text AS bar
          FROM operating_expenses
         WHERE business_day = ${r.business_day}::date
           AND zahlweg = 'BAR'`);
      const [ohneZahlwegZeile] = await app.db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n
          FROM operating_expenses
         WHERE business_day = ${r.business_day}::date
           AND zahlweg = 'UNBEKANNT'`);
      // `amount_cents` ist eine GANZE ZAHL in Cent; die Rechnung erwartet eine
      // Zeichenkette in Euro. Ohne Gleitkomma umgewandelt.
      const barausgabenCent = BigInt(barausgabeZeile?.bar ?? '0');
      const barausgabenEur = `${barausgabenCent / 100n}.${String(barausgabenCent % 100n).padStart(2, '0')}`;

      const [barankaufZeile] = await app.db.execute<{ bar: string }>(sql`
        SELECT COALESCE(SUM(tp.amount_eur), 0)::text AS bar
          FROM transaction_payments tp
          JOIN transactions t ON t.id = tp.transaction_id
         WHERE berlin_business_day(t.finalized_at) = ${r.business_day}::date
           AND t.direction = 'ANKAUF'
           AND tp.payment_method = 'CASH'::payment_method`);

      const input: KassenberichtInput = {
        businessDay: r.business_day,
        state: r.state === 'FINALIZED' ? 'FINALIZED' : 'COUNTING',
        verkaufCount: Number(r.verkauf_count),
        ankaufCount: Number(r.ankauf_count),
        stornoCount: Number(r.storno_count),
        grossVerkaufEur: r.gross_verkauf_eur,
        stornoVerkaufEur: r.storno_verkauf_eur,
        rueckgabeVerkaufEur: r.rueckgabe_verkauf_eur,
        rueckgabeCount: r.rueckgabe_count,
        stornoAnkaufEur: r.storno_ankauf_eur,
        grossAnkaufEur: r.gross_ankauf_eur,
        netVerkaufEur: r.net_verkauf_eur,
        netAnkaufEur: r.net_ankauf_eur,
        vatByTreatment: (r.vat_by_treatment ?? {}) as Record<string, string>,
        paymentsByMethod: (r.payments_by_method ?? {}) as Record<string, string>,
        bargeldbewegungen: bewegungsRows.map((b) => ({
          direction: b.direction,
          amountEur: b.amount_eur,
        })),
        anfangsbestandEur: anfangZeile?.anfang ?? '0.00',
        barausgabenEur,
        ausgabenOhneZahlweg: Number(ohneZahlwegZeile?.n ?? '0'),
        barauszahlungAnkaufEur: barankaufZeile?.bar ?? '0.00',
        cashExpectedEur: r.cash_expected_eur,
        cashCountedEur: r.cash_counted_eur,
        cashVarianceEur: r.cash_variance_eur,
        tseFinishedCount: Number(r.tse_finished_count),
        tsePendingCount: Number(r.tse_pending_count),
        tseFailedCount: Number(r.tse_failed_count),
        finalizedAt: r.finalized_at ? new Date(r.finalized_at).toISOString() : null,
      };

      // Paper for a Kassen-Nachschau. The letterhead is the SAME shop identity
      // the receipt prints (system_settings), so a Prüfer holding a receipt and
      // this report sees one business rather than two.
      if (req.query.format === 'html') {
        const shopRows = (await app.db.execute<{ key: string; value: string | null }>(sql`
          SELECT key, value #>> '{}' AS value FROM system_settings WHERE key LIKE 'shop.%'
        `)) as unknown as { key: string; value: string | null }[];
        const s = new Map(shopRows.map((x) => [x.key, x.value ?? '']));
        const html = renderKassenberichtHtml(input, {
          // KEIN stiller Rueckfall mehr (26.07.2026): ein Kassenbericht mit
          // erfundenem Briefkopf ist schlimmer als ein klarer 409 — der
          // Pruefer hielte sonst den Namen des ERSTEN Kunden fuer diesen Laden.
          name: erzwingeLadenname(s.get('shop.name')),
          addressLine1: s.get('shop.address_line1') ?? '',
          addressLine2: s.get('shop.address_line2') ?? '',
          vatId: s.get('shop.vat_id') ?? '',
          phone: s.get('shop.phone') ?? '',
        });
        reply.type('text/html; charset=utf-8');
        return reply.status(200).send(html);
      }

      const csv = buildKassenberichtCsv(input);
      const filename = `Kassenbericht_${r.business_day}.csv`;
      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.type('text/plain; charset=utf-8');
      return reply.status(200).send(csv);
    },
  );

  // ── GET /api/closings/:id/export/dsfinvk — local DSFinV-K bundle (ZIP) ────
  //    The DFKA-Taxonomie Kassendaten export a Finanzamt requests in a §146b
  //    Kassen-Nachschau (Z3 Datenträgerüberlassung), built LOCALLY from the
  //    real fiscal rows. Same auth as DATEV (ADMIN/READONLY + step-up + mTLS).
  //    READ-ONLY (GoBD): nothing is mutated or recomputed — the generator only
  //    re-expresses existing transactions/items/payments/tse_signatures.
  //
  //    Body encoding:
  //      • default                → raw application/zip (Owner Desktop blob,
  //                                  curl, browser).
  //      • ?encoding=base64       → text/plain base64 of the SAME bytes, for the
  //                                  POS api-client (its file path is text-only;
  //                                  the WebView2 webview decodes base64 → Blob).
  app.get<{ Params: { id: string }; Querystring: { encoding?: string } }>(
    '/api/closings/:id/export/dsfinvk',
    {
      schema: {
        tags: ['closings'],
        summary:
          'Download a daily closing as a local DSFinV-K bundle ZIP (ADMIN/READONLY + step-up).',
        description:
          'Returns a ZIP of the DSFinV-K core taxonomy CSV files (cashpointclosing, ' +
          'bon_kopf, bon_pos, bon_pos_preise, bon_pos_ust, bon_ust, datapayment, tse) ' +
          '+ index.xml, built from the day’s real transactions/items/payments and ' +
          'tse_signatures. CORE, not certified — validate with the official DSFinV-K ' +
          'Prüftool before a real inspection. ?encoding=base64 returns the same bytes ' +
          'base64-encoded as text/plain (for the POS client).',
        params: Type.Object({ id: Type.String({ format: 'uuid' }) }),
        querystring: Type.Object({ encoding: Type.Optional(Type.String()) }),
        response: {
          401: ErrorResponse,
          403: ErrorResponse,
          404: ErrorResponse,
          409: ErrorResponse,
        },
      },
    },
    async (req, reply) => {
      requireAuth(req);
      requireRole(req, 'ADMIN', 'READONLY');
      requireStepUp(req);

      const { id } = req.params;

      const { businessDay, zip } = await baueDsfinvkTagZip(app.db, id);

      const filename = `DSFinV-K_${businessDay}.zip`;

      if (req.query.encoding === 'base64') {
        // POS api-client path: same bytes, base64 in a text/plain body.
        reply.header('Content-Disposition', `attachment; filename="${filename}.b64"`);
        reply.type('text/plain; charset=utf-8');
        return reply.status(200).send(zip.toString('base64'));
      }

      reply.header('Content-Disposition', `attachment; filename="${filename}"`);
      reply.type('application/zip');
      return reply.status(200).send(zip);
    },
  );
};

export default closingExportRoute;
