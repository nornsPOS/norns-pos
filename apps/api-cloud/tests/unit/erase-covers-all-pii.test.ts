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
