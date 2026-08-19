/**
 * ════════════════════════════════════════════════════════════════════════
 *  Jeder Punkt der Startliste führt an einen Ort, den es WIRKLICH gibt
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 08.08.2026 ───────────────────────────────────────────
 *
 * Die Karte „Diese Kasse kann noch nicht verkaufen" beschrieb sieben Wege
 * und öffnete NULL davon. `wohin` war Prosa: „Einstellungen, Steuer". Der
 * Mensch musste selbst suchen.
 *
 * Und bei einem Punkt stimmte die Prosa nicht einmal: der Umsatzsteuer-Status
 * (`steuer.modus`) wird in `BetriebSection` gepflegt, nicht unter „Steuer".
 * Wer dem Satz folgte, landete in einem Bereich, in dem es das Feld nicht
 * gibt, und schloss daraus, die Kasse sei kaputt.
 *
 * ── WARUM DIESER WÄCHTER ────────────────────────────────────────────────
 *
 * `ziel` ist eine Adresse in einem ANDEREN Paket. Nichts im Typsystem
 * verbindet sie: ein umbenannter Bereich, eine entfernte Fläche, und der
 * Griff führt still ins Leere. Genau die Sorte Bruch, die niemand bemerkt,
 * weil beide Seiten für sich gültig bleiben.
 *
 * Hier wird sie gemessen: jeder `pfad` steht in der Flächenliste der Kasse,
 * jeder `bereich` in der Bereichsliste der Einstellungen.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { leseStammdaten } from '../../src/lib/haendler-stammdaten.js';
import { offeneSchritte, type Schritt } from '../../src/lib/einrichtung.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '../../../..');

/** Eine leere Kasse — dann sind ALLE Punkte offen und alle Ziele messbar. */
function alleSchritte(): Schritt[] {
  return offeneSchritte({
    einstellungen: {},
    hatArbeitszeiten: false,
    hatKassencode: false,
    fehlendeStammdaten: ['der vollständige Firmenname'],
  });
}

/** Die Pfade, die die Kasse wirklich kennt. */
function echtePfade(): Set<string> {
  const q = readFileSync(join(REPO, 'apps/tauri-pos/src/app/chrome/surface-registry.ts'), 'utf8');
  const treffer = q.matchAll(/path:\s*'(\/[a-z0-9-]*)'/g);
  return new Set([...treffer].map((m) => m[1] as string));
}

/**
 * Die Bereichskennungen der Einstellungen, aus der Typvereinigung `SectionId`.
 *
 * ⚠️ Aus der VEREINIGUNG, nicht aus der Anzeigeliste: die Anzeigeliste filtert
 * nach Rolle, und ein nur dem Inhaber sichtbarer Bereich ist trotzdem ein
 * gültiges Ziel.
 */
function echteBereiche(): Set<string> {
  const q = readFileSync(join(REPO, 'apps/tauri-pos/src/screens/secondary/Einstellungen.tsx'), 'utf8');
  const block = /type SectionId =([\s\S]*?);/.exec(q);
  if (block === null) throw new Error('die Bereichsliste wurde nicht gefunden');
  return new Set([...block[1]!.matchAll(/'([a-z]+)'/g)].map((m) => m[1] as string));
}

