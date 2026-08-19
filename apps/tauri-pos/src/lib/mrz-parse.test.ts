import { parse } from 'mrz';
import { describe, expect, it } from 'vitest';

import { parseMrzDocument } from './mrz-parse.js';

// Canonical ICAO 9303 TD3 (passport) specimen — "ANNA MARIA ERIKSSON".
const TD3: [string, string] = [
  'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<',
  'L898902C36UTO7408122F1204159ZE184226B<<<<<10',
];

describe('mrz.parse (TD3)', () => {
  it('extracts surname + documentNumber from a known passport MRZ', () => {
    const result = parse(TD3);
    expect(result.fields.lastName).toBe('ERIKSSON');
    expect(result.fields.documentNumber).toBe('L898902C3');
  });
});

describe('parseMrzDocument', () => {
  it('maps the mrz fields to the KYC person shape', () => {
    const person = parseMrzDocument(TD3);
    expect(person).not.toBeNull();
    expect(person?.surname).toBe('ERIKSSON');
    expect(person?.givenNames).toBe('ANNA MARIA');
    expect(person?.documentNumber).toBe('L898902C3');
    expect(person?.expiryDate).toBe('120415');
    expect(person?.format).toBe('TD3');
    // 'UTO' is the fictional ICAO specimen country — mrz validates nationality
    // against real ISO states and returns null, which we map to ''.
    expect(person?.nationality).toBe('');
  });

  it('returns null for non-MRZ input', () => {
    expect(parseMrzDocument('not an mrz at all')).toBeNull();
  });
});
