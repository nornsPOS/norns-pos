// @vitest-environment node
//
// Diese Prüfung zeichnet nichts, sie liest eine Quelldatei und ruft reine
// Helfer daraus — darum Node, nicht jsdom (dasselbe Muster wie die vier
// Wächter nebenan).

/**
 * Der Wächter über den ZEITRAUM der Steuer-Export-Fläche.
 *
 * ── WAS DER BEFUND WAR (13.08.2026) ─────────────────────────────────────────
 *
 * `SteuerExport.tsx` holte die Abschlüsse mit `closingsApi.list(api)` — OHNE
 * Zeitraum. Der Server liefert dann die 90 NEUESTEN Geschäftstage
 * (`apps/api-cloud/src/routes/closing-export.ts`: `limit` Vorgabe 90,
 * `ORDER BY business_day DESC`). Und weil genau diese Liste die einzige
 * Stelle im Haus ist, die eine Abschluss-`id` hergibt, hing JEDER der drei
 * Exporte daran: DATEV, Kassenbericht und DSFinV-K.
 *
 * Für einen Laden mit täglichem Geschäft heisst das: ab dem 91. Tag war jeder
 * ältere Kassentag über diese Fläche unerreichbar, und die Kasse sagte für
 * einen VORHANDENEN Pflichtbeleg wörtlich, es gebe ihn nicht. § 147 AO
 * verlangt zehn Jahre Aufbewahrung — eine Fläche, die nur ein Vierteljahr
 * kennt, ist eine Wand vor den Büchern, und sie steht ausgerechnet an dem
 * Tag, an dem der Prüfer im Laden ist.
 *
 * ── WARUM DER NAHELIEGENDE WEG FALSCH IST ───────────────────────────────────
 *
 * Naheliegend wäre, einfach eine grössere Zahl zu holen (etwa 500 statt 90)
 * und fertig. Das verschiebt die Wand nur: nach anderthalb Jahren steht sie
 * wieder da, diesmal leiser. Eine Liste mit fester Obergrenze OHNE Gesamtzahl
 * ist in diesem Haus eine bekannte Fehlerklasse — die Fläche kann dann
 * „steht nicht auf dieser Seite" nicht von „gibt es nicht" unterscheiden.
 * Deshalb verlangt dieser Wächter beides: einen echten Zeitraum an den
 * Server UND den Gebrauch von `gesamt` und `weitere` in der Fläche.
 *
 * ── WAS ER MISST ────────────────────────────────────────────────────────────
 *
 * Den GEBRAUCH, nicht die Erwähnung: Kommentare werden vor dem Messen
 * weggeschnitten, und die Argumente jedes `closingsApi.list(`-Aufrufs werden
 * über zählende Klammern wirklich herausgeschnitten statt per Textsuche
 * erraten. Dazu laufen die reinen Zeitraum-Helfer der Fläche echt.
 *
 * ── WARUM ER SEIT DEM 13.08.2026 DEN GANZEN BAUM LIEST ──────────────────────
 *
 * Der Wächter stand zuerst nur vor `SteuerExport.tsx`. Am selben Tag zeigte
 * eine Suche über den Baum, dass DIESELBE Liste an zwei weiteren Stellen ohne
 * Zeitraum geholt wurde — unter anderem im Kassenbericht-Export der
 * `SteuerComplianceSection.tsx`, wo der fehlende Zeitraum wörtlich den Satz
 * „Für diesen Tag liegt kein abgeschlossener Kassenbericht vor" über einen
 * Kassentag auslöste, den es sehr wohl gibt.
 *
 * Ein Wächter, der eine Datei beim Namen kennt, wird bei der nächsten neuen
 * Fläche still blind. Deshalb liest er jetzt JEDE Quelldatei der Kasse und
 * misst jeden Aufruf, den er findet.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AUFBEWAHRUNGSJAHRE,
  SEITENGROESSE,
  aufbewahrungsJahre,
  jahrDesZeitraums,
  jahresAnfang,
  jahresEnde,
  zeitraumTraegt,
} from './screens/secondary/SteuerExport.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const FLAECHE = join(HIER, 'screens/secondary/SteuerExport.tsx');

/**
 * Die Obergrenze, die der Server auf EINER Seite höchstens hergibt
 * (`closing-export.ts`, `limit: Type.Integer({ minimum: 1, maximum: 500 })`).
 * Wer mehr anfordert, bekommt von Fastify einen Schemafehler statt Zeilen.
 */
