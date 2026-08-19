/**
 * TypeBox schemas for POST /api/transactions/storno (Day 15).
 *
 * Storno = negative-amount mirror of the original transaction, linked via
 * `storno_of_transaction_id`. The DB triggers (migration 0009 + 0013 C-5)
 * enforce:
 *   • original must not itself be a storno
 *   • direction matches the original
 *   • magnitudes exactly negate the original
 *   • customer matches
 *   • at most one storno per original (partial UNIQUE)
 *
 * The route loads the original transaction + its lines + payments, builds
 * the negated mirror, and INSERTs in one transaction. The triggers do the
 * cumulative-spend reversal + ledger emit. The route emits an explicit
 * audit_log row carrying the human-readable `reason` for incident review.
 *
 * Basel directive Day 15 §3: `requireStepUp` is **mandatory**, regardless of
 * amount. No "small storno" loophole.
 */

import { type Static, Type } from '@sinclair/typebox';

import { SignedDecimalString } from './money.js';
import { TransactionDirection } from './transaction.js';

export const StornoBody = Type.Object({
  originalTransactionId: Type.String({ format: 'uuid' }),
  /**
   * Required free-text justification — surfaced in audit_log payload and
   * shown to ADMIN on the Bridge reversal review panel. Minimum 8 chars to
   * deter "fat-finger" stornos with no context.
   */
  reason: Type.String({
    minLength: 8,
    maxLength: 1024,
    description: 'Human-readable reason for the reversal. Persisted to audit_log.',
    examples: ['Customer changed mind 30s after sale', 'Wrong item rung up'],
  }),

  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  DIE ERFASSUNGSZEIT DES GERÄTS — 28.07.2026 ergänzt
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Bis heute kannte der Storno-Rumpf kein `erfasstAm`. Sein `finalized_at`
   * kam deshalb aus `DEFAULT now()`, also aus der Uhr des SERVERS — während
   * der Verkauf seine Zeit vom GERÄT bekommt (0118). Zwei Zeitquellen für
   * die zwei Hälften desselben Vorgangs.
   *
   * Im Alltag fällt das nicht auf, weil beide Uhren dieselbe sind. Es fällt
   * genau dort auf, wofür es die Gerätezeit überhaupt gibt:
   *
   *   • Ein aus dem Offline-Speicher NACHGESPIELTER Verkauf trägt das Datum
   *     von gestern. Sein Storno bekäme das von heute — der Erlös stünde in
   *     einem Tagesabschluss, seine Aufhebung in einem anderen.
   *   • Ein Verkauf um 23:58 und sein Storno um 00:02 fielen auseinander.
   *     Und da der zweite Tag den ersten nicht mehr aufheben kann
   *     (`transactions_validate_closing_day`), bliebe der Erlös stehen.
   *
   * Fehlt das Feld, gilt weiterhin die Serverzeit — eine bereits
   * ausgelieferte Kasse sendet es nicht, und die soll weiterlaufen.
   */
  erfasstAm: Type.Optional(
    Type.String({
      format: 'date-time',
      description:
        'Zeitpunkt des Stornierens auf dem Gerät (ISO 8601). Fehlt er, gilt die ' +
        'Serverzeit. Er unterliegt denselben Grenzen wie beim Verkauf: nicht in ' +
        'der Zukunft, nicht älter als sieben Tage.',
    }),
  ),
});
export type StornoBody = Static<typeof StornoBody>;

export const StornoResponse = Type.Object({
  /** ID of the NEW storno transaction row. */
  id: Type.String({ format: 'uuid' }),
  /** ID of the original transaction that was reversed. */
  stornoOfTransactionId: Type.String({ format: 'uuid' }),
  receiptLocator: Type.String(),
  finalizedAt: Type.String({ format: 'date-time' }),
  direction: TransactionDirection,
  /** Negated total — mirrors `-original.totalEur`. */
  totalEur: SignedDecimalString,
  /** ID of the `transaction.stornoed` ledger event emitted by the trigger. */
  ledgerEventId: Type.Integer(),

  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  WAS DIE TSE ZUM SIGNIEREN BRAUCHT — 08.08.2026 ergänzt
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Der Storno-Dialog kennt nur die Kennung des Ursprungsbelegs. Er wusste
   * deshalb weder den Betrag noch die Steueraufteilung noch die Zahlart und
   * sendete an die TSE `amountCents: 0`, eine leere Aufteilung und fest
   * „Unbar" — auch beim Storno eines Barverkaufs.
   *
   * Der Server hat all das ohnehin in der Hand: er baut den Spiegel gerade
   * aus den Zeilen und Zahlungen des Originals. Er gibt es jetzt zurück,
   * statt den Klienten raten zu lassen.
   */

  /**
   * Die Bruttoaufteilung des Stornos je Steuerbehandlung, in ganzen Cent und
   * NEGATIV. Der Klient übersetzt die Behandlung in den fiskaly-Satznamen.
   */
  ustAufteilung: Type.Array(
    Type.Object({
      taxTreatmentCode: Type.String(),
      /** Brutto in ganzen Cent, negativ. */
      bruttoCents: Type.Integer(),
    }),
  ),

  /**
   * Zahlart des URSPRUNGSBELEGS, auf die zwei Werte abgebildet, die die
   * KassenSichV kennt. Bar bleibt bar: wer bar gekauft hat, bekommt bar
   * zurück, und die Signatur muss das sagen.
   */
  zahlartTse: Type.Union([Type.Literal('CASH'), Type.Literal('NON_CASH')]),

  /**
   * ═══════════════════════════════════════════════════════════════════════
   *  DER NACHTRAG — 11.08.2026 ergänzt (Befund 12)
   * ═══════════════════════════════════════════════════════════════════════
   *
   * War der Geschäftstag des Ursprungsbelegs schon abgeschlossen, bucht der
   * Server den Storno in den LAUFENDEN Tag und trägt den Urtag in
   * `nachtrag_bezugstag`. Der Vorgang ist damit vollständig aufgezeichnet.
   *
   * ⚠️ OHNE DIESES FELD ERFÄHRT DIE KASSE DAVON NICHTS. Fastify streift
   * jedes nicht deklarierte Feld aus der Antwort — der Kassierer sähe einen
   * gewöhnlichen Storno und wüsste nicht, dass der Beleg in den heutigen
   * Abschluss fällt statt in den von gestern. Genau diese Klasse hat im Haus
   * schon einmal ein ehrliches Feld unsichtbar gemacht.
   *
   * `null` heisst: gewöhnlicher Storno im offenen Tag, nichts zu melden.
   */
  nachtragBezugstag: Type.Union([Type.String({ format: 'date' }), Type.Null()]),
});
export type StornoResponse = Static<typeof StornoResponse>;
