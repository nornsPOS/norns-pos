/**
 * TypeBox schemas for POST /api/transactions/:id/tse-signature (migration 0054).
 *
 * Durable, server-side persistence of the Fiskaly SIGN DE V2 signature the POS
 * received from its local TSE bridge after a successful finalize+FINISH. GoBD /
 * BSI TR-03153 require the signature to be recorded server-side, linked to the
 * transaction it signs — previously it lived only on the thermal receipt + the
 * POS's browser localStorage offline queue.
 *
 * The signature counter and Fiskaly transaction number are monotonic BIGINTs;
 * they ride the wire as decimal STRINGS so we never lose precision through a
 * JS `number`. The POS already stringifies them (`String(signatureCounter)`).
 */

import { type Static, Type } from '@sinclair/typebox';

/** A non-negative integer carried as a decimal string (bigint-safe). */
const BigIntString = Type.String({
  pattern: '^[0-9]+$',
  description: 'A non-negative integer encoded as a decimal string (bigint-safe).',
  examples: ['42', '1000003'],
});

export const TseSignatureParams = Type.Object({
  /** The fiscal transaction this signature belongs to. */
  id: Type.String({ format: 'uuid' }),
});
export type TseSignatureParams = Static<typeof TseSignatureParams>;

/**
 * Die Kennung einer Sicherungseinrichtung.
 *
 * ⚠️ NICHT `format: 'uuid'`. Eine Wolken-TSE vergibt UUIDs, ein
 * Swissbit-Stecker trägt eine SERIENNUMMER wie `5E4B1C9A00000042`. Mit der
 * UUID-Prüfung könnte eine Kasse mit Hardware-TSE keinen einzigen Beleg
 * schreiben: jede Signatur prallte mit 400 ab, und ohne Signatur bleibt jeder
 * Verkauf unsigniert.
 *
 * ⚠️ Diese Leitung und die Datenbank fallen GEMEINSAM (Wanderung 0131). Nur
 * hier zu weiten verwandelte die ehrliche 400 in eine 500 aus der Tiefe der
 * Datenbank: dieselbe Ablehnung, aber ohne Satz, der sagt warum.
 *
 * Die Grenzen bleiben eng: nicht leer, keine Steuerzeichen, und höchstens
 * 128 Zeichen. Ein leeres Feld wäre schlimmer als eine falsche UUID, denn es
 * sähe aus wie „signiert", ohne dass ein Gerät je etwas signiert hätte.
 */
const TseKennung = Type.String({
  minLength: 1,
  maxLength: 128,
  pattern: '^[\\x21-\\x7E]+$',
  description:
    'Kennung der Sicherungseinrichtung. Wolke: eine UUID. Gerät: die Seriennummer.',
  examples: ['b4e3f0a2-1c5d-4a7e-9f10-2b3c4d5e6f70', '5E4B1C9A00000042'],
});

export const TseSignatureBody = Type.Object({
  /** Kennung der signierenden Sicherungseinrichtung (Wolke: UUID, Gerät: Seriennummer). */
  fiskalyTssId: TseKennung,
  /** Kennung dieser Kasse an der Sicherungseinrichtung. */
  fiskalyClientId: TseKennung,
  /** Die Vorgangskennung der Sicherungseinrichtung, sofern sie eine nennt. */
  fiskalyTransactionId: Type.Optional(TseKennung),
  /** Monotonic per-TSS transaction number (KassenSichV). */
  fiskalyTransactionNumber: BigIntString,

  /** Base64 signature value (printed on the receipt). */
  signatureValue: Type.String({ minLength: 1, maxLength: 8192 }),
  /** Monotonic per-TSS signature counter. */
  signatureCounter: BigIntString,
  /** Signature algorithm, e.g. 'ecdsa-plain-SHA256'. */
  signatureAlgorithm: Type.Optional(Type.String({ maxLength: 128 })),

  /**
   * ── DIE ZWEI ANGABEN, DIE EINE SIGNATUR NACHRECHENBAR MACHEN ────────────
   *
   * Bis zum 13.08.2026 kannte dieses Schema sie nicht — und Fastify ENTFERNT
   * still, was es nicht kennt. Die Kasse hat beide Werte
   * (`src-tauri/src/commands/tse.rs`), sie kamen hier nur nie an. In der
   * `tse.csv` jedes Prüferpakets blieben `TSE_SERIAL` und `TSE_PUBLIC_KEY`
   * daraufhin leer.
   *
   * Optional, weil eine Sicherungseinrichtung nicht beide Angaben liefern
   * muss. Ein LEERER Wert wird abgewiesen: er sähe im Auszug aus wie eine
   * gemachte Angabe, wäre aber keine.
   */
  tssSerialNumber: Type.Optional(TseKennung),
  signaturePublicKey: Type.Optional(Type.String({ minLength: 1, maxLength: 4096 })),

  /** KassenSichV process classification. */
  processType: Type.Optional(Type.String({ maxLength: 128 })),
  /** Receipt-ready QR code payload (BSI TR-03151). */
  qrCodeData: Type.Optional(Type.String({ maxLength: 8192 })),

  /** When the TSE TRANSACTION started (Fiskaly-reported). */
  tseStartTime: Type.Optional(Type.String({ format: 'date-time' })),
  /** When the TSE TRANSACTION finalized / was signed (Fiskaly-reported). */
  tseEndTime: Type.Optional(Type.String({ format: 'date-time' })),
});
export type TseSignatureBody = Static<typeof TseSignatureBody>;

export const TseSignatureResponse = Type.Object({
  /** ID of the tse_signatures evidence row. */
  id: Type.String({ format: 'uuid' }),
  /** The fiscal transaction the signature belongs to. */
  transactionId: Type.String({ format: 'uuid' }),
  /** TRUE when this POST created the row; FALSE when it was already recorded (idempotent no-op). */
  created: Type.Boolean(),
  /** When the signature was recorded server-side. */
  recordedAt: Type.String({ format: 'date-time' }),
});
export type TseSignatureResponse = Static<typeof TseSignatureResponse>;
