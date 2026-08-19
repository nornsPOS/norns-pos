/**
 * Die Fiskal-Ampel, geprüft an dem einen Fehler, den sie in der Produktion hatte.
 *
 * Der erste Test unten ist der wichtigste der Datei. Er hält den Zustand fest,
 * den die alte Fassung als "in Ordnung" gemeldet hat, und verlangt Alarm.
 */

import { describe, expect, it } from 'vitest';

import { judgeFiscalHealth } from '../../src/lib/fiscal-health.js';

describe('unklar ist nicht grün', () => {
  it('OHNE Sicherungseinrichtung schlägt die Ampel Alarm', () => {
    // GENAU DIESER FALL stand am 25.07.2026 in der Produktion und wurde grün
    // gemeldet: 0 Clients, 13 unsignierte Belege. Die alte Zeile lautete
    // `tseDays === null ? 'ok'`, und `tse_days` ist null, WEIL kein Client da ist.
    const v = judgeFiscalHealth({ clients: 0, certDays: null, unsignedRecent: 13, zertifikatUeberwacht: true });
    expect(v.status).toBe('alert');
    expect(v.reason).toContain('keine technische Sicherheitseinrichtung');
    // Der Text muss den Paragraphen nennen, sonst weiss der Händler nicht,
    // worum es geht, und hält es für eine technische Kleinigkeit.
    expect(v.reason).toContain('146a');
  });

  it('ein leerer Laden ohne TSE ist ebenfalls Alarm, nicht in Ordnung', () => {
    // Keine Belege heisst nicht, dass alles gut ist. Es heisst nur, dass der
    // Mangel noch niemandem aufgefallen ist.
    const v = judgeFiscalHealth({ clients: 0, certDays: null, unsignedRecent: 0, zertifikatUeberwacht: true });
    expect(v.status).toBe('alert');
  });

  it('ein Client OHNE bekannte Laufzeit gilt als Mangel, nicht als Ordnung', () => {
    const v = judgeFiscalHealth({ clients: 1, certDays: null, unsignedRecent: 0, zertifikatUeberwacht: true });
    expect(v.status).toBe('alert');
    expect(v.reason).toContain('unbekannt');
  });
});

describe('eine eingerichtete, aber stumme TSE ist so schlimm wie keine', () => {
  it('unsignierte Belege schlagen jede Restlaufzeit', () => {
    // Ein Zertifikat, das noch Jahre läuft, hilft nichts, wenn nichts signiert
    // wird. Dieser Fall ist heimtückisch: alles sieht eingerichtet aus.
    const v = judgeFiscalHealth({ clients: 1, certDays: 900, unsignedRecent: 1, zertifikatUeberwacht: true });
    expect(v.status).toBe('alert');
    expect(v.reason).toContain('trägt nicht');
  });

  it('nennt die Anzahl, und zwar sprachlich richtig', () => {
    expect(judgeFiscalHealth({ clients: 1, certDays: 900, unsignedRecent: 1, zertifikatUeberwacht: true }).reason)
      .toContain('1 Beleg der letzten Tage');
    expect(judgeFiscalHealth({ clients: 1, certDays: 900, unsignedRecent: 7, zertifikatUeberwacht: true }).reason)
      .toContain('7 Belege der letzten Tage');
  });
});

describe('die Restlaufzeit des Zertifikats', () => {
  it('abgelaufen ist Alarm', () => {
    const v = judgeFiscalHealth({ clients: 1, certDays: -3, unsignedRecent: 0, zertifikatUeberwacht: true });
    expect(v.status).toBe('alert');
    expect(v.reason).toContain('abgelaufen');
  });

  it('unter sieben Tagen ist Alarm', () => {
    expect(judgeFiscalHealth({ clients: 1, certDays: 6, unsignedRecent: 0, zertifikatUeberwacht: true }).status).toBe('alert');
  });

  it('bis dreissig Tage ist Beobachtung', () => {
    expect(judgeFiscalHealth({ clients: 1, certDays: 7, unsignedRecent: 0, zertifikatUeberwacht: true }).status).toBe('watch');
    expect(judgeFiscalHealth({ clients: 1, certDays: 30, unsignedRecent: 0, zertifikatUeberwacht: true }).status).toBe('watch');
  });

  it('erst darüber ist wirklich in Ordnung, und nur dann', () => {
    const v = judgeFiscalHealth({ clients: 1, certDays: 31, unsignedRecent: 0, zertifikatUeberwacht: true });
    expect(v.status).toBe('ok');
    expect(v.reason).toContain('werden signiert');
  });
});

