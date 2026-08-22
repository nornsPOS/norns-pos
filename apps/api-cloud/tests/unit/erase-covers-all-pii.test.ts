/**
 * Jede Tabelle mit PII muss von erase_customer erreicht werden.
 *
 * Diese Lücke ist in diesem Haus dreimal aufgetreten: 0094 fand `shoppers`
 * unbeachtet, 0096 fand `email_outbox` unbeachtet, und am 2026-07-22 fügte
 * 0098 `carts.shipping_address_encrypted` hinzu, ohne die Löschung davon zu
 * unterrichten. Jedes Mal wurde es lange nach der Tatsache entdeckt.
 *
 * Der Selbsttest liest die Migrationen (die Quelle der Wahrheit für das
 * Schema) und die aktuelle Definition von erase_customer und prüft: trägt
 * eine Tabelle irgendwo eine `_encrypted`-Spalte, dann muss der Rumpf von
 * erase_customer ihren Namen nennen. Fehlt einer, bricht dieser Test und
 * stellt die Frage, die dreimal zu spät gestellt wurde.
 *
 * Rein textuell und ohne Datenbank, also läuft er überall, anders als die
 * Integrationstests, die eine Postgres-Instanz brauchen.
 */

import { readFileSync, readdirSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const MIGRATIONS = new URL('../../../../packages/db/migrations/', import.meta.url);

/** `-- …`-Kommentare entfernen: sonst zählt ein Wort wie „encrypt" in einer
 * Erklärung als Spalte. Genau daran hing sich der Test zuerst an `two_factors`,
 * dessen `secret`-Spalte nur im KOMMENTAR das Wort trägt. */
function stripLineComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, '');
}

/** Alle Migrations-SQL zu einem Text, in Reihenfolge, ohne Kommentare. */
function allMigrationSql(): string {
  return readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort()
    .map((f) => stripLineComments(readFileSync(new URL(f, MIGRATIONS), 'utf8')))
    .join('\n');
}

/**
 * Die letzte (also gültige) Definition von erase_customer über alle
 * Migrationen: der Text ab dem letzten CREATE ... FUNCTION erase_customer bis
 * zum abschließenden $function$.
 */
function currentEraseBody(sql: string): string {
  const marker = /CREATE OR REPLACE FUNCTION[^;]*?erase_customer/gi;
  let last = -1;
  for (const m of sql.matchAll(marker)) last = m.index ?? last;
  expect(last, 'erase_customer wird in keiner Migration definiert').toBeGreaterThan(-1);
  const rest = sql.slice(last);
  const end = rest.indexOf('$function$;');
  return end === -1 ? rest : rest.slice(0, end);
}

/**
 * Tabellen mit mindestens einer `_encrypted`-Spalte.
 *
 * Anweisung für Anweisung (getrennt am Semikolon), damit ein `_encrypted` in
 * einer späteren, fremden Anweisung nicht fälschlich der davorstehenden
 * Tabelle zugeschlagen wird. Genau dieser Fehler ordnete zuerst `users` (die
 * Personaltabelle, die keine verschlüsselte Spalte trägt) den PII-Tabellen zu.
 */
function tablesWithEncryptedColumns(sql: string): Set<string> {
  const tables = new Set<string>();
  for (const stmt of sql.split(';')) {
    if (!/\b\w+_encrypted\b/.test(stmt)) continue;
    const m = stmt.match(
      /(?:CREATE TABLE(?:\s+IF NOT EXISTS)?|ALTER TABLE(?:\s+ONLY)?)\s+(?:public\.)?"?(\w+)"?/i,
    );
    if (m?.[1]) tables.add(m[1].toLowerCase());
  }
  // ── 19.08.2026 (Wanderung 0149): AUSGEZOGENE Tabellen brauchen kein Kehren.
  // Eine spaetere Wanderung, die eine PII-Tabelle ganz AUSZIEHT, ist die
  // staerkste Loeschung, die es gibt — die Funktion darf (und muss) sie
  // danach nicht mehr nennen, sonst scheiterte jede echte Loeschung an
  // „relation does not exist". Die Ausnahme wird aus den DROP-Saetzen der
  // Wanderungen selbst gelesen, nie aus einer Handliste.
  for (const stmt of sql.split(';')) {
    const d = stmt.match(/DROP TABLE(?:\s+IF EXISTS)?\s+(?:public\.)?"?(\w+)"?/i);
    if (d?.[1]) tables.delete(d[1].toLowerCase());
  }
  return tables;
}

