/**
 * ════════════════════════════════════════════════════════════════════════
 *  Jeder Wert, den die Datenbank halten kann, muss durch die Antwort passen
 * ════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 11.08.2026 (P0, 3 von 3 Stimmen) ─────────────────────
 *
 * `ebay_listing_state` traegt seit Wanderung 0035 einen ZEHNTEN Wert:
 * `BEENDET`. Drei Antwortschemata kannten nur neun. Sobald ein Stueck, das
 * auf eBay ONLINE stand, an der Ladentheke verkauft wird, setzt die Kasse es
 * selbst auf BEENDET (`routes/transactions-finalize.ts:1119`), und der
 * Abgleicher tut dasselbe fuer ein abgelaufenes Inserat. Ab diesem Augenblick
 * antwortete die GANZE Lagerliste mit Fehler 500 — nicht nur die eine Zeile,
 * denn `fast-json-stringify` bricht die Serialisierung der gesamten Antwort
 * ab, wenn ein `anyOf` keinen Zweig findet. Der Haendler sah keinen Bestand
 * mehr, und die Meldung nannte keinen Grund.
 *
 * ── ⚠️ WARUM DER NAHELIEGENDE WEG FALSCH IST ────────────────────────────
 *
 * Naheliegend waere, `BEENDET` an den drei Stellen nachzutragen und fertig.
 * Das ist ein Flicken an EINER Aufzaehlung. Die Wanderungen dieses Hauses
 * kennen 49 Aufzaehlungen; jede kann morgen einen Wert dazubekommen, und
 * genau dann wiederholt sich dieser Ausfall an einer anderen Liste. Ein
 * Waechter mit fester Werteliste waere ausserdem die Klasse „Waechter mit
 * Namensliste wird blind": er wuerde den elften Wert nie sehen.
 *
 * ── WAS DIESER WAECHTER MISST ───────────────────────────────────────────
 *
 * (Der fruehere TEIL 1, die HTTP-Buehne fuer den eBay-Zustand, wurde am
 * 14.08.2026 mit der Trennung von warehouse14 ausgetragen — Grabstein weiter
 * unten. Kein Antwortschema traegt die Aufzaehlung mehr.)
 *
 * TEIL 2 haelt ALLE Aufzaehlungen gegen ALLE Literal-Listen der Schnitt-
 * stelle. Der Fund ist mechanisch (Wanderungen lesen, Quelltexte lesen,
 * Kommentare vorher wegschneiden). Die Einordnung — „das ist eine Antwort,
 * die muss vollstaendig sein" gegen „das ist eine Anfrage, die darf enger
 * sein" — ist gepinnt, samt der GENAUEN Fehlmenge. Eine neue Stelle steht in
 * keiner der beiden Listen und ist damit rot; ein neuer Datenbankwert
 * veraendert die Fehlmenge einer gepinnten Stelle und ist damit ebenfalls
 * rot. Beides zwingt einen Menschen zum Hinsehen, statt still zu bestehen.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const HIER = dirname(fileURLToPath(import.meta.url));
const REPO = join(HIER, '../../../..');
const WANDERUNGEN = join(REPO, 'packages/db/migrations');

// ══════════════════════════════════════════════════════════════════════════
//  Die Aufzaehlungen der Datenbank — aus den Wanderungen, nicht abgeschrieben
// ══════════════════════════════════════════════════════════════════════════

/**
 * SQL-Kommentare entfernen, OHNE einen Wert in Anfuehrungszeichen zu
 * zerstoeren. Ein naives `--[^\n]*` reisst sonst mitten aus einer Liste wie
 * `('MATCHED', 'UNKNOWN_BARCODE', -- ...)` die folgenden Werte heraus; genau
 * das passierte bei der ersten Messung an `inventory_scan_match`.
 */
function ohneSqlKommentare(sql: string): string {
  let aus = '';
  let i = 0;
  let inText = false;
  while (i < sql.length) {
    const c = sql[i]!;
    if (inText) {
      aus += c;
      if (c === "'") {
        if (sql[i + 1] === "'") {
          aus += sql[i + 1];
          i += 2;
          continue;
        }
        inText = false;
      }
      i += 1;
      continue;
    }
    if (c === "'") {
      inText = true;
      aus += c;
      i += 1;
      continue;
    }
    if (c === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && sql[i + 1] === '*') {
      const j = sql.indexOf('*/', i + 2);
      i = j === -1 ? sql.length : j + 2;
      continue;
    }
    aus += c;
    i += 1;
  }
  return aus;
}

