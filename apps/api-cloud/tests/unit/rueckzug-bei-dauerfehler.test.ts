/**
 * Ein Takt, der immer scheitert, soll nicht immer schreien.
 *
 * Am 26.07.2026 gemessen: der Kalendertakt schlug alle 15 Sekunden fehl, jedes
 * Mal mit vollem Stapelabzug. 9141 Bytes je Minute, rund 12 MB je Tag, aus
 * EINEM Behälter ohne Grössengrenze.
 *
 * Der Fehler war echt — das Google-Projekt des Dienstkontos war GELÖSCHT — und
 * genau deshalb änderte sich in 15 Sekunden mit Sicherheit nichts.
 */

import { describe, expect, it } from 'vitest';

import {
  neuerStand,
  RUECKZUG_HOECHSTABSTAND,
  zaehleErfolg,
  zaehleFehler,
} from '../../src/lib/rueckzug-bei-dauerfehler.js';

describe('der Rueckzug', () => {
  it('der ERSTE Fehler wird immer voll gemeldet', () => {
    // Ein Rueckzug, der schon den ersten Fehler schluckt, ist ein Verschlucken.
    expect(zaehleFehler(neuerStand()).melden).toBe(true);
  });

  it('⚠️ aus 5760 Takten am Tag werden 31 Meldungen', () => {
    // 24 Stunden Dauerfehler bei 15 Sekunden Takt — der gemessene Fall.
    //
    // ⚠️ Die Zahl stand hier zuerst als „weniger als 30", geraten. Sie ist 31,
    // und das ist RICHTIG: neun Verdopplungen decken die ersten ~511 Takte,
    // die restlichen 5249 laufen im gedeckelten Abstand von 240. Eine
    // gewuenschte Zahl in einen Test zu schreiben, statt die ausgerechnete,
    // macht aus einer Pruefung eine Meinung.
    const s = neuerStand();
    let gemeldet = 0;
    for (let i = 0; i < 5760; i += 1) if (zaehleFehler(s).melden) gemeldet += 1;
    expect(gemeldet).toBe(31);
    // Statt 5760 Zeilen mit vollem Stapelabzug: 31.
    expect(gemeldet / 5760).toBeLessThan(0.01);
  });

  it('⚠️ und er verschluckt NICHTS: jede Meldung nennt die unterdrueckten', () => {
    // Wer die Zeile liest, muss wissen, dass es weiterging und wie oft. Sonst
    // sieht ein anhaltender Ausfall aus wie ein einmaliger Aussetzer.
    const s = neuerStand();
    const meldungen: number[] = [];
    for (let i = 0; i < 500; i += 1) {
      const e = zaehleFehler(s);
      if (e.melden) meldungen.push(e.unterdrueckt);
    }
    expect(meldungen.length).toBeGreaterThan(3);
    // ⚠️ Die Summe der gemeldeten Unterdrueckungen plus die Meldungen selbst
    // ergibt NICHT die 500 — am Ende liegt ein Schwanz, der noch auf seine
    // Meldung wartet. Der erste Entwurf dieses Tests hat den vergessen und war
    // damit schlicht falsch, nicht der Code.
    expect(meldungen.reduce((a, b) => a + b, 0) + meldungen.length + s.unterdrueckt).toBe(500);
  });

  it('der Abstand ist gedeckelt', () => {
    // Ohne Deckel stuende nach einem Tag Ausfall die naechste Meldung erst in
    // einer Woche an — dann waere der Rueckzug faktisch ein Verschlucken.
    const s = neuerStand();
    let letzte = 0;
    let groessterAbstand = 0;
    for (let i = 1; i <= 20_000; i += 1) {
      if (zaehleFehler(s).melden) {
        groessterAbstand = Math.max(groessterAbstand, i - letzte);
        letzte = i;
      }
    }
    expect(groessterAbstand).toBeLessThanOrEqual(RUECKZUG_HOECHSTABSTAND);
  });

  it('ein ERFOLG setzt alles zurueck', () => {
    const s = neuerStand();
    for (let i = 0; i < 100; i += 1) zaehleFehler(s);
    const e = zaehleErfolg(s);
    expect(e.warKaputt).toBe(true);
    expect(e.fehlerWaren).toBe(100);
    // Der naechste Fehler ist wieder ein voller.
    expect(zaehleFehler(s).melden).toBe(true);
  });

  it('ein Erfolg ohne vorherigen Fehler meldet nichts', () => {
    // Sonst stuende bei jedem gelungenen Takt „wieder erreichbar" im Protokoll.
    expect(zaehleErfolg(neuerStand()).warKaputt).toBe(false);
  });
});

describe('der Kalendertakt benutzt ihn wirklich', () => {
  it('calendar-pull zaehlt Fehler und Erfolge', async () => {
    const q = (await import('node:fs')).readFileSync(
      new URL('../../src/lib/calendar-pull.ts', import.meta.url),
      'utf8',
    );
    // Auf den AUFRUF pruefen, nicht auf den Namen — ein Waechter, der den
    // Import zaehlt, bewacht die Importliste. Und der Dateiname kommt hier
    // ohnehin in einem Kommentar vor.
    expect(/(?<!as\s)\bzaehleFehler\s*\(/.test(q), 'kein Rueckzug im Takt').toBe(true);
    expect(/(?<!as\s)\bzaehleErfolg\s*\(/.test(q), 'kein Zuruecksetzen bei Erfolg').toBe(true);
  });
});