describe('⚠️ Ein Zertifikat, das NIEMAND überwacht', () => {
  /**
   * ── DER BEFUND VOM 08.08.2026 ────────────────────────────────────────
   *
   * `certDays === null` hiess bis heute Alarm. Die Annahme dahinter trug
   * nur, solange `clients` aus `tse_clients` kam: dort bringt jede Zeile
   * ein Ablaufdatum mit, also war eine Zeile ohne Datum ein Widerspruch.
   *
   * Seit die Einrichtung an `system_settings` hängt — dem einzigen Ort, den
   * die Kasse selbst füllt — ist „eingerichtet, aber kein Wachbuch" der
   * NORMALE Zustand von Norns POS. Der Arbeiter, der `tse_clients` füllt,
   * reist mit der Kasse nicht mit.
   *
   * Alarm wäre damit die zweite Dauerlampe an derselben Ampel gewesen.
   */
  it('⛔ ist NICHT grün — das Verschweigen wäre der eigentliche Fehler', () => {
    const v = judgeFiscalHealth({
      clients: 1,
      certDays: null,
      unsignedRecent: 0,
      zertifikatUeberwacht: false,
    });
    expect(v.status).not.toBe('ok');
  });

  it('⛔ und NICHT Alarm — die Kette trägt ja nachweislich', () => {
    const v = judgeFiscalHealth({
      clients: 1,
      certDays: null,
      unsignedRecent: 0,
      zertifikatUeberwacht: false,
    });
    expect(v.status).toBe('watch');
    expect(v.reason).toContain('nicht überwacht');
  });

  it('⚠️ ein unsignierter Beleg schlägt das trotzdem — der Alarm bleibt vorn', () => {
    // Die Reihenfolge der Zweige ist hier die eigentliche Aussage: was die
    // Kette WIRKLICH misst, wiegt schwerer als was sie nicht überwacht.
    const v = judgeFiscalHealth({
      clients: 1,
      certDays: null,
      unsignedRecent: 3,
      zertifikatUeberwacht: false,
    });
    expect(v.status).toBe('alert');
    expect(v.reason).toContain('trägt nicht');
  });

  it('⚠️ und ohne Einrichtung bleibt es Alarm, ganz gleich was überwacht wird', () => {
    const v = judgeFiscalHealth({
      clients: 0,
      certDays: null,
      unsignedRecent: 0,
      zertifikatUeberwacht: false,
    });
    expect(v.status).toBe('alert');
    expect(v.reason).toContain('146a');
  });
});

describe('es gibt genau EINEN Weg zu grün', () => {
  it('grün verlangt Client UND Signaturen UND Laufzeit', () => {
    // Diese Schleife ist der eigentliche Schutz: sie geht jede Kombination
    // durch und besteht nur, wenn ausschliesslich der vollständig gesunde
    // Zustand grün ergibt. Wer eine Bedingung entfernt, sieht es hier sofort.
    for (const clients of [0, 1]) {
      for (const certDays of [null, -1, 3, 20, 400]) {
        for (const unsignedRecent of [0, 5]) {
          const gesund = clients > 0 && unsignedRecent === 0 && certDays !== null && certDays > 30;
          const v = judgeFiscalHealth({ clients, certDays, unsignedRecent, zertifikatUeberwacht: true });
          expect(v.status === 'ok').toBe(gesund);
          // Und jedes Urteil muss begründet sein. Eine Ampel ohne Satz ist
          // für den Händler wertlos.
          expect(v.reason.length).toBeGreaterThan(20);
        }
      }
    }
  });
});
