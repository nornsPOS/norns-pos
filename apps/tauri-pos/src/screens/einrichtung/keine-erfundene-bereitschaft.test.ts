/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ DER PRÜFSTEIN LIEST DIE BEREITSCHAFT. ER RECHNET SIE NICHT.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── BASELS ENTSCHEIDUNG VOM 14.08.2026 ────────────────────────────────────
 *
 * Auf ausdrückliche Nachfrage: der Prüfstein LÄSST den Händler in die Kasse,
 * auch wenn die technische Sicherheitseinrichtung noch fehlt. Er hält
 * niemanden auf.
 *
 * Genau deshalb muss das, was er SAGT, stimmen. Ein Prüfstein, der
 * durchlässt UND beschönigt, ist zweimal falsch.
 *
 * ── DIE WUNDE, GEGEN DIE ER GEBAUT IST ────────────────────────────────────
 *
 * ⚠️ Wenn die Fläche die Bereitschaft SELBST rechnet, entsteht eine zweite
 * Wahrheit neben dem Riegel. Beide haben aus ihrer Sicht recht, und der
 * Händler steht dazwischen: die Fläche sagt „alles bereit", der erste
 * Verkauf wird abgewiesen, und er sucht einen Fehler, den ihm jemand hätte
 * nennen können.
 *
 * Dieses Haus hatte genau das schon: die Startliste behauptete, ein Verkauf
 * sei unmöglich, während er längst durchging, weil die Zahl der Belege ohne
 * Sicherungseinrichtung an einer zweiten Stelle gerechnet wurde.
 *
 * ── UND DIE ANDERE RICHTUNG ───────────────────────────────────────────────
 *
 * ⚠️ „null ist nicht grün": kommt gar keine Antwort, darf der Prüfstein
 * NICHT Entwarnung geben. Ein Prüfstein, der bei einem Netzfehler „alles
 * bereit" sagt, ist die Lüge, gegen die er gebaut ist.
 */

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { EINRICHTUNGS_SCHRITTE } from './einrichtungs-schritte.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ASSISTENT = resolve(HIER, 'EinrichtungsAssistent.tsx');

/** Kommentare weg. Eine Erwähnung in Prosa ist kein Gebrauch. */
function ohneKommentare(quelle: string): string {
  const nurUmbrueche = (s: string): string => s.replace(/[^\n]/g, ' ');
  return quelle
    .replace(/\/\*[\s\S]*?\*\//g, nurUmbrueche)
    .replace(/(^|[^:])\/\/.*$/gm, (_t, davor: string) => davor);
}

describe('⛔ Der Prüfstein erfindet keine Bereitschaft', () => {
  const quelle = ohneKommentare(readFileSync(ASSISTENT, 'utf8'));

  it('der Prüfstein steht überhaupt im Weg der Etappen', () => {
    // „null ist nicht grün": ohne den Schritt wäre alles unten gegenstandslos.
    const p = EINRICHTUNGS_SCHRITTE.find((s) => s.kennung === 'pruefstein');
    expect(p, 'es gibt keinen Prüfstein').toBeDefined();
    // Er ist eine Zäsur, kein Formular.
    expect(p?.felder.length, 'der Prüfstein fragt Felder ab').toBe(0);
  });

  it('⛔ die Bereitschaft kommt vom MOTOR, nicht aus einer eigenen Rechnung', () => {
    expect(
      /'\/api\/einrichtung'/.test(quelle),
      'Die Fläche fragt die Startliste des Motors nicht ab. Dann rechnet sie ' +
        'die Bereitschaft selbst, und es gibt zwei Wahrheiten: die Fläche sagt ' +
        '„alles bereit", der Riegel weist den ersten Verkauf ab.',
    ).toBe(true);
    // Und der Prüfstein bekommt WIRKLICH diesen Wert gereicht.
    expect(quelle).toMatch(/kannVerkaufen=\{bereitschaft\.data\?\.kannVerkaufen\}/);
    expect(quelle).toMatch(/punkte=\{bereitschaft\.data\?\.schritte\}/);
  });

  it('⛔ er rechnet die Sperre NICHT selbst nach', () => {
    /*
     * Der Prüfstein darf die Punkte des Motors SORTIEREN, aber er darf nicht
     * aus den Einstellungen ableiten, ob verkauft werden kann. Ein
     * `entwurf['tse.tss_id']`-Vergleich im Prüfstein wäre genau die zweite
     * Wahrheit.
     */
    const i = quelle.indexOf('function Pruefstein');
    expect(i).toBeGreaterThan(-1);
    const rumpf = quelle.slice(i, quelle.indexOf('function Anleitung'));
    expect(
      /entwurf\[/.test(rumpf),
      'Der Prüfstein liest die Einstellungen selbst. Damit rechnet er die ' +
        'Bereitschaft nach, statt sie zu lesen.',
    ).toBe(false);
    expect(
      /tse\.tss_id|steuer\.modus/.test(rumpf),
      'Der Prüfstein nennt einen Einstellungsschlüssel. Er soll die Punkte des ' +
        'Motors zeigen, nicht seine eigene Prüfung bauen.',
    ).toBe(false);
  });

  it('⛔ ohne Antwort gibt er KEINE Entwarnung', () => {
    const i = quelle.indexOf('function Pruefstein');
    const rumpf = quelle.slice(i, quelle.indexOf('function Anleitung'));
    // Der undefined-Zweig muss existieren und darf nicht „bereit" sagen.
    expect(rumpf).toMatch(/kannVerkaufen === undefined/);
    const zweig = rumpf.slice(rumpf.indexOf('kannVerkaufen === undefined'));
    expect(
      /kann verkaufen|alles bereit|bereit\./i.test(zweig.slice(0, 400)),
      'Bei fehlender Antwort behauptet der Prüfstein Bereitschaft. Ein ' +
        'Netzfehler darf keine Entwarnung sein.',
    ).toBe(false);
  });

  it('⛔ und er lässt den Händler wirklich durch (Basels Entscheidung)', () => {
    /*
     * Die Gegenprobe. Ein Prüfstein, der doch sperrt, wäre gegen die
     * ausdrückliche Entscheidung vom 14.08.2026 gebaut. Der Weg weiter darf
     * an dieser Stelle an keine Bedingung geknüpft sein.
     */
    const i = quelle.indexOf('function Pruefstein');
    const rumpf = quelle.slice(i, quelle.indexOf('function Anleitung'));
    expect(
      /disabled|return null/.test(rumpf),
      'Der Prüfstein sperrt oder verschwindet. Er soll zeigen und durchlassen.',
    ).toBe(false);
  });
});
