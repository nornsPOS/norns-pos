/**
 * Wächter: die Nachkommastellen der EINGANGSPRÜFUNG müssen die Spalte treffen,
 * in der der Wert am Ende landet.
 *
 * ── WARUM ES DIESEN WÄCHTER GIBT ───────────────────────────────────────────
 *
 * Basels Befund vom 05.08.2026: kein einziges Stück liess sich ins Lager
 * aufnehmen. Er tippte ein Gewicht ein und bekam „Gewicht ungültig bitte
 * prüfen" — vor sich ein völlig richtiges Gewicht.
 *
 * Drei Schichten trugen drei verschiedene Wahrheiten:
 *
 *   Spalte   `products.weight_grams`   numeric(10,4)   vier Stellen
 *   Prüfung  `weightGrams`             Geldregel       ZWEI Stellen
 *   Kasse    sendet                    drei Stellen
 *
 * Eine Feinunze wiegt 31,103 g. Jede Juwelierwaage zeigt Milligramm. Also
 * scheiterte JEDER Zugang mit einem echten Gewicht, und derselbe Riegel sass
 * im Ankauf, dem Kern des Geschäfts.
 *
 * Die richtige Regel (`WeightString`) gab es zu dem Zeitpunkt schon. Sie war
 * nur nirgends im SCHREIBweg angeschlossen: das LESEN eines Produkts erlaubte
 * vier Stellen, das ANLEGEN zwei. Zwei Listen, die auseinandergelaufen sind,
 * und niemand hat es gemerkt, weil beide für sich schlüssig aussahen.
 *
 * ── WIE ER NICHT BLIND WERDEN KANN ─────────────────────────────────────────
 *
 * Er trägt KEINE Liste von Feldnamen. Er nimmt die Prüfschemata selbst,
 * sammelt JEDES Feld, das ein Zahlenmuster trägt, rechnet aus dem Muster die
 * erlaubten Stellen aus und schlägt die Spalte im ECHTEN Bauplan nach.
 *
 * Drei Riegel gegen das stille Nichtstun:
 *   1. Findet er weniger Felder als erwartet, wird er rot. Ein Wächter, der
 *      nichts mehr sieht, ist gefährlicher als gar keiner.
 *   2. Findet er zu einem Feld keine Spalte, wird er rot. Er darf nicht
 *      stillschweigend überspringen, was er nicht versteht.
 *   3. Steht in der Ausnahmeliste ein Feld, das es gar nicht mehr gibt, wird
 *      er rot. Geister sehen aus wie offene Arbeit und sind doch nur Altlast.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

import { AnkaufLineItem } from '../../src/schemas/ankauf.js';
import { CreateProductBody, UpdateProductBody } from '../../src/schemas/product.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const BAUPLAN = join(HIER, '../../sidecar/erststart/schema.sql');

// ──────────────────────────────────────────────────────────────────────────
// Der Bauplan: welche Spalte hält wie viele Stellen?
// ──────────────────────────────────────────────────────────────────────────

interface Spalte {
  /** Gesamtzahl der Ziffern. */
  readonly genauigkeit: number;
  /** Ziffern nach dem Komma. */
  readonly stellen: number;
}