const SERVER_SEITENMAXIMUM = 500;

/** Kommentare entfernen, bevor gemessen wird. Ein Wächter, der Prosa liest,
 *  misst die Erzählung statt das Verhalten. */
function ohneKommentare(quelle: string): string {
  return quelle.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

/**
 * Die Argumentliste jedes `closingsApi.list(`-Aufrufs, über zählende Klammern
 * herausgeschnitten.
 *
 * ⚠️ Absichtlich KEIN Muster wie `closingsApi\.list\(([^)]*)\)`: das bricht
 * beim ersten inneren Klammerpaar ab (`list(api, { ... })` ist harmlos, aber
 * `list(api, filter(x))` nicht) und liesse genau den Aufruf durch, den es
 * prüfen soll.
 */
function argumenteDerListenAufrufe(quelle: string): string[] {
  const AUFRUF = 'closingsApi.list(';
  const gefunden: string[] = [];
  let ab = quelle.indexOf(AUFRUF);
  while (ab !== -1) {
    let i = ab + AUFRUF.length;
    let tiefe = 1;
    while (i < quelle.length && tiefe > 0) {
      const z = quelle[i];
      if (z === '(') tiefe += 1;
      else if (z === ')') tiefe -= 1;
      i += 1;
    }
    gefunden.push(quelle.slice(ab + AUFRUF.length, i - 1));
    ab = quelle.indexOf(AUFRUF, i);
  }
  return gefunden;
}

/** Jede Quelldatei der Kasse — ohne Prüfungen, die den Aufruf nur zitieren. */
function alleQuelldateien(wurzel: string): string[] {
  const gefunden: string[] = [];
  const gehen = (ordner: string): void => {
    for (const eintrag of readdirSync(ordner, { withFileTypes: true })) {
      const weg = join(ordner, eintrag.name);
      if (eintrag.isDirectory()) {
        if (eintrag.name === 'node_modules' || eintrag.name === 'dist') continue;
        gehen(weg);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(eintrag.name)) continue;
      if (/\.test\.tsx?$/.test(eintrag.name)) continue;
      gefunden.push(weg);
    }
  };
  gehen(wurzel);
  return gefunden;
}

const QUELLBAUM = HIER;

describe('KEINE Fläche der Kasse holt die Abschlüsse ohne Zeitraum', () => {
  // Die Wurzel des Befundes, über den ganzen Baum statt über einen Dateinamen.
  // Ein Aufruf ohne `from`/`to` bekommt die 90 NEUESTEN Tage — und die Fläche,
  // die daraufhin nichts findet, sagt über einen vorhandenen Pflichtbeleg, es
  // gebe ihn nicht.
  const dateien = alleQuelldateien(QUELLBAUM);

  const aufrufe = dateien.flatMap((datei) =>
    argumenteDerListenAufrufe(ohneKommentare(readFileSync(datei, 'utf8'))).map((args) => ({
      datei: relative(QUELLBAUM, datei),
      args,
    })),
  );

  it('der Messpunkt existiert überhaupt noch', () => {
    // Ein Wächter ohne Messpunkt ist still grün. Wird die Liste einmal
    // umbenannt oder gekapselt, muss das hier auffallen und nicht durchgehen.
    expect(
      aufrufe.length,
      'Im ganzen Quellbaum der Kasse steht kein `closingsApi.list(`-Aufruf ' +
        'mehr. Entweder wurde der Zugriff gekapselt — dann gehört dieser ' +
        'Wächter auf den neuen Namen umgestellt — oder die Abschlüsse werden ' +
        'nirgends mehr geholt.',
    ).toBeGreaterThan(0);
  });

  it.each(
    aufrufe.map((a, i) => ({
      ...a,
      nummer: i + 1,
      kurz: a.args.replace(/\s+/g, ' ').trim().slice(0, 80),
    })),
  )('$datei · Aufruf $nummer gibt einen Zeitraum mit', ({ datei, args, kurz }) => {
    expect(
      /\bfrom\s*:/.test(args) && /\bto\s*:/.test(args),
      `\`${datei}\` holt die Abschlüsse ohne Zeitraum: ` +
        `\`closingsApi.list(${kurz})\`. Der Server liefert dann die 90 ` +
        'NEUESTEN Geschäftstage. Jeder ältere Kassentag wird über diese ' +
        'Fläche unerreichbar, und sie behauptet daraufhin, es gebe ihn ' +
        'nicht — § 147 Abs. 3 AO verlangt zehn Jahre. `from` und `to` sind ' +
        'Pflicht, auch wenn die Fläche „nur" einen Verlauf zeichnet.',
    ).toBe(true);
  });
});

describe('Die Steuer-Export-Fläche erreicht jeden Tag der Aufbewahrungsfrist', () => {
  const roh = readFileSync(FLAECHE, 'utf8');
  const quelle = ohneKommentare(roh);

  it('holt die Abschlüsse überhaupt über closingsApi.list', () => {
    // Ein Wächter, dessen Messpunkt verschwindet, wird still grün. Also
    // zuerst: den Aufruf gibt es.
    expect(
      argumenteDerListenAufrufe(quelle).length,
      'In SteuerExport.tsx steht kein `closingsApi.list(`-Aufruf mehr. ' +
        'Entweder wurde die Fläche umgebaut — dann gehört dieser Wächter ' +
        'mit umgebaut — oder die Liste ist weg.',
    ).toBeGreaterThan(0);
  });

  it('JEDER Aufruf von closingsApi.list gibt einen Zeitraum mit (from und to)', () => {
    for (const args of argumenteDerListenAufrufe(quelle)) {
      expect(
        /\bfrom\s*:/.test(args) && /\bto\s*:/.test(args),
        'Ein Aufruf von `closingsApi.list` geht ohne Zeitraum an den Server: ' +
          `\`closingsApi.list(${args.trim()})\`. Der Server liefert dann die 90 ` +
          'NEUESTEN Tage, und jeder ältere Pflichtbeleg wird über diese Fläche ' +
          'unerreichbar — die Kasse behauptet dann, es gebe ihn nicht ' +
          '(§ 147 AO verlangt zehn Jahre). `from` und `to` sind Pflicht.',
      ).toBe(true);
    }
  });

  it('die angeforderte Seitengrösse überschreitet das Servermaximum nicht', () => {
    expect(
      SEITENGROESSE,
      `Die Fläche fordert ${SEITENGROESSE} Zeilen an, der Server nimmt ` +
        `höchstens ${SERVER_SEITENMAXIMUM} (closing-export.ts, Obergrenze von ` +
        'limit). Darüber antwortet Fastify mit einem Schemafehler statt mit ' +
        'Zeilen, und der Händler sieht GAR KEINE Kassentage mehr.',
    ).toBeLessThanOrEqual(SERVER_SEITENMAXIMUM);
  });

  it('jeder Aufruf bleibt innerhalb dieser Seitengrösse', () => {
    for (const args of argumenteDerListenAufrufe(quelle)) {
      const zahl = /\blimit\s*:\s*(\d+)/.exec(args);
      if (zahl?.[1] !== undefined) {
        expect(
          Number(zahl[1]),
          `Ein Aufruf fordert ${zahl[1]} Zeilen an; der Server nimmt höchstens ` +
            `${SERVER_SEITENMAXIMUM}.`,
        ).toBeLessThanOrEqual(SERVER_SEITENMAXIMUM);
      }
    }
  });

  it('die Fläche nennt die GESAMTZAHL und weist auf weitere Seiten hin', () => {
    // Die bekannte Fehlerklasse: eine Liste mit Obergrenze OHNE Gesamtzahl
    // kann „steht nicht auf dieser Seite" nicht von „gibt es nicht"
    // unterscheiden. Beide Felder liefert die Antwort bereits.
    expect(
      /\.gesamt\b/.test(quelle),
      'Die Fläche liest `gesamt` nicht. Ohne die volle Trefferzahl kann sie ' +
        'einen Ausschnitt nicht von der Wahrheit unterscheiden und zeigt ihn ' +
        'still als alles, was es gibt.',
    ).toBe(true);
    expect(
      /\.weitere\b/.test(quelle),
      'Die Fläche liest `weitere` nicht. Passt der Zeitraum nicht auf eine ' +
        'Seite, muss sie das SAGEN, statt den Rest zu verschweigen.',
    ).toBe(true);
  });

  it('der Zeitraum steht im Abfrageschlüssel, sonst klebt die alte Liste', () => {
    const schluessel = /queryKey\s*:\s*\[([^\]]*)\]/.exec(quelle);
    expect(schluessel?.[1], 'Kein `queryKey` in SteuerExport.tsx gefunden.').toBeDefined();
    expect(
      /\bvon\b/.test(schluessel?.[1] ?? '') && /\bbis\b/.test(schluessel?.[1] ?? ''),
      'Der Abfrageschlüssel trägt den Zeitraum nicht. Dann wechselt der ' +
        'Händler das Jahr, und die Fläche zeigt weiter die Zeilen des alten ' +
        'Zeitraums — mit den Knöpfen daneben, die dann den falschen Tag ziehen.',
    ).toBe(true);
  });

  it('die alte Behauptung über die GANZE Kasse steht nicht mehr da', () => {
    // „Noch keine Tagesabschlüsse vorhanden." war eine Aussage über den
    // ganzen Betrieb, gemessen an einem Ausschnitt von 90 Tagen.
    expect(
      /Noch keine Tagesabschlüsse vorhanden/.test(quelle),
      'Der Leersatz behauptet wieder etwas über die GANZE Kasse, obwohl nur ' +
        'ein Zeitraum abgefragt wurde. Er darf nur über den gewählten ' +
        'Zeitraum sprechen.',
    ).toBe(false);
  });
});