describe('erase_customer erreicht jede PII-Tabelle', () => {
  const sql = allMigrationSql();
  const body = currentEraseBody(sql).toLowerCase();
  const tables = [...tablesWithEncryptedColumns(sql)].sort();

  it('findet überhaupt PII-Tabellen und einen Funktionsrumpf', () => {
    // Ein Schutz gegen einen kaputten Parser, der leise nichts findet und
    // damit alles bestehen ließe.
    expect(tables.length).toBeGreaterThanOrEqual(5);
    expect(body).toContain('erase_customer');
  });

  it('nennt jede Tabelle mit einer verschlüsselten Spalte', () => {
    const fehlend = tables.filter((t) => !body.includes(t));
    expect(fehlend, `erase_customer nennt diese PII-Tabellen NICHT: ${fehlend.join(', ')}`).toEqual(
      [],
    );
  });

  it('erreicht carts, die dreimal gefundene Lücke', () => {
    // Ausdrücklich festgehalten, weil genau diese Tabelle die jüngste
    // Wiederholung war.
    expect(tables).toContain('carts');
    expect(body).toContain('update carts');
  });
});

/**
 * ════════════════════════════════════════════════════════════════════════════
 *  ⛔ UND DIE GEGENRICHTUNG: DIE LÖSCHUNG DARF NICHT ZU WEIT REICHEN
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ── DER BEFUND VOM 22.08.2026 ─────────────────────────────────────────────
 *
 * Die Sätze oben messen EINE Richtung: vergisst die Löschung eine Tabelle?
 * Dreimal ist genau das passiert, und dreimal fiel es spät auf.
 *
 * Die andere Richtung war ungemessen: greift die Löschung zu weit? Sie läuft
 * als `SECURITY DEFINER`, also mit erhöhten Rechten — sie kommt an Spalten,
 * die der Kassenrolle ausdrücklich ENTZOGEN sind. Was sie zerstört, ist
 * zerstört, und ein Steuerauszug lässt sich nicht rückgängig machen.
 *
 * Die Regel steht seit jeher in der Wanderung selbst, als Kommentar:
 *
 *     -- transactions: keep the fiscal row; NULL only the embedded PII.
 *     -- NEVER NULL customer_id (the storno-validator trigger matches on it).
 *
 * Ein Kommentar ist keine Sicherung. Fällt diese Zeile, verliert JEDER
 * fiskale Beleg seine Zuordnung zur Person — und § 147 AO verlangt sie zehn
 * Jahre. Der Stornoprüfer verlöre zugleich sein Vergleichsmerkmal.
 *
 * ⚠️ WARUM DIE VERBINDUNG BLEIBEN DARF, OHNE ART. 17 ZU VERLETZEN: die
 * Kundenzeile SELBST überlebt die Löschung, ihr Name durch ein Merkzeichen
 * ersetzt. Der Beleg zeigt also auf eine bereits unkenntliche Akte. Die
 * Verbindung zu kappen schützt die Person nicht zusätzlich — sie nimmt dem
 * Händler nur den Nachweis.
 *
 * ⚠️ `email_outbox` setzt `customer_id = NULL` ABSICHTLICH und zu Recht: ein
 * Zustellprotokoll trägt keine Aufbewahrungspflicht nach § 147 AO. Geprüft
 * wird deshalb je Tisch, nicht über den ganzen Rumpf.
 */
const FISKAL_BLEIBT_VERBUNDEN = [
  'transactions',
  'transaction_items',
  'transaction_payments',
  'daily_closings',
  'tse_transactions',
  'tse_signatures',
] as const;