/** Alle `CREATE TYPE … AS ENUM` plus jedes spaetere `ALTER TYPE … ADD VALUE`. */
function aufzaehlungenDerDatenbank(): Map<string, string[]> {
  const karte = new Map<string, string[]>();
  const dateien = readdirSync(WANDERUNGEN)
    .filter((d) => d.endsWith('.sql'))
    .sort();
  for (const datei of dateien) {
    const sql = ohneSqlKommentare(readFileSync(join(WANDERUNGEN, datei), 'utf8'));
    const anlegen = /CREATE\s+TYPE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s+AS\s+ENUM\s*\(([\s\S]*?)\)\s*;/gi;
    for (let m = anlegen.exec(sql); m !== null; m = anlegen.exec(sql)) {
      const name = m[1]!.toLowerCase();
      const liste = karte.get(name) ?? [];
      for (const w of m[2]!.matchAll(/'([^']*)'/g)) {
        if (!liste.includes(w[1]!)) liste.push(w[1]!);
      }
      karte.set(name, liste);
    }
    const erweitern = /ALTER\s+TYPE\s+"?(\w+)"?\s+ADD\s+VALUE\s+(?:IF\s+NOT\s+EXISTS\s+)?'([^']*)'/gi;
    for (let m = erweitern.exec(sql); m !== null; m = erweitern.exec(sql)) {
      const name = m[1]!.toLowerCase();
      const liste = karte.get(name) ?? [];
      if (!liste.includes(m[2]!)) liste.push(m[2]!);
      karte.set(name, liste);
    }
  }
  return karte;
}

const DB_AUFZAEHLUNGEN = aufzaehlungenDerDatenbank();

function werte(name: string): string[] {
  const w = DB_AUFZAEHLUNGEN.get(name);
  if (w === undefined || w.length === 0) {
    throw new Error(
      `Die Aufzaehlung "${name}" steht in keiner Wanderung. Entweder wurde sie ` +
        'umbenannt, oder der Leser oben findet sie nicht mehr — beides muss ein ' +
        'Mensch ansehen, statt dass dieser Waechter still gruen bleibt.',
    );
  }
  return w;
}

// GRABSTEIN 14.08.2026: Der Abschnitt „Ein eBay-Zustand aus der Datenbank
// bricht keine Antwort ab" (EBAY_ANTWORTEN, fuenf Antwortgestalten) wurde mit
// der Trennung von warehouse14 ausgetragen. Die Antworten tragen den
// eBay-Zustand NICHT mehr (product-list, products-detail: Felder entfernt;
// schemas/products-ebay.ts geloescht) — was der Draht nicht traegt, kann kein
// gespeicherter Wert mehr zerbrechen. Der DB-Typ `ebay_listing_state` bleibt
// gespeicherter Zustand; seine Werte liest TEIL 2 unten weiterhin aus den
// Wanderungen, nur eben ohne HTTP-Buehne.

// ══════════════════════════════════════════════════════════════════════════
//  TEIL 2 — die Vollstaendigkeit: alle Aufzaehlungen gegen alle Literallisten
// ══════════════════════════════════════════════════════════════════════════

