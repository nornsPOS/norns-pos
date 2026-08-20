/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⛔ Die Startliste nennt eine Vorgabe eine Vorgabe
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 20.08.2026 ──────────────────────────────────────────────
 *
 * Wanderung 0150 gibt einer frischen Kasse Platzhalter für Berater- und
 * Mandantennummer (1001 / 99999), damit sie am ERSTEN Tag einen Steuerexport
 * erzeugen kann. Das war Basels ausdrückliche Anweisung, und sie ist richtig.
 *
 * Sie hätte aber beinahe eine Lüge an einer zweiten Stelle erzeugt. Die
 * Startliste misst diese Angaben mit `leer()`. Ein Platzhalter ist nicht
 * leer — also hätte sie ab sofort gemeldet:
 *
 *     „Alle sechs Angaben des Steuerberaters sind eingetragen."  ✓ erledigt
 *
 * Das ist GENAU die Gefahr, wegen der Wanderung 0117 einen früheren Versuch
 * mit Platzhaltern wieder ausgebaut hat: „eine falsche Mandantennummer lädt
 * die Buchungen STILL in die Bücher eines fremden Betriebs; auffallen würde
 * das erst beim Jahresabschluss." Der Händler hätte der grünen Liste geglaubt
 * und die zwei Zahlen nie angefasst.
 *
 * ── WAS DIESER WÄCHTER MISST ───────────────────────────────────────────────
 *
 * Über den echten HTTP-Weg gegen den echten Server mit allen echten
 * Wanderungen, nicht gegen die Datenbankzeile:
 *
 *   1. Frisch: der DATEV-Punkt ist OFFEN und sagt im Klartext, dass es
 *      Vorgaben sind — obwohl beide Felder gefüllt sind.
 *   2. Er hält nichts auf (`sperre: KOSMETIK`): die Datei entsteht, sie sagt
 *      nur selbst, dass sie noch zugeordnet werden muss.
 *   3. Gegenprobe: trägt der Händler SEINE zwei Zahlen ein, ist der Punkt
 *      erledigt. Ohne diesen Satz wäre eine Liste, die IMMER mahnt, genauso
 *      grün — und damit wieder wertlos.
 *   4. Und leert jemand ein Feld ganz, kehrt die harte Sperre zurück: der
 *      Export lehnt dann ab, und die Liste sagt dasselbe.
 */

import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { baueFiskalBuehne } from '../helfer/fiskal-buehne.js';

interface Schritt {
  titel: string;
  erklaerung: string;
  sperre: string;
  erledigt: boolean;
}
interface Startliste {
  kannVerkaufen: boolean;
  schritte: Schritt[];
}

/** Der eine Punkt, um den es hier geht — an seinem Riegel erkannt. */
function datevPunkt(a: Startliste): Schritt {
  const treffer = a.schritte.filter((s) => s.titel.startsWith('DATEV'));
  expect(treffer, 'Der DATEV-Punkt steht nicht mehr in der Startliste').toHaveLength(1);
  return treffer[0]!;
}

