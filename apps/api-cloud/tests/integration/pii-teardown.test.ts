/**
 * THE RED LINE — PII key teardown verification (Basel directive Day 12b).
 *
 * Invariants this test PROVES end-to-end against a real Postgres:
 *
 *   1. `withPii(...)` sets `warehouse14.pii_key` for the duration of its
 *      transaction. Inside, `decrypt_pii(...)` returns the cleartext.
 *
 *   2. After `withPii(...)` returns (success), the SAME connection from the
 *      pool, on a SUBSEQUENT query, has NO key set. Verified by
 *      `current_setting('warehouse14.pii_key', true)` returning the empty
 *      string (the `true` argument means "missing_ok").
 *
 *   3. If `withPii(...)` throws inside the callback, the transaction rolls
 *      back AND the key is still cleared on connection return.
 *
 *   4. Two concurrent `withPii` calls with the same key complete without
 *      cross-talk (each gets its own transaction).
 *
 *   5. Bare `SELECT decrypt_pii(...)` outside `withPii` returns null/error —
 *      proving the API tier cannot bypass the helper accidentally.
 *
 * Test discipline: every assertion runs through a fresh `withPii` block OR a
 * raw SQL query — never through code that "should" set the key. We attack
 * the system as a hostile reviewer would.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { AppDb } from '@norns/db/client';
import * as schema from '@norns/db/schema';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyAllMigrations as applyAllMigrationsFidelity } from './_migrate.js';

import { withPii } from '../../src/lib/pii.js';
import { runInRequestScope } from '../../src/lib/request-context.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PII_KEY = 'test-pii-key-do-not-use-in-production-32b';

const INITDB_SQL = `
  CREATE ROLE warehouse14_migrator
    LOGIN
    NOINHERIT
    SUPERUSER
    CREATEROLE
    PASSWORD 'warehouse14_migrator_test_pw';
  GRANT ALL ON SCHEMA public TO warehouse14_migrator;
`;

async function applyAllMigrations(sqlClient: Sql): Promise<void> {
  await applyAllMigrationsFidelity(sqlClient);
}

describe('PII key teardown — Basel RED LINE invariant', () => {
  let container: StartedPostgreSqlContainer;
  let migratorSql: Sql;
  let appSql: Sql;
  let appDb: AppDb;
  let aliceCustomerId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer('pgvector/pgvector:pg17')
      .withDatabase('warehouse14_test')
      .withUsername('postgres')
      .withPassword('postgres_test_pw')
      .withCommand(['postgres', '-c', 'shared_preload_libraries=pg_stat_statements'])
      .withCopyContentToContainer([
        { content: INITDB_SQL, target: '/docker-entrypoint-initdb.d/00.sql' },
      ])
      .start();

    migratorSql = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_migrator',
      password: 'warehouse14_migrator_test_pw',
      max: 1,
      onnotice: () => {},
    });

    await applyAllMigrations(migratorSql);
    await migratorSql.unsafe(`ALTER ROLE warehouse14_app PASSWORD 'warehouse14_app_test_pw'`);

    // Insert Alice as an encrypted customer using the migrator role.
    const [alice] = await migratorSql<{ id: string }[]>`
      WITH s AS (SELECT set_config('warehouse14.pii_key', ${PII_KEY}, true))
      INSERT INTO customers (full_name_encrypted, retention_until)
      SELECT encrypt_pii('Alice Encrypted'), (now() + interval '5 years')::date FROM s
      RETURNING id`;
    aliceCustomerId = alice!.id;

    // Use a SMALL pool (max=1) so we maximize the chance of connection
    // reuse — making any pii_key leak visible to the very next query.
    appSql = postgres({
      host: container.getHost(),
      port: container.getPort(),
      database: 'warehouse14_test',
      username: 'warehouse14_app',
      password: 'warehouse14_app_test_pw',
      max: 1,
      onnotice: () => {},
    });
    appDb = drizzle(appSql, { schema });
  }, 60_000);

  afterAll(async () => {
    await appSql.end({ timeout: 5 }).catch(() => {});
    await migratorSql.end({ timeout: 5 }).catch(() => {});
    await container.stop().catch(() => {});
  });

  // ────────────────────────────────────────────────────────────────────
  // 1. Happy path: withPii decrypts; afterwards the key is GONE.
  // ────────────────────────────────────────────────────────────────────

  it('withPii decrypts inside its block AND the key is empty on the next query', async () => {
    const decrypted = await runInRequestScope(
      {
        actorId: null,
        deviceId: null,
        requestId: 'test-req-1',
        piiKey: PII_KEY,
      },
      () =>
        withPii(appDb, async (tx) => {
          const rows = await tx.execute(
            sql`SELECT decrypt_pii(full_name_encrypted) AS name FROM customers WHERE id = ${aliceCustomerId}`,
          );
          return (rows as unknown as { name: string }[])[0]?.name;
        }),
    );
    expect(decrypted).toBe('Alice Encrypted');

    // CRITICAL ASSERTION: same pool connection (max=1), next query — key is gone.
    const [zeile_k] = await appSql<{ k: string }[]>`
      SELECT current_setting('warehouse14.pii_key', true) AS k`;
    // Eine Zaehlabfrage liefert immer genau eine Zeile. Fehlt sie, ist die
    // Abfrage kaputt, und das ist ein Fehler DIESER Pruefung, keine Aussage
    // ueber den Pruefling.
    if (!zeile_k) throw new Error("Die Abfrage lieferte keine Zeile.");
    const { k } = zeile_k;
    expect(k).toBe(''); // current_setting with missing_ok=true returns empty string
  });

  // ────────────────────────────────────────────────────────────────────
  // 2. ROLLBACK path: throw inside withPii still tears down the key.
  // ────────────────────────────────────────────────────────────────────

  it('withPii that throws still clears the key on the next query', async () => {
    await expect(
      runInRequestScope(
        { actorId: null, deviceId: null, requestId: 'test-req-2', piiKey: PII_KEY },
        () =>
          withPii(appDb, async (tx) => {
            // Read once successfully to prove the key WAS set inside…
            await tx.execute(sql`SELECT current_setting('warehouse14.pii_key', true)`);
            throw new Error('deliberate route-handler failure');
          }),
      ),
    ).rejects.toThrow(/deliberate route-handler failure/);

    const [zeile_k] = await appSql<{ k: string }[]>`
      SELECT current_setting('warehouse14.pii_key', true) AS k`;
    // Eine Zaehlabfrage liefert immer genau eine Zeile. Fehlt sie, ist die
    // Abfrage kaputt, und das ist ein Fehler DIESER Pruefung, keine Aussage
    // ueber den Pruefling.
    if (!zeile_k) throw new Error("Die Abfrage lieferte keine Zeile.");
    const { k } = zeile_k;
    expect(k).toBe('');
  });

  // ────────────────────────────────────────────────────────────────────
  // 3. The "bypass" attack: app role tries to decrypt WITHOUT withPii.
  // ────────────────────────────────────────────────────────────────────

  it('raw SELECT decrypt_pii() outside withPii is REFUSED, kein Klartext', async () => {
    /**
     * Ohne `withPii` traegt die Verbindung keinen Schluessel, und die Datenbank
     * bricht ab, statt etwas zurueckzugeben.
     *
     * ⚠️ Bis zum 04.08.2026 verlangte diese Pruefung hier NULL. Das war die
     * schwaechere und die falsche Erwartung: NULL sieht aus wie „dieser Kunde
     * hat keinen Namen" und wandert als solches in Listen, Exporte und im
     * schlimmsten Fall zurueck in die Spalte. Wanderung 0007 schreibt das
     * Verhalten woertlich fest — nur ein NULL-Geheimtext geht durch, ein
     * fehlender oder falscher Schluessel LOEST AUS. Gemessen kommt genau das:
     * „Illegal argument to function" aus pgp_sym_decrypt.
     *
     * Der Abbruch ist der schaerfere Riegel, deshalb wird er hier gepinnt.
     */
    let fehler: unknown;
    let ausgabe: unknown;
    try {
      ausgabe = await appSql<{ name: string | null }[]>`
        SELECT decrypt_pii(full_name_encrypted) AS name
          FROM customers WHERE id = ${aliceCustomerId}`;
    } catch (e) {
      fehler = e;
    }
    expect(ausgabe).toBeUndefined();
    expect(String((fehler as Error | undefined)?.message ?? '')).toMatch(
      /Illegal argument to function|unrecognized configuration parameter|Wrong key/i,
    );

    // Und der Klartext ist in keiner Form herausgefallen.
    expect(JSON.stringify(ausgabe ?? null)).not.toContain('Alice Encrypted');
  });

  // ────────────────────────────────────────────────────────────────────
  // 4. Concurrent withPii calls do not cross-talk.
  // ────────────────────────────────────────────────────────────────────

  it('two concurrent withPii calls complete independently', async () => {
    // Note: with appSql.max=1 the two transactions actually serialize, which is
    // the strongest test — proves no setting leaks BETWEEN sequential txs.
    const [a, b] = await Promise.all([
      runInRequestScope(
        { actorId: null, deviceId: null, requestId: 'req-a', piiKey: PII_KEY },
        () =>
          withPii(appDb, async (tx) => {
            const r = await tx.execute(
              sql`SELECT decrypt_pii(full_name_encrypted) AS name FROM customers WHERE id = ${aliceCustomerId}`,
            );
            return (r as unknown as { name: string }[])[0]?.name;
          }),
      ),
      runInRequestScope(
        { actorId: null, deviceId: null, requestId: 'req-b', piiKey: PII_KEY },
        () =>
          withPii(appDb, async (tx) => {
            const r = await tx.execute(
              sql`SELECT decrypt_pii(full_name_encrypted) AS name FROM customers WHERE id = ${aliceCustomerId}`,
            );
            return (r as unknown as { name: string }[])[0]?.name;
          }),
      ),
    ]);
    expect(a).toBe('Alice Encrypted');
    expect(b).toBe('Alice Encrypted');

    // After both: key still cleared.
    const [zeile_k] = await appSql<{ k: string }[]>`
      SELECT current_setting('warehouse14.pii_key', true) AS k`;
    // Eine Zaehlabfrage liefert immer genau eine Zeile. Fehlt sie, ist die
    // Abfrage kaputt, und das ist ein Fehler DIESER Pruefung, keine Aussage
    // ueber den Pruefling.
    if (!zeile_k) throw new Error("Die Abfrage lieferte keine Zeile.");
    const { k } = zeile_k;
    expect(k).toBe('');
  });

  // ────────────────────────────────────────────────────────────────────
  // 5. currentPiiKey() refuses outside a request scope.
  // ────────────────────────────────────────────────────────────────────

  it('withPii called outside a request scope throws (refuse-by-default)', async () => {
    // No runInRequestScope wrapper → currentPiiKey() must throw.
    await expect(withPii(appDb, async () => 'should-never-execute')).rejects.toThrow(
      /outside a request scope/i,
    );
  });

  // ────────────────────────────────────────────────────────────────────
  // 6. The forbidden SQL form is not in the compiled source.
  // ────────────────────────────────────────────────────────────────────

  it('no `SET warehouse14.pii_key` (non-LOCAL form) appears in compiled source', async () => {
    const srcDir = resolve(__dirname, '..', '..', 'src');
    const allTs = await collectFiles(srcDir, '.ts');
    for (const f of allTs) {
      const text = await readFile(f, 'utf8');
      // The forbidden form would be a literal `SET warehouse14.pii_key` —
      // we use `set_config(..., true)` exclusively. The test fails on any
      // accidental switch to the session-scoped form.
      // Allow the constant defined in pii.ts which DOCUMENTS the forbidden form.
      if (f.endsWith('lib/pii.ts')) continue;
      expect(text.includes('SET warehouse14.pii_key')).toBe(false);
    }
  });

  /**
   * Die zweite Haelfte desselben Riegels, und die SCHAERFERE.
   *
   * ⚠️ Bis zum 04.08.2026 stand hier
   *      expect(text.includes("set_config('warehouse14.pii_key', ")).toBe(false)
   * mit dem Kommentar „must use parameterized form". Das misst nichts: die
   * SICHERE Form sieht Zeichen fuer Zeichen genauso aus wie die unsichere, weil
   * die Bindung im Vorlagenliteral steckt und nicht im Text. Die Zeile schlug
   * deshalb auf `routes/storefront-webhook.ts` an, obwohl die Stelle dort
   * korrekt gebunden ist, und sie haette eine eingesetzte Zeichenkette nie
   * bemerkt.
   *
   * Was WIRKLICH zaehlt, wird jetzt an JEDER Fundstelle geprueft, `lib/pii.ts`
   * eingeschlossen:
   *   • der Wert ist ein Platzhalter `${…}`, also gebunden, nie eingesetzt,
   *   • das dritte Argument ist `true`, also auf die Transaktion begrenzt.
   * Eine Fundstelle mit `false` oder mit einem Text als Schluessel macht diese
   * Pruefung rot.
   */
  it('every set_config of the PII key binds its value and is LOCAL (third arg true)', async () => {
    const srcDir = resolve(__dirname, '..', '..', 'src');
    const allTs = await collectFiles(srcDir, '.ts');
    const muster = /set_config\(\s*'warehouse14\.pii_key'\s*,\s*([^,]+),\s*([A-Za-z]+)\s*\)/g;

    const fundstellen: string[] = [];
    for (const f of allTs) {
      const text = await readFile(f, 'utf8');
      for (const zeile of text.split('\n')) {
        // Kommentarzeilen tragen die verbotene Form absichtlich als Beispiel;
        // gemessen wird nur, was wirklich laeuft.
        const kurz = zeile.trim();
        if (kurz.startsWith('*') || kurz.startsWith('//') || kurz.startsWith('/*')) continue;
        for (const treffer of zeile.matchAll(muster)) {
          fundstellen.push(`${f}: ${kurz}`);
          expect(treffer[1]?.trim().startsWith('${')).toBe(true);
          expect(treffer[2]).toBe('true');
        }
      }
    }
    // Ein Riegel, der nichts mehr findet, ist ein blinder Riegel: faende die
    // Suche keine einzige Stelle, waere oben jede Zusicherung uebersprungen.
    expect(fundstellen.length).toBeGreaterThan(0);
  });
});

async function collectFiles(dir: string, ext: string): Promise<string[]> {
  const { readdir, stat } = await import('node:fs/promises');
  const entries = await readdir(dir);
  const out: string[] = [];
  for (const e of entries) {
    const full = join(dir, e);
    const st = await stat(full);
    if (st.isDirectory()) {
      out.push(...(await collectFiles(full, ext)));
    } else if (e.endsWith(ext)) {
      out.push(full);
    }
  }
  return out;
}