describe('Die Zeitraum-Helfer der Fläche rechnen richtig', () => {
  it('die Jahreswahl deckt die volle Aufbewahrungsfrist ab, neuestes zuerst', () => {
    const jahre = aufbewahrungsJahre(new Date('2026-08-13T10:00:00'));
    expect(jahre.length).toBe(AUFBEWAHRUNGSJAHRE);
    expect(jahre[0]).toBe(2026);
    expect(jahre[jahre.length - 1]).toBe(2026 - (AUFBEWAHRUNGSJAHRE - 1));
    // Zehn Jahre sind das gesetzliche Mass des § 147 Abs. 3 AO. Weniger wäre
    // wieder eine Wand, nur eine höhere.
    expect(AUFBEWAHRUNGSJAHRE).toBeGreaterThanOrEqual(10);
  });

  it('ein volles Jahr passt in EINE Seite, es entsteht keine stille Grenze', () => {
    // 366 Tage im Schaltjahr — der Grund, warum die Jahreswahl der sichere
    // Weg ist und die Seitengrösse nie zubeisst.
    expect(SEITENGROESSE).toBeGreaterThanOrEqual(366);
  });

  it('die Jahreswahl erkennt genau ein volles Kalenderjahr', () => {
    expect(jahrDesZeitraums(jahresAnfang(2019), jahresEnde(2019))).toBe('2019');
    expect(jahrDesZeitraums('2019-01-01', '2019-12-30')).toBe('');
    expect(jahrDesZeitraums('2019-02-01', '2019-12-31')).toBe('');
    expect(jahrDesZeitraums('', '')).toBe('');
  });

  it('ein verdrehter oder leerer Zeitraum trägt nicht', () => {
    expect(zeitraumTraegt('2026-01-01', '2026-12-31')).toBe(true);
    expect(zeitraumTraegt('2026-01-01', '2026-01-01')).toBe(true);
    expect(zeitraumTraegt('2026-12-31', '2026-01-01')).toBe(false);
    expect(zeitraumTraegt('', '2026-01-01')).toBe(false);
    expect(zeitraumTraegt('2026-01-01', '')).toBe(false);
  });

  it('ein Jahr vor zehn Jahren ist über die Wahl wirklich erreichbar', () => {
    // Der Kern des Befundes, als Rechnung: der Tag, der in den 90 neuesten
    // NIE vorkäme, liegt im Zeitraum, den die Jahreswahl baut.
    const alt = 2016;
    const von = jahresAnfang(alt);
    const bis = jahresEnde(alt);
    const alterKassentag = '2016-03-14';
    expect(zeitraumTraegt(von, bis)).toBe(true);
    expect(von <= alterKassentag && alterKassentag <= bis).toBe(true);
  });
});
