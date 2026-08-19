/**
 * ════════════════════════════════════════════════════════════════════════
 *  Ein Code, der die STELLE nennt, nicht nur die Art
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 09.08.2026 ───────────────────────────────────────────
 *
 *     194 Fehlerklassen erben von DomainError
 *      20 Codes gibt es am Draht
 *     139 der 194 fallen auf DREI davon:
 *           50 × CONFLICT   46 × NOT_FOUND   43 × VALIDATION_ERROR
 *
 * Der Händler rief an und sagte „es kam ein Konflikt". Davon gibt es
 * fünfzig. Und die `requestId`, die es hätte auflösen können, sah er nie:
 * im ganzen Kassenquelltext kommt das Wort viermal vor, alle vier in
 * Vorschau-Attrappen.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { KENNUNG_VORSATZ, stellenkennung } from '../../src/lib/fehlerkennung.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '../../../..');

describe('⛔ Die Kennung nennt die Stelle', () => {
  it('⛔ aus dem Klassennamen wird eine lesbare Kennung', () => {
    expect(stellenkennung('BargeldOhneSchichtError')).toBe('NORNS-BARGELD-OHNE-SCHICHT');
    expect(stellenkennung('KycRequiredError')).toBe('NORNS-KYC-REQUIRED');
    expect(stellenkennung('MargeOhneEinkaufspreisError')).toBe('NORNS-MARGE-OHNE-EINKAUFSPREIS');
  });

  it('⚠️ eine Abkürzung am Anfang bleibt zusammen', () => {
    // `ZNummerFehlt` darf nicht `ZNUMMER` werden.
    expect(stellenkennung('ZNummerFehltError')).toBe('NORNS-Z-NUMMER-FEHLT');
    expect(stellenkennung('TSEAusfallError')).toBe('NORNS-TSE-AUSFALL');
  });

  it('⚠️ Umlaute bleiben stehen, damit der Mensch das Wort erkennt', () => {
    expect(stellenkennung('PrüferpaketFehltError')).toBe('NORNS-PRÜFERPAKET-FEHLT');
  });

  it('⚠️ und Unsinn wird nicht zu einer leeren Kennung', () => {
    // Eine leere Kennung wäre schlimmer als keine: sie SÄHE aus wie eine.
    expect(stellenkennung('')).toBe(`${KENNUNG_VORSATZ}-UNBEKANNT`);
    expect(stellenkennung('Error')).toBe(`${KENNUNG_VORSATZ}-UNBEKANNT`);
    expect(stellenkennung('   ')).toBe(`${KENNUNG_VORSATZ}-UNBEKANNT`);
  });
});

describe('⛔ Jede Fehlerklasse dieses Motors bekommt eine eigene Kennung', () => {
  /** Alle Klassennamen, die von `DomainError` erben. */
  function alleFehlerklassen(): string[] {
    const namen: string[] = [];
    const gehe = (ordner: string): void => {
      for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
        const pfad = join(ordner, eintrag.name);
        if (eintrag.isDirectory()) gehe(pfad);
        else if (eintrag.name.endsWith('.ts')) {
          const q = readFileSync(pfad, 'utf8');
          for (const m of q.matchAll(/class\s+([A-Za-z0-9_]+)\s+extends\s+DomainError/g)) {
            namen.push(m[1] as string);
          }
        }
      }
    };
    gehe(join(REPO, 'apps/api-cloud/src'));
    return namen;
  }

  const klassen = alleFehlerklassen();

  it('⚠️ es gibt überhaupt welche zu messen', () => {
    // null ist nicht grün: fände die Suche nichts, wäre alles unten erfüllt.
    expect(klassen.length).toBeGreaterThan(50);
  });

  it('⛔ keine Klasse bleibt ohne Kennung', () => {
    for (const k of klassen) {
      const kennung = stellenkennung(k);
      expect(kennung, `${k} bekommt keine Kennung`).not.toBe(`${KENNUNG_VORSATZ}-UNBEKANNT`);
      expect(kennung.startsWith(`${KENNUNG_VORSATZ}-`)).toBe(true);
    }
  });

  it('⛔ und zwei Klassen teilen sich keine Kennung', () => {
    /**
     * Zwei Klassen mit derselben Kennung wären schlimmer als keine: der
     * Händler liest sie vor, und man landet an zwei Stellen.
     */
    const gesehen = new Map<string, string>();
    const doppelt: string[] = [];
    for (const k of new Set(klassen)) {
      const kennung = stellenkennung(k);
      const vorher = gesehen.get(kennung);
      if (vorher !== undefined) doppelt.push(`${kennung}: ${vorher} und ${k}`);
      else gesehen.set(kennung, k);
    }
    expect(doppelt).toEqual([]);
  });
});