/** Liest jede `numeric(p,s)`-Spalte je Tabelle aus dem echten Bauplan. */
function spaltenAusBauplan(sql: string): Map<string, Map<string, Spalte>> {
  const tabellen = new Map<string, Map<string, Spalte>>();
  const tabellenBlock = /CREATE TABLE (?:IF NOT EXISTS )?(?:[\w"]+\.)?"?(\w+)"?\s*\(([\s\S]*?)\n\);/g;
  for (const [, name, rumpf] of sql.matchAll(tabellenBlock)) {
    // Ohne diesen Riegel wäre der Wächter unter `noUncheckedIndexedAccess`
    // rot: eine Fanggruppe ist für den Typprüfer `string | undefined`. Sie
    // kann hier nie leer sein — beide Gruppen sind Pflichtteile des Musters —
    // aber ein Wächter, der nicht typgeprüft durchgeht, ist kein Wächter.
    if (name === undefined || rumpf === undefined) continue;
    const spalten = new Map<string, Spalte>();
    for (const [, feld, p, s] of rumpf.matchAll(/^\s+"?(\w+)"?\s+numeric\((\d+),\s*(\d+)\)/gm)) {
      if (feld === undefined) continue;
      spalten.set(feld, { genauigkeit: Number(p), stellen: Number(s) });
    }
    if (spalten.size > 0) tabellen.set(name, spalten);
  }
  return tabellen;
}

// ──────────────────────────────────────────────────────────────────────────
// Die Prüfschemata: welches Feld erlaubt wie viele Stellen?
// ──────────────────────────────────────────────────────────────────────────

/**
 * Aus `^-?\d{1,6}(\.\d{1,4})?$` wird {ganze: 6, stellen: 4}.
 *
 * ⚠️ Er muss AUCH die Muster ohne Wiederholungsklammer lesen: `\d` allein
 * heisst eine Ziffer, `\.\d` heisst eine Nachkommastelle. Bei der ersten
 * Fassung tat er das nicht — und übersah damit ausgerechnet `finenessDecimal`
 * und die drei Massfelder, also genau die, die gerade umgestellt worden waren.
 * Riegel 1 hat es gefangen; ohne ihn wäre dieser Wächter grün gewesen und
 * hätte nichts geprüft.
 */
function stellenAusMuster(muster: string): { ganze: number; stellen: number } | null {
  const m = /^\^-?\\d(?:\{1,(\d+)\})?\(\\\.\\d(?:\{1,(\d+)\})?\)\?\$$/.exec(muster);
  if (!m) return null;
  return { ganze: m[1] ? Number(m[1]) : 1, stellen: m[2] ? Number(m[2]) : 1 };
}

/**
 * Holt das Muster eines Feldes heraus, egal wie tief es verpackt ist:
 * `Type.Optional(...)`, `Type.Union([X, Type.Null()])`, oder blank.
 */
function musterVon(knoten: unknown): string | null {
  if (knoten === null || typeof knoten !== 'object') return null;
  const k = knoten as { pattern?: unknown; anyOf?: unknown[] };
  if (typeof k.pattern === 'string') return k.pattern;
  if (Array.isArray(k.anyOf)) {
    for (const zweig of k.anyOf) {
      const treffer = musterVon(zweig);
      if (treffer) return treffer;
    }
  }
  return null;
}

/** camelCase → snake_case, die Regel, nach der dieses Haus Spalten benennt. */
function zurSpalte(feld: string): string {
  return feld.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

interface Pruefling {
  /** Wie das Schema heisst, für die Fehlermeldung. */
  readonly name: string;
  readonly schema: { properties?: Record<string, unknown> };
  /** In welche Tabelle die Felder dieses Rumpfes geschrieben werden. */
  readonly tabelle: string;
  /**
   * Felder, die bewusst KEINE gleichnamige Spalte haben, mit dem Grund.
   * Steht hier ein Feld, das der Rumpf gar nicht mehr trägt, wird der
   * Wächter rot — sonst wüchse hier eine Geisterliste.
   */
  readonly ohneSpalte: Readonly<Record<string, string>>;
}

const PRUEFLINGE: readonly Pruefling[] = [
  { name: 'CreateProductBody', schema: CreateProductBody, tabelle: 'products', ohneSpalte: {} },
  { name: 'UpdateProductBody', schema: UpdateProductBody, tabelle: 'products', ohneSpalte: {} },
  {
    name: 'AnkaufLineItem',
    schema: AnkaufLineItem,
    tabelle: 'products',
    ohneSpalte: {
      // Der Auszahlungsbetrag je Zeile ist der PREIS des Ankaufs, keine
      // Eigenschaft des Stücks. Er landet in `transaction_items`, nicht in
      // `products` — und dort als Geldbetrag mit zwei Stellen, richtig so.
      negotiatedPriceEur: 'Preis des Vorgangs, steht in transaction_items',
    },
  },
];

/**
 * Die Untergrenze dessen, was der Wächter sehen MUSS. Sie ist nicht geraten:
 * am 05.08.2026 gemessen waren es 13 Felder mit einfachem Zahlenmuster. Fällt
 * die Zahl, hat jemand ein Muster entfernt oder umbenannt, und der Wächter
 * prüft weniger, ohne dass irgendwo etwas rot wird.
 */
const MINDESTENS = 13;

/**
 * Muster, die dieser Wächter bewusst NICHT als Dezimalregel liest, mit Grund.
 *
 * ⚠️ Ohne diese Liste wäre das Überspringen still. Ein Feld, dessen Muster
 * niemand lesen kann, sähe genauso aus wie eines, das es gar nicht gibt — und
 * genau daraus entsteht ein Wächter, der grün ist und nichts prüft. Steht ein
 * Muster hier, ist die Entscheidung getroffen und nachlesbar; taucht ein
 * unbekanntes auf, wird der Wächter rot und verlangt eine Entscheidung.
 */
const BEWUSST_UNGELESEN: Readonly<Record<string, string>> = {
  // Feingehalt ist ein VERHÄLTNIS zwischen 0 und 1, kein freier Dezimalwert.
  // Sein Muster begrenzt zusätzlich den Wert, nicht nur die Stellenzahl, und
  // passt damit ohnehin nicht auf den Vergleich „Stellen gegen Spalte".
  // Er trifft numeric(5,4) korrekt: eine Vorkomma-, vier Nachkommastellen.
  '^(0(\\.\\d{1,4})?|1(\\.0{1,4})?)$': 'Feingehalt, ein Verhältnis 0 bis 1',
};

describe('Nachkommastellen: Prüfung und Spalte müssen dasselbe sagen', () => {
  const bauplan = spaltenAusBauplan(readFileSync(BAUPLAN, 'utf8'));

  it('der Bauplan ist überhaupt lesbar', () => {
    expect(bauplan.size).toBeGreaterThan(20);
    expect(bauplan.get('products')?.get('weight_grams')).toEqual({
      genauigkeit: 10,
      stellen: 4,
    });
  });

  const gesehen: string[] = [];
  const ungelesen: { feld: string; muster: string }[] = [];

  for (const pruefling of PRUEFLINGE) {
    const felder = Object.entries(pruefling.schema.properties ?? {});

    for (const [feld, knoten] of felder) {
      const muster = musterVon(knoten);
      if (muster === null) continue;
      const erlaubt = stellenAusMuster(muster);
      if (erlaubt === null) {
        // Nur Muster, die überhaupt ein Komma und Ziffern dahinter kennen,
        // sind Kandidaten für eine Dezimalregel. Ein Kennungs- oder
        // Länderkennzeichen-Muster ist keiner und braucht keinen Eintrag.
        //
        // ⚠️ Gesucht sind die VIER Zeichen `\`, `.`, `\`, `d` in der
        // Musterzeichenkette. Hier stand einmal ein Ausdruck mit doppelt so
        // vielen Fluchtzeichen; er traf nichts, und dieser Riegel war grün,
        // weil er blind war. Genau der Fehler, den er verhindern soll.
        if (/\\\.\\[d0]/.test(muster)) {
          ungelesen.push({ feld: `${pruefling.name}.${feld}`, muster });
        }
        continue;
      }

      gesehen.push(`${pruefling.name}.${feld}`);

      it(`${pruefling.name}.${feld} passt zu ${pruefling.tabelle}.${zurSpalte(feld)}`, () => {
        const grund = pruefling.ohneSpalte[feld];
        if (grund !== undefined) {
          expect(grund.length).toBeGreaterThan(10);
          return;
        }

        const spalte = bauplan.get(pruefling.tabelle)?.get(zurSpalte(feld));
        // Riegel 2: kein stilles Überspringen.
        expect(
          spalte,
          `Zu ${pruefling.name}.${feld} gibt es keine Spalte ${pruefling.tabelle}.${zurSpalte(feld)}. ` +
            'Entweder heisst sie anders, oder das Feld gehört in eine andere Tabelle. ' +
            'Beides muss hier eingetragen werden, damit der Wächter nicht wegsieht.',
        ).toBeDefined();
        if (!spalte) return;

        // Der Kern: die Prüfung darf NICHT weniger Stellen erlauben als die
        // Spalte hält — sonst weist sie einen Wert ab, den die Datenbank
        // problemlos trüge. Genau daran scheiterte jeder Lagerzugang.
        expect(
          erlaubt.stellen,
          `${pruefling.name}.${feld} erlaubt ${erlaubt.stellen} Nachkommastellen, ` +
            `${pruefling.tabelle}.${zurSpalte(feld)} hält ${spalte.stellen}.`,
        ).toBe(spalte.stellen);

        // Und sie darf nicht MEHR Vorkommastellen durchlassen, als die Spalte
        // trägt — sonst kommt der Wert durch die Prüfung und stirbt unten an
        // einem Überlauf, also als 500 statt als lesbarer Satz.
        expect(
          erlaubt.ganze,
          `${pruefling.name}.${feld} lässt ${erlaubt.ganze} Vorkommastellen durch, ` +
            `${pruefling.tabelle}.${zurSpalte(feld)} trägt ${spalte.genauigkeit - spalte.stellen}.`,
        ).toBe(spalte.genauigkeit - spalte.stellen);
      });
    }

    // Riegel 3: keine Geister in der Ausnahmeliste.
    for (const feld of Object.keys(pruefling.ohneSpalte)) {
      it(`${pruefling.name}: die Ausnahme ${feld} gibt es wirklich`, () => {
        expect(Object.keys(pruefling.schema.properties ?? {})).toContain(feld);
      });
    }
  }

  // Riegel 1: der Wächter darf nicht erblinden.
  it(`sieht mindestens ${MINDESTENS} Felder mit Zahlenmuster`, () => {
    expect(gesehen.length, `gesehen: ${gesehen.join(', ')}`).toBeGreaterThanOrEqual(MINDESTENS);
  });

  // Riegel 4: kein STILLES Überspringen. Jedes Muster, das dieser Wächter
  // nicht als Dezimalregel lesen kann, muss oben mit Grund benannt sein.
  it('überspringt kein Muster ohne benannten Grund', () => {
    const fremd = ungelesen.filter((u) => BEWUSST_UNGELESEN[u.muster] === undefined);
    expect(
      fremd.map((u) => `${u.feld} → ${u.muster}`),
      'Ein Feld trägt ein Zahlenmuster, das dieser Wächter nicht lesen kann. ' +
        'Entweder ist es eine Dezimalregel — dann muss `stellenAusMuster` sie lesen — ' +
        'oder es ist keine, dann gehört sie mit Grund in BEWUSST_UNGELESEN.',
    ).toEqual([]);
  });
});

/**
 * Der Fall, an dem es Basel zerbrochen ist, als Zahl.
 *
 * Die Regeln oben vergleichen Muster mit Spalten. Das ist die Ursache. Hier
 * steht die WIRKUNG: derselbe Prüfer, den Fastify benutzt, bekommt genau den
 * Rumpf, den die Kasse sendet, und muss ihn annehmen. Ohne diesen Teil bliebe
 * offen, ob der Vertrag am Ende wirklich durchlässt, was der Tresen eintippt.
 */
describe('Der Lagerzugang, an dem es scheiterte', () => {
  const pruefer = new Ajv({ allErrors: true, strict: false });
  const gegenCreate = pruefer.compile(CreateProductBody);

  /** Genau der Rumpf, den `NeuesProduktDialog.tsx` zusammensetzt. */
  const zugang = (gewicht: string): Record<string, unknown> => ({
    sku: 'AU-KRU-0001',
    name: 'Krügerrand 1 oz',
    itemType: 'gold_coin',
    condition: 'USED_GOOD',
    taxTreatmentCode: 'MARGIN_25A',
    acquisitionCostEur: '2400.00',
    listPriceEur: '2650.00',
    hallmarkStamps: [],
    isCommission: false,
    listedOnStorefront: false,
    listedOnEbay: false,
    weightGrams: gewicht,
  });

  it('nimmt eine Feinunze an: 31,103 g', () => {
    const ok = gegenCreate(zugang('31.103'));
    expect(ok, JSON.stringify(gegenCreate.errors)).toBe(true);
  });

  it('nimmt die volle Genauigkeit der Spalte an: 31,1035 g', () => {
    expect(gegenCreate(zugang('31.1035')), JSON.stringify(gegenCreate.errors)).toBe(true);
  });

  it('nimmt ein glattes Gewicht an: 500 g', () => {
    expect(gegenCreate(zugang('500')), JSON.stringify(gegenCreate.errors)).toBe(true);
  });

  it('weist ab, was die Spalte NICHT mehr trägt: fünf Nachkommastellen', () => {
    expect(gegenCreate(zugang('31.10350'))).toBe(false);
  });

  it('weist ab, was in der Spalte überliefe: sieben Vorkommastellen', () => {
    expect(gegenCreate(zugang('1234567.0'))).toBe(false);
  });
});
