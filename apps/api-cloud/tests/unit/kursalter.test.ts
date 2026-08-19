/**
 * Das Alter eines Metallkurses.
 *
 * Gold stand auf der Produktion vom 05.06. bis 13.06. auf EINEM Kurs, 172,8
 * Stunden lang, und wurde die ganze Zeit als aktueller ausgeliefert. Der
 * Ankaufsatz wird ungefragt ins Preisfeld vorgeschrieben; wer in diesem
 * Fenster ankaufte, zahlte nach einem Kurs, den es nicht mehr gab.
 */

import { describe, expect, it } from 'vitest';

import { beurteileKursalter, KURS_HOECHSTALTER_STUNDEN } from '../../src/lib/kursalter.js';

const JETZT = new Date('2026-06-13T12:00:00Z');
const vorStunden = (h: number) => new Date(JETZT.getTime() - h * 3_600_000);

describe('der Vorfall vom Juni', () => {
  it('sieben Tage alter Kurs ist VERALTET', () => {
    const a = beurteileKursalter({ gueltigSeit: vorStunden(172.8), jetzt: JETZT });
    expect(a.alterStunden).toBe(172.8);
    expect(a.veraltet).toBe(true);
  });

  it('und haette schon am ZWEITEN Tag gemeldet, nicht am siebten', () => {
    expect(beurteileKursalter({ gueltigSeit: vorStunden(49), jetzt: JETZT }).veraltet).toBe(true);
  });
});

describe('der Normalbetrieb darf NICHT anschlagen', () => {
  it('der gemessene Rhythmus liegt bei rund 24 Stunden', () => {
    // Auf der Produktion nachgemessen: 24,0 · 24,0 · 24,2 Stunden in Folge.
    // Eine Grenze bei 24 wuerde hier dauernd leuchten, und eine Warnung, die
    // immer leuchtet, wird abgeschaltet. Genau deshalb steht sie bei 48.
    for (const h of [24.0, 24.2, 30, 47.9]) {
      expect(beurteileKursalter({ gueltigSeit: vorStunden(h), jetzt: JETZT }).veraltet, `${h}h`).toBe(
        false,
      );
    }
  });

  it('genau auf der Grenze gilt noch als brauchbar', () => {
    expect(
      beurteileKursalter({ gueltigSeit: vorStunden(KURS_HOECHSTALTER_STUNDEN), jetzt: JETZT })
        .veraltet,
    ).toBe(false);
  });
});

describe('die unangenehmen Faelle', () => {
  it('GAR KEIN Kurs gilt als veraltet, nicht als frisch', () => {
    // „Kein Kurs" ist nicht besser als „alter Kurs", sondern schlechter, und
    // darf erst recht nicht stillschweigend zu einem Preisvorschlag fuehren.
    const a = beurteileKursalter({ gueltigSeit: null, jetzt: JETZT });
    expect(a.alterStunden).toBeNull();
    expect(a.veraltet).toBe(true);
  });

  it('ein unlesbarer Zeitstempel ebenfalls', () => {
    expect(beurteileKursalter({ gueltigSeit: 'kein datum', jetzt: JETZT }).veraltet).toBe(true);
  });

  it('ein Kurs aus der ZUKUNFT legt den Laden nicht lahm', () => {
    // Das waere ein Uhrfehler, kein frischer Kurs. Er zaehlt als Alter null
    // und gilt als brauchbar; sonst koennte eine schiefe Serveruhr den Ankauf
    // vollstaendig blockieren.
    const a = beurteileKursalter({ gueltigSeit: vorStunden(-5), jetzt: JETZT });
    expect(a.alterStunden).toBe(0);
    expect(a.veraltet).toBe(false);
  });

  it('eine eigene Grenze aus den Einstellungen gilt', () => {
    expect(
      beurteileKursalter({ gueltigSeit: vorStunden(30), jetzt: JETZT, hoechstalterStunden: 12 })
        .veraltet,
    ).toBe(true);
  });

  it('eine unsinnige Grenze faellt auf die Vorgabe zurueck', () => {
    for (const g of [0, -5, Number.NaN]) {
      expect(
        beurteileKursalter({ gueltigSeit: vorStunden(30), jetzt: JETZT, hoechstalterStunden: g })
          .veraltet,
        String(g),
      ).toBe(false);
    }
  });
});

/**
 * ⚠️ Der Wächter gegen die Fastify-Falle.
 *
 * Fastify entfernt aus einer Antwort still alles, was das Antwortschema nicht
 * kennt. Die drei Felder unten sind der ganze Sinn dieser Arbeit: ohne sie
 * kann kein Aufrufer merken, dass ein Kurs eingefroren ist, und genau das war
 * sieben Tage lang der Zustand.
 *
 * Wer eines davon aus dem Schema nimmt, bekommt hier rot statt einer stillen
 * Antwort ohne Zeitstempel.
 */
describe('das Antwortschema traegt das Kursalter wirklich', () => {
  it('asOf, ageHours und stale sind deklariert', async () => {
    const { MetalRate } = await import('../../src/schemas/metal-prices.js');
    const felder = Object.keys((MetalRate as { properties: Record<string, unknown> }).properties);

    for (const f of ['asOf', 'ageHours', 'stale']) {
      expect(felder, `${f} fehlt im Antwortschema — Fastify wuerde es entfernen`).toContain(f);
    }
  });

  it('und der Ankaufsatz darf null sein, sonst koennte er nicht zurueckgehalten werden', async () => {
    // Waere er ohne Null-Zweig deklariert, wuerde die Antwort bei einem alten
    // Kurs am EIGENEN Schema scheitern, statt den Vorschlag wegzulassen. Die
    // Kasse bekaeme dann einen Fehler statt einer ehrlichen Luecke.
    const { MetalRate } = await import('../../src/schemas/metal-prices.js');
    const feld = (MetalRate as { properties: Record<string, { anyOf?: Array<{ type?: string }> }> })
      .properties.ankaufRatePerGramEur;

    expect(feld, 'ankaufRatePerGramEur fehlt im Schema').toBeDefined();
    expect(feld?.anyOf, 'ankaufRatePerGramEur ist keine Vereinigung').toBeDefined();
    expect(
      feld?.anyOf?.some((z) => z.type === 'null'),
      'ankaufRatePerGramEur laesst kein null zu — ein alter Kurs wuerde die Antwort sprengen',
    ).toBe(true);
  });
});
