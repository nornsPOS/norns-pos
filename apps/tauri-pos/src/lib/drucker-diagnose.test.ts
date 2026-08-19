/**
 * Der Drucker sagt NIE wieder `[object Object]`.
 *
 * ⚠️ 02.08.2026, in der Druckererkennung gefunden: der Händler las wörtlich
 * `[object Object]` über ein Gerät, das er in der Hand hielt. Die Ursache war
 * `String(err)` auf einer Ablehnung, die kein `Error` ist, sondern das
 * serialisierte `{ kind, details }` aus `src-tauri/src/error.rs:23`.
 *
 * Der wichtigste Satz dieser Datei ist deshalb nicht einer der schönen
 * Einzelfälle, sondern der letzte: für JEDE Eingabe kommt ein lesbarer
 * deutscher Satz heraus. Ein Übersetzer, der in einem Randfall wieder ein
 * rohes Objekt durchlässt, hat den Fehler nur verschoben.
 */

import { describe, expect, it } from 'vitest';

import { diagnoseAlsZeile, diagnostiziereDrucker } from './drucker-diagnose.js';

/** Genau die Form, mit der der Rumpf ablehnt. */
function rumpf(kind: string, details: string): unknown {
  return { kind, details };
}

describe('Druckerdiagnose', () => {
  it('macht aus der ECHTEN Ablehnungsform einen Satz', () => {
    const d = diagnostiziereDrucker(rumpf('internal', 'lpadmin: Forbidden'));
    expect(d.satz).toContain('Rechte');
    expect(d.handlung).toContain('Systemeinstellungen');
    expect(d.rohtext).toBe('lpadmin: Forbidden');
  });

  it('nennt bei fehlenden Rechten den WEG, nicht nur die Lage', () => {
    // Ein Satz, der nur „abgelehnt" sagt, lässt den Menschen am Tresen
    // stehen. Der Weg ist die halbe Auskunft.
    const d = diagnostiziereDrucker(rumpf('internal', 'client-error-forbidden'));
    expect(d.handlung).not.toBeNull();
    expect(d.handlung).toMatch(/einmalig/);
    // Und er verspricht, dass es EINMALIG ist — das ist die Erleichterung.
    expect(d.handlung).toMatch(/nie wieder|danach/);
  });

  it('unterscheidet die fünf Alltagsursachen voneinander', () => {
    const faelle: ReadonlyArray<[string, RegExp]> = [
      ['lpadmin: Forbidden', /Rechte/],
      ['no PPD found for device', /Treiber/],
      ['printer Zebra is stopped', /angehalten/],
      ['media empty: out of paper', /Papier/],
      ['cover open', /Deckel/],
    ];
    const saetze = faelle.map(([roh, muster]) => {
      const d = diagnostiziereDrucker(rumpf('device', roh));
      expect(d.satz, `„${roh}" wurde nicht erkannt`).toMatch(muster);
      return d.satz;
    });
    // Fünf verschiedene Handlungen brauchen fünf verschiedene Sätze. Wären
    // zwei gleich, hätte der Mensch wieder nur eine Ratlosigkeit.
    expect(new Set(saetze).size).toBe(faelle.length);
  });

  it('fällt auf die Fehlerart zurück, wenn kein Muster greift', () => {
    const d = diagnostiziereDrucker(rumpf('timeout', 'irgendein unbekannter Text'));
    expect(d.satz).toMatch(/antwortet nicht/);
    expect(d.rohtext).toBe('irgendein unbekannter Text');
  });

  /**
   * ⚠️ DER SATZ, AUF DEN ES ANKOMMT.
   *
   * Der ursprüngliche Fehler war ein RANDFALL: eine Ablehnungsform, an die
   * niemand gedacht hatte. Deshalb prüft dieser Satz nicht die schönen Fälle,
   * sondern alle hässlichen.
   */
  it('liefert für JEDE Eingabe einen lesbaren deutschen Satz', () => {
    const eingaben: unknown[] = [
      undefined,
      null,
      '',
      'nackte Zeichenkette',
      0,
      false,
      {},
      { kind: 'unbekannte_art' },
      { details: '' },
      { details: 42 },
      [],
      new Error('ein echter Error'),
      Object.create(null),
    ];
    for (const e of eingaben) {
      const zeile = diagnoseAlsZeile(e);
      expect(zeile, `leer bei ${JSON.stringify(e)}`).not.toBe('');
      expect(zeile, `[object Object] bei ${JSON.stringify(e)}`).not.toContain('[object');
      expect(zeile, `undefined bei ${JSON.stringify(e)}`).not.toContain('undefined');
      // Ein deutscher Satz endet mit einem Punkt und hat Substanz.
      expect(zeile.length, `zu kurz bei ${JSON.stringify(e)}`).toBeGreaterThan(20);
    }
  });

  it('gibt den Rohtext weiter, statt ihn zu verwerfen', () => {
    // Genau hier unterscheidet sich diese Diagnose von
    // `describeHardwareError`: der Rohtext ist die Ferndiagnose. Er gehört in
    // eine ruhige Zeile, aber er darf nicht verschwinden.
    const d = diagnostiziereDrucker(rumpf('internal', 'cups: client-error-not-possible'));
    expect(d.rohtext).toBe('cups: client-error-not-possible');
  });

  it('erfindet keinen Rohtext, wo keiner war', () => {
    expect(diagnostiziereDrucker({ kind: 'network' }).rohtext).toBeNull();
    expect(diagnostiziereDrucker(undefined).rohtext).toBeNull();
  });

  it('liest auch eine Ablehnung mit `message` statt `details`', () => {
    // Nicht jeder Weg im Haus reicht die Rumpfform durch; manche werfen ein
    // Objekt mit `message`. Ein Übersetzer, der nur EINE Form kennt, lässt die
    // andere wieder als rohes Objekt durch.
    const d = diagnostiziereDrucker({ message: 'printer is stopped' });
    expect(d.satz).toMatch(/angehalten/);
  });
});