describe('⛔ Die Startliste zeigt auf echte Orte', () => {
  it('⚠️ es gibt überhaupt Punkte zu messen', () => {
    // null ist nicht grün: ein leerer Lauf wäre kein Beweis.
    expect(alleSchritte().length).toBeGreaterThanOrEqual(7);
  });

  it('⛔ jeder Punkt trägt ein Ziel', () => {
    for (const s of alleSchritte()) {
      expect(s.ziel, `„${s.titel}" hat keinen Griff`).toBeDefined();
      expect(s.ziel.pfad, `„${s.titel}" hat keinen Pfad`).toMatch(/^\//);
    }
  });

  it('⛔ jeder Pfad ist eine Fläche, die diese Kasse wirklich hat', () => {
    const pfade = echtePfade();
    expect(pfade.size, 'die Flaechenliste wurde nicht gelesen').toBeGreaterThan(10);
    for (const s of alleSchritte()) {
      expect(pfade.has(s.ziel.pfad), `„${s.titel}" fuehrt nach ${s.ziel.pfad}, das gibt es nicht`).toBe(
        true,
      );
    }
  });

  it('⛔ jeder Bereich ist ein Bereich, den die Einstellungen wirklich haben', () => {
    const bereiche = echteBereiche();
    expect(bereiche.size, 'die Bereichsliste wurde nicht gelesen').toBeGreaterThan(10);
    for (const s of alleSchritte()) {
      if (s.ziel.bereich === undefined) continue;
      expect(
        bereiche.has(s.ziel.bereich),
        `„${s.titel}" fuehrt in den Bereich ${s.ziel.bereich}, den gibt es nicht`,
      ).toBe(true);
    }
  });

  it('⛔ der Umsatzsteuer-Status führt nach Betrieb, nicht nach Steuer', () => {
    /**
     * Der namentliche Befund. Gemessen wird zusätzlich, dass `steuer.modus`
     * dort WIRKLICH gepflegt wird — sonst wäre auch die neue Angabe nur eine
     * andere Behauptung.
     */
    const s = alleSchritte().find((x) => x.titel === 'Umsatzsteuer-Status');
    expect(s, 'der Punkt fehlt').toBeDefined();
    expect(s!.ziel.bereich).toBe('betrieb');

    const betrieb = readFileSync(
      join(REPO, 'apps/tauri-pos/src/screens/secondary/BetriebSection.tsx'),
      'utf8',
    );
    expect(betrieb, 'BetriebSection pflegt steuer.modus gar nicht').toContain("'steuer.modus'");
  });

  it('⛔ ein Ziel, das dem Inhaber gehört, sagt das auch', () => {
    /**
     * Ohne diese Angabe fuehrte ein Knopf einen Kassierer auf eine Flaeche,
     * die er nicht sieht. Gemessen: die Bereiche, die in den Einstellungen
     * `adminOnly` tragen, muessen hier `nurInhaber` tragen.
     */
    const q = readFileSync(
      join(REPO, 'apps/tauri-pos/src/screens/secondary/Einstellungen.tsx'),
      'utf8',
    );
    /**
     * ⚠️ Die erste Fassung dieses Griffs war FALSCH und meldete `beleg` als
     * Inhaberbereich: das Suchmuster lief über die Objektgrenze hinweg und
     * fand das `adminOnly` des NÄCHSTEN Eintrags. Ein Wächter, der die
     * Nachbarzeile misst, ist derselbe Fehler wie der, den er sucht.
     *
     * Die Vorausschau `(?!id:)` hält das Muster innerhalb eines Eintrags.
     */
    const nurAdmin = new Set(
      [...q.matchAll(/id:\s*'([a-z]+)',(?:(?!\bid:)[\s\S]){0,300}?adminOnly:\s*true/g)].map(
        (m) => m[1] as string,
      ),
    );
    // Gegenprobe zur Vorrichtung selbst: `beleg` trägt KEIN adminOnly.
    expect(nurAdmin.has('beleg'), 'der Waechter liest ueber die Objektgrenze hinaus').toBe(false);
    expect(nurAdmin.has('betrieb'), 'der Waechter findet den echten Inhaberbereich nicht').toBe(true);
    expect(nurAdmin.size, 'kein einziger adminOnly-Bereich gefunden').toBeGreaterThan(0);

    for (const s of alleSchritte()) {
      if (s.ziel.bereich !== undefined && nurAdmin.has(s.ziel.bereich)) {
        expect(
          s.ziel.nurInhaber,
          `„${s.titel}" fuehrt in den Inhaberbereich ${s.ziel.bereich}, meldet es aber nicht`,
        ).toBe(true);
      }
    }
  });

  it('⛔ und ein Ziel, dessen HANDLUNG dem Inhaber gehört, sagt das auch', () => {
    /*
     * ── WARUM DER SATZ DARÜBER NICHT GENÜGT (Tiefenjagd 11.08.2026) ───────
     *
     * Der Satz darüber misst, ob der BEREICH `adminOnly` trägt. Der Bereich
     * `hardware` tut das nicht — der Kassierer braucht dort die Drucker. Die
     * HANDLUNG dahinter ist aber inhaberpflichtig:
     *
     *     POST /api/tse/einrichten mit Kassierersitzung
     *     → HTTP 403 {"code":"FORBIDDEN","message":"Owner-only operation"}
     *
     * Der Wächter mass also die sichtbare Tür und nicht das verschlossene
     * Schloss dahinter, und der TSE-Punkt meldete jahrelang `nurInhaber:
     * false`. Hausklasse „Wächter misst das Falsche".
     *
     * Dieser Satz ist BEWUSST eng: er prüft genau eine Beziehung, die
     * wirklich besteht (TSE-Punkt ↔ TSE-Route), statt eine Namensliste zu
     * pflegen, die bei der nächsten Route blind wäre.
     */
    const route = readFileSync(join(REPO, 'apps/api-cloud/src/routes/tse-einrichtung.ts'), 'utf8');
    expect(route, 'die TSE-Route verlangt den Inhaber nicht mehr — dann stimmt dieser Satz nicht').
      toContain('requireOwner(req)');

    const tse = alleSchritte().find((s) => s.schluessel === 'tse.tss_id');
    expect(tse, 'den TSE-Punkt gibt es nicht mehr').toBeDefined();
    expect(
      tse!.ziel.nurInhaber,
      'die TSE-Route ist inhaberpflichtig, der Griff führt den Kassierer trotzdem hin',
    ).toBe(true);
  });

  it('⛔ und die Karte baut aus dem Ziel wirklich einen Griff', () => {
    /**
     * ⚠️ POSITIV gemessen, nicht negativ. Ein Wächter, der ein Wort verbietet,
     * trifft im Haus regelmässig die Einfuhrzeile oder den eigenen Kommentar.
     * Gemessen wird stattdessen, dass der lebende Weg dasteht.
     */
    const karte = readFileSync(
      join(REPO, 'apps/tauri-pos/src/screens/werkstatt/EinrichtungCard.tsx'),
      'utf8',
    );
    expect(karte, 'die Karte navigiert nicht').toMatch(/navigate\(adresse\(s\.ziel\)\)/);
    expect(karte, 'die Adresse traegt den Bereich nicht').toMatch(/\?bereich=/);
    expect(karte, 'der Griff ist kein Knopf').toMatch(/<button/);
    expect(karte, 'die Liste frischt nicht auf').toMatch(/invalidateQueries/);
  });

  it('⛔ und die Einstellungen lesen den Bereich wirklich aus der Adresse', () => {
    const q = readFileSync(
      join(REPO, 'apps/tauri-pos/src/screens/secondary/Einstellungen.tsx'),
      'utf8',
    );
    expect(q, 'die Adresse wird nicht gelesen').toMatch(/useSearchParams/);
    expect(q, 'der Bereich wird nicht aus der Adresse genommen').toMatch(/get\('bereich'\)/);
  });

  it('⛔ und die Route gibt das Ziel wirklich heraus', () => {
    /**
     * ⚠️ Fastify entfernt still, was das Antwortschema nicht kennt. Im Haus
     * hat das schon einmal genau das Feld verschluckt, das die Wahrheit trug.
     */
    const route = readFileSync(join(REPO, 'apps/api-cloud/src/routes/einrichtung.ts'), 'utf8');
    expect(route, 'das Antwortschema kennt das Ziel nicht').toMatch(/ziel:\s*Type\.Object/);
    expect(route).toMatch(/pfad:\s*Type\.String\(\)/);
    expect(route).toMatch(/nurInhaber:\s*Type\.Boolean\(\)/);
  });
});

describe('⚠️ Die Stammdaten-Prüfung bleibt dieselbe wie im Export', () => {
  it('ein vollständiger Stand hat keinen Stammdatenpunkt mehr', () => {
    // Gegenprobe: sonst wäre „alle Punkte offen" auch dann erfüllt, wenn die
    // Liste schlicht immer alles meldet.
    const schritte = offeneSchritte({
      einstellungen: {},
      hatArbeitszeiten: false,
      hatKassencode: false,
      fehlendeStammdaten: leseStammdaten({
        'shop.legal_name': 'Muster e. K.',
        'shop.street': 'Musterstraße 1',
        'shop.postal_code': '73614',
        'shop.city': 'Musterstadt',
        'shop.country_code': 'DEU',
        'shop.tax_number': '12345/67890',
      }).fehlt,
    });
    expect(schritte.some((s) => s.titel === 'Stammdaten des Betriebs')).toBe(false);
  });
});
