/**
 * ════════════════════════════════════════════════════════════════════════
 *  Ein Tag, der noch nicht vorbei ist, wird nicht festgeschrieben
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * `POST /api/closings/finalize` nimmt einen `businessDay` aus dem Rumpf und
 * benutzt ihn ohne jede Prüfung:
 *
 *     SELECT COALESCE(${req.body.businessDay ?? null}::date,
 *                     berlin_business_day(now()))::text AS day
 *
 * Kein Wort über die Zukunft. Der Verkauf hat diesen Riegel seit langem
 * (`erfassungszeit.ts`: „Die Erfassungszeit liegt in der Zukunft. Bitte die
 * Uhr der Kasse prüfen."), der Abschluss nicht.
 *
 * ── WARUM DAS EINE SACKGASSE IST, KEIN SCHÖNHEITSFEHLER ────────────────
 *
 * Ein festgeschriebener Tag ist unantastbar; genau dafür gibt es ihn. Der
 * Auslöser `transactions_validate_closing_day` weist danach JEDEN Beleg ab,
 * der in diesen Tag fällt.
 *
 * Ein Zahlendreher genügt: wer heute (08.08.) statt `2026-08-08` versehentlich
 * `2026-08-09` schreibt, versiegelt MORGEN. Am nächsten Morgen nimmt die Kasse
 * keinen einzigen Verkauf mehr an, und es gibt keinen Weg zurück: einen
 * festgeschriebenen Abschluss kann niemand aufheben, das ist der Sinn von
 * § 146 Abs. 4 AO.
 *
 * Der Laden steht dann, bis jemand mit Datenbankrechten von Hand eingreift.
 * Und ein solcher Eingriff ist in einem fiskalpflichtigen Bestand genau das,
 * was ein Prüfer als Manipulation liest.
 *
 * ── WAS ERLAUBT BLEIBT ────────────────────────────────────────────────
 *
 * HEUTE bleibt erlaubt. Der Laden schliesst abends ab, und dann ist der
 * laufende Tag der richtige. Ein Riegel, der den Feierabend blockiert, wird
 * abgeschaltet, und ein abgeschalteter Riegel schützt nichts.
 *
 * VERGANGENE Tage bleiben ebenfalls erlaubt: ein vergessener Abschluss muss
 * nachgeholt werden können, und § 146 Abs. 1 Satz 2 AO verlangt das sogar.
 */

import { describe, expect, it } from 'vitest';

import { pruefeAbschlusstag } from '../../src/lib/abschlusstag.js';

/** Ein fester Zeitpunkt: Samstag, 08.08.2026, 19:30 Uhr Berliner Zeit. */
const JETZT = new Date('2026-08-08T17:30:00.000Z');

describe('Der Abschlusstag darf nicht in der Zukunft liegen', () => {
  it('⛔ MORGEN wird abgewiesen — der Zahlendreher, der den Laden stilllegt', () => {
    const befund = pruefeAbschlusstag('2026-08-09', JETZT);
    expect(befund).not.toBeNull();
    expect(befund?.nachricht).toContain('2026-08-09');
    expect(befund?.nachricht).toContain('Zukunft');
  });

  it('⛔ und jeder weitere Tag danach', () => {
    for (const tag of ['2026-08-10', '2026-09-01', '2027-01-01', '2099-12-31']) {
      expect(pruefeAbschlusstag(tag, JETZT), tag).not.toBeNull();
    }
  });

  it('✅ HEUTE geht durch — das ist der Feierabend', () => {
    expect(pruefeAbschlusstag('2026-08-08', JETZT)).toBeNull();
  });

  it('✅ ein vergessener Tag von gestern oder früher geht durch', () => {
    // § 146 Abs. 1 Satz 2 AO verlangt das Nachholen.
    for (const tag of ['2026-08-07', '2026-07-31', '2025-01-02']) {
      expect(pruefeAbschlusstag(tag, JETZT), tag).toBeNull();
    }
  });

  it('✅ ohne Angabe entscheidet der Server, nicht der Klient', () => {
    expect(pruefeAbschlusstag(null, JETZT)).toBeNull();
    expect(pruefeAbschlusstag(undefined, JETZT)).toBeNull();
  });
});

describe('⚠️ Der Tag wird BERLINER Zeit gemessen, nicht UTC', () => {
  it('um 23:30 Berliner Zeit ist noch heute, nicht schon morgen', () => {
    /**
     * Im Sommer liegt Berlin zwei Stunden vor UTC. Um 23:30 Berliner Zeit ist
     * es in UTC schon 21:30 desselben Tages, aber am 31.12. um 23:30 Berliner
     * Zeit wäre eine naive UTC-Rechnung noch beim alten Jahr.
     *
     * Gemessen wird deshalb mit derselben Zeitzone, die auch
     * `berlin_business_day()` in der Datenbank benutzt. Ohne das wiese der
     * Riegel abends zwei Stunden lang den RICHTIGEN Tag ab, und der Kassierer
     * käme nicht in den Feierabend.
     */
    const kurzVorMitternachtBerlin = new Date('2026-08-08T21:30:00.000Z'); // 23:30 Berlin
    expect(pruefeAbschlusstag('2026-08-08', kurzVorMitternachtBerlin)).toBeNull();
    expect(pruefeAbschlusstag('2026-08-09', kurzVorMitternachtBerlin)).not.toBeNull();
  });

  it('⛔ und um 00:30 Berliner Zeit ist der neue Tag wirklich schon da', () => {
    // 00:30 Berlin am 09.08. ist 22:30 UTC am 08.08. Eine naive UTC-Rechnung
    // hielte den 09.08. hier noch für Zukunft und sperrte den Feierabend aus.
    const kurzNachMitternachtBerlin = new Date('2026-08-08T22:30:00.000Z');
    expect(pruefeAbschlusstag('2026-08-09', kurzNachMitternachtBerlin)).toBeNull();
    expect(pruefeAbschlusstag('2026-08-10', kurzNachMitternachtBerlin)).not.toBeNull();
  });

  it('im Winter gilt eine Stunde Versatz, und der Riegel rechnet das mit', () => {
    // 23:30 Berlin am 15.01. ist 22:30 UTC.
    const winterabend = new Date('2026-01-15T22:30:00.000Z');
    expect(pruefeAbschlusstag('2026-01-15', winterabend)).toBeNull();
    expect(pruefeAbschlusstag('2026-01-16', winterabend)).not.toBeNull();
  });
});

describe('⛔ Was sonst noch abgewiesen wird', () => {
  it('ein Datum, das es nicht gibt', () => {
    // Postgres hätte `2026-02-30` mit einem Fehler quittiert, den niemand
    // versteht. Hier fällt er mit einem deutschen Satz auf.
    for (const kaputt of ['2026-02-30', '2026-13-01', '2026-00-10']) {
      expect(pruefeAbschlusstag(kaputt, JETZT), kaputt).not.toBeNull();
    }
  });

  it('der 29. Februar in einem Nicht-Schaltjahr', () => {
    expect(pruefeAbschlusstag('2026-02-29', JETZT)).not.toBeNull();
    // 2028 ist ein Schaltjahr; das Datum gibt es, es liegt nur in der Zukunft.
    const befund = pruefeAbschlusstag('2028-02-29', JETZT);
    expect(befund?.nachricht).toContain('Zukunft');
  });
});
