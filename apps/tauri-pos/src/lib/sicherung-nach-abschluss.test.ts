import { describe, expect, it } from 'vitest';

import { entscheide, gelungenSatz, gescheitertSatz, heute } from './sicherung-nach-abschluss.js';

describe('Sicherung nach dem Abschluss: wann überhaupt', () => {
  it('sichert, wenn ein Ziel eingerichtet ist und heute noch nichts lief', () => {
    expect(
      entscheide({ zielordner: 'Dokumente/Norns', zuletztAm: '2026-08-12', heute: '2026-08-13' }),
    ).toEqual({ sichern: true, zielordner: 'Dokumente/Norns' });
  });

  it('sichert auch beim allerersten Mal', () => {
    expect(
      entscheide({ zielordner: 'Dokumente/Norns', zuletztAm: '', heute: '2026-08-13' }),
    ).toEqual({ sichern: true, zielordner: 'Dokumente/Norns' });
  });

  /**
   * ⚠️ Zwei Schichten an einem Tag heissen zwei Abschlüsse. Die ganze
   * Datenbank zweimal auf denselben Stick zu schreiben, kostet den
   * Kassierer beim zweiten Mal nur Wartezeit für dieselben Daten.
   */
  it('sichert höchstens einmal am Tag', () => {
    expect(
      entscheide({ zielordner: 'Dokumente/Norns', zuletztAm: '2026-08-13', heute: '2026-08-13' }),
    ).toEqual({ sichern: false, grund: 'heute-schon' });
  });

  it('sichert nicht, solange kein Ziel eingerichtet ist', () => {
    for (const leer of ['', '   ']) {
      expect(entscheide({ zielordner: leer, zuletztAm: '', heute: '2026-08-13' })).toEqual({
        sichern: false,
        grund: 'nicht-eingerichtet',
      });
    }
  });
});

describe('Die Sätze', () => {
  /**
   * ⚠️ Der wichtigste Satz der Datei. Liest ein Kassierer am Abend nur
   * „Fehler", glaubt er, sein Tagesabschluss sei nicht durch — und macht
   * ihn ein zweites Mal oder ruft nachts an.
   */
  it('sagt bei einem Fehlschlag ZUERST, dass der Abschluss steht', () => {
    const satz = gescheitertSatz('Der Ordner ist nicht beschreibbar.');
    expect(satz.indexOf('Tagesabschluss ist gebucht')).toBeLessThan(satz.indexOf('nicht geklappt'));
    expect(satz).toContain('von Hand nachholen');
  });

  it('nennt bei Erfolg den Ort, nicht nur ein Häkchen', () => {
    const satz = gelungenSatz('norns-sicherung-2026-08-13.sql.gz', 12_345);
    expect(satz).toContain('norns-sicherung-2026-08-13.sql.gz');
    expect(satz).toContain('12.345');
  });

  it('spricht Deutsch, ohne Kennungen', () => {
    for (const satz of [gelungenSatz('a.sql.gz', 1), gescheitertSatz('Grund.')]) {
      expect(satz).not.toMatch(/[a-z]_[a-z]/);
      for (const englisch of ['error', 'failed', 'backup', 'success']) {
        expect(satz.toLowerCase()).not.toContain(englisch);
      }
    }
  });
});

describe('Der Tag', () => {
  it('wird als ISO-Tag aus der ÖRTLICHEN Uhr gebildet', () => {
    // ⚠️ Nicht `toISOString()`: das rechnet nach UTC um. Ein Abschluss um
    // 23:30 in Schorndorf fiele damit auf den Folgetag und liesse die
    // Tagesbremse ins Leere laufen.
    expect(heute(new Date(2026, 7, 13, 23, 30))).toBe('2026-08-13');
    expect(heute(new Date(2026, 0, 5, 0, 15))).toBe('2026-01-05');
  });
});
