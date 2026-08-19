/**
 * TypeBox schemas for POST /api/customers/:id/kyc-documents — Day 12
 * (closes Phase 1.5 #I-47).
 *
 * The body carries everything the kyc_documents row needs:
 *   • document classification (type, issuing country, optional authority)
 *   • document number (plaintext on the wire — encrypted at rest via
 *     `encrypt_pii()` inside withPii)
 *   • validity window
 *   • the image bytes (base64 + contentType). The SERVER compresses, strips
 *     EXIF, AES-256-GCM-encrypts to a LOCAL file (migration 0074), and computes
 *     the SHA-256 — R2 is gone; the client supplies neither a key nor a hash.
 *   • optional retention years (default 5 — GwG-aligned, see ADR-0007)
 */

import { type Static, Type } from '@sinclair/typebox';

export const KycDocumentType = Type.Union(
  [
    Type.Literal('PERSONALAUSWEIS'),
    Type.Literal('REISEPASS'),
    Type.Literal('ID_CARD_EU'),
    Type.Literal('PASSPORT_EU'),
    Type.Literal('PASSPORT_NON_EU'),
  ],
  { description: 'Migration 0007 id_document_type enum (DE biased).' },
);

export const KycDocumentBody = Type.Object({
  documentType: KycDocumentType,
  issuingCountryIso2: Type.String({
    pattern: '^[A-Z]{2}$',
    description: 'ISO 3166-1 alpha-2, uppercase.',
  }),
  issuingAuthority: Type.Optional(Type.String({ maxLength: 256 })),
  documentNumber: Type.String({ minLength: 1, maxLength: 64 }),
  issuedOn: Type.Optional(Type.String({ format: 'date' })),
  expiresOn: Type.String({ format: 'date' }),
  /**
   * Image payload, base64-encoded (no data: URI prefix). The server compresses
   * + EXIF-strips, AES-256-GCM-encrypts to a LOCAL file (migration 0074), and
   * COMPUTES the sha256 over the compressed bytes — the client no longer
   * supplies an r2Key or sha256.
   */
  dataBase64: Type.String({ minLength: 1 }),
  contentType: Type.Union([
    Type.Literal('image/jpeg'),
    Type.Literal('image/png'),
    Type.Literal('image/webp'),
  ]),
  retentionYears: Type.Optional(Type.Integer({ minimum: 1, maximum: 30, default: 5 })),
});
export type KycDocumentBody = Static<typeof KycDocumentBody>;

export const KycDocumentResponse = Type.Object({
  id: Type.String({ format: 'uuid' }),
  customerId: Type.String({ format: 'uuid' }),
  documentType: KycDocumentType,
  capturedAt: Type.String({ format: 'date-time' }),
  expiresOn: Type.String({ format: 'date' }),
  retentionUntil: Type.String({ format: 'date' }),
});
export type KycDocumentResponse = Static<typeof KycDocumentResponse>;
