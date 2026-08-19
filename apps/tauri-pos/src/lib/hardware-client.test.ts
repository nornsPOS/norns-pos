import { describe, expect, it, vi } from 'vitest';

import {
  type HardwareError,
  type HardwareErrorKind,
  describeHardwareError,
  isHardwareError,
} from './hardware-client.js';

const KINDS: HardwareErrorKind[] = [
  'network',
  'timeout',
  'device',
  'not_configured',
  'encoding',
  'local_io',
  'invalid_argument',
  'internal',
];

// The exact operator-facing German sentences. Asserting them verbatim locks the
// wording — a copy change is a deliberate, reviewed test edit, not a silent drift.
const EXPECTED: Record<HardwareErrorKind, string> = {
  network: 'Keine Verbindung zum Gerät. Bitte Kabel und Netzwerk prüfen und erneut versuchen.',
  timeout:
    'Das Gerät antwortet nicht rechtzeitig. Bitte prüfen, ob es eingeschaltet und verbunden ist, und erneut versuchen.',
  device:
    'Das Gerät hat unerwartet reagiert. Bitte erneut versuchen; bleibt der Fehler, das Gerät neu starten.',
  not_configured: 'Das Gerät ist noch nicht eingerichtet. Bitte im Gerätemanager konfigurieren.',
  encoding: 'Die Daten konnten nicht verarbeitet werden. Bitte erneut versuchen.',
  local_io:
    'Eine lokale Datei konnte nicht gespeichert werden. Bitte Speicherplatz prüfen und erneut versuchen.',
  invalid_argument: 'Die Eingabe war ungültig. Bitte die Angaben prüfen und erneut versuchen.',
  internal: 'Es ist ein unerwarteter Fehler aufgetreten. Bitte erneut versuchen.',
};

describe('describeHardwareError', () => {
  it('returns the exact self-contained German sentence per kind', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const kind of KINDS) {
      expect(describeHardwareError({ kind, details: '' })).toBe(EXPECTED[kind]);
    }
    warn.mockRestore();
  });

  it('never surfaces the raw technical details in the human string', () => {
    // A poison detail carrying every kind of leak we must never show an operator.
    const poison = 'lpr exited with Some(1): Permission denied at /var/spool/cups';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const kind of KINDS) {
      const msg = describeHardwareError({ kind, details: poison });
      expect(msg).toBe(EXPECTED[kind]);
      expect(msg).not.toContain(poison);
      expect(msg.toLowerCase()).not.toContain('lpr');
      expect(msg).not.toContain('Permission denied');
      expect(msg).not.toContain('/var/spool');
    }
    // The details are LOGGED as a diagnostic side-channel, just not surfaced.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not log when there is no detail to log', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    describeHardwareError({ kind: 'timeout', details: '' });
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it('falls back to the internal message for an unmapped kind', () => {
    const weird = { kind: 'totally_unknown', details: 'x' } as unknown as HardwareError;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(describeHardwareError(weird)).toBe(EXPECTED.internal);
    warn.mockRestore();
  });
});

describe('isHardwareError', () => {
  it('accepts the {kind, details} shape and rejects everything else', () => {
    expect(isHardwareError({ kind: 'network', details: 'x' })).toBe(true);
    expect(isHardwareError({ kind: 'network' })).toBe(false);
    expect(isHardwareError({ details: 'x' })).toBe(false);
    expect(isHardwareError(null)).toBe(false);
    expect(isHardwareError('boom')).toBe(false);
    expect(isHardwareError(undefined)).toBe(false);
  });
});
