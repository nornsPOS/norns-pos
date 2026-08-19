/**
 * Offline MRZ parsing (GwG/GDPR — identity data never leaves the device).
 *
 * Thin, pure wrapper over the battle-tested `mrz` package: it validates the
 * MRZ check digits and extracts the fields, then we map them to the shape the
 * KYC capture flow consumes. No OCR / no network here — callers pass the
 * already-extracted MRZ text lines (TD1 = 3×30, TD3 = 2×44).
 */

import { parse } from 'mrz';

export interface MrzPerson {
  surname: string;
  givenNames: string;
  nationality: string;
  /** YYMMDD as printed on the document. */
  dateOfBirth: string;
  documentNumber: string;
  /** YYMMDD as printed on the document. */
  expiryDate: string;
  /** True when every MRZ check digit validated. */
  valid: boolean;
  /** 'TD1' | 'TD2' | 'TD3' | null (the detected MRZ format). */
  format: string | null;
}

/**
 * Parse MRZ text lines into a person record, or null when no document fields
 * could be extracted. Field extraction succeeds even if check digits fail
 * (we surface `valid` so the operator can decide); null only when the input
 * isn't recognizably an MRZ.
 */
export function parseMrzDocument(lines: string | string[]): MrzPerson | null {
  let result: ReturnType<typeof parse>;
  try {
    result = parse(lines);
  } catch {
    return null;
  }
  const f = result.fields;
  if (!f.documentNumber && !f.lastName && !f.firstName) return null;

  return {
    surname: f.lastName ?? '',
    givenNames: f.firstName ?? '',
    nationality: f.nationality ?? '',
    dateOfBirth: f.birthDate ?? '',
    documentNumber: f.documentNumber ?? '',
    expiryDate: f.expirationDate ?? '',
    valid: result.valid,
    format: result.format,
  };
}
