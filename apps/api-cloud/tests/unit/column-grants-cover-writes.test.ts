/**
 * Auf spaltenweise gesicherten Tabellen muss jede geschriebene Spalte vergeben sein.
 *
 * WARUM ES DIESEN TEST GIBT
 * Auf `carts` sind die Schreibrechte der Rolle `warehouse14_app` absichtlich
 * SPALTENWEISE vergeben (`GRANT UPDATE (spalte) ON carts TO …`), nicht auf der
 * ganzen Tabelle. Eine neu hinzugefügte Spalte ist damit still gesperrt: der
 * Code übersetzt, die Tests laufen grün, und erst auf der Produktion antwortet
 * Postgres mit 42501 „permission denied for table carts".
 *
 * Genau das geschah am 23.07.2026. Migration 0099 legte den Abholablauf an,
 * vergab aber keine Rechte. Die Folge war nicht nur, dass die drei neuen
 * Übergänge 500 warfen — der Kundenshop konnte überhaupt keine Reservierung
 * mehr annehmen, weil `storefront-reserve` beim Reservieren `pickup_stage`
 * schreibt. Die Kernfunktion des Geschäfts stand still.
 *
 * Migration 0067 hatte die Regel für genau eine Spalte schon vorgemacht. Sie
 * stand nirgends geschrieben, also wurde sie vergessen. Ab jetzt steht sie hier.
 *
 * WAS DIESER TEST SIEHT UND WAS NICHT
 * Er liest die Quelltexte und findet Spalten in `UPDATE tabelle SET …` und in
 * `.update(tabelle).set({ … })`. Einen Spaltennamen, der zur Laufzeit aus einer
 * Variablen kommt (`${sql.raw(spalte)} = now()`), kann er nicht sehen; für den
 * einen Fall dieser Art im Haus steht unten eine ausdrückliche Prüfung. Rein
 * textuell und ohne Datenbank, also läuft er überall.
 *
 * NACHTRAG 11.08.2026 (Befund 10, Belegnummer): Wanderung 0135 ENTZIEHT der
 * Anwendungsrolle das spaltenweise UPDATE auf `transactions.receipt_locator`.
 * Der Parser hier kannte bis dahin nur GRANT — ein entzogenes Recht wäre in
 * seiner Karte stehen geblieben, und der Test hätte künftigen Code, der die
 * Spalte schreibt, für gedeckt gehalten, während die Produktion 42501 wirft.
 * Der naheliegende Weg (REVOKE schlicht ignorieren) baut also genau die
 * Blindheit, gegen die dieser Test existiert. Deshalb liest er jetzt GRANT
 * und REVOKE in Wanderungsreihenfolge, und eine eigene Prüfung unten pinnt
 * den Zustand nach 0135 fest.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const MIGRATIONS = new URL('../../../../packages/db/migrations/', import.meta.url);
const QUELLEN: Array<{ pfad: URL; rolle: string }> = [
  { pfad: new URL('../../src/', import.meta.url), rolle: 'warehouse14_app' },
];

/** `-- …` entfernen, damit ein Spaltenname in einer Erklärung nicht mitzählt. */
function ohneSqlKommentare(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/** Zeilen- und Blockkommentare entfernen. Ohne das zählt eine JSDoc-Zeile wie
 *  „• UPDATE carts SET status='CONVERTED'" in storefront-webhook.ts als echter
 *  Schreibvorgang, und der Test misst Kommentare statt Code. */
function ohneTsKommentare(ts: string): string {
  return ts.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

function alleMigrationen(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((f) => ohneSqlKommentare(readFileSync(new URL(f, MIGRATIONS), 'utf8')))
    .join('\n');
}

function alleTsDateien(wurzel: URL): string[] {
  const start = fileURLToPath(wurzel);
  const gefunden: string[] = [];
  const gehe = (verzeichnis: string): void => {
    for (const eintrag of readdirSync(verzeichnis)) {
      const voll = join(verzeichnis, eintrag);
      if (statSync(voll).isDirectory()) gehe(voll);
      else if (voll.endsWith('.ts')) gefunden.push(voll);
    }
  };
  gehe(start);
  return gefunden;
}

/**
 * Eine SET-Liste an den Kommas der OBERSTEN Ebene trennen.
 *
 * Ein schlichtes `split(',')` reicht nicht: `COALESCE(a, b)` bringt ein Komma
 * mit, das keine neue Zuweisung einleitet. Damit meldete der Test auf
 * `shoppers` zuerst nur die erste von vier fehlenden Spalten — er schlug zwar
 * an, aber die Liste im Fehlertext war unvollständig, und eine unvollständige
 * Liste führt zu einer unvollständigen Vergabe.
 */
function aufOberstemKommaTeilen(setListe: string): string[] {
  const teile: string[] = [];
  let tiefe = 0;
  let aktuell = '';
  for (const zeichen of setListe) {
    if (zeichen === '(') tiefe += 1;
    else if (zeichen === ')') tiefe -= 1;
    if (zeichen === ',' && tiefe <= 0) {
      teile.push(aktuell);
      aktuell = '';
      continue;
    }
    aktuell += zeichen;
  }
  teile.push(aktuell);
  return teile;
}

/** camelCase → snake_case, wie Drizzle die Spalten benennt. */
function zuSchlangenschrift(name: string): string {
  return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/**
 * Tabellen, deren UPDATE-Recht für eine Rolle spaltenweise vergeben ist, samt
 * der Menge der vergebenen Spalten. Eine Tabelle, die irgendwo ein
 * tabellenweites `GRANT UPDATE ON …` bekommt, ist NICHT eingeschränkt und
 * fliegt wieder heraus — sonst würde der Test dort falsch anschlagen.
 */
function spaltenweiseVergeben(sql: string, rolle: string): Map<string, Set<string>> {
  const eingeschraenkt = new Map<string, Set<string>>();
  // GRANT und REVOKE in EINEM Muster, damit die Karte der WANDERUNGSREIHENFOLGE
  // folgt: `alleMigrationen()` verkettet sortiert, ein späteres REVOKE (0135)
  // nimmt eine frühere Vergabe (0009) also wirklich wieder heraus. Zwei
  // getrennte Durchläufe könnten ein Recht behalten, das die Datenbank längst
  // nicht mehr kennt.
  const spaltenRegel = new RegExp(
    `(GRANT|REVOKE)\\s+UPDATE\\s*\\(([^)]*)\\)\\s*ON\\s+(?:TABLE\\s+)?(?:public\\.)?"?(\\w+)"?\\s+(?:TO|FROM)\\s+${rolle}`,
    'gis',
  );
  for (const m of sql.matchAll(spaltenRegel)) {
    const entzug = (m[1] ?? '').toUpperCase() === 'REVOKE';
    const tabelle = (m[3] ?? '').toLowerCase();
    const spalten = (m[2] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/"/g, '').toLowerCase())
      .filter(Boolean);
    const bisher = eingeschraenkt.get(tabelle) ?? new Set<string>();
    for (const s of spalten) {
      if (entzug) bisher.delete(s);
      else bisher.add(s);
    }
    eingeschraenkt.set(tabelle, bisher);
  }
  const ganzeTabelle = new RegExp(
    `GRANT\\s+[^;(]*\\bUPDATE\\b[^;(]*\\s+ON\\s+(?:TABLE\\s+)?(?:public\\.)?"?(\\w+)"?\\s+TO\\s+${rolle}`,
    'gis',
  );
  for (const m of sql.matchAll(ganzeTabelle)) {
    eingeschraenkt.delete((m[1] ?? '').toLowerCase());
  }
  return eingeschraenkt;
}

/** Spalten, die eine Quelle auf `tabelle` schreibt, soweit statisch sichtbar. */
function geschriebeneSpalten(quelle: string, tabelle: string): Set<string> {
  const spalten = new Set<string>();

  // 1) Rohes SQL: UPDATE <tabelle> SET a = …, b = … [WHERE|RETURNING|`]
  const rohes = new RegExp(
    `UPDATE\\s+(?:public\\.)?"?${tabelle}"?\\s+SET\\s+([\\s\\S]*?)(?:\\bWHERE\\b|\\bRETURNING\\b|\`)`,
    'gi',
  );
  for (const m of quelle.matchAll(rohes)) {
    for (const zuweisung of aufOberstemKommaTeilen(m[1] ?? '')) {
      const name = zuweisung.match(/^\s*"?([a-z_][a-z0-9_]*)"?\s*=/i);
      if (name?.[1]) spalten.add(name[1].toLowerCase());
    }
  }

  // 2) Drizzle: .update(<tabelle in camelCase>).set({ feld: …, feld2: … })
  const drizzleName = tabelle.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
  const drizzle = new RegExp(
    `\\.update\\(\\s*${drizzleName}\\s*\\)[\\s\\S]{0,80}?\\.set\\(\\s*\\{([\\s\\S]*?)\\}\\s*\\)`,
    'g',
  );
  for (const m of quelle.matchAll(drizzle)) {
    for (const feld of (m[1] ?? '').matchAll(/(?:^|[,{])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g)) {
      if (feld[1]) spalten.add(zuSchlangenschrift(feld[1]));
    }
  }
  return spalten;
}

describe('Spaltenweise Vergaben decken jeden Schreibvorgang', () => {
  const sql = alleMigrationen();

  it('erkennt carts überhaupt als spaltenweise gesichert', () => {
    // Schutz gegen einen stillen Parser: findet er nichts, bestünde alles.
    const tabellen = spaltenweiseVergeben(sql, 'warehouse14_app');
    expect([...tabellen.keys()]).toContain('carts');
    expect(tabellen.get('carts')!.size).toBeGreaterThanOrEqual(7);
  });

  for (const { pfad, rolle } of QUELLEN) {
    const eingeschraenkt = spaltenweiseVergeben(sql, rolle);
    const quelle = ohneTsKommentare(
      alleTsDateien(pfad)
        .map((f) => readFileSync(f, 'utf8'))
        .join('\n'),
    );

    for (const [tabelle, vergeben] of eingeschraenkt) {
      it(`${rolle} darf auf ${tabelle} jede Spalte schreiben, die der Code setzt`, () => {
        const geschrieben = [...geschriebeneSpalten(quelle, tabelle)].sort();
        const fehlend = geschrieben.filter((s) => !vergeben.has(s));
        expect(
          fehlend,
          `Der Code schreibt ${tabelle}.${fehlend.join(', ' + tabelle + '.')}, aber ${rolle} hat dafür kein GRANT UPDATE. ` +
            `Eine Migration mit "GRANT UPDATE (${fehlend.join(', ')}) ON ${tabelle} TO ${rolle};" fehlt.`,
        ).toEqual([]);
      });
    }
  }

  it('⛔ die Belegnummer traegt nach 0135 KEIN UPDATE-Recht mehr (und die Nachbarn schon)', () => {
    // Befund 10: das stehende Recht aus 0009 auf `transactions.receipt_locator`
    // hatte keinen Aufrufer und keinen Ausloeser, der eine Aenderung
    // aufzeichnet — nach Paragraf 146 Abs. 4 AO muss es weg. Diese Pruefung
    // pinnt zugleich fest, dass der Parser REVOKE wirklich liest: ohne den
    // Nachtrag oben waere sie fuer immer rot oder fuer immer blind.
    const vergeben = spaltenweiseVergeben(sql, 'warehouse14_app').get('transactions');
    expect(vergeben, 'transactions ist nicht mehr spaltenweise gesichert?').toBeDefined();
    expect(vergeben!.has('receipt_locator'), 'receipt_locator ist wieder vergeben').toBe(false);
    for (const spalte of ['printed_at', 'notes_internal', 'updated_at', 'shift_id']) {
      expect(vergeben!.has(spalte), `transactions.${spalte} hat sein UPDATE-Recht verloren`).toBe(
        true,
      );
    }
  });

  it('vergibt auch die drei Stempel, die nur zur Laufzeit benannt werden', () => {
    // orders.ts setzt die Zeitstempel über `${sql.raw(stampColumn)} = now()`.
    // Der Name steht dort in einer Variablen, also kann die Suche oben ihn
    // nicht sehen. Diese drei werden deshalb ausdrücklich geprüft.
    const vergeben = spaltenweiseVergeben(sql, 'warehouse14_app').get('carts')!;
    for (const spalte of ['approved_at', 'preparation_started_at', 'ready_at']) {
      expect(vergeben, `carts.${spalte} ist nicht an warehouse14_app vergeben`).toContain(spalte);
    }
  });
});
