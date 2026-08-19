/**
 * Der Wächter gegen die Fehlerklasse, die hier schon zweimal aufgetreten ist.
 *
 * `ApiOfflineQueuedError` erbt von `Error` und NICHT von `ApiError`. Jede
 * Maske, die nur auf `ApiError` prüft, behauptet einen Fehlschlag, obwohl der
 * Vorgang sicher eingereiht ist. Die Kassiererin drückt dann erneut, und bei
 * der Kassenbewegung wurde daraus eine zweite Zeile im Kassenbuch.
 */

import { describe, expect, it } from 'vitest';

import { ApiError, ApiOfflineQueuedError } from '@norns/api-client';

import { eingereihtHinweis, istSicherEingereiht } from './eingereiht.js';

describe('istSicherEingereiht', () => {
  it('erkennt den eingereihten Vorgang', () => {
    expect(istSicherEingereiht(new ApiOfflineQueuedError('k-1', Date.now()))).toBe(true);
  });

  it('DIE Falle: er erbt NICHT von ApiError', () => {
    // Genau daran ist es zweimal gescheitert. Wenn diese Zusicherung je rot
    // wird, weil jemand die Vererbung ändert, ist das eine gute Nachricht —
    // dann greift `instanceof ApiError` von selbst. Bis dahin ist sie der
    // Beleg dafür, warum es diese Datei gibt.
    const err = new ApiOfflineQueuedError('k-2', Date.now());
    expect(err instanceof ApiError).toBe(false);
    expect(err instanceof Error).toBe(true);
  });

  it('haelt einen echten Fehler NICHT faelschlich fuer Erfolg', () => {
    const echt = new ApiError({ code: 'CONFLICT', message: 'nein', httpStatus: 409 });
    expect(istSicherEingereiht(echt)).toBe(false);
    expect(istSicherEingereiht(new Error('kaputt'))).toBe(false);
    expect(istSicherEingereiht(null)).toBe(false);
    expect(istSicherEingereiht(undefined)).toBe(false);
  });
});

describe('der Hinweis, den die Kassiererin liest', () => {
  it('ist ruhig, nicht alarmierend', () => {
    const h = eingereihtHinweis('Einlage');
    expect(h.tone).toBe('info');
    expect(h.title).toContain('Einlage');
    expect(h.title).not.toMatch(/fehler|gestört|problem/i);
  });

  it('haelt AUSDRUECKLICH davon ab, es erneut einzutragen', () => {
    // Der eigentliche Schutz. Ohne diesen Satz liest ein Mensch „offline
    // gespeichert" und traegt es sicherheitshalber trotzdem noch einmal ein.
    expect(eingereihtHinweis('Einlage').body).toMatch(/NICHT erneut/);
  });
});