describe('⛔ Die Kennung überlebt den Weg nach draussen', () => {
  it('⛔ DomainError trägt sie, und der Behandler reicht sie weiter', () => {
    /**
     * ⚠️ POSITIV gemessen: der lebende Weg muss dastehen. Ein Wächter, der
     * ein Wort verbietet, trifft im Haus regelmässig den eigenen Kommentar.
     */
    const q = readFileSync(join(REPO, 'apps/api-cloud/src/plugins/error-handler.ts'), 'utf8');
    expect(q, 'DomainError hat keine Stelle').toMatch(/get stelle\(\): string/);
    expect(q, 'der Behandler reicht sie nicht weiter').toMatch(/err\.stelle/);
    expect(q, 'die Antwortform kennt sie nicht').toMatch(/stelle\?: string/);
  });

  it('⛔ der Klient nimmt sie auf und der Mensch sieht sie', () => {
    const klient = readFileSync(join(REPO, 'packages/api-client/src/errors.ts'), 'utf8');
    expect(klient, 'ApiError traegt die Stelle nicht').toMatch(/readonly stelle: string \| null/);

    const text = readFileSync(join(REPO, 'packages/i18n-de/src/german-text.ts'), 'utf8');
    expect(text, 'der Satz traegt die Stelle nicht').toMatch(/function mitStelle/);
    expect(text, 'describeError haengt sie nicht an').toMatch(
      /mitStelle\(satzOhneStelle\(err\), err\)/,
    );
  });

  it('⚠️ und die Klassennamen überleben das Bündeln', () => {
    /**
     * ⚠️ DIE MESSUNG, DIE DAS GANZE TRÄGT.
     *
     * Die Kennung wird aus `this.name` abgeleitet. Würde das ausgelieferte
     * Bündel verkleinert, hiesse jede Klasse `a` und jede Kennung wäre
     * Unsinn, und niemandem fiele es auf, weil die Quelle stimmt.
     *
     * Gemessen wird deshalb das AUSGELIEFERTE Bündel.
     *
     * ── WARUM HIER EINE EIGENE PRÜFUNG AUF DAS DASEIN STEHT ────────────────
     *
     * Bis zum 13.08.2026 stand hier ein nacktes `readFileSync`. Das Bündel ist
     * `.gitignore`-Beute (10,5 MB, erzeugt), und der Prüfauftrag hat es nie
     * gebaut. Auf dem Läufer starb dieser Wächter deshalb IMMER, und zwar mit
     *
     *     Error: ENOENT: no such file or directory, open '…/start.mjs'
     *
     * Das nennt weder die Ursache noch einen Weg. Sichtbar wurde es erst, als
     * die Aufträge davor grün wurden: ein rotes Tor verdeckt das nächste.
     *
     * Der Prüfauftrag baut das Bündel jetzt selbst (172 ms, gemessen). Bleibt
     * es trotzdem aus, sagt dieser Satz, was zu tun ist, statt einen Dateipfad
     * hinzuwerfen.
     */
    const weg = join(REPO, 'apps/tauri-pos/src-tauri/resources/sidecar/start.mjs');
    expect(
      existsSync(weg),
      'Das ausgelieferte Bündel `resources/sidecar/start.mjs` fehlt, also kann ' +
        'dieser Wächter das nicht messen, wofür es ihn gibt: ob die ' +
        'Klassennamen das Bündeln überleben. Die Datei ist erzeugt und nicht ' +
        'eingecheckt. Herstellen mit:\n\n' +
        '    node scripts/buendle-motor.mjs\n\n' +
        'Das dauert etwa eine Fünftelsekunde. Der Prüfauftrag ruft es von ' +
        'selbst, siehe den Schritt „Das Bündel, das gemessen wird" in ' +
        '`.github/workflows/ci.yml`.',
    ).toBe(true);

    const buendel = readFileSync(weg, 'utf8');
    expect(buendel.includes('KycRequiredError'), 'die Klassennamen sind verkleinert').toBe(true);
    expect(buendel.includes('DomainError'), 'die Grundklasse fehlt im Buendel').toBe(true);
  });
});
