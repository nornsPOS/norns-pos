/**
 * Die Spalten-Momentaufnahme aus DEN WANDERUNGEN DIESES BAUMS bauen.
 *
 * ── WARUM DIESE DATEI ÜBERHAUPT ENTSTEHT ───────────────────────────────────
 *
 * `scripts/check-sql-columns.mjs` hält rohes SQL gegen eine Liste echter
 * Spalten. Das ist ein wichtiger Wächter: rohes SQL ist für den Typprüfer
 * unsichtbar, und eine falsch benannte Spalte geht grün durch die Übersetzung
 * und stirbt erst im Betrieb.
 *
 * Diese Liste wurde bisher per `ssh` aus der laufenden Datenbank von
 * WAREHOUSE14 gezogen. Für Norns POS ist das aus drei Gründen falsch:
 *
 *   1. Warehouse14 ist eine fremde Firma und der erste KUNDE. Ein Bauwerkzeug
 *      dieses Baums darf nicht an der Produktionsdatenbank eines Kunden
 *      hängen.
 *   2. Norns POS wird OFFLINE ausgeliefert. Die Wahrheit über sein Schema
 *      steht in `packages/db/migrations`, nicht auf einem fremden Server.
 *   3. Es driftete auseinander, und zwar still. Die Momentaufnahme vom
 *      30.07.2026 kannte weder `daily_closings.z_nr` (Wanderung 0124) noch
 *      `customers.vat_id_checked_at` (0116) noch `email_outbox.next_attempt_at`
 *      (0107), und die Tabellen `kartenleser` und `leser_zahlungen` (0121)
 *      fehlten ganz. Der Wächter war dadurch ROT — und ein roter Wächter ist
 *      ein abgeschalteter Wächter. Er meldete drei Fehlalarme und verdeckte
 *      damit einen ECHTEN Treffer: `arbeitszeiten.ts` fragte `u.deleted_at` ab,
 *      und diese Spalte heisst `soft_deleted_at`. Die ganze Fläche für
 *      Arbeitszeiten hätte 500 geworfen, Lesen wie Schreiben.
 *
 * ── WIE ES HIER GEMACHT WIRD ───────────────────────────────────────────────
 *
 * Ein Wegwerf-Postgres wird hochgefahren, ALLE Wanderungen laufen darauf mit
 * derselben Treue wie im Betrieb (`_migrate.ts`), und danach wird gelesen, was
 * wirklich entstanden ist. Kein Abschreiben aus dem SQL-Text: nur das, was
 * Postgres nach dem letzten `ALTER TABLE` tatsächlich hat, zählt.
 *
 * Der Behälter trägt einen eigenen Namen und einen eigenen Port. Er berührt
 * keinen laufenden Behälter dieser Maschine.
 */

import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import postgres from 'postgres';

import { applyAllMigrations } from '../tests/integration/_migrate.js';

const HIER = dirname(fileURLToPath(import.meta.url));
const ZIEL = resolve(HIER, '../../../packages/db/schema-snapshot/columns.json');

/**
 * Die Rolle, die die Wanderungen erwarten.
 *
 * Wörtlich dieselbe Vorbereitung wie in den Integrationsproben: mehrere
 * Wanderungen erteilen ihr Rechte, und ohne sie brechen sie ab.
 */
const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator
    LOGIN
    NOINHERIT
    SUPERUSER
    CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

async function main(): Promise<void> {
  process.stdout.write('Wegwerf-Postgres wird hochgefahren …\n');
  const behaelter = await new PostgreSqlContainer('pgvector/pgvector:pg17')
    .withDatabase('norns_schema_probe')
    .withUsername('postgres')
    .withPassword('postgres_probe_pw')
    .withCopyContentToContainer([
      { content: INITDB_SQL, target: '/docker-entrypoint-initdb.d/00.sql' },
    ])
    .start();

  const sql = postgres({
    host: behaelter.getHost(),
    port: behaelter.getPort(),
    database: 'norns_schema_probe',
    username: 'postgres',
    password: 'postgres_probe_pw',
    max: 1,
    onnotice: () => {},
  });

  try {
    process.stdout.write('Wanderungen laufen …\n');
    await applyAllMigrations(sql);

    const zeilen = await sql<{ table_name: string; column_name: string }[]>`
      SELECT table_name, column_name
        FROM information_schema.columns
       WHERE table_schema = 'public'
       ORDER BY table_name, column_name`;

    const karte: Record<string, string[]> = {};
    for (const z of zeilen) {
      (karte[z.table_name] ??= []).push(z.column_name);
    }

    // ⚠️ Sortiert schreiben, Tabellen wie Spalten. Sonst erzeugt jeder Lauf
    // eine andere Reihenfolge, der Unterschied ist nicht lesbar, und niemand
    // sieht mehr, WAS sich am Schema geändert hat.
    const sortiert = Object.fromEntries(
      Object.entries(karte)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([t, s]) => [t, [...s].sort()]),
    );

    writeFileSync(ZIEL, `${JSON.stringify(sortiert, null, 0)}\n`);
    const spalten = Object.values(sortiert).reduce((n, s) => n + s.length, 0);
    process.stdout.write(
      `Geschrieben: ${Object.keys(sortiert).length} Tabellen, ${spalten} Spalten\n${ZIEL}\n`,
    );
  } finally {
    await sql.end({ timeout: 5 });
    await behaelter.stop();
  }
}

await main();