/**
 * Der gültige Rumpf, aus der ZULETZT definierenden Wanderung.
 *
 * ⚠️ Bewusst NICHT über `currentEraseBody` oben. Jener Helfer ruft `expect`
 * in seinem Innern; im Rumpf eines `describe` läuft das ausserhalb eines
 * Satzes, und was er dort zurückgibt, liess sich nicht ansehen — mein erster
 * Anlauf bekam einen Rumpf ohne `UPDATE transactions` und kein `console.log`
 * kam je heraus. Ein Wächter, dessen Messung man nicht beobachten kann, ist
 * keiner. Diese Fassung liest Datei für Datei und behält die letzte.
 */
function letzterRumpf(): string {
  const dateien = readdirSync(MIGRATIONS)
    .filter((f) => /^\d{4}_.+\.sql$/.test(f))
    .sort();
  let gefunden = '';
  for (const f of dateien) {
    const roh = stripLineComments(readFileSync(new URL(f, MIGRATIONS), 'utf8'));
    const ab = roh.search(/CREATE OR REPLACE FUNCTION\s+public\.erase_customer/i);
    if (ab === -1) continue;
    const rest = roh.slice(ab);
    const bis = rest.indexOf('$function$;');
    gefunden = bis === -1 ? rest : rest.slice(0, bis);
  }
  return gefunden;
}

describe('⛔ erase_customer kappt keine fiskale Verbindung', () => {
  const body = letzterRumpf();

  it('findet überhaupt einen Funktionsrumpf', () => {
    // „null ist nicht grün": über einem leeren Rumpf wäre alles darunter
    // trivial erfüllt.
    expect(body.length, 'erase_customer hat keinen lesbaren Rumpf').toBeGreaterThan(500);
  });

  it('⛔ fasst `transactions` überhaupt an (sonst prüft der Satz unten nichts)', () => {
    expect(body).toMatch(/UPDATE\s+transactions/i);
  });

  it.each(FISKAL_BLEIBT_VERBUNDEN)('⛔ %s behält seine Verbindung zur Kundenakte', (tisch) => {
    /*
     * Je Anweisung prüfen, nicht über den ganzen Rumpf: `email_outbox` darf
     * seine Verbindung kappen und würde einen groben Vergleich rot färben.
     */
    for (const anweisung of body.split(';')) {
      const trifft = new RegExp(`UPDATE\\s+${tisch}\\b`, 'i').test(anweisung);
      if (!trifft) continue;
      expect(
        anweisung.replace(/\s+/g, ' '),
        `Die Löschung setzt \`${tisch}.customer_id\` auf NULL. Damit verliert ein fiskaler Beleg seine Zuordnung zur (bereits unkenntlichen) Kundenakte. § 147 AO verlangt sie zehn Jahre, und der Stornoprüfer vergleicht auf ihr. Die Kundenzeile überlebt die Löschung ohnehin nur als Merkzeichen — das Kappen schützt niemanden, es nimmt nur den Nachweis.`,
      ).not.toMatch(/customer_id\s*=\s*NULL/i);
    }
  });

  it('⛔ und die Löschung fasst keinen fiskalen Tisch mit DELETE an', () => {
    const geloescht: string[] = [];
    for (const anweisung of body.split(';')) {
      const m = /DELETE\s+FROM\s+([a-z_]+)/i.exec(anweisung);
      if (m?.[1] && (FISKAL_BLEIBT_VERBUNDEN as readonly string[]).includes(m[1])) {
        geloescht.push(m[1]);
      }
    }
    expect(
      geloescht,
      'Ein fiskaler Tisch wird von der Löschung ZEILENWEISE entfernt. Das ist ' +
        'kein Unkenntlichmachen mehr, sondern das Vernichten eines ' +
        'aufbewahrungspflichtigen Belegs (§ 147 AO, § 146 Abs. 4 AO).',
    ).toEqual([]);
  });
});
