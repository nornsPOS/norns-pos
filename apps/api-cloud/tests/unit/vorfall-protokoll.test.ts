/**
 * ════════════════════════════════════════════════════════════════════════
 *  Der Faden überlebt den Neustart — und trägt keinen Kundennamen
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 09.08.2026 ───────────────────────────────────────────
 *
 * Kein Fehlschlag hinterliess eine dauerhafte Spur:
 *
 *   app.ts:190     Pino auf stdout, keine Datei
 *   motor.rs:407   while empfaenger.recv().is_ok() {}   ← verwirft alles
 *   motor.rs:75    zwölf Zeilen im Arbeitsspeicher, sonst nichts
 *
 * Die Vorgangskennung war nach einem Neustart für immer weg.
 *
 * ── ⚠️ UND WARUM DIE NAHELIEGENDE LÖSUNG FALSCH GEWESEN WÄRE ───────────
 *
 * „Rust fängt stdout und schreibt es in eine Datei" hätte personenbezogene
 * Daten unverschlüsselt neben die Datenbank gelegt: in einer Fehlermeldung
 * kann ein Kundenname stehen, in einer Adresse seine Kennung. Die Datei
 * räumt niemand auf, und sie reist in jeder Sicherung mit.
 *
 * Deshalb schreibt der Motor eine ENGE Zeile aus festen Feldern. Diese
 * Prüfung hält fest, dass daran niemand etwas anbaut.
 */

import { describe, expect, it } from 'vitest';

import {
  VORFALL_TAGE,
  dateiname,
  zeile,
  zuAlt,
  type Vorfall,
} from '../../src/lib/vorfall-protokoll.js';

const beispiel = (): Vorfall => ({
  zeit: '2026-08-09T10:15:00.000Z',
  vorgang: '7f3a1c2e-0000-4000-8000-000000000001',
  stelle: 'NORNS-BARGELD-OHNE-SCHICHT',
  code: 'CONFLICT',
  status: 409,
  verb: 'POST',
  muster: '/api/transactions/finalize',
});

describe('⛔ Die Zeile trägt genau sieben Felder — und keins mehr', () => {
  it('⛔ die Felder stehen alle da', () => {
    const o = JSON.parse(zeile(beispiel())) as Record<string, unknown>;
    expect(Object.keys(o).sort()).toEqual([
      'code',
      'muster',
      'status',
      'stelle',
      'verb',
      'vorgang',
      'zeit',
    ]);
  });

  it('⛔ ein angebautes Feld erreicht die Platte NICHT', () => {
    /**
     * Der Kern des Datenschutzes hier. Wer der Zeile später eine Meldung
     * oder einen Rumpf anhängt, muss `zeile()` ändern — und dieser Satz
     * wird dann rot, statt dass ein Kundenname still auf der Platte landet.
     */
    const mitFracht = {
      ...beispiel(),
      meldung: 'Kunde Max Mustermann hat kein Ausweisdokument',
      rumpf: { kunde: 'Max Mustermann' },
    } as unknown as Vorfall;

    const roh = zeile(mitFracht);
    expect(roh, 'ein Kundenname ist auf der Platte gelandet').not.toContain('Mustermann');
    expect(roh).not.toContain('meldung');
    expect(roh).not.toContain('rumpf');
  });

  it('⚠️ jede Zeile endet mit einem Umbruch, sonst verschmelzen zwei Vorfälle', () => {
    expect(zeile(beispiel()).endsWith('\n')).toBe(true);
    expect(zeile(beispiel()).slice(0, -1)).not.toContain('\n');
  });
});

describe('⛔ Das Protokoll wächst nicht unbegrenzt', () => {
  it('⛔ eine Datei je Tag — und zwar je BERLINER Tag', () => {
    /*
     * ⛔ 21.08.2026: diese Probe hielt bis heute den Defekt fest, statt ihn zu
     * verhindern. Sie erwartete `vorfaelle-2026-08-09` für den Zeitpunkt
     * `2026-08-09T23:59Z` — der in Berlin (Sommerzeit, UTC+2) aber schon
     * 01:59 am ZEHNTEN ist. Sie war grün, weil sie dieselbe UTC-Rechnung
     * abschrieb, die sie hätte prüfen sollen.
     *
     * Wer am Morgen nachsieht, was in der Nacht schiefging, öffnet die Datei
     * mit dem Datum von gestern — und findet nichts.
     */
    expect(dateiname(new Date('2026-08-09T23:59:00.000Z'))).toBe('vorfaelle-2026-08-10.jsonl');
    // Mitten am Tag ist die Frage gar nicht erst da.
    expect(dateiname(new Date('2026-08-09T12:00:00.000Z'))).toBe('vorfaelle-2026-08-09.jsonl');
    // Und im Winter (UTC+1) verschiebt sich die Grenze um eine Stunde.
    expect(dateiname(new Date('2026-01-14T23:30:00.000Z'))).toBe('vorfaelle-2026-01-15.jsonl');
  });

  it('⛔ zu alte Dateien werden erkannt, junge nicht', () => {
    const jetzt = new Date('2026-08-09T12:00:00.000Z');
    const namen = [
      'vorfaelle-2026-08-09.jsonl', // heute
      'vorfaelle-2026-07-20.jsonl', // 20 Tage alt
      'vorfaelle-2026-06-01.jsonl', // weit drüber
      'vorfaelle-2025-01-01.jsonl',
    ];
    expect(zuAlt(namen, jetzt)).toEqual(['vorfaelle-2026-06-01.jsonl', 'vorfaelle-2025-01-01.jsonl']);
  });

  it('⛔ und eine FREMDE Datei wird niemals angefasst', () => {
    /**
     * ⚠️ Der gefährlichste Fall. Läge das Protokoll je in einem Ordner mit
     * anderem Inhalt, dürfte das Aufräumen nichts davon anrühren. Die
     * Datenbank und die Sicherungen liegen im selben Datenort.
     */
    const jetzt = new Date('2026-08-09T12:00:00.000Z');
    const fremd = [
      'schluessel-zeuge.txt',
      'norns-sicherung-2020-01-01.dump',
      'pg-port',
      'vorfaelle.jsonl',
      'vorfaelle-2020-13-99.jsonl',
    ];
    expect(zuAlt(fremd, jetzt)).toEqual([]);
  });

  it('⚠️ und die Frist ist eine Frist, kein Zufall', () => {
    expect(VORFALL_TAGE).toBeGreaterThanOrEqual(14);
    expect(VORFALL_TAGE).toBeLessThanOrEqual(90);
  });
});

describe('⛔ Der Behandler schreibt wirklich, und nur das Muster', () => {
  it('⛔ der lebende Weg steht da', async () => {
    const { readFileSync } = await import('node:fs');
    const q = readFileSync(
      new URL('../../src/plugins/error-handler.ts', import.meta.url).pathname,
      'utf8',
    );
    // POSITIV: der Aufruf ist da.
    expect(q, 'der Vorfall wird nicht festgehalten').toMatch(/haltFest\(datenort, \{/);
    // Und er nimmt die SCHABLONE, nicht die gefahrene Adresse.
    expect(q, 'die echte Adresse landet auf der Platte').toMatch(/routeOptions\?\.url/);
    expect(q, 'die gefahrene Adresse wird mitgeschrieben').not.toMatch(/muster: req\.url/);
  });
});