describe('⛔ Die Startliste nennt eine Vorgabe eine Vorgabe', () => {
  const buehne = baueFiskalBuehne({});

  beforeAll(async () => {
    await buehne.starten();
    await buehne.leeren();
  }, 180_000);

  afterAll(async () => {
    await buehne.stoppen();
  });

  function schreibe(schluessel: string, wert: string): Promise<LightMyRequestResponse> {
    const wer = buehne.akteure;
    return buehne.app.inject({
      method: 'PATCH',
      // Der EIGENE Weg der DATEV-Fläche — derselbe, den der Händler
      // benutzt. Er ist es, der den Schlüssel aus `datev.platzhalter`
      // nimmt; ein Schreiben am ihm vorbei bewiese nichts.
      url: `/api/settings/datev/${schluessel}`,
      headers: {
        cookie: `warehouse14.session=${wer.inhaberSitzung}`,
        'x-dev-device-fingerprint': wer.geraetFingerabdruck,
        'content-type': 'application/json',
      },
      payload: { value: wert },
    });
  }

  async function startliste(): Promise<Startliste> {
    const wer = buehne.akteure;
    const antwort = await buehne.app.inject({
      method: 'GET',
      url: '/api/einrichtung',
      headers: {
        cookie: `warehouse14.session=${wer.inhaberSitzung}`,
        'x-dev-device-fingerprint': wer.geraetFingerabdruck,
      },
    });
    expect(antwort.statusCode, antwort.body).toBe(200);
    return antwort.json() as Startliste;
  }

  it('⛔ frisch: beide Felder gefüllt — und der Punkt bleibt trotzdem OFFEN', async () => {
    const punkt = datevPunkt(await startliste());

    expect(
      punkt.erledigt,
      'Die Startliste erklärt eine Vorgabe zur Angabe des Steuerberaters. ' +
        'Der Händler wird sie nie eintragen — und der Steuerberater bekommt ' +
        'die Buchungen eines fremden Betriebs.',
    ).toBe(false);

    // Und sie sagt WARUM, im Klartext, ohne Fachwort.
    expect(punkt.erklaerung).toContain('Vorgaben');
    expect(punkt.erklaerung).toContain('MANDANT ZUORDNEN');
    expect(punkt.erklaerung).toContain('Steuerberater');
  });

  it('hält aber nichts auf — der Export läuft ab Werk', async () => {
    // KOSMETIK heisst in dieser Liste: fehlt, hält nichts auf. Stünde hier
    // EXPORT, meldete die Fläche eine Sperre, die es nicht gibt.
    expect(datevPunkt(await startliste()).sperre).toBe('KOSMETIK');
  });

  it('⛔ Gegenprobe: mit den eigenen Zahlen ist der Punkt ERLEDIGT', async () => {
    // Ohne diesen Satz wäre eine Liste, die immer mahnt, genauso grün.
    expect((await schreibe('datev.beraternummer', '29098')).statusCode).toBe(200);
    expect((await schreibe('datev.mandantennummer', '55003')).statusCode).toBe(200);

    const punkt = datevPunkt(await startliste());
    expect(punkt.erledigt, 'Die Liste mahnt weiter, obwohl beide Zahlen stehen').toBe(true);
    expect(punkt.erklaerung).not.toContain('MANDANT ZUORDNEN');
  });

  it('die Fläche selbst lässt ein Feld gar nicht erst leeren', async () => {
    // Gemessen, nicht angenommen: der eigene Weg der DATEV-Fläche weist die
    // leere Eingabe ab und sagt, was er erwartet. Ein Händler kann sich
    // diesen Zustand also nicht aus Versehen bauen.
    const abgewiesen = await schreibe('datev.mandantennummer', '');
    expect(abgewiesen.statusCode).toBe(400);
    expect(abgewiesen.body).toContain('Mandantennummer');
  });

  it('⛔ steht ein Feld dennoch leer, kehrt die harte Sperre zurück', async () => {
    /*
     * Über die Fläche geht das nicht (Satz darüber). Aus der Datenbank
     * heraus schon: eine Kasse, die vor Wanderung 0150 eingerichtet und
     * seither nie angefasst wurde, oder ein Eingriff von Hand.
     *
     * In diesem Augenblick lehnt der Riegel `ladeDatevMandant` den Export
     * mit DATEV_MANDANT_FEHLT ab. Sagte die Liste dazu „erledigt", erführe
     * der Händler die Absage zum ersten Mal beim Steuerberater — genau der
     * Befund vom 12.08.2026, der diesen Punkt überhaupt entstehen liess.
     */
    await buehne.sql`
      UPDATE system_settings SET value = '""'::jsonb WHERE key = 'datev.mandantennummer'`;

    const punkt = datevPunkt(await startliste());
    expect(punkt.erledigt).toBe(false);
    expect(punkt.sperre).toBe('EXPORT');
    expect(punkt.erklaerung).toContain('Mandantennummer');
  });
});
