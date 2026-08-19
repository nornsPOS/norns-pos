/**
 * Der Prüferlauf darf nicht beim ersten schlechten Tag stehenbleiben.
 *
 * ── BASELS ANWEISUNG VOM 02.08.2026 ────────────────────────────────────────
 *
 * Wörtlich: wenn der Prüfer den Laden besucht und den Knopf drückt, MUSS er
 * laufen. Jedes Problem kostet Bussgelder und zerstört den Ruf für immer.
 *
 * ── DIE ZWEI EIGENSCHAFTEN, DIE HIER HÄNGEN ────────────────────────────────
 *
 * ⚠️ 1. EIN STURZ REISST KEINEN ANDEREN MIT. Die alte Schleife lag in EINEM
 *    `try`: warf der 47. von 900 Kassentagen, endete alles. Der Händler las
 *    „Export fehlgeschlagen" und wusste nicht, welche Tage schon da waren.
 *
 * ⚠️ 2. UNVOLLSTÄNDIG WIRD NIE ALS ERFOLG GEMELDET. Bei einer Kassennachschau
 *    ist ein Datenträger mit Lücken schlimmer als gar keiner, weil er nach
 *    Erfüllung aussieht. Die fehlenden Tage stehen deshalb NAMENTLICH da.
 */

import { describe, expect, it } from 'vitest';

import { berichtssatz, imFenster, laufeUeberTage, type Nachschautag } from './nachschau-lauf.js';

const tage = (...namen: string[]): Nachschautag[] => namen.map((t) => ({ id: `id-${t}`, tag: t }));
const sag = (f: unknown): string => (f instanceof Error ? f.message : 'unbekannt');

describe('Der Lauf für die Kassennachschau', () => {
  it('⛔ ein einzelner Sturz beendet den Lauf NICHT', async () => {
    // Der Kern. Vorher hörte alles beim ersten Wurf auf.
    const angefasst: string[] = [];
    const bericht = await laufeUeberTage(
      tage('2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'),
      async (t) => {
        angefasst.push(t.tag);
        if (t.tag === '2026-01-02') throw new Error('Der Ankauf hat keinen Geschäftsvorfalltyp.');
      },
      sag,
    );

    expect(angefasst, 'nach dem Sturz wurde aufgehört').toHaveLength(4);
    expect(bericht.gelungen).toBe(3);
    expect(bericht.gescheitert).toBe(1);
    expect(bericht.fehlendeTage).toEqual(['2026-01-02']);
  });

  it('⛔ der fehlende Tag steht NAMENTLICH im Satz, nicht nur als Zahl', async () => {
    const bericht = await laufeUeberTage(
      tage('2026-01-01', '2026-01-02'),
      async (t) => {
        if (t.tag === '2026-01-02') throw new Error('Der Ankauf hat keinen Geschäftsvorfalltyp.');
      },
      sag,
    );
    expect(bericht.satz).toContain('2026-01-02');
    expect(bericht.satz).toContain('FEHLEN');
    // Und der Grund reist mit, sonst weiss niemand, was zu tun ist.
    expect(bericht.satz).toContain('Geschäftsvorfalltyp');
  });

  it('⛔ unvollständig wird NIE als Erfolg gemeldet', async () => {
    const bericht = await laufeUeberTage(
      tage('a', 'b', 'c'),
      async (t) => {
        if (t.tag === 'c') throw new Error('kaputt');
      },
      sag,
    );
    // Kein „2 von 3 erfolgreich", und kein „lückenlos". Nur das Wort, das
    // zählt: unvollständig.
    expect(bericht.satz).not.toMatch(/erfolgreich/i);
    expect(bericht.satz).not.toContain('lückenlos');
    expect(bericht.satz).toContain('unvollständig');
    // Und die Zahl der GELUNGENEN Tage steht NICHT vorne im Satz, wo sie wie
    // ein Erfolg aussähe. Vorne stehen die fehlenden.
    expect(bericht.satz.indexOf('FEHLEN')).toBeLessThan(bericht.satz.indexOf('unvollständig'));
  });

  it('bei vollem Erfolg sagt der Satz genau das, mit der Zahl', async () => {
    const bericht = await laufeUeberTage(tage('a', 'b'), async () => {}, sag);
    expect(bericht.gescheitert).toBe(0);
    expect(bericht.satz).toContain('Alle 2');
    expect(bericht.satz).toContain('lückenlos');
  });

  it('ein leerer Zeitraum ist kein Erfolg und kein Fehler, sondern ein Satz', () => {
    const satz = berichtssatz(0, [], []);
    expect(satz).toContain('kein abgeschlossener Kassentag');
    // Kein „alles vollständig" auf einer leeren Menge. Das ist die Klasse
    // „grün, weil nichts geprüft wurde".
    expect(satz).not.toContain('lückenlos');
  });

  it('jeder Tag wird gemeldet, damit 900 Tage kein stummes Fenster sind', async () => {
    const gemeldet: string[] = [];
    await laufeUeberTage(tage('a', 'b', 'c'), async () => {}, sag, (fertig, gesamt, tag) =>
      gemeldet.push(`${tag} ${fertig}/${gesamt}`),
    );
    expect(gemeldet).toEqual(['a 1/3', 'b 2/3', 'c 3/3']);
  });

  it('das Fenster schliesst BEIDE Grenzen ein', () => {
    // Ein exklusives Ende liesse ausgerechnet den letzten Prüfungstag fallen.
    expect(imFenster('2026-01-01', '2026-01-01', '2026-01-31')).toBe(true);
    expect(imFenster('2026-01-31', '2026-01-01', '2026-01-31')).toBe(true);
    expect(imFenster('2025-12-31', '2026-01-01', '2026-01-31')).toBe(false);
    expect(imFenster('2026-02-01', '2026-01-01', '2026-01-31')).toBe(false);
  });

  it('keine Gedankenstriche in dem, was der Mensch liest', async () => {
    const bericht = await laufeUeberTage(
      tage('a'),
      async () => {
        throw new Error('kaputt');
      },
      sag,
    );
    expect(bericht.satz).not.toMatch(/[—–]/);
  });
});