function ohneTsKommentare(ts: string): string {
  return ts.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function alleTsDateien(ordner: string): string[] {
  const aus: string[] = [];
  for (const e of readdirSync(ordner, { withFileTypes: true })) {
    const p = join(ordner, e.name);
    if (e.isDirectory()) aus.push(...alleTsDateien(p));
    else if (e.name.endsWith('.ts')) aus.push(p);
  }
  return aus.sort();
}

interface Fundstelle {
  datei: string;
  aufzaehlung: string;
  fehlt: string[];
}

/** Jede `Type.Union([...])`-Klammer samt der darin genannten Literale. */
function literalListen(text: string): string[][] {
  const aus: string[][] = [];
  let i = text.indexOf('Type.Union([');
  while (i !== -1) {
    let j = i + 'Type.Union(['.length;
    let tiefe = 1;
    while (j < text.length && tiefe > 0) {
      if (text[j] === '[') tiefe += 1;
      else if (text[j] === ']') tiefe -= 1;
      j += 1;
    }
    const werteDrin = [...text.slice(i, j).matchAll(/Type\.Literal\('([^']*)'\)/g)].map((m) => m[1]!);
    if (werteDrin.length >= 2) aus.push(werteDrin);
    i = text.indexOf('Type.Union([', i + 1);
  }
  return aus;
}

/**
 * Eine Literalliste gilt als Abbild einer Aufzaehlung, wenn sie ganz in ihr
 * liegt und mindestens zwei Werte teilt. „Mindestens zwei" haelt Zufaelle
 * klein; ein echter Zufall bleibt moeglich und wird unten benannt statt
 * weggeschwiegen.
 */
function fundstellen(): Fundstelle[] {
  const aus: Fundstelle[] = [];
  const wurzeln = [
    join(REPO, 'apps/api-cloud/src/schemas'),
    join(REPO, 'apps/api-cloud/src/routes'),
  ];
  for (const wurzel of wurzeln) {
    for (const datei of alleTsDateien(wurzel)) {
      const text = ohneTsKommentare(readFileSync(datei, 'utf8'));
      for (const liste of literalListen(text)) {
        const s = new Set(liste);
        for (const [name, dbWerte] of DB_AUFZAEHLUNGEN) {
          const db = new Set(dbWerte);
          const gemeinsam = [...s].filter((v) => db.has(v));
          const fehlt = dbWerte.filter((v) => !s.has(v));
          if (gemeinsam.length === s.size && gemeinsam.length >= 2 && fehlt.length > 0) {
            aus.push({
              datei: relative(REPO, datei),
              aufzaehlung: name,
              fehlt: fehlt.sort(),
            });
          }
        }
      }
    }
  }
  return aus;
}

/**
 * Die GEMESSENE Einordnung vom 11.08.2026. Schluessel: Datei + Aufzaehlung.
 * Der Wert ist die GENAUE Fehlmenge — nicht „darf enger sein", sondern
 * „genau diese Werte fehlen, und zwar aus diesem Grund". Kommt ein neuer
 * Wert in die Aufzaehlung, stimmt die Fehlmenge nicht mehr und der Waechter
 * wird rot. Das ist Absicht: ein Mensch muss dann sagen, ob der neue Wert
 * an diese Stelle gehoert.
 */
const GEPINNT: ReadonlyArray<{
  datei: string;
  aufzaehlung: string;
  fehlt: string[];
  grund: string;
}> = [
  {
    datei: 'apps/api-cloud/src/schemas/ankauf.ts',
    aufzaehlung: 'product_status',
    fehlt: ['RESERVED', 'SOLD'],
    grund:
      'ANTWORT, aber im selben Vorgang erzeugt: `createdProducts[].status` beschreibt ' +
      'Zeilen, die diese Route soeben angelegt hat. Eine soeben angelegte Zeile kann ' +
      'weder RESERVED noch SOLD sein. Eine Erweiterung waere trotzdem ehrlicher — die ' +
      'Datei gehoert einem anderen Baendel, siehe offene Punkte.',
  },
  {
    datei: 'apps/api-cloud/src/schemas/product.ts',
    aufzaehlung: 'product_status',
    fehlt: ['RESERVED', 'SOLD'],
    grund:
      'Zwei Stellen: `UpdateProduct.status` ist eine ANFRAGE und absichtlich eng ' +
      '(DRAFT → AVAILABLE ist der einzige Weg ueber diese Route; RESERVED und SOLD ' +
      'gehen ueber Lager- und Belegwege). `CreateProductResponse.status` ist eine ' +
      'ANTWORT auf eine soeben angelegte Zeile, siehe ankauf.ts.',
  },
  {
    datei: 'apps/api-cloud/src/schemas/customer-trust.ts',
    aufzaehlung: 'customer_trust_level',
    fehlt: ['BANNED', 'NEW', 'SUSPICIOUS'],
    grund:
      'ANFRAGE `promoteTrustLevelTo`: eine Beurkundung darf BEFOERDERN, nicht ' +
      'herabstufen. NEW ist der Anfangswert, BANNED und SUSPICIOUS haben eigene Wege.',
  },
  {
    datei: 'apps/api-cloud/src/schemas/inventory.ts',
    aufzaehlung: 'reservation_channel',
    fehlt: ['WEB_RESERVATION'],
    grund:
      'ANFRAGE: diese Schnittstelle nimmt Reservierungen der Kasse, des Ladens im ' +
      'Netz und von eBay entgegen. WEB_RESERVATION entsteht auf einem eigenen Weg.',
  },
  {
    datei: 'apps/api-cloud/src/schemas/belegtext.ts',
    aufzaehlung: 'belegtext_kind',
    fehlt: [
      'ANKAUFBELEG_DECLARATION',
      'GENERIC_FOOTER',
      'GENERIC_HEADER',
      'KLEINUNTERNEHMER_19',
      'REVERSE_CHARGE_13B',
    ],
    grund:
      'ZUFALL, keine Drift: die getroffene Liste ist `TAX_TREATMENT_CODE` (vier ' +
      'Steuerarten). Sie ist zufaellig eine Teilmenge von `belegtext_kind`, weil die ' +
      'Belegtexte nach denselben vier Steuerarten benannt sind. Die vollstaendige ' +
      'Liste `BELEGTEXT_KIND` daneben traegt alle neun Werte.',
  },
  // GRABSTEIN 14.08.2026: der Eintrag fuer
  // `apps/api-cloud/src/schemas/products-ebay.ts` (ebay_listing_state, fehlt
  // BEENDET) entfiel mit der Datei selbst — die eBay-Uebergangsrouten sind mit
  // der Trennung von warehouse14 geloescht, kein Schema traegt die Aufzaehlung
  // mehr. Der DB-Typ bleibt gespeicherter Zustand.
  {
    datei: 'apps/api-cloud/src/routes/appointments.ts',
    aufzaehlung: 'appointment_status',
    fehlt: ['RESCHEDULED', 'SCHEDULED'],
    grund:
      'ANFRAGE `PATCH …/status`: SCHEDULED ist der Anfangswert beim Buchen, ' +
      'RESCHEDULED setzt der Verlegeweg. Ueber diese Route sind sie nicht waehlbar.',
  },
  {
    datei: 'apps/api-cloud/src/routes/shifts.ts',
    aufzaehlung: 'cash_movement_direction',
    fehlt: ['CLOSING_RECONCILIATION', 'OPENING_FLOAT'],
    grund:
      'ANFRAGE: der Mensch bucht Einlage, Bankgang und Tresorgang. Das Wechselgeld ' +
      'beim Oeffnen und der Ausgleich beim Schliessen schreibt die Schicht selbst.',
  },
];

describe('⛔ Keine unbemerkte Drift zwischen Datenbank und Schnittstelle', () => {
  it('⛔ jede Literalliste, die enger ist als ihre Aufzaehlung, ist begruendet', () => {
    const gefunden = fundstellen();
    const offen: string[] = [];

    for (const f of gefunden) {
      const pin = GEPINNT.find((p) => p.datei === f.datei && p.aufzaehlung === f.aufzaehlung);
      if (pin === undefined) {
        offen.push(
          `${f.datei} — Aufzaehlung "${f.aufzaehlung}", es fehlen: ${f.fehlt.join(', ')}. ` +
            'Ist das eine ANTWORT? Dann bricht sie ab, sobald die Datenbank einen dieser ' +
            'Werte fuehrt. Ist es eine ANFRAGE? Dann gehoert die Fehlmenge mit Grund in ' +
            'die Liste GEPINNT.',
        );
        continue;
      }
      if (pin.fehlt.join('|') !== f.fehlt.join('|')) {
        offen.push(
          `${f.datei} — Aufzaehlung "${f.aufzaehlung}": gepinnt war [${pin.fehlt.join(', ')}], ` +
            `gemessen ist [${f.fehlt.join(', ')}]. Die Datenbank hat sich bewegt. Ein Mensch ` +
            'muss sagen, ob der neue Wert an diese Stelle gehoert.',
        );
      }
    }

    expect(offen, `\n${offen.join('\n\n')}\n`).toEqual([]);
  });

  it('⚠️ und der Leser findet ueberhaupt etwas — sonst bestuende alles', () => {
    // Schutz gegen einen stillen Parser. Faende er nichts, waere der Test oben
    // fuer immer gruen und dieser Waechter wertlos.
    expect(DB_AUFZAEHLUNGEN.size).toBeGreaterThanOrEqual(45);
    expect(werte('ebay_listing_state').length).toBeGreaterThanOrEqual(10);
    expect(werte('ebay_listing_state')).toContain('BEENDET');
    expect(fundstellen().length).toBeGreaterThanOrEqual(GEPINNT.length);
  });
});
